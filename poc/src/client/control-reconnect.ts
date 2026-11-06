export type ResumeRole = "participant" | "display";

export type ResumeCandidate = {
  token: string;
  roomId: string;
  entryRoomId: string | null;
};

export type ResumeStorageResult = {
  candidate: ResumeCandidate | null;
  persistent: boolean;
};

const memoryCandidates = new Map<ResumeRole, ResumeCandidate>();

function storageKey(role: ResumeRole): string {
  return `laitse.control.resume.${role}`;
}

export function readResumeCandidate(role: ResumeRole): ResumeStorageResult {
  try {
    const encoded = window.sessionStorage.getItem(storageKey(role));
    if (!encoded) return { candidate: memoryCandidates.get(role) ?? null, persistent: true };
    const value = JSON.parse(encoded) as Partial<ResumeCandidate>;
    if (typeof value.token !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(value.token) ||
        typeof value.roomId !== "string" ||
        (value.entryRoomId !== null && typeof value.entryRoomId !== "string")) {
      window.sessionStorage.removeItem(storageKey(role));
      memoryCandidates.delete(role);
      return { candidate: null, persistent: true };
    }
    const candidate = { token: value.token, roomId: value.roomId, entryRoomId: value.entryRoomId ?? null };
    memoryCandidates.set(role, candidate);
    return { candidate, persistent: true };
  } catch {
    return { candidate: memoryCandidates.get(role) ?? null, persistent: false };
  }
}

export function saveResumeCandidate(role: ResumeRole, candidate: ResumeCandidate): boolean {
  memoryCandidates.set(role, candidate);
  try {
    window.sessionStorage.setItem(storageKey(role), JSON.stringify(candidate));
    return true;
  } catch {
    return false;
  }
}

export function clearResumeCandidate(role: ResumeRole): void {
  memoryCandidates.delete(role);
  try {
    window.sessionStorage.removeItem(storageKey(role));
  } catch {
    // A same-page reconnect can still use its in-memory candidate.
  }
}

export function resumeEntryMatches(candidate: ResumeCandidate, explicitRoomId: string | null): boolean {
  return explicitRoomId === candidate.entryRoomId;
}

export const MAX_RECONNECT_ATTEMPTS = 8;
export const MIN_RECONNECT_DELAY_MS = 250;
export const MAX_RECONNECT_DELAY_MS = 2_000;

export function reconnectDelayMs(attemptIndex: number, random = Math.random): number {
  const base = Math.min(MIN_RECONNECT_DELAY_MS * 2 ** attemptIndex, MAX_RECONNECT_DELAY_MS);
  return Math.round(base * (0.8 + random() * 0.4));
}

export class BoundedReconnectLoop {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private stopped = false;

  constructor(
    private readonly connect: () => void,
    private readonly exhausted: () => void,
    private readonly random: () => number = Math.random,
  ) {}

  schedule(): void {
    if (this.stopped || this.timer !== null) return;
    if (this.attempts >= MAX_RECONNECT_ATTEMPTS) {
      this.exhausted();
      return;
    }
    const delay = reconnectDelayMs(this.attempts, this.random);
    this.attempts += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.stopped) this.connect();
    }, delay);
  }

  recovered(): void {
    this.clearTimer();
    this.attempts = 0;
    this.stopped = false;
  }

  retryNow(): void {
    this.clearTimer();
    this.attempts = 0;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.clearTimer();
    this.attempts = 0;
    this.stopped = true;
  }

  dispose(): void {
    this.stop();
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
