import { randomBytes } from "node:crypto";
import type { RoomId } from "./space.ts";

export const CONTROL_RESUME_TTL_MS = 10 * 60_000;
export const MAX_CONTROL_RESUME_SESSIONS = 512;

export type ResumeRole = "participant" | "display";
export type ResumeMode = "watch" | "interaction";

export type ControlResumeRecord = {
  token: string;
  participantId: string;
  displayName: string;
  roomId: RoomId;
  role: ResumeRole;
  mode: ResumeMode;
  admissionRevision: number;
  expiresAt: number;
  activeConnectionId: string | null;
};

type ResumeInput = Omit<ControlResumeRecord, "token" | "expiresAt" | "activeConnectionId">;

type StoreOptions = {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
  createToken?: () => string;
};

export function createControlResumeStore(options: StoreOptions = {}) {
  const ttlMs = options.ttlMs ?? CONTROL_RESUME_TTL_MS;
  const maxEntries = options.maxEntries ?? MAX_CONTROL_RESUME_SESSIONS;
  const now = options.now ?? Date.now;
  const createToken = options.createToken ?? (() => randomBytes(32).toString("base64url"));
  const records = new Map<string, ControlResumeRecord>();

  const pruneExpired = () => {
    const timestamp = now();
    for (const [token, record] of records) {
      if (record.activeConnectionId === null && record.expiresAt <= timestamp) records.delete(token);
    }
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

    canIssue(): boolean {
      return hasRoom();
    },

    issue(input: ResumeInput, connectionId: string): ControlResumeRecord | null {
      if (!hasRoom()) return null;
      const token = createToken();
      const record: ControlResumeRecord = {
        ...input,
        token,
        expiresAt: now() + ttlMs,
        activeConnectionId: connectionId,
      };
      records.set(token, record);
      return record;
    },

    lookup(token: unknown): { record: ControlResumeRecord | null; expired: boolean } {
      if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return { record: null, expired: false };
      const record = records.get(token);
      if (!record) return { record: null, expired: false };
      if (record.activeConnectionId === null && record.expiresAt <= now()) {
        records.delete(token);
        return { record: null, expired: true };
      }
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
      const record = records.get(token);
      if (record?.activeConnectionId === connectionId) {
        record.activeConnectionId = null;
        record.expiresAt = now() + ttlMs;
      }
    },

    updateMode(token: string | undefined, mode: ResumeMode): void {
      if (!token) return;
      const record = records.get(token);
      if (record) record.mode = mode;
    },

    updateRoom(token: string | undefined, roomId: RoomId, admissionRevision: number): void {
      if (!token) return;
      const record = records.get(token);
      if (!record) return;
      record.roomId = roomId;
      record.admissionRevision = admissionRevision;
    },

    refreshAdmission(token: string | undefined, admissionRevision: number): void {
      if (!token) return;
      const record = records.get(token);
      if (record) record.admissionRevision = admissionRevision;
    },

    invalidate(token: string | undefined): void {
      if (token) records.delete(token);
    },

    invalidateParticipant(participantId: string): void {
      for (const [token, record] of records) {
        if (record.participantId === participantId) records.delete(token);
      }
    },

    clear(): void {
      records.clear();
    },
  };
}
