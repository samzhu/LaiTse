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
import { createScreenRelay, MAX_SCREEN_FRAME_BYTES } from "./screen-relay.ts";
import { createHostControlPolicy } from "./host-control.ts";
import { createRoomAccessPolicy, isValidRoomPassword, type PersistedRoomAccess } from "./room-access.ts";
import { createRoomManagement } from "./room-management.ts";
import { createControlResumeStore, type ResumeMode, type ResumeRole } from "./control-resume.ts";
import { createTransportBudget, MAX_APPLICATION_SEND_BYTES } from "./transport-budget.ts";
import { createSerialExecutor, QueueFullError } from "./serial-executor.ts";
import { openSystemPersistence, type ActivityCounters, type DurableSnapshot, type PendingPersistence, type PersistedParticipant, type PersistedRoomSettings, type PersistedSession, type PersistenceBootstrap } from "./persistence.ts";
import {
  DEFAULT_MEMBER_SOFT_LIMIT,
  LOCAL_CAPACITY_ADMIN_HTML,
  parseMemberSoftLimit,
  isLoopbackAddress,
  isLoopbackHost,
} from "./capacity.ts";
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
  MOVE_WINDOW_MS,
  SPACE_ROOMS,
  type RoomId,
  type SpaceMember,
} from "./space.ts";

export const MAX_CONTROL_MESSAGE_BYTES = 1_024;
export const MAX_SOCKET_BUFFERED_BYTES = MAX_APPLICATION_SEND_BYTES;

const DEFAULT_ROOM = SPACE_ROOMS[0];
const REACTIONS = new Set(["wave", "clap", "heart"]);
const MAX_DISPLAY_NAME_CODE_POINTS = 32;
const MAX_EVENTS_PER_SECOND = 10;
const EVENT_WINDOW_MS = 1_000;
const MAX_CONTROL_OUTBOX_FRAMES = 4_096;
const MAX_CONTROL_OUTBOX_BYTES = MAX_APPLICATION_SEND_BYTES;
const MAX_DEFERRED_CLOSES = 256;

type Member = SpaceMember;
type ParticipationRole = "participant" | "display";
type ParticipationMode = "watch" | "interaction";

type ControlEvent = {
  seq: number;
  kind: "member.joined" | "member.left" | "reaction";
  roomId: RoomId;
  participantId: string;
  displayName: string;
  reaction?: string;
  at: number;
};

type ClientConnection = {
  id: string;
  resumeToken?: string;
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
  databaseUrl?: string;
  databaseSchema?: string;
  localCapacityAdmin?: boolean;
};

type ControlRunResult = "completed" | "queue_full" | "unavailable";

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
  const seedRoomAccess = createRoomAccessPolicy(options.meetingRoomPassword);
  const hostControl = createHostControlPolicy(options.hostControlToken);
  const persistence = await openSystemPersistence(options.databaseUrl, options.databaseSchema);
  let persistenceBootstrap: PersistenceBootstrap | undefined;
  if (persistence) {
    const seedSettings = SPACE_ROOMS.map((room): PersistedRoomSettings => {
      const access = room.id === "studio" ? seedRoomAccess.snapshot() : null;
      return {
        roomId: room.id,
        locked: access?.locked ?? false,
        passwordSalt: access?.passwordSalt ?? null,
        passwordVerifier: access?.passwordVerifier ?? null,
        admissionRevision: access?.admissionRevision ?? 0,
        lockKind: access?.locked ? "legacy" : "none",
        managerParticipantId: null,
        interactionPaused: false,
        danmakuEnabled: true,
      };
    });
    try {
      persistenceBootstrap = await persistence.initialize({
        roomIds: SPACE_ROOMS.map(({ id }) => id),
        initialRoomSettings: seedSettings,
        managedHostMode: Boolean(options.hostControlToken),
        initialMemberSoftLimit: DEFAULT_MEMBER_SOFT_LIMIT,
      });
      if (persistenceBootstrap.managedHostMode !== Boolean(options.hostControlToken)) {
        throw new Error("HOST_CONTROL_TOKEN configuration does not match the saved managed-host setting; startup refused to weaken or change room management mode.");
      }
    } catch (error) {
      await persistence.close();
      throw error;
    }
  }
  const app = Fastify({ logger: false, https: options.https ?? null });
  const clients = new Map<import("ws").WebSocket, ClientConnection>();
  const transportBudgets = new WeakMap<import("ws").WebSocket, ReturnType<typeof createTransportBudget>>();
  type OutboundFrame = { target: import("ws").WebSocket; payload: string | Buffer; sendOptions?: { binary?: boolean; compress?: boolean } };
  type DeferredClose = { target: import("ws").WebSocket; code?: number; reason?: string };
  type ControlWriteContext = { outbox: OutboundFrame[]; outboxBytes: number; overflow: boolean; closes: DeferredClose[]; closeTargets: Set<import("ws").WebSocket>; required: boolean; pending: PendingPersistence; memberSoftLimit?: number };
  let activeWriteContext: ControlWriteContext | null = null;
  let persistenceFailed = false;
  let appClosing = false;
  let memberSoftLimit = persistenceBootstrap?.memberSoftLimit ?? DEFAULT_MEMBER_SOFT_LIMIT;
  const controlExecutor = createSerialExecutor();
  const emptyPendingPersistence = (): PendingPersistence => ({
    interactions: [], interactionDedup: [], controlEvents: [], tombstones: [], moderation: [], management: [], capabilities: [], revokedSessionDigests: [],
  });
  const sendTo = (target: import("ws").WebSocket, payload: string | Buffer, sendOptions?: { binary?: boolean; compress?: boolean }) => {
    if (activeWriteContext && !sendOptions?.binary) {
      if (activeWriteContext.overflow) return false;
      const bytes = typeof payload === "string" ? Buffer.byteLength(payload) : payload.byteLength;
      if (activeWriteContext.outbox.length >= MAX_CONTROL_OUTBOX_FRAMES || activeWriteContext.outboxBytes + bytes > MAX_CONTROL_OUTBOX_BYTES) {
        activeWriteContext.overflow = true;
        try { target.close(1013, "Control output backlog"); } catch { /* The socket may already be closing. */ }
        return false;
      }
      activeWriteContext.outbox.push({ target, payload, sendOptions });
      activeWriteContext.outboxBytes += bytes;
      return true;
    }
    return transportBudgets.get(target)?.send(payload, sendOptions) ?? false;
  };
  const closeSocket = (target: import("ws").WebSocket, code?: number, reason?: string) => {
    if (activeWriteContext) {
      if (activeWriteContext.closeTargets.has(target)) return;
      if (activeWriteContext.closes.length >= MAX_DEFERRED_CLOSES) {
        activeWriteContext.overflow = true;
        try { target.close(1013, "Control close backlog"); } catch { /* The socket may already be closing. */ }
        return;
      }
      activeWriteContext.closeTargets.add(target);
      activeWriteContext.closes.push({ target, code, reason });
      return;
    }
    if (code === undefined) target.close();
    else target.close(code, reason);
  };
  const members = new Map<string, Member>();
  const persistedParticipants = new Map<string, PersistedParticipant>((persistenceBootstrap?.participants ?? []).map((participant) => [participant.id, participant]));
  const observations = new Map<string, CapabilityObservation>();
  const space = createSpaceModel();
  const interactions = new InteractionStore(SPACE_ROOMS.map(({ id }) => id));
  const settingsByRoom = new Map((persistenceBootstrap?.roomSettings ?? []).map((setting) => [setting.roomId, setting]));
  const restoredStudio = settingsByRoom.get("studio");
  const roomAccess: ReturnType<typeof createRoomAccessPolicy> = persistenceBootstrap && restoredStudio
    ? createRoomAccessPolicy(undefined, {
      locked: restoredStudio.locked,
      passwordSalt: restoredStudio.passwordSalt,
      passwordVerifier: restoredStudio.passwordVerifier,
      admissionRevision: restoredStudio.admissionRevision,
    } satisfies PersistedRoomAccess)
    : seedRoomAccess;
  const roomManagement = createRoomManagement({
    initial: persistenceBootstrap && restoredStudio
      ? { lockKind: restoredStudio.lockKind, managerParticipantId: restoredStudio.managerParticipantId }
      : { lockKind: seedRoomAccess.isMeetingRoomLocked("studio") ? "legacy" : "none", managerParticipantId: null },
  });
  const resumeSessions = createControlResumeStore({
    restored: persistenceBootstrap?.sessions,
    recentlyExpiredDigests: persistenceBootstrap?.recentlyExpiredSessionDigests,
  });
  if (persistenceBootstrap) {
    interactions.restore({
      records: persistenceBootstrap.activeInteractions,
      publicQueueIds: persistenceBootstrap.publicQueueInteractionIds,
      dedup: persistenceBootstrap.dedup,
      presentation: Object.fromEntries(persistenceBootstrap.roomSettings.map((setting) => [setting.roomId, {
        paused: setting.interactionPaused,
        danmakuEnabled: setting.danmakuEnabled,
      }])),
    });
  }
  const publisherGrants = new Map<RoomId, Set<string>>(SPACE_ROOMS.map(({ id }) => [id, new Set()]));
  const mediaRooms = new Map<RoomId, RoomRelays>(SPACE_ROOMS.map(({ id }) => [id, {
    audio: createAudioRelay({
      allowMultiplePublishers: id === "studio",
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
      if (sendTo(target, payload)) counters.eventsSent += 1;
    }
  };
  let unassignedControlRejections = 0;
  let sequence = persistenceBootstrap?.controlSequence ?? 0;
  let spaceSequence = persistenceBootstrap?.spaceSequence ?? 0;
  const roomCounters: Record<RoomId, ActivityCounters> = persistenceBootstrap?.roomCounters ?? Object.fromEntries(
    SPACE_ROOMS.map(({ id }) => [id, { joins: 0, leaves: 0, moves: 0, reactions: 0, interactions: 0, capabilityReports: 0, hostActions: 0 }]),
  ) as Record<RoomId, ActivityCounters>;

  const recordParticipant = (connection: ClientConnection): void => {
    if (!connection.member || !connection.currentRoomId) return;
    const player = space.getPlayer(connection.member.id);
    if (!player) return;
    persistedParticipants.set(connection.member.id, {
      id: connection.member.id,
      displayName: connection.member.displayName,
      roomId: connection.currentRoomId,
      role: connection.role,
      mode: connection.mode,
      x: player.x,
      y: player.y,
    });
  };

  const durableSnapshot = (capacityOverride = memberSoftLimit): DurableSnapshot => {
    const presentation = interactions.snapshot("studio").presentation;
    const studioAccess = roomAccess.snapshot();
    const sessions = resumeSessions.snapshot();
    const retainedParticipantIds = new Set(sessions.map((session) => session.participantId));
    for (const participantId of persistedParticipants.keys()) {
      if (!members.has(participantId) && !retainedParticipantIds.has(participantId)) persistedParticipants.delete(participantId);
    }
    return {
      memberSoftLimit: capacityOverride,
      roomSettings: SPACE_ROOMS.map((room): PersistedRoomSettings => {
        const access = room.id === "studio" ? studioAccess : null;
        return {
          roomId: room.id,
          locked: access?.locked ?? false,
          passwordSalt: access?.passwordSalt ?? null,
          passwordVerifier: access?.passwordVerifier ?? null,
          admissionRevision: access?.admissionRevision ?? 0,
          lockKind: room.id === "studio" ? roomManagement.snapshot(studioAccess.locked).lockKind : "none",
          managerParticipantId: room.id === "studio" ? roomManagement.snapshot(studioAccess.locked).managerParticipantId : null,
          interactionPaused: room.id === "studio" ? presentation.paused : interactions.snapshot(room.id).presentation.paused,
          danmakuEnabled: room.id === "studio" ? presentation.danmakuEnabled : interactions.snapshot(room.id).presentation.danmakuEnabled,
        };
      }),
      participants: [...persistedParticipants.values()].map((participant) => ({ ...participant })),
      sessions,
      controlSequence: sequence,
      spaceSequence,
      roomCounters: Object.fromEntries(SPACE_ROOMS.map(({ id }) => [id, { ...roomCounters[id] }])) as Record<RoomId, ActivityCounters>,
    };
  };

  const flushContext = (context: ControlWriteContext): void => {
    for (const frame of context.outbox) {
      if (frame.target.readyState === frame.target.OPEN) transportBudgets.get(frame.target)?.send(frame.payload, frame.sendOptions);
    }
    for (const close of context.closes) {
      if (close.target.readyState !== close.target.CLOSED && close.target.readyState !== close.target.CLOSING) {
        if (close.code === undefined) close.target.close();
        else close.target.close(close.code, close.reason);
      }
    }
  };

  const failClosed = (): void => {
    if (persistenceFailed) return;
    persistenceFailed = true;
    activeWriteContext = null;
    for (const socket of clients.keys()) {
      try { socket.close(1011, "System persistence unavailable"); } catch { /* Socket may already be closing. */ }
    }
    setImmediate(() => { void app.close().catch(() => {}); });
  };

  const runControl = (operation: () => void, target?: import("ws").WebSocket): Promise<ControlRunResult> => {
    return controlExecutor.run(async (): Promise<ControlRunResult> => {
      if (persistenceFailed || appClosing) return "unavailable";
      const context: ControlWriteContext = { outbox: [], outboxBytes: 0, overflow: false, closes: [], closeTargets: new Set(), required: false, pending: emptyPendingPersistence() };
      activeWriteContext = context;
      try {
        operation();
        if (context.overflow) throw new Error("Control outbox capacity exceeded.");
        if (context.required && persistence) await persistence.save(durableSnapshot(context.memberSoftLimit ?? memberSoftLimit), context.pending);
        if (context.overflow) throw new Error("Control outbox capacity exceeded.");
        if (context.memberSoftLimit !== undefined) memberSoftLimit = context.memberSoftLimit;
        flushContext(context);
        return "completed";
      } catch {
        failClosed();
        return "unavailable";
      } finally {
        if (activeWriteContext === context) activeWriteContext = null;
      }
    }).catch((error: unknown) => {
      if (error instanceof QueueFullError) {
        if (target && target.readyState === target.OPEN) {
          try { target.send(JSON.stringify({ type: "protocol.error", code: "control_queue_full", message: "The control queue is busy. Reconnect and try again." })); } catch { /* The socket may already be closing. */ }
          target.close(1013, "Control queue is full");
        }
        return "queue_full";
      } else if (target || persistence) {
        failClosed();
      }
      return "unavailable";
    });
  };

  persistence?.onFatal(failClosed);

  const markDurable = (): void => {
    if (activeWriteContext) activeWriteContext.required = true;
  };

  const addPending = <K extends keyof PendingPersistence>(key: K, value: PendingPersistence[K][number]): void => {
    if (!activeWriteContext) return;
    (activeWriteContext.pending[key] as Array<PendingPersistence[K][number]>).push(value);
    activeWriteContext.required = true;
  };

  const bumpCounter = (roomId: RoomId, name: keyof ActivityCounters): void => {
    roomCounters[roomId][name] += 1;
    markDurable();
  };

  const onlineStudioParticipants = (): Member[] => {
    const online = new Map<string, Member>();
    for (const [socket, connection] of clients) {
      if (socket.readyState !== socket.OPEN || connection.removed || connection.role !== "participant" ||
          connection.currentRoomId !== "studio" || !connection.member) continue;
      online.set(connection.member.id, connection.member);
    }
    return [...online.values()];
  };

  const roomManagementStateFor = (connection: ClientConnection) => {
    const current = roomManagement.snapshot(roomAccess.isMeetingRoomLocked("studio"));
    const isOwner = Boolean(connection.member && roomManagement.canManageAnonymously(connection.member.id));
    return {
      type: "room.management.state",
      roomId: "studio",
      isLocked: current.locked,
      lockKind: current.lockKind,
      anonymousManagementEnabled: !hostControl.enabled,
      canLock: !hostControl.enabled && connection.role === "participant" && current.lockKind === "none" && !current.locked,
      isOwner,
      ...(isOwner && connection.member ? {
        ownerParticipantId: connection.member.id,
        members: onlineStudioParticipants().map((member) => ({ id: member.id, displayName: member.displayName })),
      } : {}),
    };
  };

  const sendRoomManagementState = (socket: import("ws").WebSocket, connection: ClientConnection): void => {
    if (!connection.member || connection.role !== "participant" || socket.readyState !== socket.OPEN) return;
    sendTo(socket, JSON.stringify(roomManagementStateFor(connection)));
  };

  const broadcastRoomManagementStates = (): void => {
    for (const [socket, connection] of clients) sendRoomManagementState(socket, connection);
  };

  const handleAnonymousOwnerOffline = (participantId: string): "unchanged" | "transferred" | "unlocked" => {
    const result = roomManagement.ownerDisconnected(participantId, onlineStudioParticipants().map((member) => member.id));
    if (result === "unchanged") return result;
    if (result === "unlocked") roomAccess.setMeetingRoomPassword(null);
    markDurable();
    addPending("management", {
      roomId: "studio",
      actorParticipantId: participantId,
      targetParticipantId: roomManagement.snapshot(roomAccess.isMeetingRoomLocked("studio")).managerParticipantId,
      action: result === "transferred" ? "room.anonymous_manager.auto_transferred" : "room.anonymous_manager.auto_unlocked",
    });
    return result;
  };

  const interactionPruneTimer = setInterval(() => {
    runControl(() => {
      interactions.prune();
      for (const roomId of interactions.drainChangedRooms()) broadcastRoomInteractionState(roomId as RoomId);
    });
  }, 500);
  interactionPruneTimer.unref();
  const sessionHeartbeatTimer = setInterval(() => {
    if (persistence && resumeSessions.hasActive()) runControl(() => markDurable());
  }, 60_000);
  sessionHeartbeatTimer.unref();

  await app.register(fastifyWebsocket, {
    options: { maxPayload: MAX_SCREEN_FRAME_BYTES },
  });

  if (options.localCapacityAdmin) {
    const capacityState = async () => controlExecutor.run(() => persistenceFailed ? null : ({
      softLimit: memberSoftLimit,
      currentMembers: members.size,
      persistence: persistence?.mode ?? "process-memory",
      persisted: Boolean(persistence),
    }));
    const canUseLocalCapacityAdmin = (request: FastifyRequest): boolean =>
      isLoopbackAddress(request.raw.socket.remoteAddress) && isLoopbackHost(request.headers.host);
    const rejectNonLocalCapacityAdmin = (request: FastifyRequest, reply: import("fastify").FastifyReply) => {
      if (canUseLocalCapacityAdmin(request)) return false;
      reply.code(403).header("Cache-Control", "no-store").send({ error: "local_capacity_admin_only" });
      return true;
    };

    app.get("/poc/capacity", async (request, reply) => {
      if (rejectNonLocalCapacityAdmin(request, reply)) return;
      try {
        const state = await capacityState();
        if (!state) return reply.code(503).header("Cache-Control", "no-store").send({ error: "persistence_unavailable" });
        return reply.code(200).header("Cache-Control", "no-store").type("text/html; charset=utf-8").send(LOCAL_CAPACITY_ADMIN_HTML);
      } catch {
        return reply.code(503).header("Cache-Control", "no-store").send({ error: "control_state_unavailable" });
      }
    });

    app.get("/api/poc/capacity", async (request, reply) => {
      if (rejectNonLocalCapacityAdmin(request, reply)) return;
      try {
        const state = await capacityState();
        if (!state) return reply.code(503).header("Cache-Control", "no-store").send({ error: "persistence_unavailable" });
        return reply.code(200).header("Cache-Control", "no-store").send(state);
      } catch {
        return reply.code(503).header("Cache-Control", "no-store").send({ error: "control_state_unavailable" });
      }
    });

    app.post<{ Body: { softLimit?: unknown } }>("/api/poc/capacity", { bodyLimit: 1_024 }, async (request, reply) => {
      if (rejectNonLocalCapacityAdmin(request, reply)) return;
      if (!isSameOriginRequest(request, Boolean(options.https))) {
        return reply.code(403).header("Cache-Control", "no-store").send({ error: "origin_not_allowed" });
      }
      if (request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
        return reply.code(415).header("Cache-Control", "no-store").send({ error: "json_required" });
      }
      const body = request.body;
      if (!body || typeof body !== "object" || Array.isArray(body) || !hasOnlyKeys(body as Record<string, unknown>, ["softLimit"]) ||
          Object.keys(body).length !== 1) {
        return reply.code(400).header("Cache-Control", "no-store").send({ error: "invalid_capacity" });
      }
      const nextSoftLimit = parseMemberSoftLimit(body.softLimit);
      if (nextSoftLimit === null) {
        return reply.code(400).header("Cache-Control", "no-store").send({ error: "invalid_capacity", message: "softLimit must be an integer from 1 to 1000." });
      }

      let acknowledgedMembers = 0;
      const result = await runControl(() => {
        if (!activeWriteContext) throw new Error("Capacity setting requires the serialized control context.");
        activeWriteContext.memberSoftLimit = nextSoftLimit;
        markDurable();
        acknowledgedMembers = members.size;
      });
      if (result !== "completed") {
        const error = result === "queue_full" ? "control_queue_full" : "persistence_unavailable";
        return reply.code(503).header("Cache-Control", "no-store").send({ error });
      }
      return reply.code(200).header("Cache-Control", "no-store").send({
        softLimit: nextSoftLimit,
        currentMembers: acknowledgedMembers,
        persistence: persistence?.mode ?? "process-memory",
        persisted: Boolean(persistence),
      });
    });
  }

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
    status: persistenceFailed ? "error" : "ok",
    persistence: persistence?.mode ?? "process-memory",
    ...(persistence ? { persistenceAvailable: !persistenceFailed } : {}),
  }));

  app.get("/api/rooms", async (_request, reply) => {
    try {
      const rooms = await controlExecutor.run(() => persistenceFailed ? null : publicRooms(roomAccess, hostControl.enabled));
      if (!rooms) return reply.code(503).send({ error: "persistence_unavailable" });
      return rooms;
    } catch {
      return reply.code(503).send({ error: "control_state_unavailable" });
    }
  });

  app.get("/api/media-diagnostics", async () => ({
    rooms: SPACE_ROOMS.map(({ id }) => ({
      roomId: id,
      ...roomMetrics.get(id)!,
    })),
    unassignedControlRejections,
  }));

  app.get<{ Params: { observationId: string } }>("/api/observations/:observationId", async (request, reply) => {
    let observation = observations.get(request.params.observationId);
    if (!observation && persistence) {
      try {
        const stored = await persistence.getObservation(request.params.observationId);
        if (stored) observation = {
          observationId: stored.observationId,
          observedAtServer: stored.observedAtServer,
          connectionId: stored.connectionId,
          roomId: stored.roomId,
          member: { id: stored.participantId, displayName: stored.displayName },
          report: stored.report,
        };
      } catch {
        failClosed();
        return reply.code(503).send({ error: "persistence_unavailable" });
      }
    }
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
      const transportBudget = createTransportBudget(socket);
      transportBudgets.set(socket, transportBudget);
      socket.once("close", () => {
        transportBudget.dispose();
        transportBudgets.delete(socket);
      });

      const send = (message: unknown): boolean => {
        if (socket.readyState !== socket.OPEN) return false;
        const payload = JSON.stringify(message);
        return sendTo(socket, payload);
      };

      const sendBinary = (message: Buffer): boolean => {
        if (socket.readyState !== socket.OPEN) return false;
        return sendTo(socket, message, { binary: true, compress: false });
      };

      const rejectControl = (code: string, message: string, closeCode = 1008, countControlRejection = true) => {
        if (countControlRejection) {
          if (connection.currentRoomId) roomMetrics.get(connection.currentRoomId)!.control.rejected += 1;
          else unassignedControlRejections += 1;
        }
        send({ type: "protocol.error", code, message });
        socket.once("error", () => {});
        closeSocket(socket, closeCode, "Invalid control message");
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
        if (target.readyState !== target.OPEN) return;
        sendTo(target, payload);
      };

      const broadcastRoomCatalogue = () => {
        const message = JSON.stringify({ type: "room.catalogue", rooms: publicRooms(roomAccess, hostControl.enabled) });
        for (const target of clients.keys()) {
          if (target.readyState !== target.OPEN) continue;
          sendTo(target, message);
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
              if (sendBinary(message)) {
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
        if (sendTo(target, payload)) counters[metric] += 1;
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
          transport: transportBudget.snapshot(),
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

      const sendAuthoritativeRoomState = (roomId: RoomId, lastSeq: number) => {
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
          lastSeq,
        }, "roomSnapshotsSent");
        sendInteractionSnapshot(socket, connection, roomId);
        sendParticipationSnapshot();
        broadcastSpaceState();
        broadcastRoomManagementStates();
        sendPublishPermission(socket, connection);
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
        markDurable();
        bumpCounter(roomId, kind === "member.joined" ? "joins" : kind === "member.left" ? "leaves" : "reactions");
        const event: ControlEvent = {
          seq: ++sequence,
          kind,
          roomId,
          participantId: member.id,
          displayName: member.displayName,
          at: Date.now(),
          ...(reaction ? { reaction } : {}),
        };
        addPending("controlEvents", event);
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
          sendTo(targetSocket, payload);
        }
      };

      const handleIncomingMessage = (raw: import("ws").RawData, isBinary: boolean) => {
        if (persistenceFailed || connection.removed || socket.readyState !== socket.OPEN) return;
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

        if (message.type === "session.leave") {
          if (bytes.byteLength > MAX_CONTROL_MESSAGE_BYTES || !hasOnlyKeys(message, ["type"])) {
            rejectControl("invalid_session_leave", "Leave the current resumable control session without extra fields.");
            return;
          }
          if (connection.resumeToken) {
            markDurable();
            const digest = resumeSessions.invalidate(connection.resumeToken);
            if (digest) addPending("revokedSessionDigests", digest);
            connection.resumeToken = undefined;
          }
          send({ type: "session.left" });
          closeSocket(socket, 1000, "Session left");
          return;
        }

        if (message.type === "session.resume") {
          if (bytes.byteLength > MAX_CONTROL_MESSAGE_BYTES || !hasOnlyKeys(message, ["type", "token", "password"]) || typeof message.token !== "string" ||
              (message.password !== undefined && typeof message.password !== "string") || connection.member) {
            sendProtocolError("invalid_resume", "Resume with the issued session token and, when requested, the current room password.");
            closeSocket(socket, 1008, "Invalid resume request");
            return;
          }
          const lookup = resumeSessions.lookup(message.token);
          if (!lookup.record) {
            sendProtocolError(lookup.expired ? "resume_expired" : "resume_invalid", "This control session can no longer be resumed.");
            closeSocket(socket, 1008, "Resume unavailable");
            return;
          }
          const record = lookup.record;
          if (record.activeConnectionId !== null) {
            sendProtocolError("resume_busy", "This control session is still active; retry after the previous connection closes.");
            closeSocket(socket, 4002, "Resume is busy");
            return;
          }
          const currentAdmissionRevision = roomAccess.admissionRevision(record.roomId);
          let admissionWasRevalidated = false;
          if (currentAdmissionRevision !== record.admissionRevision) {
            const denial = roomAccess.authorizeEntry(record.roomId, message.password, connection);
            if (denial) {
              send({ type: "protocol.error", ...denial, roomId: record.roomId });
              return;
            }
            admissionWasRevalidated = true;
          }
          if (members.size >= memberSoftLimit) {
            sendProtocolError("room_full", `The local space is at its current capacity of ${memberSoftLimit} members. Wait for a place to open or ask the local operator to increase the limit before retrying.`);
            closeSocket(socket, 1013, "Room is full");
            return;
          }
          markDurable();
          if (!resumeSessions.attach(record, connection.id)) {
            sendProtocolError("resume_busy", "This control session is still active; retry after the previous connection closes.");
            closeSocket(socket, 4002, "Resume is busy");
            return;
          }
          if (admissionWasRevalidated) resumeSessions.refreshAdmission(record.token, currentAdmissionRevision);

          const member = { id: record.participantId, displayName: record.displayName };
          connection.member = member;
          connection.currentRoomId = record.roomId;
          connection.role = record.role;
          connection.mode = record.mode;
          connection.hostActive = false;
          connection.removed = false;
          connection.resumeToken = record.token;
          publisherGrants.get(record.roomId)!.delete(member.id);
          space.add(member, record.roomId);
          const restoredParticipant = persistedParticipants.get(member.id);
          if (restoredParticipant && restoredParticipant.roomId === record.roomId) {
            space.remove(member.id);
            space.add(member, record.roomId, { x: restoredParticipant.x, y: restoredParticipant.y });
          }
          registerMediaConnection(record.roomId);
          mediaRooms.get(record.roomId)!.audio.markJoined(connection.id);
          mediaRooms.get(record.roomId)!.screen.markJoined(connection.id);
          members.set(member.id, member);
          recordParticipant(connection);
          send({
            type: "session.resumed",
            participantId: member.id,
            roomId: record.roomId,
            role: record.role,
            mode: record.mode,
          });
          const event = emit("member.joined", member, record.roomId);
          sendAuthoritativeRoomState(record.roomId, event.seq);
          return;
        }

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
          markDurable();
          bumpCounter(observation.roomId as RoomId, "capabilityReports");
          addPending("capabilities", {
            observationId: observation.observationId,
            observedAtServer: observation.observedAtServer,
            connectionId: observation.connectionId,
            roomId: observation.roomId as RoomId,
            participantId: observation.member.id,
            displayName: observation.member.displayName,
            report: observation.report,
          });
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
          markDurable();
          connection.mode = nextMode;
          resumeSessions.updateMode(connection.resumeToken, nextMode);
          recordParticipant(connection);
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
          markDurable();
          bumpCounter(roomId, "interactions");
          const dedupEntry = interactions.durableDedup(now).find((entry) => entry.senderId === connection.member!.id && entry.eventId === parsed.eventId);
          if (dedupEntry) addPending("interactionDedup", { ...dedupEntry, roomId });
          addPending("interactions", event);
          send({ type: "interaction.ack", roomId, eventId: parsed.eventId, interactionId: event.id, duplicate: false });
          broadcastInteractionEvent(roomId, event);
          return;
        }

        if (bytes.byteLength > MAX_CONTROL_MESSAGE_BYTES) {
          rejectControl("invalid_message", "Control frames are limited to 1 KiB; capability reports have a separate 8 KiB bound.", 1009);
          return;
        }

        if (typeof message.type === "string" && message.type.startsWith("room.management.")) {
          const sendManagementError = (code: string, explanation: string) => send({ type: "room.management.error", code, message: explanation });
          const sendManagementResult = (action: string) => send({
            type: "room.management.result",
            action,
            isLocked: roomAccess.isMeetingRoomLocked("studio"),
          });
          if (!connection.member || connection.role !== "participant" || !connection.currentRoomId) {
            sendManagementError("room_management_unavailable", "Join as a participant before managing a meeting room.");
            return;
          }
          if (hostControl.enabled) {
            sendManagementError("anonymous_management_disabled", "Anonymous room management is unavailable while legacy HOST_CONTROL_TOKEN mode is enabled.");
            return;
          }

          if (message.type === "room.management.lock") {
            if (!hasOnlyKeys(message, ["type", "password"]) || typeof message.password !== "string" ||
                message.password.length === 0 || !isValidRoomPassword(message.password)) {
              sendManagementError("invalid_room_password", "Enter a meeting room password of 1 to 128 characters and at most 512 UTF-8 bytes.");
              return;
            }
            if (roomAccess.isMeetingRoomLocked("studio") || roomManagement.snapshot(false).lockKind !== "none") {
              sendManagementError("room_already_managed", "The meeting room is already locked or managed.");
              return;
            }
            if (message.password === options.hostControlToken) {
              sendManagementError("invalid_room_password", "The meeting room password must be different from the host token.");
              return;
            }
            const actorParticipantId = connection.member.id;
            if (!roomManagement.lockAnonymous(actorParticipantId)) {
              sendManagementError("room_already_managed", "The meeting room is already locked or managed.");
              return;
            }
            roomAccess.setMeetingRoomPassword(message.password);
            markDurable();
            addPending("management", { roomId: "studio", actorParticipantId, action: "room.anonymous_locked", details: { revision: roomAccess.admissionRevision("studio") } });
            broadcastRoomCatalogue();
            broadcastSpaceState();
            broadcastRoomManagementStates();
            sendManagementResult("lock");
            return;
          }

          if (message.type === "room.management.changePassword") {
            if (!hasOnlyKeys(message, ["type", "password"]) || typeof message.password !== "string" ||
                message.password.length === 0 || !isValidRoomPassword(message.password)) {
              sendManagementError("invalid_room_password", "Enter a meeting room password of 1 to 128 characters and at most 512 UTF-8 bytes.");
              return;
            }
            if (!roomManagement.canManageAnonymously(connection.member.id)) {
              sendManagementError("room_management_unauthorized", "Only the current anonymous room manager can change this password.");
              return;
            }
            if (message.password === options.hostControlToken) {
              sendManagementError("invalid_room_password", "The meeting room password must be different from the host token.");
              return;
            }
            roomAccess.setMeetingRoomPassword(message.password);
            markDurable();
            addPending("management", { roomId: "studio", actorParticipantId: connection.member.id, action: "room.anonymous_password_changed", details: { revision: roomAccess.admissionRevision("studio") } });
            broadcastRoomCatalogue();
            broadcastSpaceState();
            broadcastRoomManagementStates();
            sendManagementResult("changePassword");
            return;
          }

          if (message.type === "room.management.unlock") {
            if (!hasOnlyKeys(message, ["type"])) {
              sendManagementError("invalid_room_management", "Unlock does not accept additional fields.");
              return;
            }
            if (!roomManagement.canManageAnonymously(connection.member.id)) {
              sendManagementError("room_management_unauthorized", "Only the current anonymous room manager can unlock this room.");
              return;
            }
            roomAccess.setMeetingRoomPassword(null);
            roomManagement.setLegacyLock(false);
            markDurable();
            addPending("management", { roomId: "studio", actorParticipantId: connection.member.id, action: "room.anonymous_unlocked", details: { revision: roomAccess.admissionRevision("studio") } });
            broadcastRoomCatalogue();
            broadcastSpaceState();
            broadcastRoomManagementStates();
            sendManagementResult("unlock");
            return;
          }

          if (message.type === "room.management.transfer") {
            if (!hasOnlyKeys(message, ["type", "participantId"]) || typeof message.participantId !== "string" ||
                message.participantId.length < 1 || message.participantId.length > 128) {
              sendManagementError("invalid_room_management_target", "Choose a current meeting room member by server-assigned participant ID.");
              return;
            }
            if (!roomManagement.canManageAnonymously(connection.member.id)) {
              sendManagementError("room_management_unauthorized", "Only the current anonymous room manager can transfer room management.");
              return;
            }
            const target = onlineStudioParticipants().find((member) => member.id === message.participantId);
            if (!target || target.id === connection.member.id) {
              sendManagementError("room_management_target_not_in_room", "Choose another participant who is currently in the meeting room.");
              return;
            }
            if (!roomManagement.transfer(connection.member.id, target.id, true)) {
              sendManagementError("room_management_target_not_in_room", "Choose another participant who is currently in the meeting room.");
              return;
            }
            markDurable();
            addPending("management", { roomId: "studio", actorParticipantId: connection.member.id, targetParticipantId: target.id, action: "room.anonymous_manager.transferred" });
            broadcastRoomManagementStates();
            sendManagementResult("transfer");
            return;
          }

          sendManagementError("invalid_room_management", "This meeting room management action is not supported.");
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
          markDurable();
          connection.hostActive = true;
          addPending("management", { roomId: connection.currentRoomId, actorParticipantId: connection.member.id, action: "host.claimed" });
          bumpCounter(connection.currentRoomId, "hostActions");
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
              markDurable();
              publisherGrants.get(roomId)!.add(targetMemberId);
              addPending("management", { roomId, actorParticipantId: connection.member.id, targetParticipantId: targetMemberId, action: "publisher.granted" });
              bumpCounter(roomId, "hostActions");
              broadcastHostPublisherGrants(roomId);
              sendPublishPermission(target.socket, target.connection);
              sendHostResult("grantPublisher", { participantId: targetMemberId, allowed: true });
              return;
            }

            if (message.type === "host.revokePublisher") {
              markDurable();
              publisherGrants.get(roomId)!.delete(targetMemberId);
              addPending("management", { roomId, actorParticipantId: connection.member.id, targetParticipantId: targetMemberId, action: "publisher.revoked" });
              bumpCounter(roomId, "hostActions");
              broadcastHostPublisherGrants(roomId);
              const relays = mediaRooms.get(roomId)!;
              relays.audio.stopPublishing(target.connection.id, "permission_revoked");
              relays.screen.stopPublishing(target.connection.id, "permission_revoked");
              if (target.socket.readyState === target.socket.OPEN) {
                sendTo(target.socket, JSON.stringify({ type: "host.publishRevoked", reason: "permission_revoked" }));
              }
              sendPublishPermission(target.socket, target.connection);
              sendHostResult("revokePublisher", { participantId: targetMemberId, allowed: false });
              return;
            }

            const removedMember = target.connection.member!;
            markDurable();
            recordParticipant(target.connection);
            target.connection.removed = true;
            target.connection.hostActive = false;
            for (const digest of resumeSessions.invalidateParticipant(targetMemberId)) addPending("revokedSessionDigests", digest);
            target.connection.resumeToken = undefined;
            addPending("management", { roomId, actorParticipantId: connection.member.id, targetParticipantId: targetMemberId, action: "participant.removed" });
            bumpCounter(roomId, "hostActions");
            publisherGrants.get(roomId)!.delete(targetMemberId);
            broadcastHostPublisherGrants(roomId);
            members.delete(targetMemberId);
            space.remove(targetMemberId);
            const managerHandover = handleAnonymousOwnerOffline(targetMemberId);
            for (const relays of mediaRooms.values()) {
              relays.audio.disconnect(target.connection.id);
              relays.screen.disconnect(target.connection.id);
            }
            target.connection.member = undefined;
            target.connection.currentRoomId = undefined;
            sendHostResult("removeParticipant", { participantId: targetMemberId });
            emit("member.left", removedMember, roomId);
            broadcastSpaceState();
            if (managerHandover !== "unchanged") broadcastRoomCatalogue();
            broadcastRoomManagementStates();
            closeSocket(target.socket, 4001, "Removed by host");
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
            if (roomManagement.snapshot(roomAccess.isMeetingRoomLocked("studio")).lockKind === "anonymous") {
              sendHostError("host_room_managed_anonymously", "The current anonymous room manager controls this meeting room lock.");
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
            markDurable();
            roomAccess.setMeetingRoomPassword(message.password);
            roomManagement.setLegacyLock(true);
            addPending("management", { roomId, actorParticipantId: connection.member.id, action: "room.password.changed", details: { revision: roomAccess.admissionRevision(roomId) } });
            bumpCounter(roomId, "hostActions");
            broadcastRoomCatalogue();
            broadcastSpaceState();
            broadcastRoomManagementStates();
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
            if (roomManagement.snapshot(roomAccess.isMeetingRoomLocked("studio")).lockKind === "anonymous") {
              sendHostError("host_room_managed_anonymously", "The current anonymous room manager controls this meeting room lock.");
              return;
            }
            markDurable();
            roomAccess.setMeetingRoomPassword(null);
            roomManagement.setLegacyLock(false);
            addPending("management", { roomId, actorParticipantId: connection.member.id, action: "room.unlocked", details: { revision: roomAccess.admissionRevision(roomId) } });
            bumpCounter(roomId, "hostActions");
            broadcastRoomCatalogue();
            broadcastSpaceState();
            broadcastRoomManagementStates();
            sendHostResult("unlockMeetingRoom", { roomId, isLocked: false });
            return;
          }

          if (message.type === "host.endSession") {
            if (!hasOnlyKeys(message, ["type"])) {
              sendHostError("invalid_host_control", "End session accepts no additional fields.");
              return;
            }
            markDurable();
            const endedGrants = [...publisherGrants.get(roomId)!];
            publisherGrants.get(roomId)!.clear();
            for (const participantId of endedGrants) {
              addPending("management", { roomId, actorParticipantId: connection.member.id, targetParticipantId: participantId, action: "publisher.revoked", details: { reason: "session_ended" } });
            }
            addPending("management", { roomId, actorParticipantId: connection.member.id, action: "host.session_ended", details: { grantCount: endedGrants.length } });
            bumpCounter(roomId, "hostActions");
            broadcastHostPublisherGrants(roomId);
            const relays = mediaRooms.get(roomId)!;
            for (const [targetSocket, targetConnection] of clients) {
              if (!targetConnection.member || targetConnection.currentRoomId !== roomId || targetConnection.removed) continue;
              relays.audio.stopPublishing(targetConnection.id, "session_ended");
              relays.screen.stopPublishing(targetConnection.id, "session_ended");
              if (targetSocket.readyState === targetSocket.OPEN) {
                sendTo(targetSocket, JSON.stringify({ type: "host.publishRevoked", reason: "session_ended" }));
                sendTo(targetSocket, JSON.stringify({ type: "host.sessionEnded", roomId }));
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
            markDurable();
            interactions.setPaused(roomId, message.paused);
            addPending("moderation", { roomId, actorParticipantId: connection.member.id, action: "presentation.paused", details: { paused: message.paused } });
            bumpCounter(roomId, "hostActions");
            broadcastInteractionState(roomId);
            sendHostResult("interaction.setPaused", { roomId, paused: message.paused, queueCount: interactions.snapshot(roomId).queueCount });
            return;
          }

          if (message.type === "host.interaction.setDanmakuEnabled") {
            if (!hasOnlyKeys(message, ["type", "enabled"]) || typeof message.enabled !== "boolean") {
              sendHostError("invalid_interaction_control", "Set public danmaku acceptance using a boolean enabled field.");
              return;
            }
            markDurable();
            interactions.setDanmakuEnabled(roomId, message.enabled);
            addPending("moderation", { roomId, actorParticipantId: connection.member.id, action: "danmaku.acceptance.changed", details: { enabled: message.enabled } });
            bumpCounter(roomId, "hostActions");
            broadcastInteractionState(roomId);
            sendHostResult("interaction.setDanmakuEnabled", { roomId, enabled: message.enabled });
            return;
          }

          if (message.type === "host.interaction.clearQueue") {
            if (!hasOnlyKeys(message, ["type"])) {
              sendHostError("invalid_interaction_control", "Clear the public queue without extra fields.");
              return;
            }
            markDurable();
            const queueItems = interactions.publicQueueRecords(roomId);
            const clearedCount = interactions.clearPublicQueue(roomId);
            for (const item of queueItems) addPending("tombstones", { interactionId: item.id, roomId, action: "clearQueue", actorParticipantId: connection.member.id });
            addPending("moderation", { roomId, actorParticipantId: connection.member.id, action: "public_queue.cleared", itemCount: clearedCount });
            bumpCounter(roomId, "hostActions");
            broadcastInteractionState(roomId);
            sendHostResult("interaction.clearQueue", { roomId, clearedCount });
            return;
          }

          if (message.type === "host.interaction.remove") {
            if (!hasOnlyKeys(message, ["type", "interactionId"]) || typeof message.interactionId !== "string" || message.interactionId.length < 1 || message.interactionId.length > 128) {
              sendHostError("invalid_interaction_control", "Remove one current room item using its server-issued interaction ID.");
              return;
            }
            markDurable();
            const removed = interactions.remove(roomId, message.interactionId);
            if (removed) {
              addPending("tombstones", { interactionId: message.interactionId, roomId, action: "remove", actorParticipantId: connection.member.id });
              addPending("moderation", { roomId, actorParticipantId: connection.member.id, action: "interaction.removed", itemCount: 1, details: { interactionId: message.interactionId } });
            }
            bumpCounter(roomId, "hostActions");
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
            !hasOnlyKeys(message, ["type", "roomId", "displayName", "password", "role", "mode", "resumable"]) ||
            message.type !== "join" ||
            !isKnownRoom(message.roomId) ||
            typeof message.displayName !== "string" ||
            (message.role !== undefined && message.role !== "participant" && message.role !== "display") ||
            (message.mode !== undefined && message.mode !== "watch" && message.mode !== "interaction") ||
            (message.resumable !== undefined && typeof message.resumable !== "boolean")
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

          if (members.size >= memberSoftLimit) {
            rejectControl("room_full", `The local space is at its current capacity of ${memberSoftLimit} members. Wait for a place to open or ask the local operator to increase the limit before retrying.`);
            return;
          }

          markDurable();
          const member = { id: randomUUID(), displayName };
          const role = (message.role as ParticipationRole | undefined) ?? "participant";
          const mode = (message.mode as ParticipationMode | undefined) ?? "watch";
          const resumeRecord = message.resumable === true
            ? resumeSessions.issue({
                participantId: member.id,
                displayName: member.displayName,
                roomId,
                role,
                mode,
                admissionRevision: roomAccess.admissionRevision(roomId),
              }, connection.id)
            : null;
          if (message.resumable === true && !resumeRecord) {
            rejectControl("resume_unavailable", "The bounded local resume store is full; join without automatic recovery or try again later.");
            return;
          }
          connection.role = role;
          connection.mode = mode;
          connection.member = member;
          connection.currentRoomId = roomId;
          if (resumeRecord) {
            connection.resumeToken = resumeRecord.token;
            send({
              type: "session.issued",
              token: resumeRecord.token,
              participantId: member.id,
              roomId,
              role,
              mode,
            });
          }
          space.add(member, roomId);
          registerMediaConnection(roomId);
          mediaRooms.get(roomId)!.audio.markJoined(connection.id);
          mediaRooms.get(roomId)!.screen.markJoined(connection.id);
          members.set(member.id, member);
          recordParticipant(connection);
          const event = emit("member.joined", member, roomId);
          sendAuthoritativeRoomState(roomId, event.seq);
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
          markDurable();
          bumpCounter(connection.currentRoomId!, "moves");
          recordParticipant(connection);
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
            markDurable();
            if (publisherGrants.get(previousRoomId)!.delete(connection.member.id)) {
              addPending("management", { roomId: previousRoomId, actorParticipantId: null, targetParticipantId: connection.member.id, action: "publisher.revoked", details: { reason: "room_switched" } });
              bumpCounter(previousRoomId, "hostActions");
            }
            if (connection.hostActive) {
              addPending("management", { roomId: previousRoomId, actorParticipantId: connection.member.id, action: "host.disconnected", details: { reason: "room_switched" } });
              bumpCounter(previousRoomId, "hostActions");
            }
            resumeSessions.updateRoom(connection.resumeToken, nextRoomId, roomAccess.admissionRevision(nextRoomId));
          }
          if (previousRoomId !== nextRoomId) {
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
            recordParticipant(connection);
            emit("member.joined", connection.member, nextRoomId);
          }
          sendAuthoritativeRoomState(nextRoomId, sequence);
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
      };

      socket.on("message", (raw, isBinary) => {
        if (isBinary) {
          handleIncomingMessage(raw, true);
          return;
        }
        runControl(() => handleIncomingMessage(raw, false), socket);
      });

      socket.on("close", () => {
        runControl(() => {
          clients.delete(socket);
          if (connection.resumeToken) {
            markDurable();
            resumeSessions.detach(connection.resumeToken, connection.id);
          }
          for (const relays of mediaRooms.values()) {
            relays.audio.disconnect(connection.id);
            relays.screen.disconnect(connection.id);
          }
          const leavingMember = connection.member;
          const leavingRoom = connection.currentRoomId;
          if (!leavingMember || !leavingRoom) return;
          recordParticipant(connection);
          if (connection.hostActive) {
            addPending("management", { roomId: leavingRoom, actorParticipantId: leavingMember.id, action: "host.disconnected" });
            bumpCounter(leavingRoom, "hostActions");
          }
          if (publisherGrants.get(leavingRoom)!.delete(leavingMember.id)) {
            addPending("management", { roomId: leavingRoom, actorParticipantId: null, targetParticipantId: leavingMember.id, action: "publisherGrant.revoked", details: { reason: "participant_disconnected" } });
            bumpCounter(leavingRoom, "hostActions");
          }
          broadcastHostPublisherGrants(leavingRoom);
          members.delete(leavingMember.id);
          space.remove(leavingMember.id);
          connection.hostActive = false;
          connection.member = undefined;
          connection.currentRoomId = undefined;
          const managerHandover = handleAnonymousOwnerOffline(leavingMember.id);
          emit("member.left", leavingMember, leavingRoom);
          broadcastSpaceState();
          if (managerHandover !== "unchanged") broadcastRoomCatalogue();
          broadcastRoomManagementStates();
        }, socket);
      });

      socket.on("error", () => {
        // The connection close handler owns membership cleanup.
      });
    },
  );

  app.addHook("onClose", async () => {
    appClosing = true;
    clearInterval(interactionPruneTimer);
    clearInterval(sessionHeartbeatTimer);
    await controlExecutor.drain();
    if (persistence && !persistenceFailed && clients.size > 0) {
      const context: ControlWriteContext = { outbox: [], outboxBytes: 0, overflow: false, closes: [], closeTargets: new Set(), required: false, pending: emptyPendingPersistence() };
      activeWriteContext = context;
      try {
        for (const [socket, connection] of clients) {
          if (connection.resumeToken) resumeSessions.detach(connection.resumeToken, connection.id);
          const leavingMember = connection.member;
          const leavingRoom = connection.currentRoomId;
          if (leavingMember && leavingRoom) {
            recordParticipant(connection);
            if (connection.hostActive) {
              addPending("management", { roomId: leavingRoom, actorParticipantId: leavingMember.id, action: "host.disconnected", details: { reason: "app_shutdown" } });
              bumpCounter(leavingRoom, "hostActions");
            }
            if (publisherGrants.get(leavingRoom)!.delete(leavingMember.id)) {
              addPending("management", { roomId: leavingRoom, actorParticipantId: null, targetParticipantId: leavingMember.id, action: "publisherGrant.revoked", details: { reason: "app_shutdown" } });
              bumpCounter(leavingRoom, "hostActions");
            }
            const shutdownEvent: ControlEvent = {
              seq: ++sequence,
              kind: "member.left",
              roomId: leavingRoom,
              participantId: leavingMember.id,
              displayName: leavingMember.displayName,
              at: Date.now(),
            };
            addPending("controlEvents", shutdownEvent);
            bumpCounter(leavingRoom, "leaves");
            members.delete(leavingMember.id);
            space.remove(leavingMember.id);
            connection.member = undefined;
            connection.currentRoomId = undefined;
            connection.hostActive = false;
          }
          try { socket.close(1001, "Server shutting down"); } catch { /* Socket may already be closing. */ }
        }
        if (context.required) await persistence.save(durableSnapshot(), context.pending);
      } catch {
        persistenceFailed = true;
      } finally {
        activeWriteContext = null;
      }
    }
    clients.clear();
    members.clear();
    for (const grants of publisherGrants.values()) grants.clear();
    observations.clear();
    resumeSessions.clear();
    for (const relays of mediaRooms.values()) {
      relays.audio.close();
      relays.screen.close();
    }
    await persistence?.close();
  });

  return app;
}
