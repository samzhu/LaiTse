export type MediaReceiveChannel = "audio" | "screen";
export type MediaRecoveryRole = "participant" | "display";
export type MediaRecoveryMode = "watch" | "interaction";

export type MediaRecoveryAuthority = {
  roomId: string | null;
  role: MediaRecoveryRole;
  mode: MediaRecoveryMode;
};

export type MediaReceiveIntentSnapshot = {
  roomId: string | null;
  audio: boolean;
  screen: boolean;
};

/** Same-page receive intent only. It deliberately stores no socket, token, or publish permission. */
export class MediaRecoveryIntent {
  private roomId: string | null = null;
  private audio = false;
  private screen = false;

  set(channel: MediaReceiveChannel, enabled: boolean, roomId: string): void {
    if (!roomId) return;
    if (enabled) {
      if (this.roomId !== roomId) this.clear();
      this.roomId = roomId;
      this[channel] = true;
      return;
    }
    if (this.roomId !== roomId) return;
    this[channel] = false;
    this.clearRoomWhenEmpty();
  }

  clear(): void {
    this.roomId = null;
    this.audio = false;
    this.screen = false;
  }

  /**
   * Call only after both a fresh room snapshot and participation snapshot arrive
   * on the resumed socket. A room change, role/mode downgrade, or failed gate
   * drops the old receive intent instead of carrying it into another context.
   */
  restoreFor(authority: MediaRecoveryAuthority): MediaReceiveIntentSnapshot {
    if (!authority.roomId || authority.mode !== "watch" || this.roomId !== authority.roomId) {
      this.clear();
      return this.snapshot();
    }
    if (authority.role !== "participant" && authority.role !== "display") {
      this.clear();
      return this.snapshot();
    }
    if (authority.role === "display") {
      this.audio = false;
      this.clearRoomWhenEmpty();
    }
    return this.snapshot();
  }

  snapshot(): MediaReceiveIntentSnapshot {
    return { roomId: this.roomId, audio: this.audio, screen: this.screen };
  }

  private clearRoomWhenEmpty(): void {
    if (!this.audio && !this.screen) this.roomId = null;
  }
}
