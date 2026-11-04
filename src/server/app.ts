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
import { createHostControlPolicy } from "./host-control.ts";
import { createRoomAccessPolicy, isValidRoomPassword } from "./room-access.ts";
import {
  InteractionStore,
  MAX_FEEDBACK_PER_SECOND,
  MAX_INTERACTION_MESSAGE_BYTES,
  MAX_INTERACTIONS_PER_SECOND,
  parseInteractionInput,
} from "./interactions.ts";
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

const DEFAULT_ROOM = SPACE_ROOMS[0];
const REACTIONS = new Set(["wave", "clap", "heart"]);
const MAX_DISPLAY_NAME_CODE_POINTS = 32;
const MAX_EVENTS_PER_SECOND = 10;
const EVENT_WINDOW_MS = 1_000;

type Member = SpaceMember;
type ParticipationRole = "participant" | "display";
type ParticipationMode = "watch" | "interaction";

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
  hostActive: boolean;
  role: ParticipationRole;
  mode: ParticipationMode;
  removed: boolean;
  downlink: {
    audio: { bytes: number; frames: number };
    screen: { bytes: number; frames: number };
  };
  eventTimes: number[];
  interactionTimes: number[];
  feedbackTimes: number[];
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
  meetingRoomPassword?: string;
  hostControlToken?: string;
};

type MediaMetricCounter = {
  controlMessagesSent: number;
  binaryFramesSent: number;
  rejected: number;
  guardedSendChecks: number;
  crossRoomGuardBlocks: number;
};

type ControlMetricCounter = {
  roomSnapshotsSent: number;
  spaceSnapshotsSent: number;
  eventsSent: number;
  rejected: number;
  guardedSendChecks: number;
  crossRoomGuardBlocks: number;
};

type RoomMetricCounters = {
  control: ControlMetricCounter;
  audio: MediaMetricCounter;
  screen: MediaMetricCounter;
};

type RoomRelays = {
  audio: ReturnType<typeof createAudioRelay>;
  screen: ReturnType<typeof createScreenRelay>;
};

function createRoomMetricCounters(): RoomMetricCounters {
  return {
    control: {
      roomSnapshotsSent: 0,
      spaceSnapshotsSent: 0,
      eventsSent: 0,
      rejected: 0,
      guardedSendChecks: 0,
      crossRoomGuardBlocks: 0,
    },
    audio: {
      controlMessagesSent: 0,
      binaryFramesSent: 0,
      rejected: 0,
      guardedSendChecks: 0,
      crossRoomGuardBlocks: 0,
    },
    screen: {
      controlMessagesSent: 0,
      binaryFramesSent: 0,
      rejected: 0,
      guardedSendChecks: 0,
      crossRoomGuardBlocks: 0,
    },
  };
}

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

function publicRooms(roomAccess: ReturnType<typeof createRoomAccessPolicy>, hostControlsEnabled: boolean) {
  return SPACE_ROOMS.map(({ id, name, kind, audioPolicy, audioRadiusGridUnits }) => ({
    id,
    name,
    kind,
    audioPolicy,
    audioRadiusGridUnits,
    isLocked: roomAccess.isMeetingRoomLocked(id),
    hostControlsEnabled,
  }));
}

function displayInteractionProjection(state: ReturnType<InteractionStore["snapshot"]>) {
  return { ...state, history: [] as typeof state.history, publicQueue: state.publicQueue.filter((event) => event.kind === "danmaku") };
}

export async function createApp(options: CreateAppOptions = {}) {
  if (options.hostControlToken && options.meetingRoomPassword && options.hostControlToken === options.meetingRoomPassword) {
    throw new Error("HOST_CONTROL_TOKEN must be different from MEETING_ROOM_PASSWORD.");
  }
  const app = Fastify({ logger: false, https: options.https ?? null });
  const clients = new Map<import("ws").WebSocket, ClientConnection>();
  const members = new Map<string, Member>();
  const observations = new Map<string, CapabilityObservation>();
  const space = createSpaceModel();
  const interactions = new InteractionStore(SPACE_ROOMS.map(({ id }) => id));
  const roomAccess = createRoomAccessPolicy(options.meetingRoomPassword);
  const hostControl = createHostControlPolicy(options.hostControlToken);
  const publisherGrants = new Map<RoomId, Set<string>>(SPACE_ROOMS.map(({ id }) => [id, new Set()]));
  const mediaRooms = new Map<RoomId, RoomRelays>(SPACE_ROOMS.map(({ id }) => [id, {
    audio: createAudioRelay({
      isRecipientEligible: (publisherConnectionId, recipientConnectionId) => {
        const findCurrentPlayer = (connectionId: string) => {
          for (const connection of clients.values()) {
            if (connection.id === connectionId && connection.member && connection.currentRoomId === id) {
              return space.getPlayer(connection.member.id);
            }
          }
          return null;
        };
        const publisher = findCurrentPlayer(publisherConnectionId);
        const recipient = findCurrentPlayer(recipientConnectionId);
        if (!publisher || !recipient || publisher.roomId !== id || recipient.roomId !== id) return false;
        const room = SPACE_ROOMS.find((candidate) => candidate.id === id)!;
        if (room.audioPolicy === "room") return true;
        const dx = publisher.x - recipient.x;
        const dy = publisher.y - recipient.y;
        const radius = room.audioRadiusGridUnits;
        return radius !== null && dx * dx + dy * dy <= radius * radius;
      },
    }),
    screen: createScreenRelay(),
  }]));
  const roomMetrics = new Map<RoomId, RoomMetricCounters>(SPACE_ROOMS.map(({ id }) => [id, createRoomMetricCounters()]));
  const broadcastRoomInteractionState = (roomId: RoomId) => {
    const state = interactions.snapshot(roomId);
    for (const [target, targetConnection] of clients) {
      if (!targetConnection.member || targetConnection.currentRoomId !== roomId || target.readyState !== target.OPEN) continue;
      const payload = JSON.stringify({
        type: "interaction.state",
        ...(targetConnection.role === "display" ? displayInteractionProjection(state) : state),
      });
      const counters = roomMetrics.get(roomId)!.control;
      counters.guardedSendChecks += 1;
      if (target.bufferedAmount + Buffer.byteLength(payload) > MAX_SOCKET_BUFFERED_BYTES) {
        target.close(1013, "Receiver is too slow");
        continue;
      }
      counters.eventsSent += 1;
      target.send(payload, (error) => {
        if (error) target.terminate();
      });
    }
  };
  const interactionPruneTimer = setInterval(() => {
    interactions.prune();
    for (const roomId of interactions.drainChangedRooms()) broadcastRoomInteractionState(roomId as RoomId);
  }, 500);
  interactionPruneTimer.unref();
  let unassignedControlRejections = 0;
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

  app.get("/api/rooms", async () => publicRooms(roomAccess, hostControl.enabled));

  app.get("/api/media-diagnostics", async () => ({
    rooms: SPACE_ROOMS.map(({ id }) => ({
      roomId: id,
      ...roomMetrics.get(id)!,
    })),
    unassignedControlRejections,
  }));

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
      const connection: ClientConnection = {
        id: randomUUID(), hostActive: false, removed: false,
        role: "participant", mode: "watch",
        downlink: { audio: { bytes: 0, frames: 0 }, screen: { bytes: 0, frames: 0 } },
        eventTimes: [], interactionTimes: [], feedbackTimes: [], moveTimes: [],
      };
      clients.set(socket, connection);

      const send = (message: unknown): boolean => {
        if (socket.readyState !== socket.OPEN) return false;
        const payload = JSON.stringify(message);
        if (socket.bufferedAmount + Buffer.byteLength(payload) > MAX_SOCKET_BUFFERED_BYTES) {
          socket.close(1013, "Receiver is too slow");
          return false;
        }
        socket.send(payload, (error) => {
          if (error) socket.terminate();
        });
        return true;
      };

      const sendBinary = (message: Buffer): boolean => {
        if (socket.readyState !== socket.OPEN) return false;
        if (socket.bufferedAmount + message.byteLength > MAX_SOCKET_BUFFERED_BYTES) {
          socket.close(1013, "Receiver is too slow");
          return false;
        }
        socket.send(message, { binary: true, compress: false }, (error) => {
          if (error) socket.terminate();
        });
        return true;
      };

      const sendScreenBinary = (message: Buffer): boolean => {
        if (socket.readyState !== socket.OPEN) return false;
        if (socket.bufferedAmount + message.byteLength > MAX_SCREEN_SOCKET_BUFFERED_BYTES) {
          socket.close(1013, "Screen receiver is too slow");
          return false;
        }
        socket.send(message, { binary: true, compress: false }, (error) => {
          if (error) socket.terminate();
        });
        return true;
      };

      const rejectControl = (code: string, message: string, closeCode = 1008, countControlRejection = true) => {
        if (countControlRejection) {
          if (connection.currentRoomId) roomMetrics.get(connection.currentRoomId)!.control.rejected += 1;
          else unassignedControlRejections += 1;
        }
        send({ type: "protocol.error", code, message });
        socket.once("error", () => {});
        socket.close(closeCode, "Invalid control message");
      };

      const sendProtocolError = (code: string, message: string) => {
        send({ type: "protocol.error", code, message });
      };

      const canPublish = (targetConnection: ClientConnection): boolean => {
        if (targetConnection.role === "display") return false;
        if (!hostControl.enabled) return true;
        const member = targetConnection.member;
        const roomId = targetConnection.currentRoomId;
        if (!member || !roomId) return false;
        return targetConnection.hostActive || publisherGrants.get(roomId)!.has(member.id);
      };

      const sendPublishPermission = (target: import("ws").WebSocket, targetConnection: ClientConnection) => {
        if (!hostControl.enabled || !targetConnection.member || !targetConnection.currentRoomId) return;
        const payload = JSON.stringify({
          type: "host.publishPermission",
          enabled: hostControl.enabled,
          allowed: canPublish(targetConnection),
        });
        if (target.readyState !== target.OPEN || target.bufferedAmount + Buffer.byteLength(payload) > MAX_SOCKET_BUFFERED_BYTES) return;
        target.send(payload, (error) => {
          if (error) target.terminate();
        });
      };

      const broadcastRoomCatalogue = () => {
        const message = JSON.stringify({ type: "room.catalogue", rooms: publicRooms(roomAccess, hostControl.enabled) });
        for (const target of clients.keys()) {
          if (target.readyState !== target.OPEN || target.bufferedAmount + Buffer.byteLength(message) > MAX_SOCKET_BUFFERED_BYTES) continue;
          target.send(message, (error) => {
            if (error) target.terminate();
          });
        }
      };

      const registerMediaConnection = (roomId: RoomId) => {
        const roomRelays = mediaRooms.get(roomId)!;
        const peer = (channel: "audio" | "screen") => {
          const metrics = roomMetrics.get(roomId)![channel];
          const authorizedCurrentRoom = () => {
            metrics.guardedSendChecks += 1;
            if (!connection.member || connection.currentRoomId !== roomId) {
              metrics.crossRoomGuardBlocks += 1;
              return false;
            }
            return true;
          };
          return {
            sendControl: (message: unknown) => {
              if (!authorizedCurrentRoom()) return;
              if (
                message && typeof message === "object" &&
                typeof (message as { type?: unknown }).type === "string" &&
                send(message)
              ) {
                metrics.controlMessagesSent += 1;
              }
            },
            sendBinary: (message: Buffer) => {
              if (!authorizedCurrentRoom()) return;
              if (connection.mode === "interaction") {
                metrics.rejected += 1;
                return;
              }
              if (sendBinary(message)) {
                metrics.binaryFramesSent += 1;
                connection.downlink[channel].bytes += message.byteLength;
                connection.downlink[channel].frames += 1;
              }
            },
            sendScreenBinary: (message: Buffer) => {
              if (!authorizedCurrentRoom()) return;
              if (connection.mode === "interaction") {
                metrics.rejected += 1;
                return;
              }
              if (sendScreenBinary(message)) {
                metrics.binaryFramesSent += 1;
                connection.downlink.screen.bytes += message.byteLength;
                connection.downlink.screen.frames += 1;
              }
            },
            reject: (code: string, explanation: string, closeCode?: number) => {
              metrics.rejected += 1;
              rejectControl(code, explanation, closeCode, false);
            },
            readyState: () => socket.readyState,
            openState: socket.OPEN,
          };
        };
        roomRelays.audio.register(connection.id, peer("audio"));
        roomRelays.screen.register(connection.id, peer("screen"));
      };

      const sendRoomMessage = (
        target: import("ws").WebSocket,
        targetConnection: ClientConnection,
        roomId: RoomId,
        message: unknown,
        metric: "roomSnapshotsSent" | "spaceSnapshotsSent" | "eventsSent",
      ) => {
        const counters = roomMetrics.get(roomId)!.control;
        counters.guardedSendChecks += 1;
        if (!targetConnection.member || targetConnection.currentRoomId !== roomId) {
          counters.crossRoomGuardBlocks += 1;
          return;
        }
        if (target.readyState !== target.OPEN) return;
        const payload = JSON.stringify(message);
        if (target.bufferedAmount + Buffer.byteLength(payload) > MAX_SOCKET_BUFFERED_BYTES) {
          target.close(1013, "Receiver is too slow");
          return;
        }
        counters[metric] += 1;
        target.send(payload, (error) => {
          if (error) target.terminate();
        });
      };

      const participationSnapshot = () => {
        const roomId = connection.currentRoomId;
        const relays = roomId ? mediaRooms.get(roomId) : undefined;
        return {
          type: "participation.self",
          roomId: roomId ?? null,
          participantId: connection.member?.id ?? null,
          role: connection.role,
          mode: connection.mode,
          media: {
            audio: {
              subscribed: relays?.audio.isSubscribed(connection.id) ?? false,
              downlinkBytes: connection.downlink.audio.bytes,
              downlinkFrames: connection.downlink.audio.frames,
            },
            screen: {
              subscribed: relays?.screen.isSubscribed(connection.id) ?? false,
              downlinkBytes: connection.downlink.screen.bytes,
              downlinkFrames: connection.downlink.screen.frames,
            },
          },
          downlinkScope: "server WebSocket enqueue counters for this connection lifetime; not peer receipt or decode evidence",
        };
      };

      const sendParticipationSnapshot = () => {
        if (connection.currentRoomId) {
          sendRoomMessage(socket, connection, connection.currentRoomId, participationSnapshot(), "eventsSent");
        }
      };

      const sendInteractionSnapshot = (target: import("ws").WebSocket, targetConnection: ClientConnection, roomId: RoomId) => {
        sendRoomMessage(target, targetConnection, roomId, {
          type: "interaction.snapshot",
          ...(targetConnection.role === "display"
            ? displayInteractionProjection(interactions.snapshot(roomId))
            : interactions.snapshot(roomId)),
        }, "eventsSent");
      };

      const broadcastInteractionState = (roomId: RoomId) => {
        const state = interactions.snapshot(roomId);
        for (const [target, targetConnection] of clients) {
          if (targetConnection.member && targetConnection.currentRoomId === roomId && target.readyState === target.OPEN) {
            sendRoomMessage(target, targetConnection, roomId, {
              type: "interaction.state",
              ...(targetConnection.role === "display" ? displayInteractionProjection(state) : state),
            }, "eventsSent");
          }
        }
      };

      const broadcastInteractionEvent = (roomId: RoomId, event: NonNullable<ReturnType<InteractionStore["accept"]>>) => {
        const state = interactions.snapshot(roomId);
        for (const [target, targetConnection] of clients) {
          if (targetConnection.member && targetConnection.currentRoomId === roomId && target.readyState === target.OPEN) {
            if (targetConnection.role === "display" && event.kind !== "danmaku" && event.kind !== "feedback") continue;
            sendRoomMessage(target, targetConnection, roomId, {
              type: "interaction.event",
              roomId,
              event,
              state: targetConnection.role === "display"
                ? (() => {
                    const projection = displayInteractionProjection(state);
                    return { publicQueue: projection.publicQueue, queueCount: projection.queueCount, presentation: projection.presentation, feedbackStats: projection.feedbackStats, serverNow: projection.serverNow };
                  })()
                : {
                    publicQueue: state.publicQueue,
                    queueCount: state.queueCount,
                    presentation: state.presentation,
                    feedbackStats: state.feedbackStats,
                    serverNow: state.serverNow,
                  },
            }, "eventsSent");
          }
        }
      };

      const sendInteractionError = (code: string, explanation: string, eventId?: string) => {
        if (connection.currentRoomId) roomMetrics.get(connection.currentRoomId)!.control.rejected += 1;
        send({
          type: "interaction.error",
          code,
          message: explanation,
          ...(connection.currentRoomId ? { roomId: connection.currentRoomId } : {}),
          ...(eventId ? { eventId } : {}),
        });
      };

      const broadcastSpaceState = () => {
        const seq = ++spaceSequence;
        for (const [target, targetConnection] of clients) {
          if (!targetConnection.member || !targetConnection.currentRoomId || target.readyState !== target.OPEN) continue;
          const roomId = targetConnection.currentRoomId;
          const snapshot = space.snapshot({
            seq,
            participantId: targetConnection.member.id,
            currentRoomId: roomId,
          });
          sendRoomMessage(target, targetConnection, roomId, {
            type: "space.snapshot",
            ...snapshot,
            rooms: snapshot.rooms.map((room) => ({
              ...room,
              isLocked: roomAccess.isMeetingRoomLocked(room.id),
              hostControlsEnabled: hostControl.enabled,
            })),
          }, "spaceSnapshotsSent");
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
          if (targetConnection.role === "display" && kind === "reaction") continue;
          if (targetConnection.member && targetConnection.currentRoomId === roomId && target.readyState === target.OPEN) {
            sendRoomMessage(target, targetConnection, roomId, message, "eventsSent");
          }
        }
        return event;
      };

      const sendHostError = (code: string, explanation: string) => {
        if (connection.currentRoomId) roomMetrics.get(connection.currentRoomId)!.control.rejected += 1;
        else unassignedControlRejections += 1;
        send({ type: "host.error", code, message: explanation });
      };

      const sendHostResult = (action: string, details: Record<string, unknown> = {}) => {
        send({ type: "host.actionResult", action, ...details });
      };

      const findRoomMember = (roomId: RoomId, memberId: string) => {
        for (const [candidateSocket, candidateConnection] of clients) {
          if (!candidateConnection.removed && candidateConnection.currentRoomId === roomId && candidateConnection.member?.id === memberId) {
            return { socket: candidateSocket, connection: candidateConnection };
          }
        }
        return null;
      };

      const broadcastHostPublisherGrants = (roomId: RoomId) => {
        const payload = JSON.stringify({ type: "host.publisherGrants", participantIds: [...publisherGrants.get(roomId)!] });
        for (const [targetSocket, targetConnection] of clients) {
          if (!targetConnection.hostActive || targetConnection.currentRoomId !== roomId || targetSocket.readyState !== targetSocket.OPEN) continue;
          if (targetSocket.bufferedAmount + Buffer.byteLength(payload) > MAX_SOCKET_BUFFERED_BYTES) continue;
          targetSocket.send(payload, (error) => {
            if (error) targetSocket.terminate();
          });
        }
      };

      socket.on("message", (raw, isBinary) => {
        if (connection.removed || socket.readyState !== socket.OPEN) return;
        const bytes = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw);
        if (isBinary) {
          if (!connection.currentRoomId || !connection.member) {
            unassignedControlRejections += 1;
            sendProtocolError("media_not_joined", "Join a room before publishing or receiving media.");
            return;
          }
          if (connection.role === "display" || connection.mode === "interaction") {
            const channel = bytes.subarray(0, 4).toString("ascii") === "LTS1" ? "screen" : "audio";
            roomMetrics.get(connection.currentRoomId)![channel].rejected += 1;
            sendProtocolError(connection.role === "display" ? "display_read_only" : "interaction_mode_media_denied",
              "This participation state cannot publish media packets.");
            return;
          }
          if (hostControl.enabled && !canPublish(connection)) {
            const channel = bytes.subarray(0, 4).toString("ascii") === "LTS1" ? "screen" : "audio";
            roomMetrics.get(connection.currentRoomId)![channel].rejected += 1;
            send({ type: "host.publishDenied", message: "A host must grant publishing permission before media can be sent." });
            return;
          }
          const relays = mediaRooms.get(connection.currentRoomId)!;
          if (relays.screen.handleBinary(connection.id, bytes)) return;
          relays.audio.handleBinary(connection.id, bytes);
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
        if (connection.member && connection.role === "display") {
          const allowedDisplayControl = message.type === "participation.inspect" ||
            message.type === "audio.subscribe" || message.type === "audio.unsubscribe" ||
            message.type === "screen.subscribe" || message.type === "screen.unsubscribe";
          if (!allowedDisplayControl) {
            roomMetrics.get(connection.currentRoomId!)!.control.rejected += 1;
            sendProtocolError("display_read_only", "Display connections can only inspect themselves and subscribe to shared media.");
            return;
          }
        }

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
            roomId: connection.currentRoomId ?? DEFAULT_ROOM.id,
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

        if (message.type === "participation.inspect") {
          if (bytes.byteLength > MAX_CONTROL_MESSAGE_BYTES) {
            rejectControl("invalid_message", "Participation control frames are limited to 1 KiB.", 1009);
            return;
          }
          if (!hasOnlyKeys(message, ["type"]) || !connection.member || !connection.currentRoomId) {
            sendProtocolError("invalid_participation_inspect", "Inspect your own participation after joining a room.");
            return;
          }
          sendParticipationSnapshot();
          return;
        }

        if (message.type === "participation.setMode") {
          if (bytes.byteLength > MAX_CONTROL_MESSAGE_BYTES) {
            rejectControl("invalid_message", "Participation control frames are limited to 1 KiB.", 1009);
            return;
          }
          if (!hasOnlyKeys(message, ["type", "mode"]) || !connection.member || !connection.currentRoomId ||
              connection.role !== "participant" || (message.mode !== "watch" && message.mode !== "interaction")) {
            sendProtocolError(connection.role === "display" ? "display_read_only" : "invalid_participation_mode", "Choose watch or interaction mode on a joined participant connection.");
            return;
          }
          const nextMode = message.mode as ParticipationMode;
          connection.mode = nextMode;
          if (nextMode === "interaction") {
            const relays = mediaRooms.get(connection.currentRoomId)!;
            relays.audio.disableConnection(connection.id);
            relays.screen.disableConnection(connection.id);
          }
          const relays = mediaRooms.get(connection.currentRoomId)!;
          send({
            type: "participation.modeChanged",
            roomId: connection.currentRoomId,
            role: connection.role,
            mode: connection.mode,
            media: {
              audioSubscribed: relays.audio.isSubscribed(connection.id),
              screenSubscribed: relays.screen.isSubscribed(connection.id),
            },
          });
          sendParticipationSnapshot();
          return;
        }

        if (message.type === "interaction.submit") {
          if (bytes.byteLength > MAX_INTERACTION_MESSAGE_BYTES) {
            sendInteractionError("interaction_message_too_large", "Interaction messages are limited to 2 KiB.", typeof message.eventId === "string" ? message.eventId : undefined);
            return;
          }
          if (!connection.member || !connection.currentRoomId) {
            sendInteractionError("interaction_not_joined", "Join a room before sending an interaction.");
            return;
          }
          const parsed = parseInteractionInput(message);
          if (!parsed) {
            sendInteractionError("invalid_interaction", "The interaction does not match the supported text, sticker, feedback, or event ID format.", typeof message.eventId === "string" ? message.eventId : undefined);
            return;
          }
          const roomId = connection.currentRoomId;
          const duplicate = interactions.checkDuplicate(connection.member.id, parsed.eventId, roomId, parsed.fingerprint);
          if (duplicate.kind === "duplicate") {
            send({ type: "interaction.ack", roomId, eventId: parsed.eventId, interactionId: duplicate.interactionId, duplicate: true });
            return;
          }
          if (duplicate.kind === "collision") {
            sendInteractionError("interaction_event_id_conflict", "This event ID was already used with different content or in another room.", parsed.eventId);
            return;
          }
          if (parsed.input.kind === "danmaku" && !interactions.isDanmakuEnabled(roomId)) {
            sendInteractionError("danmaku_blocked", "The host is not accepting new public danmaku right now.", parsed.eventId);
            return;
          }
          const now = Date.now();
          if (!interactions.hasDedupCapacity(now)) {
            sendInteractionError("interaction_dedup_capacity", "The bounded duplicate protection cache is full; wait for retained event IDs to expire.", parsed.eventId);
            return;
          }
          connection.interactionTimes = connection.interactionTimes.filter((eventAt) => now - eventAt < EVENT_WINDOW_MS);
          connection.feedbackTimes = connection.feedbackTimes.filter((eventAt) => now - eventAt < EVENT_WINDOW_MS);
          if (connection.interactionTimes.length >= MAX_INTERACTIONS_PER_SECOND ||
              (parsed.input.kind === "feedback" && connection.feedbackTimes.length >= MAX_FEEDBACK_PER_SECOND)) {
            sendInteractionError("interaction_rate_limited", "The local interaction rate limit was reached; wait briefly and try again.", parsed.eventId);
            return;
          }
          const event = interactions.accept(connection.member.id, roomId, connection.member, parsed.eventId, parsed.input, now);
          if (!event) {
            sendInteractionError("interaction_dedup_capacity", "The bounded duplicate protection cache is full; wait for retained event IDs to expire.", parsed.eventId);
            return;
          }
          connection.interactionTimes.push(now);
          if (parsed.input.kind === "feedback") connection.feedbackTimes.push(now);
          send({ type: "interaction.ack", roomId, eventId: parsed.eventId, interactionId: event.id, duplicate: false });
          broadcastInteractionEvent(roomId, event);
          return;
        }

        if (bytes.byteLength > MAX_CONTROL_MESSAGE_BYTES) {
          rejectControl("invalid_message", "Control frames are limited to 1 KiB; capability reports have a separate 8 KiB bound.", 1009);
          return;
        }

        if (message.type === "host.claim") {
          if (!hasOnlyKeys(message, ["type", "token"])) {
            sendHostError("invalid_host_claim", "Host claim accepts only the room connection and a host token.");
            return;
          }
          if (!hostControl.enabled || !connection.member || !connection.currentRoomId) {
            sendHostError("host_claim_unavailable", "Join a room on a server with host controls enabled before claiming host access.");
            return;
          }
          if (connection.hostActive) {
            sendHostError("host_already_claimed", "This room connection already has host access.");
            return;
          }
          const denial = hostControl.claim(message.token, connection);
          if (denial) {
            sendHostError(denial, denial === "host_claim_rate_limited"
              ? "Too many host claims. Wait a minute before trying again."
              : "That host token was not accepted.");
            return;
          }
          connection.hostActive = true;
          send({
            type: "host.claimed",
            roomId: connection.currentRoomId,
            participantId: connection.member.id,
            publisherGrants: [...publisherGrants.get(connection.currentRoomId)!],
          });
          sendPublishPermission(socket, connection);
          return;
        }

        if (typeof message.type === "string" && message.type.startsWith("host.")) {
          if (!hostControl.enabled || !connection.member || !connection.currentRoomId || !connection.hostActive) {
            sendHostError("host_unauthorized", "Claim host access on this room connection before using host controls.");
            return;
          }

          const roomId = connection.currentRoomId;
          const targetMemberId = message.participantId;
          if (message.type === "host.grantPublisher" || message.type === "host.revokePublisher" || message.type === "host.removeParticipant") {
            if (!hasOnlyKeys(message, ["type", "participantId"]) || typeof targetMemberId !== "string" || targetMemberId.length < 1 || targetMemberId.length > 128) {
              sendHostError("invalid_host_target", "Choose a current room member using only their server-assigned participant ID.");
              return;
            }
            const target = findRoomMember(roomId, targetMemberId);
            if (!target) {
              sendHostError("host_target_not_in_room", "That participant is not currently in your room.");
              return;
            }
            if (target.connection === connection) {
              sendHostError("host_cannot_target_self", "Host publishing is already enabled for your own room connection.");
              return;
            }
            if (message.type !== "host.removeParticipant" && target.connection.hostActive) {
              sendHostError("host_target_is_host", "Publisher grants and revocation cannot change another host connection's built-in publish access.");
              return;
            }

            if (message.type === "host.grantPublisher") {
              publisherGrants.get(roomId)!.add(targetMemberId);
              broadcastHostPublisherGrants(roomId);
              sendPublishPermission(target.socket, target.connection);
              sendHostResult("grantPublisher", { participantId: targetMemberId, allowed: true });
              return;
            }

            if (message.type === "host.revokePublisher") {
              publisherGrants.get(roomId)!.delete(targetMemberId);
              broadcastHostPublisherGrants(roomId);
              const relays = mediaRooms.get(roomId)!;
              relays.audio.stopPublishing(target.connection.id, "permission_revoked");
              relays.screen.stopPublishing(target.connection.id, "permission_revoked");
              if (target.socket.readyState === target.socket.OPEN && target.socket.bufferedAmount + 96 < MAX_SOCKET_BUFFERED_BYTES) {
                target.socket.send(JSON.stringify({ type: "host.publishRevoked", reason: "permission_revoked" }));
              }
              sendPublishPermission(target.socket, target.connection);
              sendHostResult("revokePublisher", { participantId: targetMemberId, allowed: false });
              return;
            }

            const removedMember = target.connection.member!;
            target.connection.removed = true;
            target.connection.hostActive = false;
            publisherGrants.get(roomId)!.delete(targetMemberId);
            broadcastHostPublisherGrants(roomId);
            members.delete(targetMemberId);
            space.remove(targetMemberId);
            for (const relays of mediaRooms.values()) {
              relays.audio.disconnect(target.connection.id);
              relays.screen.disconnect(target.connection.id);
            }
            target.connection.member = undefined;
            target.connection.currentRoomId = undefined;
            sendHostResult("removeParticipant", { participantId: targetMemberId });
            emit("member.left", removedMember, roomId);
            broadcastSpaceState();
            target.socket.close(4001, "Removed by host");
            return;
          }

          if (message.type === "host.setMeetingRoomPassword") {
            if (!hasOnlyKeys(message, ["type", "password"])) {
              sendHostError("invalid_room_password", "Set a new meeting room password using the supported password field only.");
              return;
            }
            if (roomId !== "studio") {
              sendHostError("host_wrong_room", "Meeting room lock controls are available only while you are in the meeting room.");
              return;
            }
            if (typeof message.password !== "string" || message.password.length === 0 || !isValidRoomPassword(message.password)) {
              sendHostError("invalid_room_password", "Use a meeting room password of 1 to 128 characters and at most 512 UTF-8 bytes.");
              return;
            }
            if (message.password === options.hostControlToken) {
              sendHostError("invalid_room_password", "The meeting room password must be different from the host token.");
              return;
            }
            roomAccess.setMeetingRoomPassword(message.password);
            broadcastRoomCatalogue();
            broadcastSpaceState();
            sendHostResult("setMeetingRoomPassword", { roomId, isLocked: true });
            return;
          }

          if (message.type === "host.unlockMeetingRoom") {
            if (!hasOnlyKeys(message, ["type"])) {
              sendHostError("invalid_host_control", "Unlock accepts no password or additional fields.");
              return;
            }
            if (roomId !== "studio") {
              sendHostError("host_wrong_room", "Meeting room lock controls are available only while you are in the meeting room.");
              return;
            }
            roomAccess.setMeetingRoomPassword(null);
            broadcastRoomCatalogue();
            broadcastSpaceState();
            sendHostResult("unlockMeetingRoom", { roomId, isLocked: false });
            return;
          }

          if (message.type === "host.endSession") {
            if (!hasOnlyKeys(message, ["type"])) {
              sendHostError("invalid_host_control", "End session accepts no additional fields.");
              return;
            }
            publisherGrants.get(roomId)!.clear();
            broadcastHostPublisherGrants(roomId);
            const relays = mediaRooms.get(roomId)!;
            for (const [targetSocket, targetConnection] of clients) {
              if (!targetConnection.member || targetConnection.currentRoomId !== roomId || targetConnection.removed) continue;
              relays.audio.stopPublishing(targetConnection.id, "session_ended");
              relays.screen.stopPublishing(targetConnection.id, "session_ended");
              if (targetSocket.readyState === targetSocket.OPEN && targetSocket.bufferedAmount + 96 < MAX_SOCKET_BUFFERED_BYTES) {
                targetSocket.send(JSON.stringify({ type: "host.publishRevoked", reason: "session_ended" }));
                targetSocket.send(JSON.stringify({ type: "host.sessionEnded", roomId }));
              }
              sendPublishPermission(targetSocket, targetConnection);
            }
            sendHostResult("endSession", { roomId, membersRetained: true, grantsCleared: true });
            return;
          }

          if (message.type === "host.interaction.setPaused") {
            if (!hasOnlyKeys(message, ["type", "paused"]) || typeof message.paused !== "boolean") {
              sendHostError("invalid_interaction_control", "Set the presentation pause state using a boolean paused field.");
              return;
            }
            interactions.setPaused(roomId, message.paused);
            broadcastInteractionState(roomId);
            sendHostResult("interaction.setPaused", { roomId, paused: message.paused, queueCount: interactions.snapshot(roomId).queueCount });
            return;
          }

          if (message.type === "host.interaction.setDanmakuEnabled") {
            if (!hasOnlyKeys(message, ["type", "enabled"]) || typeof message.enabled !== "boolean") {
              sendHostError("invalid_interaction_control", "Set public danmaku acceptance using a boolean enabled field.");
              return;
            }
            interactions.setDanmakuEnabled(roomId, message.enabled);
            broadcastInteractionState(roomId);
            sendHostResult("interaction.setDanmakuEnabled", { roomId, enabled: message.enabled });
            return;
          }

          if (message.type === "host.interaction.clearQueue") {
            if (!hasOnlyKeys(message, ["type"])) {
              sendHostError("invalid_interaction_control", "Clear the public queue without extra fields.");
              return;
            }
            const clearedCount = interactions.clearPublicQueue(roomId);
            broadcastInteractionState(roomId);
            sendHostResult("interaction.clearQueue", { roomId, clearedCount });
            return;
          }

          if (message.type === "host.interaction.remove") {
            if (!hasOnlyKeys(message, ["type", "interactionId"]) || typeof message.interactionId !== "string" || message.interactionId.length < 1 || message.interactionId.length > 128) {
              sendHostError("invalid_interaction_control", "Remove one current room item using its server-issued interaction ID.");
              return;
            }
            const removed = interactions.remove(roomId, message.interactionId);
            if (removed) broadcastInteractionState(roomId);
            sendHostResult("interaction.remove", { roomId, interactionId: message.interactionId, removed });
            return;
          }

          sendHostError("invalid_host_control", "This host control is not supported.");
          return;
        }

        const audioControl = typeof message.type === "string" && message.type.startsWith("audio.");
        const screenControl = typeof message.type === "string" && message.type.startsWith("screen.");
        if ((audioControl || screenControl) && (!connection.currentRoomId || !connection.member)) {
          unassignedControlRejections += 1;
          sendProtocolError("media_not_joined", "Join a room before publishing or receiving media.");
          return;
        }

        if (connection.mode === "interaction" && (audioControl || screenControl) &&
            message.type !== "audio.unsubscribe" && message.type !== "screen.unsubscribe") {
          sendProtocolError("interaction_mode_media_denied", "Switch to watch mode before starting or subscribing to media.");
          return;
        }

        if (hostControl.enabled && message.type === "audio.start" && !canPublish(connection)) {
          send({ type: "audio.error", code: "publish_not_authorized", message: "A host must grant publishing permission before microphone audio can start." });
          return;
        }
        if (hostControl.enabled && message.type === "screen.start" && !canPublish(connection)) {
          send({ type: "screen.error", code: "publish_not_authorized", message: "A host must grant publishing permission before screen sharing can start." });
          return;
        }

        if (connection.currentRoomId) {
          const relays = mediaRooms.get(connection.currentRoomId)!;
          if (relays.audio.handleControl(connection.id, message)) return;
          if (relays.screen.handleControl(connection.id, message)) return;
        }

        if (!connection.member) {
          if (
            !hasOnlyKeys(message, ["type", "roomId", "displayName", "password", "role", "mode"]) ||
            message.type !== "join" ||
            !isKnownRoom(message.roomId) ||
            typeof message.displayName !== "string" ||
            (message.role !== undefined && message.role !== "participant" && message.role !== "display") ||
            (message.mode !== undefined && message.mode !== "watch" && message.mode !== "interaction")
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

          const roomId = message.roomId;
          const denial = roomAccess.authorizeEntry(roomId, message.password, connection);
          if (denial) {
            send({ type: "protocol.error", ...denial });
            return;
          }

          if (members.size >= MAX_ROOM_MEMBERS) {
            rejectControl("room_full", "The local space has reached its eight participant limit.");
            return;
          }

          const member = { id: randomUUID(), displayName };
          connection.role = (message.role as ParticipationRole | undefined) ?? "participant";
          connection.mode = (message.mode as ParticipationMode | undefined) ?? "watch";
          connection.member = member;
          connection.currentRoomId = roomId;
          space.add(member, roomId);
          registerMediaConnection(roomId);
          mediaRooms.get(roomId)!.audio.markJoined(connection.id);
          mediaRooms.get(roomId)!.screen.markJoined(connection.id);
          members.set(member.id, member);
          const event = emit("member.joined", member, roomId);
          const room = SPACE_ROOMS.find((candidate) => candidate.id === roomId)!;
          sendRoomMessage(socket, connection, roomId, {
            type: "room.snapshot",
            room: {
              id: room.id,
              name: room.name,
              kind: room.kind,
              audioPolicy: room.audioPolicy,
              audioRadiusGridUnits: room.audioRadiusGridUnits,
              isLocked: roomAccess.isMeetingRoomLocked(roomId),
              hostControlsEnabled: hostControl.enabled,
              publishAllowed: canPublish(connection),
            },
            members: space.roomMembers(roomId),
            lastSeq: event.seq,
          }, "roomSnapshotsSent");
          sendInteractionSnapshot(socket, connection, roomId);
          sendParticipationSnapshot();
          broadcastSpaceState();
          sendPublishPermission(socket, connection);
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
          mediaRooms.get(connection.currentRoomId!)!.audio.reconcileRecipients();
          broadcastSpaceState();
          return;
        }

        if (message.type === "room.switch") {
          if (!hasOnlyKeys(message, ["type", "roomId", "password"])) {
            rejectControl("invalid_room_switch", "Room switching accepts only an available room ID and optional password.");
            return;
          }
          if (!isKnownRoom(message.roomId)) {
            sendProtocolError("unknown_room", "That room is not available.");
            return;
          }
          const previousRoomId = connection.currentRoomId!;
          const nextRoomId = message.roomId;
          if (previousRoomId !== nextRoomId) {
            const denial = roomAccess.authorizeEntry(nextRoomId, message.password, connection);
            if (denial) {
              send({ type: "protocol.error", ...denial });
              return;
            }
          }
          if (previousRoomId !== nextRoomId) {
            publisherGrants.get(previousRoomId)!.delete(connection.member.id);
            broadcastHostPublisherGrants(previousRoomId);
            connection.hostActive = false;
            mediaRooms.get(previousRoomId)!.audio.disconnect(connection.id);
            mediaRooms.get(previousRoomId)!.screen.disconnect(connection.id);
            connection.currentRoomId = nextRoomId;
            registerMediaConnection(nextRoomId);
            mediaRooms.get(nextRoomId)!.audio.markJoined(connection.id);
            mediaRooms.get(nextRoomId)!.screen.markJoined(connection.id);
            emit("member.left", connection.member, previousRoomId);
            space.switchRoom(connection.member.id, nextRoomId);
            emit("member.joined", connection.member, nextRoomId);
          }
          const room = SPACE_ROOMS.find((candidate) => candidate.id === nextRoomId)!;
          sendRoomMessage(socket, connection, nextRoomId, {
            type: "room.snapshot",
            room: {
              id: room.id,
              name: room.name,
              kind: room.kind,
              audioPolicy: room.audioPolicy,
              audioRadiusGridUnits: room.audioRadiusGridUnits,
              isLocked: roomAccess.isMeetingRoomLocked(nextRoomId),
              hostControlsEnabled: hostControl.enabled,
              publishAllowed: canPublish(connection),
            },
            members: space.roomMembers(nextRoomId),
            lastSeq: sequence,
          }, "roomSnapshotsSent");
          sendInteractionSnapshot(socket, connection, nextRoomId);
          sendParticipationSnapshot();
          broadcastSpaceState();
          sendPublishPermission(socket, connection);
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
        for (const relays of mediaRooms.values()) {
          relays.audio.disconnect(connection.id);
          relays.screen.disconnect(connection.id);
        }
        if (!connection.member) return;
        if (connection.currentRoomId) {
          publisherGrants.get(connection.currentRoomId)!.delete(connection.member.id);
          broadcastHostPublisherGrants(connection.currentRoomId);
        }
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
    clearInterval(interactionPruneTimer);
    clients.clear();
    members.clear();
    for (const grants of publisherGrants.values()) grants.clear();
    observations.clear();
    for (const relays of mediaRooms.values()) {
      relays.audio.close();
      relays.screen.close();
    }
  });

  return app;
}
