import { createHash, randomBytes } from "node:crypto";
import type { RoomId } from "./space.ts";

export const CONTROL_RESUME_TTL_MS = 10 * 60_000;
export const MAX_CONTROL_RESUME_SESSIONS = 512;

export type ResumeRole = "participant" | "display";
export type ResumeMode = "watch" | "interaction";

export type ControlResumeRecord = {
  token?: string;
  tokenDigest: string;
  participantId: string;
  displayName: string;
  roomId: RoomId;
  role: ResumeRole;
  mode: ResumeMode;
  admissionRevision: number;
  expiresAt: number;
  activeConnectionId: string | null;
};

type ResumeInput = Omit<ControlResumeRecord, "token" | "tokenDigest" | "expiresAt" | "activeConnectionId">;

type StoreOptions = {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
  createToken?: () => string;
  restored?: readonly (Omit<ControlResumeRecord, "token">)[];
  recentlyExpiredDigests?: readonly string[];
};

export function createControlResumeStore(options: StoreOptions = {}) {
  const ttlMs = options.ttlMs ?? CONTROL_RESUME_TTL_MS;
  const maxEntries = options.maxEntries ?? MAX_CONTROL_RESUME_SESSIONS;
  const now = options.now ?? Date.now;
  const createToken = options.createToken ?? (() => randomBytes(32).toString("base64url"));
  const records = new Map<string, ControlResumeRecord>();
  const recentlyExpiredDigests = new Set(options.recentlyExpiredDigests ?? []);
  const digestToken = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

  const pruneExpired = () => {
    const timestamp = now();
    for (const [digest, record] of records) {
      if (record.activeConnectionId === null && record.expiresAt <= timestamp) records.delete(digest);
    }
  };

  for (const persisted of options.restored ?? []) {
    if (persisted.expiresAt > now()) records.set(persisted.tokenDigest, { ...persisted, activeConnectionId: null });
  }

  const getRecord = (token: string | undefined): ControlResumeRecord | undefined => {
    if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return undefined;
    return records.get(digestToken(token));
  };

  const hasRoom = (): boolean => {
    pruneExpired();
    return records.size < maxEntries;
  };

  return {
    get size(): number {
      pruneExpired();
      return records.size;
    },

    hasActive(): boolean {
      for (const record of records.values()) if (record.activeConnectionId !== null) return true;
      return false;
    },

    canIssue(): boolean {
      return hasRoom();
    },

    issue(input: ResumeInput, connectionId: string): ControlResumeRecord | null {
      if (!hasRoom()) return null;
      const token = createToken();
      const tokenDigest = digestToken(token);
      const record: ControlResumeRecord = {
        ...input,
        token,
        tokenDigest,
        expiresAt: now() + ttlMs,
        activeConnectionId: connectionId,
      };
      recentlyExpiredDigests.delete(tokenDigest);
      records.set(tokenDigest, record);
      return record;
    },

    lookup(token: unknown): { record: ControlResumeRecord | null; expired: boolean } {
      if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return { record: null, expired: false };
      const tokenDigest = digestToken(token);
      const record = records.get(tokenDigest);
      if (!record) return { record: null, expired: recentlyExpiredDigests.has(tokenDigest) };
      if (record.activeConnectionId === null && record.expiresAt <= now()) {
        records.delete(tokenDigest);
        recentlyExpiredDigests.add(tokenDigest);
        return { record: null, expired: true };
      }
      // The client supplied the bearer for this lookup; retain it only in process memory for the active lifecycle.
      record.token = token;
      return { record, expired: false };
    },

    attach(record: ControlResumeRecord, connectionId: string): boolean {
      if (record.activeConnectionId !== null) return false;
      record.activeConnectionId = connectionId;
      record.expiresAt = now() + ttlMs;
      return true;
    },

    detach(token: string | undefined, connectionId: string): void {
      if (!token) return;
      const record = getRecord(token);
      if (record?.activeConnectionId === connectionId) {
        record.activeConnectionId = null;
        record.expiresAt = now() + ttlMs;
      }
    },

    updateMode(token: string | undefined, mode: ResumeMode): void {
      if (!token) return;
      const record = getRecord(token);
      if (record) record.mode = mode;
    },

    updateRoom(token: string | undefined, roomId: RoomId, admissionRevision: number): void {
      if (!token) return;
      const record = getRecord(token);
      if (!record) return;
      record.roomId = roomId;
      record.admissionRevision = admissionRevision;
    },

    refreshAdmission(token: string | undefined, admissionRevision: number): void {
      if (!token) return;
      const record = getRecord(token);
      if (record) record.admissionRevision = admissionRevision;
    },

    invalidate(token: string | undefined): string | undefined {
      if (!token) return undefined;
      const digest = digestToken(token);
      records.delete(digest);
      recentlyExpiredDigests.delete(digest);
      return digest;
    },

    invalidateParticipant(participantId: string): string[] {
      const invalidated: string[] = [];
      for (const [digest, record] of records) {
        if (record.participantId === participantId) {
          records.delete(digest);
          invalidated.push(digest);
        }
      }
      return invalidated;
    },

    snapshot(): Array<Omit<ControlResumeRecord, "token">> {
      pruneExpired();
      const timestamp = now();
      return [...records.values()].map(({ token: _token, ...record }) => ({
        ...record,
        // Active proofs use a bounded crash-recovery lease refreshed by the app heartbeat.
        ...(record.activeConnectionId !== null ? { expiresAt: Math.max(record.expiresAt, timestamp + ttlMs) } : {}),
      }));
    },

    digestForToken(token: string | undefined): string | undefined {
      return token && getRecord(token)?.tokenDigest;
    },

    clear(): void {
      records.clear();
    },
  };
}
