export const AUDIO_FRAME_HEADER_BYTES = 24;
export const MAX_OPUS_PACKET_BYTES = 4_096;
export const MAX_AUDIO_FRAME_BYTES = AUDIO_FRAME_HEADER_BYTES + MAX_OPUS_PACKET_BYTES;
export const AUDIO_FRAME_DURATION_US = 20_000;

const AUDIO_MAGIC = Buffer.from("LTA1", "ascii");
const AUDIO_CONFIG = Object.freeze({
  codec: "opus",
  sampleRate: 48_000,
  channels: 1,
  bitrate: 32_000,
  frameDurationUs: AUDIO_FRAME_DURATION_US,
});

type AudioControlMessage = Record<string, unknown> & { type?: unknown };

type RelayPeer = {
  sendControl: (message: unknown) => void;
  sendBinary: (message: Buffer) => void;
  reject: (code: string, message: string, closeCode?: number) => void;
  readyState: () => number;
  openState: number;
};

type RelayConnection = {
  peer: RelayPeer;
  joined: boolean;
  subscribed: boolean;
};

type Publisher = {
  connectionId: string;
  generation: number;
  lastSequence: number;
};

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function matchesConfig(value: Record<string, unknown>): boolean {
  return value.codec === AUDIO_CONFIG.codec &&
    value.sampleRate === AUDIO_CONFIG.sampleRate &&
    value.channels === AUDIO_CONFIG.channels &&
    value.bitrate === AUDIO_CONFIG.bitrate &&
    value.frameDurationUs === AUDIO_CONFIG.frameDurationUs;
}

export function createAudioRelay() {
  const connections = new Map<string, RelayConnection>();
  let publisher: Publisher | null = null;
  let generation = 0;

  const currentStreamMessage = (active: Publisher) => ({
    type: "audio.stream",
    generation: active.generation,
    clockId: active.connectionId,
    config: AUDIO_CONFIG,
  });

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
    connections.set(connectionId, { peer, joined: false, subscribed: false });
  }

  function markJoined(connectionId: string): void {
    const connection = connections.get(connectionId);
    if (connection) connection.joined = true;
  }

  function handleControl(connectionId: string, message: AudioControlMessage): boolean {
    if (typeof message.type !== "string" || !message.type.startsWith("audio.")) return false;
    const connection = connections.get(connectionId);
    if (!connection) return true;

    const fail = (code: string, explanation: string) => {
      connection.peer.reject(code, explanation);
    };

    if (!connection.joined) {
      fail("audio_not_joined", "Join the room before using audio.");
      return true;
    }

    if (message.type === "audio.subscribe") {
      if (!hasOnlyKeys(message, ["type"])) {
        fail("invalid_audio_control", "Audio subscription controls contain unsupported fields.");
        return true;
      }
      connection.subscribed = true;
      connection.peer.sendControl({ type: "audio.subscribed" });
      if (publisher && publisher.connectionId !== connectionId) connection.peer.sendControl(currentStreamMessage(publisher));
      return true;
    }

    if (message.type === "audio.unsubscribe") {
      if (!hasOnlyKeys(message, ["type"])) {
        fail("invalid_audio_control", "Audio subscription controls contain unsupported fields.");
        return true;
      }
      connection.subscribed = false;
      connection.peer.sendControl({ type: "audio.unsubscribed" });
      return true;
    }

    if (message.type === "audio.start") {
      if (!hasOnlyKeys(message, ["type", "codec", "sampleRate", "channels", "bitrate", "frameDurationUs"])) {
        fail("invalid_audio_config", "Audio publish settings contain unsupported fields.");
        return true;
      }
      if (!matchesConfig(message)) {
        connection.peer.sendControl({ type: "audio.error", code: "unsupported_audio_config", message: "This room accepts only mono Opus at 48 kHz, 32 kbit/s, and 20 ms frames." });
        return true;
      }
      if (publisher) {
        connection.peer.sendControl({ type: "audio.error", code: "publisher_exists", message: "Another participant is already publishing audio." });
        return true;
      }

      generation = generation >= 0xffff_ffff ? 1 : generation + 1;
      publisher = { connectionId, generation, lastSequence: -1 };
      connection.peer.sendControl({ type: "audio.started", generation, config: AUDIO_CONFIG });
      tellSubscribers(currentStreamMessage(publisher));
      return true;
    }

    if (message.type === "audio.stop") {
      if (!hasOnlyKeys(message, ["type", "generation"]) || !Number.isInteger(message.generation)) {
        fail("invalid_audio_control", "Audio stop requires the current stream generation.");
        return true;
      }
      if (publisher?.connectionId !== connectionId || publisher.generation !== message.generation) {
        connection.peer.sendControl({ type: "audio.error", code: "not_current_publisher", message: "This connection does not own the active audio stream." });
        return true;
      }
      const active = publisher;
      publisher = null;
      connection.peer.sendControl({ type: "audio.stopped", generation: active.generation });
      tellSubscribers({ type: "audio.streamEnded", generation: active.generation }, active.connectionId);
      return true;
    }

    fail("invalid_audio_control", "This audio control is not supported.");
    return true;
  }

  function handleBinary(connectionId: string, bytes: Buffer): void {
    const connection = connections.get(connectionId);
    if (!connection) return;
    if (!publisher || publisher.connectionId !== connectionId) {
      connection.peer.reject("audio_not_publisher", "Only the active audio publisher may send binary audio frames.");
      return;
    }
    if (bytes.byteLength < AUDIO_FRAME_HEADER_BYTES + 1 || bytes.byteLength > MAX_AUDIO_FRAME_BYTES) {
      connection.peer.reject("invalid_audio_frame", "Compressed audio frames must contain a bounded Opus packet.", 1009);
      return;
    }
    if (!bytes.subarray(0, 4).equals(AUDIO_MAGIC)) {
      connection.peer.reject("invalid_audio_frame", "The compressed audio frame header is invalid.");
      return;
    }

    const frameGeneration = bytes.readUInt32BE(4);
    const sequence = bytes.readUInt32BE(8);
    const timestampUs = bytes.readDoubleBE(12);
    const durationUs = bytes.readUInt32BE(20);
    if (
      frameGeneration !== publisher.generation ||
      !Number.isFinite(timestampUs) ||
      timestampUs < 0 ||
      durationUs !== AUDIO_FRAME_DURATION_US ||
      sequence <= publisher.lastSequence
    ) {
      connection.peer.reject("invalid_audio_frame", "The compressed audio frame has an old generation or invalid timing.");
      return;
    }

    publisher.lastSequence = sequence;
    for (const [targetId, target] of connections) {
      if (
        targetId !== connectionId &&
        target.joined &&
        target.subscribed &&
        target.peer.readyState() === target.peer.openState
      ) {
        target.peer.sendBinary(bytes);
      }
    }
  }

  function disconnect(connectionId: string): void {
    const connection = connections.get(connectionId);
    connections.delete(connectionId);
    if (publisher?.connectionId === connectionId) {
      const active = publisher;
      publisher = null;
      tellSubscribers({ type: "audio.streamEnded", generation: active.generation }, active.connectionId);
    }
    if (connection) connection.subscribed = false;
  }

  function close(): void {
    connections.clear();
    publisher = null;
  }

  return { register, markJoined, handleControl, handleBinary, disconnect, close };
}
