import type { WebSocket } from "ws";

export const MAX_APPLICATION_SEND_BYTES = 1_536 * 1_024;
export const MAX_PENDING_CALLBACK_AGE_MS = 1_000;

export type TransportBudgetSnapshot = {
  scope: "application WebSocket send callback; excludes OS/TCP queues and peer receipt";
  maxPendingBytes: number;
  maxPendingCallbackAgeMs: number;
  pendingCallbackCount: number;
  pendingCallbackBytes: number;
  pendingCallbackHighWaterCount: number;
  pendingCallbackHighWaterBytes: number;
  oldestPendingCallbackAgeMs: number | null;
  highWaterBufferedBytes: number;
  closeReason: "buffered_bytes" | "pending_callback_age" | null;
};

type SendOptions = { binary?: boolean; compress?: boolean };
type PendingCallback = { bytes: number; startedAtMs: number };
type TimerHandle = ReturnType<typeof setTimeout>;

type TransportSocket = Pick<WebSocket, "readyState" | "OPEN" | "bufferedAmount" | "send" | "close" | "terminate">;

type TransportBudgetOptions = {
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => TimerHandle;
  cancel?: (timer: TimerHandle) => void;
  maxBytes?: number;
  maxCallbackAgeMs?: number;
};

export function createTransportBudget(socket: TransportSocket, options: TransportBudgetOptions = {}) {
  const now = options.now ?? (() => performance.now());
  const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancel = options.cancel ?? ((timer) => clearTimeout(timer));
  const maxBytes = options.maxBytes ?? MAX_APPLICATION_SEND_BYTES;
  const maxCallbackAgeMs = options.maxCallbackAgeMs ?? MAX_PENDING_CALLBACK_AGE_MS;
  const pending = new Map<number, PendingCallback>();
  let nextId = 1;
  let pendingCallbackBytes = 0;
  let ageTimer: TimerHandle | null = null;
  let disposed = false;
  let closeReason: TransportBudgetSnapshot["closeReason"] = null;
  let pendingCallbackHighWaterCount = 0;
  let pendingCallbackHighWaterBytes = 0;
  let highWaterBufferedBytes = socket.bufferedAmount;

  const oldestPending = () => {
    let oldest: PendingCallback | null = null;
    for (const entry of pending.values()) {
      if (!oldest || entry.startedAtMs < oldest.startedAtMs) oldest = entry;
    }
    return oldest;
  };

  const cancelAgeTimer = () => {
    if (ageTimer !== null) cancel(ageTimer);
    ageTimer = null;
  };

  const closeSlowSocket = (reason: NonNullable<TransportBudgetSnapshot["closeReason"]>) => {
    if (disposed || closeReason !== null) return;
    closeReason = reason;
    cancelAgeTimer();
    if (socket.readyState === socket.OPEN) {
      socket.close(1013, reason === "buffered_bytes" ? "Receiver send queue exceeded limit" : "Receiver send callback timed out");
    }
  };

  const enforceCallbackAge = () => {
    if (disposed || closeReason !== null) return;
    const oldest = oldestPending();
    if (oldest && now() - oldest.startedAtMs >= maxCallbackAgeMs) {
      closeSlowSocket("pending_callback_age");
    }
  };

  const armAgeTimer = () => {
    cancelAgeTimer();
    if (disposed || closeReason !== null || pending.size === 0) return;
    const oldest = oldestPending();
    if (!oldest) return;
    const remaining = Math.max(1, maxCallbackAgeMs - (now() - oldest.startedAtMs));
    ageTimer = schedule(() => {
      ageTimer = null;
      enforceCallbackAge();
      armAgeTimer();
    }, remaining);
    (ageTimer as TimerHandle & { unref?: () => void }).unref?.();
  };

  const snapshot = (): TransportBudgetSnapshot => {
    const oldest = oldestPending();
    return {
      scope: "application WebSocket send callback; excludes OS/TCP queues and peer receipt",
      maxPendingBytes: maxBytes,
      maxPendingCallbackAgeMs: maxCallbackAgeMs,
      pendingCallbackCount: pending.size,
      pendingCallbackBytes,
      pendingCallbackHighWaterCount,
      pendingCallbackHighWaterBytes,
      oldestPendingCallbackAgeMs: oldest ? Math.max(0, Math.round(now() - oldest.startedAtMs)) : null,
      highWaterBufferedBytes,
      closeReason,
    };
  };

  const send = (payload: string | Buffer, sendOptions?: SendOptions): boolean => {
    enforceCallbackAge();
    if (disposed || closeReason !== null || socket.readyState !== socket.OPEN) return false;
    const bytes = typeof payload === "string" ? Buffer.byteLength(payload) : payload.byteLength;
    const currentBufferedBytes = Math.max(socket.bufferedAmount, pendingCallbackBytes);
    if (currentBufferedBytes + bytes > maxBytes) {
      closeSlowSocket("buffered_bytes");
      return false;
    }

    const id = nextId++;
    pending.set(id, { bytes, startedAtMs: now() });
    pendingCallbackBytes += bytes;
    pendingCallbackHighWaterCount = Math.max(pendingCallbackHighWaterCount, pending.size);
    pendingCallbackHighWaterBytes = Math.max(pendingCallbackHighWaterBytes, pendingCallbackBytes);
    try {
      const callback = (error?: Error) => {
        enforceCallbackAge();
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        pendingCallbackBytes -= entry.bytes;
        if (error && socket.readyState === socket.OPEN) socket.terminate();
        armAgeTimer();
      };
      if (sendOptions) socket.send(payload, sendOptions, callback);
      else socket.send(payload, callback);
      highWaterBufferedBytes = Math.max(highWaterBufferedBytes, socket.bufferedAmount);
      armAgeTimer();
      return true;
    } catch {
      const entry = pending.get(id);
      if (entry) {
        pending.delete(id);
        pendingCallbackBytes -= entry.bytes;
      }
      armAgeTimer();
      if (socket.readyState === socket.OPEN) socket.terminate();
      return false;
    }
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAgeTimer();
    pending.clear();
    pendingCallbackBytes = 0;
  };

  return { send, snapshot, dispose };
}
