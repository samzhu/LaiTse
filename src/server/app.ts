import { randomUUID } from "node:crypto";
import type { ServerOptions as HttpsServerOptions } from "node:https";
import path from "node:path";
import Fastify, { type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import {
  MAX_CAPABILITY_MESSAGE_BYTES,
  MAX_STORED_CAPABILITY_REPORTS,
  validateCapabilityReport,
  type SanitizedCapabilityReport,
} from "./capabilities.ts";
import { createAudioRelay } from "./audio-relay.ts";
import { createScreenRelay, MAX_SCREEN_FRAME_BYTES, MAX_SCREEN_SOCKET_BUFFERED_BYTES } from "./screen-relay.ts";
import {
  createSpaceModel,
  isKnownRoom,
  isMoveDirection,
  MAX_MOVES_PER_SECOND,
  MAX_SPACE_MEMBERS,
  MOVE_WINDOW_MS,
  SPACE_ROOMS,
  type RoomId,
  type SpaceMember,
} from "./space.ts";

export const MAX_CONTROL_MESSAGE_BYTES = 1_024;
export const MAX_ROOM_MEMBERS = MAX_SPACE_MEMBERS;
export const MAX_SOCKET_BUFFERED_BYTES = MAX_SCREEN_SOCKET_BUFFERED_BYTES;

const ROOM = SPACE_ROOMS[0];
const REACTIONS = new Set(["wave", "clap", "heart"]);
const MAX_DISPLAY_NAME_CODE_POINTS = 32;
const MAX_EVENTS_PER_SECOND = 10;
const EVENT_WINDOW_MS = 1_000;

type Member = SpaceMember;

type ControlEvent = {
  seq: number;
  kind: "member.joined" | "member.left" | "reaction";
  roomId: string;
  participantId: string;
  displayName: string;
  reaction?: string;
  at: number;
};

type ClientConnection = {
  id: string;
  member?: Member;
  currentRoomId?: RoomId;
  eventTimes: number[];
  moveTimes: number[];
};

type CapabilityObservation = {
  observationId: string;
  observedAtServer: string;
  connectionId: string;
  roomId: string;
  member: Member;
  report: SanitizedCapabilityReport;
};

type CreateAppOptions = {
  clientRoot?: string;
  serveClient?: boolean;
  https?: HttpsServerOptions;
};

function isSameOriginRequest(request: FastifyRequest, useHttps: boolean): boolean {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return false;

  try {
    const parsedOrigin = new URL(origin);
    const protocol = useHttps ? "https:" : "http:";
    const expectedOrigin = new URL(`${protocol}//${host}`);
    return parsedOrigin.origin === expectedOrigin.origin;
  } catch {
    return false;
  }
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

export async function createApp(options: CreateAppOptions = {}) {
  const app = Fastify({ logger: false, https: options.https ?? null });
  const clients = new Map<import("ws").WebSocket, ClientConnection>();
  const members = new Map<string, Member>();
  const observations = new Map<string, CapabilityObservation>();
  const space = createSpaceModel();
  const audioRelay = createAudioRelay();
  const screenRelay = createScreenRelay();
  let sequence = 0;
  let spaceSequence = 0;

  await app.register(fastifyWebsocket, {
    options: { maxPayload: MAX_SCREEN_FRAME_BYTES },
  });

  if (options.serveClient !== false) {
    const clientRoot = options.clientRoot ?? path.resolve(process.cwd(), "dist/client");
    await app.register(fastifyStatic, {
      root: clientRoot,
      prefix: "/",
      index: "index.html",
      wildcard: true,
    });
  }

  app.get("/api/health", async () => ({
    status: "ok",
    persistence: "process-memory",
  }));

  app.get("/api/rooms", async () => SPACE_ROOMS.map(({ id, name }) => ({ id, name })));

  app.get<{ Params: { observationId: string } }>("/api/observations/:observationId", async (request, reply) => {
    const observation = observations.get(request.params.observationId);
    if (!observation) return reply.code(404).send({ error: "observation_not_found" });
    return observation;
  });

  app.get(
    "/ws",
    {
      websocket: true,
      onRequest: async (request, reply) => {
        if (!isSameOriginRequest(request, Boolean(options.https))) {
          return reply.code(403).send({ error: "origin_not_allowed" });
        }
      },
    },
    (socket) => {
      const connection: ClientConnection = { id: randomUUID(), eventTimes: [], moveTimes: [] };
      clients.set(socket, connection);

      const send = (message: unknown) => {
        if (socket.readyState !== socket.OPEN) return;
        const payload = JSON.stringify(message);
        if (socket.bufferedAmount + Buffer.byteLength(payload) > MAX_SOCKET_BUFFERED_BYTES) {
          socket.close(1013, "Receiver is too slow");
          return;
        }
        socket.send(payload, (error) => {
          if (error) socket.terminate();
        });
      };

      const sendBinary = (message: Buffer) => {
        if (socket.readyState !== socket.OPEN) return;
        if (socket.bufferedAmount + message.byteLength > MAX_SOCKET_BUFFERED_BYTES) {
          socket.close(1013, "Receiver is too slow");
          return;
        }
        socket.send(message, { binary: true, compress: false }, (error) => {
          if (error) socket.terminate();
        });
      };

      const sendScreenBinary = (message: Buffer) => {
        if (socket.readyState !== socket.OPEN) return;
        if (socket.bufferedAmount + message.byteLength > MAX_SCREEN_SOCKET_BUFFERED_BYTES) {
          socket.close(1013, "Screen receiver is too slow");
          return;
        }
        socket.send(message, { binary: true, compress: false }, (error) => {
          if (error) socket.terminate();
        });
      };

      const rejectControl = (code: string, message: string, closeCode = 1008) => {
        send({ type: "protocol.error", code, message });
        socket.once("error", () => {});
        socket.close(closeCode, "Invalid control message");
      };

      const sendProtocolError = (code: string, message: string) => {
        send({ type: "protocol.error", code, message });
      };

      const registerMediaConnection = () => {
        audioRelay.register(connection.id, {
          sendControl: send,
          sendBinary,
          reject: rejectControl,
          readyState: () => socket.readyState,
          openState: socket.OPEN,
        });
        screenRelay.register(connection.id, {
          sendControl: send,
          sendBinary,
          sendScreenBinary,
          reject: rejectControl,
          readyState: () => socket.readyState,
          openState: socket.OPEN,
        });
      };
      registerMediaConnection();

      const broadcastSpaceState = () => {
        const seq = ++spaceSequence;
        for (const [target, targetConnection] of clients) {
          if (!targetConnection.member || !targetConnection.currentRoomId || target.readyState !== target.OPEN) continue;
          const payload = JSON.stringify({
            type: "space.snapshot",
            ...space.snapshot({
              seq,
              participantId: targetConnection.member.id,
              currentRoomId: targetConnection.currentRoomId,
            }),
          });
          if (target.bufferedAmount + Buffer.byteLength(payload) > MAX_SOCKET_BUFFERED_BYTES) {
            target.close(1013, "Receiver is too slow");
          } else {
            target.send(payload, (error) => {
              if (error) target.terminate();
            });
          }
        }
      };

      const emit = (kind: ControlEvent["kind"], member: Member, roomId: RoomId, reaction?: string) => {
        const event: ControlEvent = {
          seq: ++sequence,
          kind,
          roomId,
          participantId: member.id,
          displayName: member.displayName,
          at: Date.now(),
          ...(reaction ? { reaction } : {}),
        };
        const message = { type: "control.event", event };
        for (const [target, targetConnection] of clients) {
          if (targetConnection.member && targetConnection.currentRoomId === roomId && target.readyState === target.OPEN) {
            const payload = JSON.stringify(message);
            if (target.bufferedAmount + Buffer.byteLength(payload) > MAX_SOCKET_BUFFERED_BYTES) {
              target.close(1013, "Receiver is too slow");
            } else {
              target.send(payload, (error) => {
                if (error) target.terminate();
              });
            }
          }
        }
        return event;
      };

      socket.on("message", (raw, isBinary) => {
        if (socket.readyState !== socket.OPEN) return;
        const bytes = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw);
        if (isBinary) {
          if (connection.currentRoomId !== ROOM.id) {
            sendProtocolError("media_unavailable_in_room", "Audio and screen relay are available only in the lobby during this step.");
            return;
          }
          if (screenRelay.handleBinary(connection.id, bytes)) return;
          audioRelay.handleBinary(connection.id, bytes);
          return;
        }
        if (bytes.byteLength > MAX_CAPABILITY_MESSAGE_BYTES) {
          rejectControl("invalid_message", "WebSocket frames must be small UTF-8 JSON text.", bytes.byteLength > MAX_CAPABILITY_MESSAGE_BYTES ? 1009 : 1008);
          return;
        }

        let payload: unknown;
        try {
          payload = JSON.parse(bytes.toString("utf8"));
        } catch {
          rejectControl("invalid_message", "Control frames must be valid JSON.", bytes.byteLength > MAX_CONTROL_MESSAGE_BYTES ? 1009 : 1008);
          return;
        }

        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          rejectControl("invalid_message", "Control frames must be JSON objects.", bytes.byteLength > MAX_CONTROL_MESSAGE_BYTES ? 1009 : 1008);
          return;
        }

        const message = payload as Record<string, unknown>;
        if (message.type === "capability.report") {
          if (bytes.byteLength > MAX_CAPABILITY_MESSAGE_BYTES) {
            rejectControl("invalid_capability_report", "Capability reports must stay within the 8 KiB limit.", 1009);
            return;
          }
          if (!connection.member) {
            rejectControl("invalid_capability_report", "Join the local room before sending a capability report.");
            return;
          }
          if (!hasOnlyKeys(message, ["type", "report"])) {
            rejectControl("invalid_capability_report", "Capability reports contain fields outside the supported schema.");
            return;
          }
          const report = validateCapabilityReport(message.report);
          if (!report) {
            rejectControl("invalid_capability_report", "Capability report schema or bounds are invalid.");
            return;
          }

          const observation: CapabilityObservation = {
            observationId: randomUUID(),
            observedAtServer: new Date().toISOString(),
            connectionId: connection.id,
            roomId: connection.currentRoomId ?? ROOM.id,
            member: { ...connection.member },
            report,
          };
          observations.set(observation.observationId, observation);
          while (observations.size > MAX_STORED_CAPABILITY_REPORTS) {
            const oldestObservationId = observations.keys().next().value;
            if (!oldestObservationId) break;
            observations.delete(oldestObservationId);
          }
          send({
            type: "capability.ack",
            observationId: observation.observationId,
            observedAtServer: observation.observedAtServer,
            connectionId: observation.connectionId,
            roomId: observation.roomId,
            member: observation.member,
          });
          return;
        }

        if (bytes.byteLength > MAX_CONTROL_MESSAGE_BYTES) {
          rejectControl("invalid_message", "Control frames are limited to 1 KiB; capability reports have a separate 8 KiB bound.", 1009);
          return;
        }

        if (
          connection.currentRoomId !== ROOM.id &&
          typeof message.type === "string" &&
          (message.type.startsWith("audio.") || message.type.startsWith("screen."))
        ) {
          sendProtocolError("media_unavailable_in_room", "Audio and screen relay are available only in the lobby during this step.");
          return;
        }

        if (audioRelay.handleControl(connection.id, message)) return;
        if (screenRelay.handleControl(connection.id, message)) return;

        if (!connection.member) {
          if (
            !hasOnlyKeys(message, ["type", "roomId", "displayName"]) ||
            message.type !== "join" ||
            !isKnownRoom(message.roomId) ||
            typeof message.displayName !== "string"
          ) {
            rejectControl("invalid_join", "Choose an available room and join with a short display name.");
            return;
          }

          const displayName = message.displayName.trim();
          const codePointCount = Array.from(displayName).length;
          if (
            codePointCount < 1 ||
            codePointCount > MAX_DISPLAY_NAME_CODE_POINTS ||
            /[\u0000-\u001f\u007f]/u.test(displayName)
          ) {
            rejectControl("invalid_join", "Display names must contain 1 to 32 printable characters.");
            return;
          }

          if (members.size >= MAX_ROOM_MEMBERS) {
            rejectControl("room_full", "The local space has reached its eight participant limit.");
            return;
          }

          const roomId = message.roomId;
          const member = { id: randomUUID(), displayName };
          connection.member = member;
          connection.currentRoomId = roomId;
          space.add(member, roomId);
          if (roomId === ROOM.id) {
            audioRelay.markJoined(connection.id);
            screenRelay.markJoined(connection.id);
          }
          members.set(member.id, member);
          const event = emit("member.joined", member, roomId);
          const room = SPACE_ROOMS.find((candidate) => candidate.id === roomId)!;
          send({
            type: "room.snapshot",
            room: { id: room.id, name: room.name },
            members: space.roomMembers(roomId),
            lastSeq: event.seq,
          });
          broadcastSpaceState();
          return;
        }

        if (message.type === "space.move") {
          if (!hasOnlyKeys(message, ["type", "direction"]) || !isMoveDirection(message.direction)) {
            rejectControl("invalid_space_move", "Move one bounded step using up, down, left, or right.");
            return;
          }
          const now = Date.now();
          connection.moveTimes = connection.moveTimes.filter((moveAt) => now - moveAt < MOVE_WINDOW_MS);
          if (connection.moveTimes.length >= MAX_MOVES_PER_SECOND) {
            sendProtocolError("movement_rate_limited", "Movement is arriving too quickly; pause briefly and try again.");
            return;
          }
          connection.moveTimes.push(now);
          const result = space.move(connection.member.id, message.direction);
          if (!result.changed) {
            sendProtocolError("movement_out_of_bounds", "That step is outside this room. Your position was not changed.");
            return;
          }
          broadcastSpaceState();
          return;
        }

        if (message.type === "room.switch") {
          if (!hasOnlyKeys(message, ["type", "roomId"])) {
            rejectControl("invalid_room_switch", "Room switching accepts only an available room ID.");
            return;
          }
          if (!isKnownRoom(message.roomId)) {
            sendProtocolError("unknown_room", "That room is not available.");
            return;
          }
          const previousRoomId = connection.currentRoomId!;
          const nextRoomId = message.roomId;
          if (previousRoomId !== nextRoomId) {
            audioRelay.disconnect(connection.id);
            screenRelay.disconnect(connection.id);
            registerMediaConnection();
            emit("member.left", connection.member, previousRoomId);
            connection.currentRoomId = nextRoomId;
            space.switchRoom(connection.member.id, nextRoomId);
            if (nextRoomId === ROOM.id) {
              audioRelay.markJoined(connection.id);
              screenRelay.markJoined(connection.id);
            }
            emit("member.joined", connection.member, nextRoomId);
          }
          const room = SPACE_ROOMS.find((candidate) => candidate.id === nextRoomId)!;
          send({
            type: "room.snapshot",
            room: { id: room.id, name: room.name },
            members: space.roomMembers(nextRoomId),
            lastSeq: sequence,
          });
          broadcastSpaceState();
          return;
        }

        if (
          !hasOnlyKeys(message, ["type", "reaction"]) ||
          message.type !== "reaction" ||
          typeof message.reaction !== "string" ||
          !REACTIONS.has(message.reaction)
        ) {
          rejectControl("invalid_event", "Only the bounded wave, clap, and heart reactions are accepted.");
          return;
        }

        const now = Date.now();
        connection.eventTimes = connection.eventTimes.filter((eventAt) => now - eventAt < EVENT_WINDOW_MS);
        if (connection.eventTimes.length >= MAX_EVENTS_PER_SECOND) {
          rejectControl("rate_limited", "The local control event rate limit was reached.");
          return;
        }
        connection.eventTimes.push(now);
        emit("reaction", connection.member, connection.currentRoomId!, message.reaction);
      });

      socket.on("close", () => {
        clients.delete(socket);
        audioRelay.disconnect(connection.id);
        screenRelay.disconnect(connection.id);
        if (!connection.member) return;
        members.delete(connection.member.id);
        space.remove(connection.member.id);
        emit("member.left", connection.member, connection.currentRoomId!);
        broadcastSpaceState();
      });

      socket.on("error", () => {
        // The connection close handler owns membership cleanup.
      });
    },
  );

  app.addHook("onClose", async () => {
    clients.clear();
    members.clear();
    observations.clear();
    audioRelay.close();
    screenRelay.close();
  });

  return app;
}
