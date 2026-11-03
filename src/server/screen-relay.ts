export const SCREEN_FRAME_HEADER_BYTES = 24;
export const MAX_SCREEN_FRAME_PAYLOAD_BYTES = 512 * 1_024;
export const MAX_SCREEN_FRAME_BYTES = SCREEN_FRAME_HEADER_BYTES + MAX_SCREEN_FRAME_PAYLOAD_BYTES;
export const MAX_SCREEN_SOCKET_BUFFERED_BYTES = 1_536 * 1_024;
export const MAX_SCREEN_WIDTH = 1_280;
export const MAX_SCREEN_HEIGHT = 720;
export const MAX_SCREEN_PIXELS = MAX_SCREEN_WIDTH * MAX_SCREEN_HEIGHT;
export const MAX_SCREEN_FRAME_RATE = 15;

const SCREEN_MAGIC = Buffer.from("LTS1", "ascii");
const SCREEN_CONFIG = Object.freeze({ codec: "vp8" });

type ScreenControlMessage = Record<string, unknown> & { type?: unknown };

type RelayPeer = {
  sendControl: (message: unknown) => void;
  sendBinary: (message: Buffer) => void;
  sendScreenBinary: (message: Buffer) => void;
  reject: (code: string, message: string, closeCode?: number) => void;
  readyState: () => number;
  openState: number;
};

type RelayConnection = {
  peer: RelayPeer;
  joined: boolean;
  subscribed: boolean;
  waitingForKeyframeGeneration: number | null;
};

type ScreenPublisher = {
  connectionId: string;
  generation: number;
  lastSequence: number;
  width: number;
  height: number;
  frameRate: number;
  bitrate: number;
  lastKeyframeRequestAt: number;
};

const KEYFRAME_REQUEST_MIN_INTERVAL_MS = 250;

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function hasMagic(bytes: Buffer): boolean {
  return bytes.byteLength >= SCREEN_MAGIC.byteLength && bytes.subarray(0, SCREEN_MAGIC.byteLength).equals(SCREEN_MAGIC);
}

export function createScreenRelay() {
  const connections = new Map<string, RelayConnection>();
  let publisher: ScreenPublisher | null = null;
  let generation = 0;

  const streamMessage = (active: ScreenPublisher) => ({
    type: "screen.stream",
    generation: active.generation,
    clockId: active.connectionId,
    codec: SCREEN_CONFIG.codec,
    width: active.width,
    height: active.height,
    frameRate: active.frameRate,
    bitrate: active.bitrate,
  });

  const requestKeyframe = (active: ScreenPublisher) => {
    const now = Date.now();
    if (now - active.lastKeyframeRequestAt < KEYFRAME_REQUEST_MIN_INTERVAL_MS) return;
    active.lastKeyframeRequestAt = now;
    const connection = connections.get(active.connectionId);
    if (!connection || connection.peer.readyState() !== connection.peer.openState) return;
    connection.peer.sendControl({ type: "screen.keyframeRequest", generation: active.generation });
  };

  const tellSubscribers = (message: unknown, excludeConnectionId?: string) => {
    for (const [connectionId, connection] of connections) {
      if (
        connectionId !== publisher?.connectionId &&
        connectionId !== excludeConnectionId &&
        connection.joined &&
        connection.subscribed &&
        connection.peer.readyState() === connection.peer.openState
      ) {
        connection.peer.sendControl(message);
      }
    }
  };

  function register(connectionId: string, peer: RelayPeer): void {
    connections.set(connectionId, { peer, joined: false, subscribed: false, waitingForKeyframeGeneration: null });
  }

  function markJoined(connectionId: string): void {
    const connection = connections.get(connectionId);
    if (connection) connection.joined = true;
  }

  function handleControl(connectionId: string, message: ScreenControlMessage): boolean {
    if (typeof message.type !== "string" || !message.type.startsWith("screen.")) return false;
    const connection = connections.get(connectionId);
    if (!connection) return true;

    const fail = (code: string, explanation: string) => connection.peer.reject(code, explanation);
    if (!connection.joined) {
      fail("screen_not_joined", "Join the room before using screen sharing.");
      return true;
    }

    if (message.type === "screen.subscribe") {
      if (!hasOnlyKeys(message, ["type"])) {
        fail("invalid_screen_control", "Screen subscription controls contain unsupported fields.");
        return true;
      }
      connection.subscribed = true;
      connection.waitingForKeyframeGeneration = publisher?.generation ?? null;
      connection.peer.sendControl({ type: "screen.subscribed" });
      if (publisher) {
        connection.peer.sendControl(streamMessage(publisher));
        requestKeyframe(publisher);
      }
      return true;
    }

    if (message.type === "screen.unsubscribe") {
      if (!hasOnlyKeys(message, ["type"])) {
        fail("invalid_screen_control", "Screen subscription controls contain unsupported fields.");
        return true;
      }
      connection.subscribed = false;
      connection.waitingForKeyframeGeneration = null;
      connection.peer.sendControl({ type: "screen.unsubscribed" });
      return true;
    }

    if (message.type === "screen.start") {
      if (!hasOnlyKeys(message, ["type", "codec", "width", "height", "frameRate", "bitrate"])) {
        fail("invalid_screen_config", "Screen publishing settings contain unsupported fields.");
        return true;
      }
      if (
        message.codec !== SCREEN_CONFIG.codec ||
        !isPositiveInteger(message.width) || message.width > MAX_SCREEN_WIDTH ||
        !isPositiveInteger(message.height) || message.height > MAX_SCREEN_HEIGHT ||
        message.width * message.height > MAX_SCREEN_PIXELS ||
        !isPositiveInteger(message.frameRate) || message.frameRate > MAX_SCREEN_FRAME_RATE ||
        !isPositiveInteger(message.bitrate) || message.bitrate > 1_500_000
      ) {
        connection.peer.sendControl({ type: "screen.error", code: "unsupported_screen_config", message: "This room accepts VP8 up to 1280×720, 15 fps, and 1.5 Mbit/s." });
        return true;
      }
      if (publisher) {
        connection.peer.sendControl({ type: "screen.error", code: "publisher_exists", message: "Another participant is already sharing a screen." });
        return true;
      }

      generation = generation >= 0xffff_ffff ? 1 : generation + 1;
      publisher = {
        connectionId,
        generation,
        lastSequence: -1,
        width: message.width,
        height: message.height,
        frameRate: message.frameRate,
        bitrate: message.bitrate,
        lastKeyframeRequestAt: 0,
      };
      for (const subscriber of connections.values()) {
        if (subscriber.subscribed) subscriber.waitingForKeyframeGeneration = publisher.generation;
      }
      connection.peer.sendControl({ type: "screen.started", generation, codec: SCREEN_CONFIG.codec });
      tellSubscribers(streamMessage(publisher));
      return true;
    }

    if (message.type === "screen.stop") {
      if (!hasOnlyKeys(message, ["type", "generation"]) || !isPositiveInteger(message.generation)) {
        fail("invalid_screen_control", "Screen stop requires the current stream generation.");
        return true;
      }
      if (publisher?.connectionId !== connectionId || publisher.generation !== message.generation) {
        connection.peer.sendControl({ type: "screen.error", code: "not_current_publisher", message: "This connection does not own the active screen share." });
        return true;
      }
      const active = publisher;
      publisher = null;
      for (const subscriber of connections.values()) {
        if (subscriber.waitingForKeyframeGeneration === active.generation) subscriber.waitingForKeyframeGeneration = null;
      }
      connection.peer.sendControl({ type: "screen.stopped", generation: active.generation });
      tellSubscribers({ type: "screen.streamEnded", generation: active.generation }, active.connectionId);
      return true;
    }

    fail("invalid_screen_control", "This screen control is not supported.");
    return true;
  }

  function handleBinary(connectionId: string, bytes: Buffer): boolean {
    if (!hasMagic(bytes)) return false;
    const connection = connections.get(connectionId);
    if (!connection) return true;
    if (!publisher || publisher.connectionId !== connectionId) {
      connection.peer.reject("screen_not_publisher", "Only the active screen publisher may send screen frames.");
      return true;
    }
    if (bytes.byteLength < SCREEN_FRAME_HEADER_BYTES + 1 || bytes.byteLength > MAX_SCREEN_FRAME_BYTES) {
      connection.peer.reject("invalid_screen_frame", "Screen frames must contain a bounded VP8 chunk.", 1009);
      return true;
    }
    const generationInFrame = bytes.readUInt32BE(4);
    const sequence = bytes.readUInt32BE(8);
    const timestampUs = bytes.readDoubleBE(12);
    const chunkType = bytes[20];
    if (
      generationInFrame !== publisher.generation ||
      !Number.isFinite(timestampUs) || timestampUs < 0 ||
      (chunkType !== 0 && chunkType !== 1) ||
      bytes[21] !== 0 || bytes[22] !== 0 || bytes[23] !== 0 ||
      sequence <= publisher.lastSequence
    ) {
      connection.peer.reject("invalid_screen_frame", "The screen frame has an old generation or invalid timing/header.");
      return true;
    }

    publisher.lastSequence = sequence;
    for (const [targetId, target] of connections) {
      if (
        targetId !== connectionId &&
        target.joined &&
        target.subscribed &&
        target.peer.readyState() === target.peer.openState
      ) {
        if (target.waitingForKeyframeGeneration === publisher.generation) {
          if (chunkType !== 0) continue;
          target.waitingForKeyframeGeneration = null;
        }
        target.peer.sendScreenBinary(bytes);
      }
    }
    return true;
  }

  function endPublisher(connectionId: string): void {
    if (publisher?.connectionId !== connectionId) return;
    const active = publisher;
    publisher = null;
    for (const subscriber of connections.values()) {
      if (subscriber.waitingForKeyframeGeneration === active.generation) subscriber.waitingForKeyframeGeneration = null;
    }
    tellSubscribers({ type: "screen.streamEnded", generation: active.generation }, active.connectionId);
  }

  function disconnect(connectionId: string): void {
    const connection = connections.get(connectionId);
    connections.delete(connectionId);
    endPublisher(connectionId);
    if (connection) connection.subscribed = false;
  }

  function close(): void {
    connections.clear();
    publisher = null;
  }

  return { register, markJoined, handleControl, handleBinary, disconnect, close };
}
