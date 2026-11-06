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
  announcedGenerations: Set<number>;
  outOfRangeGenerations: Set<number>;
};

type Publisher = {
  connectionId: string;
  generation: number;
  lastSequence: number;
};

type AudioRelayOptions = {
  isRecipientEligible?: (publisherConnectionId: string, recipientConnectionId: string) => boolean;
  allowMultiplePublishers?: boolean;
};

export type PublisherStopReason = "permission_revoked" | "session_ended" | "mode_changed";
export type AudioStreamEndReason = "publisher_stopped" | "out_of_range" | PublisherStopReason;

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

export function createAudioRelay(options: AudioRelayOptions = {}) {
  const connections = new Map<string, RelayConnection>();
  const publishers = new Map<number, Publisher>();
  let generation = 0;

  const currentStreamMessage = (active: Publisher) => ({
    type: "audio.stream",
    generation: active.generation,
    // clockId is server-assigned from the authorized connection, never a client field.
    clockId: active.connectionId,
    config: AUDIO_CONFIG,
  });

  const sendToOpenSubscriber = (connection: RelayConnection, message: unknown) => {
    if (connection.joined && connection.subscribed && connection.peer.readyState() === connection.peer.openState) {
      connection.peer.sendControl(message);
    }
  };

  const endSubscriber = (
    connectionId: string,
    connection: RelayConnection,
    active: Publisher,
    reason: AudioStreamEndReason,
  ) => {
    if (connectionId === active.connectionId || !connection.announcedGenerations.has(active.generation)) return;
    sendToOpenSubscriber(connection, { type: "audio.streamEnded", generation: active.generation, reason });
    connection.announcedGenerations.delete(active.generation);
    if (reason === "out_of_range") connection.outOfRangeGenerations.add(active.generation);
  };

  const endAnnouncedSubscribers = (active: Publisher, reason: AudioStreamEndReason) => {
    for (const [connectionId, connection] of connections) endSubscriber(connectionId, connection, active, reason);
  };

  const clearUnavailableGeneration = (active: Publisher) => {
    for (const connection of connections.values()) connection.outOfRangeGenerations.delete(active.generation);
  };

  const reconcileRecipients = () => {
    for (const active of publishers.values()) {
      for (const [connectionId, connection] of connections) {
        if (connectionId === active.connectionId || !connection.joined || !connection.subscribed) continue;
        if (connection.peer.readyState() !== connection.peer.openState) continue;
        const eligible = options.isRecipientEligible?.(active.connectionId, connectionId) ?? true;
        if (eligible) {
          if (!connection.announcedGenerations.has(active.generation)) {
            connection.peer.sendControl(currentStreamMessage(active));
            connection.announcedGenerations.add(active.generation);
          }
          connection.outOfRangeGenerations.delete(active.generation);
          continue;
        }
        if (connection.announcedGenerations.has(active.generation)) {
          endSubscriber(connectionId, connection, active, "out_of_range");
        }
        if (!connection.outOfRangeGenerations.has(active.generation)) {
          connection.peer.sendControl({ type: "audio.unavailable", reason: "out_of_range" });
          connection.outOfRangeGenerations.add(active.generation);
        }
      }
    }
  };

  function register(connectionId: string, peer: RelayPeer): void {
    connections.set(connectionId, {
      peer,
      joined: false,
      subscribed: false,
      announcedGenerations: new Set(),
      outOfRangeGenerations: new Set(),
    });
  }

  function markJoined(connectionId: string): void {
    const connection = connections.get(connectionId);
    if (connection) connection.joined = true;
  }

  function handleControl(connectionId: string, message: AudioControlMessage): boolean {
    if (typeof message.type !== "string" || !message.type.startsWith("audio.")) return false;
    const connection = connections.get(connectionId);
    if (!connection) return true;

    const fail = (code: string, explanation: string) => connection.peer.reject(code, explanation);

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
      connection.announcedGenerations.clear();
      connection.outOfRangeGenerations.clear();
      connection.peer.sendControl({ type: "audio.subscribed" });
      reconcileRecipients();
      return true;
    }

    if (message.type === "audio.unsubscribe") {
      if (!hasOnlyKeys(message, ["type"])) {
        fail("invalid_audio_control", "Audio subscription controls contain unsupported fields.");
        return true;
      }
      connection.subscribed = false;
      connection.announcedGenerations.clear();
      connection.outOfRangeGenerations.clear();
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
      if ([...publishers.values()].some((active) => active.connectionId === connectionId) ||
          (!options.allowMultiplePublishers && publishers.size > 0)) {
        connection.peer.sendControl({ type: "audio.error", code: "publisher_exists", message: "This room already has the allowed number of active audio publishers." });
        return true;
      }
      if (generation >= 0xffff_ffff) {
        connection.peer.sendControl({ type: "audio.error", code: "generation_exhausted", message: "The room has exhausted its audio stream generations; reconnect the room service before publishing again." });
        return true;
      }
      generation += 1;
      const active = { connectionId, generation, lastSequence: -1 };
      publishers.set(generation, active);
      connection.peer.sendControl({ type: "audio.started", generation, config: AUDIO_CONFIG });
      reconcileRecipients();
      return true;
    }

    if (message.type === "audio.stop") {
      if (!hasOnlyKeys(message, ["type", "generation"]) || !Number.isInteger(message.generation)) {
        fail("invalid_audio_control", "Audio stop requires the current stream generation.");
        return true;
      }
      const active = publishers.get(Number(message.generation));
      if (!active || active.connectionId !== connectionId) {
        connection.peer.sendControl({ type: "audio.error", code: "not_current_publisher", message: "This connection does not own the requested audio stream." });
        return true;
      }
      publishers.delete(active.generation);
      connection.peer.sendControl({ type: "audio.stopped", generation: active.generation });
      endAnnouncedSubscribers(active, "publisher_stopped");
      clearUnavailableGeneration(active);
      return true;
    }

    fail("invalid_audio_control", "This audio control is not supported.");
    return true;
  }

  function handleBinary(connectionId: string, bytes: Buffer): void {
    const connection = connections.get(connectionId);
    if (!connection) return;
    const publisher = [...publishers.values()].find((active) => active.connectionId === connectionId);
    if (!publisher) {
      connection.peer.reject("audio_not_publisher", "Only an active audio publisher may send binary audio frames.");
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
        target.announcedGenerations.has(publisher.generation) &&
        (options.isRecipientEligible?.(connectionId, targetId) ?? true) &&
        target.peer.readyState() === target.peer.openState
      ) {
        target.peer.sendBinary(bytes);
      }
    }
  }

  function endPublisher(active: Publisher, reason: AudioStreamEndReason): void {
    publishers.delete(active.generation);
    endAnnouncedSubscribers(active, reason);
    clearUnavailableGeneration(active);
  }

  function disconnect(connectionId: string): void {
    const connection = connections.get(connectionId);
    connections.delete(connectionId);
    for (const active of [...publishers.values()]) {
      if (active.connectionId === connectionId) endPublisher(active, "publisher_stopped");
    }
    if (connection) {
      connection.subscribed = false;
      connection.announcedGenerations.clear();
      connection.outOfRangeGenerations.clear();
    }
  }

  function stopPublishing(connectionId: string, reason: PublisherStopReason): boolean {
    const active = [...publishers.values()].find((publisher) => publisher.connectionId === connectionId);
    if (!active) return false;
    publishers.delete(active.generation);
    const source = connections.get(connectionId);
    if (source?.joined && source.peer.readyState() === source.peer.openState) {
      source.peer.sendControl({ type: "audio.publishRevoked", generation: active.generation, reason });
    }
    endAnnouncedSubscribers(active, reason);
    clearUnavailableGeneration(active);
    return true;
  }

  function disableConnection(connectionId: string): void {
    const connection = connections.get(connectionId);
    if (!connection) return;
    stopPublishing(connectionId, "mode_changed");
    if (connection.subscribed) {
      for (const active of publishers.values()) endSubscriber(connectionId, connection, active, "mode_changed");
    }
    connection.subscribed = false;
    connection.announcedGenerations.clear();
    connection.outOfRangeGenerations.clear();
    if (connection.joined && connection.peer.readyState() === connection.peer.openState) {
      connection.peer.sendControl({ type: "audio.unsubscribed", reason: "mode_changed" });
    }
  }

  function isSubscribed(connectionId: string): boolean {
    return connections.get(connectionId)?.subscribed ?? false;
  }

  function close(): void {
    connections.clear();
    publishers.clear();
  }

  return { register, markJoined, handleControl, handleBinary, reconcileRecipients, stopPublishing, disableConnection, isSubscribed, disconnect, close };
}
