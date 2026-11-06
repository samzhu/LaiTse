import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { RoomId } from "./space.ts";

export const MAX_ROOM_PASSWORD_CODE_POINTS = 128;
export const MAX_ROOM_PASSWORD_BYTES = 512;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_VERIFIER_BYTES = 32;
const MAX_ATTEMPTS_PER_WINDOW = 5;
const ATTEMPT_WINDOW_MS = 60_000;

export type RoomAccessDenial = {
  code: "room_password_required" | "room_password_incorrect" | "room_password_rate_limited" | "room_password_invalid";
  message: string;
};

export type PersistedRoomAccess = {
  locked: boolean;
  passwordSalt: string | null;
  passwordVerifier: string | null;
  admissionRevision: number;
};

export function isValidRoomPassword(value: string): boolean {
  return Array.from(value).length <= MAX_ROOM_PASSWORD_CODE_POINTS &&
    Buffer.byteLength(value, "utf8") <= MAX_ROOM_PASSWORD_BYTES;
}

function createVerifier(password: string): { salt: Buffer; verifier: Buffer } {
  if (!isValidRoomPassword(password)) {
    throw new Error(`Meeting room password must be at most ${MAX_ROOM_PASSWORD_CODE_POINTS} characters and ${MAX_ROOM_PASSWORD_BYTES} UTF-8 bytes.`);
  }
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const verifier = scryptSync(password, salt, PASSWORD_VERIFIER_BYTES);
  return { salt, verifier };
}

export function createRoomAccessPolicy(meetingRoomPassword?: string, persisted?: PersistedRoomAccess) {
  let stored = meetingRoomPassword ? createVerifier(meetingRoomPassword) : null;
  let studioRevision = 0;
  if (persisted) {
    if (!persisted.locked) stored = null;
    else {
      if (!persisted.passwordSalt || !persisted.passwordVerifier) throw new Error("Persisted room password verifier is incomplete.");
      stored = {
        salt: Buffer.from(persisted.passwordSalt, "base64"),
        verifier: Buffer.from(persisted.passwordVerifier, "base64"),
      };
    }
    studioRevision = persisted.admissionRevision;
  }
  const attemptsByConnection = new WeakMap<object, number[]>();

  return {
    admissionRevision(roomId: RoomId): number {
      return roomId === "studio" ? studioRevision : 0;
    },

    isMeetingRoomLocked(roomId: RoomId): boolean {
      return roomId === "studio" && stored !== null;
    },

    authorizeEntry(roomId: RoomId, password: unknown, connection: object): RoomAccessDenial | null {
      if (!this.isMeetingRoomLocked(roomId)) return null;
      const now = Date.now();
      const recentAttempts = (attemptsByConnection.get(connection) ?? []).filter((attemptAt) => now - attemptAt < ATTEMPT_WINDOW_MS);
      if (recentAttempts.length >= MAX_ATTEMPTS_PER_WINDOW) {
        attemptsByConnection.set(connection, recentAttempts);
        return {
          code: "room_password_rate_limited",
          message: "Too many room entry attempts. Wait a minute before trying again.",
        };
      }
      recentAttempts.push(now);
      attemptsByConnection.set(connection, recentAttempts);

      if (password !== undefined && (typeof password !== "string" || !isValidRoomPassword(password))) {
        return {
          code: "room_password_invalid",
          message: `The password must be at most ${MAX_ROOM_PASSWORD_CODE_POINTS} characters and ${MAX_ROOM_PASSWORD_BYTES} UTF-8 bytes.`,
        };
      }

      if (typeof password !== "string") {
        return { code: "room_password_required", message: "Enter the meeting room password to continue." };
      }

      const candidate = scryptSync(password, stored!.salt, PASSWORD_VERIFIER_BYTES);
      if (!timingSafeEqual(candidate, stored!.verifier)) {
        return { code: "room_password_incorrect", message: "That meeting room password is incorrect. Try again." };
      }
      return null;
    },

    setMeetingRoomPassword(password: string | null): void {
      stored = password === null ? null : createVerifier(password);
      studioRevision += 1;
    },

    snapshot(): PersistedRoomAccess {
      return {
        locked: stored !== null,
        passwordSalt: stored ? stored.salt.toString("base64") : null,
        passwordVerifier: stored ? stored.verifier.toString("base64") : null,
        admissionRevision: studioRevision,
      };
    },
  };
}
