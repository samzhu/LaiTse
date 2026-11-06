import type { WebSocket } from "ws";

export const DEFAULT_CONNECTION_PING_INTERVAL_MS = 10_000;
export const DEFAULT_CONNECTION_PONG_TIMEOUT_MS = 20_000;

type LivenessSocket = Pick<WebSocket, "readyState" | "OPEN" | "ping" | "terminate" | "on" | "off">;

type ConnectionLivenessOptions = {
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
  now?: () => number;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
};

type LivenessState = {
  awaitingPongSince: number | null;
  onPong: () => void;
};

function assertDuration(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number.`);
  }
}

/**
 * Tracks a single outstanding server ping per connection with one app-wide timer.
 * Closing an expired socket is deliberately left to ws' normal close event so the
 * app's serialized membership, ownership, and media cleanup remains authoritative.
 */
export function createConnectionLiveness(options: ConnectionLivenessOptions = {}) {
  const pingIntervalMs = options.pingIntervalMs ?? DEFAULT_CONNECTION_PING_INTERVAL_MS;
  const pongTimeoutMs = options.pongTimeoutMs ?? DEFAULT_CONNECTION_PONG_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const startInterval = options.setInterval ?? globalThis.setInterval;
  const stopInterval = options.clearInterval ?? globalThis.clearInterval;
  assertDuration("pingIntervalMs", pingIntervalMs);
  assertDuration("pongTimeoutMs", pongTimeoutMs);
  if (pongTimeoutMs < pingIntervalMs) {
    throw new RangeError("pongTimeoutMs must be greater than or equal to pingIntervalMs.");
  }

  const sockets = new Map<LivenessSocket, LivenessState>();
  let disposed = false;

  const remove = (socket: LivenessSocket): void => {
    const state = sockets.get(socket);
    if (!state) return;
    sockets.delete(socket);
    socket.off("pong", state.onPong);
  };

  const tick = (): void => {
    if (disposed) return;
    const timestamp = now();
    for (const [socket, state] of sockets) {
      if (socket.readyState !== socket.OPEN) {
        remove(socket);
        continue;
      }
      if (state.awaitingPongSince !== null) {
        if (timestamp - state.awaitingPongSince >= pongTimeoutMs) {
          remove(socket);
          socket.terminate();
        }
        continue;
      }

      state.awaitingPongSince = timestamp;
      try {
        socket.ping();
      } catch {
        remove(socket);
        socket.terminate();
      }
    }
  };

  const timer = startInterval(tick, pingIntervalMs);
  timer.unref?.();

  return {
    add(socket: LivenessSocket): void {
      if (disposed || sockets.has(socket)) return;
      const state: LivenessState = {
        awaitingPongSince: null,
        onPong: () => {
          const current = sockets.get(socket);
          if (current === state) current.awaitingPongSince = null;
        },
      };
      sockets.set(socket, state);
      socket.on("pong", state.onPong);
    },

    remove,

    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopInterval(timer);
      for (const socket of sockets.keys()) remove(socket);
    },

    get size(): number {
      return sockets.size;
    },
  };
}
