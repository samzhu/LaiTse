import { randomInt } from "node:crypto";
import type { PersistedRoomAccess } from "./room-access.ts";
import type { RoomId } from "./space.ts";

export type RoomLockKind = "none" | "legacy" | "anonymous";

export type PersistedRoomManagement = {
  lockKind: RoomLockKind;
  managerParticipantId: string | null;
};

export type RoomManagementSnapshot = PersistedRoomManagement & {
  roomId: RoomId;
  locked: boolean;
};

export type HandoverResult = "unchanged" | "transferred" | "unlocked";

type RoomManagementOptions = {
  initial?: PersistedRoomManagement;
  randomIndex?: (exclusiveMax: number) => number;
};

export function createRoomManagement(options: RoomManagementOptions = {}) {
  let lockKind = options.initial?.lockKind ?? "none";
  let managerParticipantId = options.initial?.managerParticipantId ?? null;
  const chooseIndex = options.randomIndex ?? ((exclusiveMax: number) => randomInt(exclusiveMax));

  const clear = (): void => {
    lockKind = "none";
    managerParticipantId = null;
  };

  return {
    snapshot(locked: boolean): RoomManagementSnapshot {
      return {
        roomId: "studio",
        locked,
        lockKind,
        managerParticipantId,
      };
    },

    lockAnonymous(participantId: string): boolean {
      if (lockKind !== "none" || !participantId) return false;
      lockKind = "anonymous";
      managerParticipantId = participantId;
      return true;
    },

    canManageAnonymously(participantId: string): boolean {
      return lockKind === "anonymous" && managerParticipantId === participantId;
    },

    setLegacyLock(locked: boolean): void {
      if (locked) {
        lockKind = "legacy";
        managerParticipantId = null;
      } else {
        clear();
      }
    },

    transfer(actorParticipantId: string, targetParticipantId: string, targetIsOnlineStudioParticipant: boolean): boolean {
      if (!this.canManageAnonymously(actorParticipantId) || !targetParticipantId || targetParticipantId === actorParticipantId || !targetIsOnlineStudioParticipant) {
        return false;
      }
      managerParticipantId = targetParticipantId;
      return true;
    },

    ownerDisconnected(participantId: string, onlineStudioParticipantIds: readonly string[]): HandoverResult {
      if (!this.canManageAnonymously(participantId)) return "unchanged";
      const candidates = [...new Set(onlineStudioParticipantIds.filter((candidateId) => candidateId && candidateId !== participantId))];
      if (candidates.length === 0) {
        clear();
        return "unlocked";
      }
      const selected = chooseIndex(candidates.length);
      if (!Number.isInteger(selected) || selected < 0 || selected >= candidates.length) {
        throw new RangeError("Room management RNG must return a valid candidate index.");
      }
      managerParticipantId = candidates[selected]!;
      return "transferred";
    },

    restoreAfterRestart(access: PersistedRoomAccess): { access: PersistedRoomAccess; changed: boolean } {
      if (lockKind !== "anonymous") return { access, changed: false };
      clear();
      return {
        changed: true,
        access: {
          locked: false,
          passwordSalt: null,
          passwordVerifier: null,
          admissionRevision: access.admissionRevision + 1,
        },
      };
    },
  };
}
