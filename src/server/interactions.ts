import { createHash, randomUUID } from "node:crypto";

export const MAX_INTERACTION_MESSAGE_BYTES = 2_048;
export const MAX_CHAT_CODE_POINTS = 300;
export const MAX_DANMAKU_CODE_POINTS = 60;
export const MAX_INTERACTIONS_PER_SECOND = 10;
export const MAX_FEEDBACK_PER_SECOND = 1;

export const INTERACTION_FEEDBACK = ["like", "want-listen", "useful"] as const;
export type InteractionFeedback = (typeof INTERACTION_FEEDBACK)[number];

export const INTERACTION_STICKERS = ["✨", "👏", "❤️", "🎉", "🌱"] as const;
export type InteractionSticker = (typeof INTERACTION_STICKERS)[number];

export const INTERACTION_LIMITS = Object.freeze({
  historyItems: 50,
  historyTtlMs: 5 * 60_000,
  publicQueueItems: 20,
  publicTtlMs: 8_000,
  feedbackWindowMs: 60_000,
  feedbackItems: 512,
  dedupItems: 2_048,
  dedupTtlMs: 10 * 60_000,
});

export type InteractionInput =
  | { kind: "chat"; text: string }
  | { kind: "danmaku"; text: string }
  | { kind: "sticker"; sticker: InteractionSticker }
  | { kind: "feedback"; feedback: InteractionFeedback };

export type InteractionRecord = {
  id: string;
  eventId: string;
  roomId: string;
  participantId: string;
  displayName: string;
  kind: InteractionInput["kind"];
  text?: string;
  sticker?: InteractionSticker;
  feedback?: InteractionFeedback;
  at: number;
  expiresAt: number;
};

type Member = { id: string; displayName: string };

type RoomState = {
  history: InteractionRecord[];
  publicQueue: InteractionRecord[];
  feedback: InteractionRecord[];
  paused: boolean;
  danmakuEnabled: boolean;
};

export type DedupRecord = {
  senderId: string;
  eventId: string;
  roomId: string;
  fingerprint: string;
  interactionId: string;
  expiresAt: number;
};

export type DeduplicationResult =
  | { kind: "new" }
  | { kind: "duplicate"; interactionId: string }
  | { kind: "collision" };

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isPlainText(value: string, maximumCodePoints: number): boolean {
  const codePoints = Array.from(value);
  return codePoints.length > 0 && codePoints.length <= maximumCodePoints &&
    value.trim().length > 0 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

export function parseInteractionInput(message: Record<string, unknown>): {
  input: InteractionInput;
  eventId: string;
  fingerprint: string;
} | null {
  if (message.type !== "interaction.submit" || typeof message.eventId !== "string" ||
      !/^[A-Za-z0-9._:-]{1,128}$/u.test(message.eventId)) return null;

  let input: InteractionInput;
  if (message.kind === "chat" || message.kind === "danmaku") {
    if (!hasOnlyKeys(message, ["type", "eventId", "kind", "text"]) || typeof message.text !== "string") return null;
    const maximum = message.kind === "chat" ? MAX_CHAT_CODE_POINTS : MAX_DANMAKU_CODE_POINTS;
    if (!isPlainText(message.text, maximum)) return null;
    input = { kind: message.kind, text: message.text };
  } else if (message.kind === "sticker") {
    if (!hasOnlyKeys(message, ["type", "eventId", "kind", "sticker"]) ||
        typeof message.sticker !== "string" || !INTERACTION_STICKERS.includes(message.sticker as InteractionSticker)) return null;
    input = { kind: "sticker", sticker: message.sticker as InteractionSticker };
  } else if (message.kind === "feedback") {
    if (!hasOnlyKeys(message, ["type", "eventId", "kind", "feedback"]) ||
        typeof message.feedback !== "string" || !INTERACTION_FEEDBACK.includes(message.feedback as InteractionFeedback)) return null;
    input = { kind: "feedback", feedback: message.feedback as InteractionFeedback };
  } else {
    return null;
  }

  return { input, eventId: message.eventId, fingerprint: createHash("sha256").update(JSON.stringify(input)).digest("hex") };
}

function makeRoomState(): RoomState {
  return { history: [], publicQueue: [], feedback: [], paused: false, danmakuEnabled: true };
}

export class InteractionStore {
  private readonly rooms = new Map<string, RoomState>();
  private readonly dedup = new Map<string, DedupRecord>();
  private readonly dedupItemLimit: number;
  private readonly dirtyRooms = new Set<string>();

  constructor(roomIds: readonly string[], dedupItemLimit = INTERACTION_LIMITS.dedupItems) {
    this.dedupItemLimit = dedupItemLimit;
    for (const roomId of roomIds) this.rooms.set(roomId, makeRoomState());
  }

  restore(input: {
    records: readonly InteractionRecord[];
    publicQueueIds: readonly string[];
    dedup: readonly DedupRecord[];
    presentation: Record<string, { paused: boolean; danmakuEnabled: boolean }>;
    now?: number;
  }): void {
    const now = input.now ?? Date.now();
    const publicQueueIds = new Set(input.publicQueueIds);
    for (const roomId of this.rooms.keys()) {
      const room = this.room(roomId);
      const settings = input.presentation[roomId];
      if (settings) {
        room.paused = settings.paused;
        room.danmakuEnabled = settings.danmakuEnabled;
      }
    }
    for (const record of input.records) {
      const room = this.rooms.get(record.roomId);
      if (!room) continue;
      if (record.kind === "feedback") {
        if (record.expiresAt > now && now - record.at < INTERACTION_LIMITS.feedbackWindowMs) room.feedback.push({ ...record });
        continue;
      }
      if (now - record.at < INTERACTION_LIMITS.historyTtlMs) room.history.push({ ...record });
      if (record.kind === "danmaku" && publicQueueIds.has(record.id) && record.expiresAt > now) {
        room.publicQueue.push({ ...record });
      }
    }
    for (const room of this.rooms.values()) {
      room.history.sort((a, b) => a.at - b.at);
      room.history = room.history.slice(-INTERACTION_LIMITS.historyItems);
      room.feedback.sort((a, b) => a.at - b.at);
      room.feedback = room.feedback.slice(-INTERACTION_LIMITS.feedbackItems);
      room.publicQueue.sort((a, b) => a.at - b.at);
      room.publicQueue = room.publicQueue.slice(-INTERACTION_LIMITS.publicQueueItems);
    }
    for (const entry of input.dedup) {
      if (entry.expiresAt > now && this.dedup.size < this.dedupItemLimit) {
        this.dedup.set(this.dedupKey(entry.senderId, entry.eventId), { ...entry });
      }
    }
    this.prune(now);
  }

  durableDedup(now = Date.now()): DedupRecord[] {
    this.prune(now);
    return [...this.dedup.values()].map((record) => ({ ...record }));
  }

  publicQueueRecords(roomId: string): InteractionRecord[] {
    return this.room(roomId).publicQueue.map((record) => ({ ...record }));
  }

  prune(now = Date.now()): string[] {
    const changedRooms: string[] = [];
    for (const [roomId, room] of this.rooms) {
      const previousHistoryLength = room.history.length;
      const previousQueueLength = room.publicQueue.length;
      const previousFeedbackLength = room.feedback.length;
      room.history = room.history.filter((event) => now - event.at < INTERACTION_LIMITS.historyTtlMs);
      room.publicQueue = room.publicQueue.filter((event) => event.expiresAt > now);
      room.feedback = room.feedback.filter((event) => now - event.at < INTERACTION_LIMITS.feedbackWindowMs);
      if (room.history.length !== previousHistoryLength || room.publicQueue.length !== previousQueueLength || room.feedback.length !== previousFeedbackLength) {
        changedRooms.push(roomId);
        this.dirtyRooms.add(roomId);
      }
    }
    for (const [key, record] of this.dedup) {
      if (record.expiresAt <= now) this.dedup.delete(key);
    }
    return changedRooms;
  }

  drainChangedRooms(): string[] {
    const changedRooms = [...this.dirtyRooms];
    this.dirtyRooms.clear();
    return changedRooms;
  }

  hasDedupCapacity(now = Date.now()): boolean {
    this.prune(now);
    return this.dedup.size < this.dedupItemLimit;
  }

  checkDuplicate(
    senderId: string,
    eventId: string,
    roomId: string,
    fingerprint: string,
    now = Date.now(),
  ): DeduplicationResult {
    const key = this.dedupKey(senderId, eventId);
    const existing = this.dedup.get(key);
    if (!existing || existing.expiresAt <= now) {
      if (existing) this.dedup.delete(key);
      return { kind: "new" };
    }
    if (existing.roomId === roomId && existing.fingerprint === fingerprint) {
      return { kind: "duplicate", interactionId: existing.interactionId };
    }
    return { kind: "collision" };
  }

  accept(senderId: string, roomId: string, member: Member, eventId: string, input: InteractionInput, now = Date.now()): InteractionRecord | null {
    const room = this.room(roomId);
    this.prune(now);
    if (!this.hasDedupCapacity(now) || this.dedup.has(this.dedupKey(senderId, eventId))) return null;
    const ttl = input.kind === "danmaku" ? INTERACTION_LIMITS.publicTtlMs :
      input.kind === "feedback" ? INTERACTION_LIMITS.feedbackWindowMs : INTERACTION_LIMITS.historyTtlMs;
    const record: InteractionRecord = {
      id: randomUUID(), eventId, roomId, participantId: member.id, displayName: member.displayName,
      kind: input.kind, at: now, expiresAt: now + ttl,
      ...("text" in input ? { text: input.text } : {}),
      ...("sticker" in input ? { sticker: input.sticker } : {}),
      ...("feedback" in input ? { feedback: input.feedback } : {}),
    };
    if (input.kind !== "feedback") {
      room.history.push(record);
      if (room.history.length > INTERACTION_LIMITS.historyItems) room.history.splice(0, room.history.length - INTERACTION_LIMITS.historyItems);
    }
    if (input.kind === "danmaku") {
      room.publicQueue.push(record);
      if (room.publicQueue.length > INTERACTION_LIMITS.publicQueueItems) {
        room.publicQueue.splice(0, room.publicQueue.length - INTERACTION_LIMITS.publicQueueItems);
      }
    }
    if (input.kind === "feedback") {
      room.feedback.push(record);
      if (room.feedback.length > INTERACTION_LIMITS.feedbackItems) {
        room.feedback.splice(0, room.feedback.length - INTERACTION_LIMITS.feedbackItems);
      }
    }
    this.remember(senderId, eventId, roomId, createHash("sha256").update(JSON.stringify(input)).digest("hex"), record.id, now);
    return record;
  }

  snapshot(roomId: string, now = Date.now()) {
    this.prune(now);
    const room = this.room(roomId);
    return {
      roomId,
      history: room.history.map((event) => ({ ...event })),
      publicQueue: room.paused ? [] : room.publicQueue.map((event) => ({ ...event })),
      queueCount: room.publicQueue.length,
      presentation: { paused: room.paused, danmakuEnabled: room.danmakuEnabled },
      feedbackStats: this.feedbackStats(room, now),
      serverNow: now,
      limits: {
        feedbackWindowMs: INTERACTION_LIMITS.feedbackWindowMs,
        historyTtlMs: INTERACTION_LIMITS.historyTtlMs,
        publicTtlMs: INTERACTION_LIMITS.publicTtlMs,
        historyItems: INTERACTION_LIMITS.historyItems,
        publicQueueItems: INTERACTION_LIMITS.publicQueueItems,
        feedbackItems: INTERACTION_LIMITS.feedbackItems,
      },
    };
  }

  setPaused(roomId: string, paused: boolean): void {
    this.room(roomId).paused = paused;
  }

  setDanmakuEnabled(roomId: string, enabled: boolean): void {
    this.room(roomId).danmakuEnabled = enabled;
  }

  isDanmakuEnabled(roomId: string): boolean {
    return this.room(roomId).danmakuEnabled;
  }

  clearPublicQueue(roomId: string): number {
    const room = this.room(roomId);
    const count = room.publicQueue.length;
    room.publicQueue = [];
    return count;
  }

  remove(roomId: string, interactionId: string): boolean {
    const room = this.room(roomId);
    const previousHistoryLength = room.history.length;
    const previousQueueLength = room.publicQueue.length;
    room.history = room.history.filter((event) => event.id !== interactionId);
    room.publicQueue = room.publicQueue.filter((event) => event.id !== interactionId);
    return room.history.length !== previousHistoryLength || room.publicQueue.length !== previousQueueLength;
  }

  private room(roomId: string): RoomState {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Unknown interaction room: ${roomId}`);
    return room;
  }

  private feedbackStats(room: RoomState, now: number) {
    const counted = room.feedback.filter((event) => now - event.at < INTERACTION_LIMITS.feedbackWindowMs);
    return Object.fromEntries(INTERACTION_FEEDBACK.map((feedback) => {
      const selected = counted.filter((event) => event.feedback === feedback);
      return [feedback, {
        count: selected.length,
        uniqueParticipants: new Set(selected.map((event) => event.participantId)).size,
      }];
    })) as Record<InteractionFeedback, { count: number; uniqueParticipants: number }>;
  }

  private dedupKey(senderId: string, eventId: string): string {
    return `${senderId}\u0000${eventId}`;
  }

  private remember(senderId: string, eventId: string, roomId: string, fingerprint: string, interactionId: string, now: number): void {
    const key = this.dedupKey(senderId, eventId);
    this.dedup.set(key, { senderId, eventId, roomId, fingerprint, interactionId, expiresAt: now + INTERACTION_LIMITS.dedupTtlMs });
  }
}
