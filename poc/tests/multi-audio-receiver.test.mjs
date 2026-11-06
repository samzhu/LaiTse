import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (error?.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith("./") ||
          !context.parentURL?.includes("/src/client/") || /\.[a-z]+$/iu.test(specifier)) throw error;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
});

const { MediaTimeline } = await import("../src/client/media-timeline.ts");
const { MultiAudioReceiver } = await import("../src/client/multi-audio-receiver.ts");

function createReceiver(context = { state: "suspended" }) {
  const changes = [];
  const receiver = new MultiAudioReceiver(context, new MediaTimeline(), 1, (sources, error) => changes.push({ sources, error }));
  return { receiver, changes };
}

const config = { codec: "opus", sampleRate: 48_000, channels: 1, bitrate: 32_000, frameDurationUs: 20_000 };

test("receiver starts more than eight active audio sources", () => {
  const { receiver } = createReceiver();

  for (let generation = 1; generation <= 9; generation += 1) {
    receiver.startStream(generation, `clock-${generation}`, config);
  }

  const sources = receiver.snapshot();
  assert.equal(sources.length, 9);
  assert.ok(sources.every((source) => source.active));
  assert.ok(sources.every((source) => source.error === null));
  receiver.stopAll();
});

test("receiver keeps stopped-source diagnostics bounded to 32 entries", () => {
  const { receiver } = createReceiver();

  for (let generation = 1; generation <= 40; generation += 1) {
    receiver.startStream(generation, `clock-${generation}`, config);
    receiver.endStream(generation);
  }

  const sources = receiver.snapshot();
  assert.equal(sources.length, 32);
  assert.ok(sources.every((source) => !source.active));
  assert.equal(sources[0].generation, 9);
  assert.equal(sources.at(-1).generation, 40);
  receiver.stopAll();
});

test("a full decode queue drops only the current packet and resumes after the decoder drains", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousAudioWorkletNode = Object.getOwnPropertyDescriptor(globalThis, "AudioWorkletNode");
  const decoders = [];

  class FakeAudioDecoder {
    state = "unconfigured";
    decodeQueueSize = 0;
    decodedChunks = [];
    constructor() { decoders.push(this); }
    configure() { this.state = "configured"; }
    decode(chunk) { this.decodeQueueSize += 1; this.decodedChunks.push(chunk); }
    close() { this.state = "closed"; }
    static async isConfigSupported() { return { supported: true }; }
  }

  class FakeEncodedAudioChunk {
    constructor(init) { Object.assign(this, init); }
  }

  class FakeAudioWorkletNode {
    constructor() { this.port = { onmessage: null, postMessage() {}, close() {} }; }
    connect() {}
    disconnect() {}
  }

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { AudioDecoder: FakeAudioDecoder, EncodedAudioChunk: FakeEncodedAudioChunk },
  });
  Object.defineProperty(globalThis, "AudioWorkletNode", { configurable: true, value: FakeAudioWorkletNode });

  try {
    const context = {
      state: "running",
      currentTime: 0,
      destination: {},
      createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; },
    };
    const { receiver } = createReceiver(context);
    receiver.startStream(1, "clock-1", config);
    receiver.startStream(2, "clock-2", config);

    for (let attempt = 0; attempt < 20 && decoders.length < 2; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(decoders.length, 2);

    for (let sequence = 0; sequence < 8; sequence += 1) receiver.handleBinary(makeAudioFrame(1, sequence));
    receiver.handleBinary(makeAudioFrame(1, 8));

    let sources = new Map(receiver.snapshot().map((source) => [source.generation, source]));
    assert.equal(sources.get(1).active, true);
    assert.equal(sources.get(1).receivedPackets, 9, "valid packets seen by the receiver include the locally skipped packet");
    assert.equal(sources.get(1).decodeQueueDroppedPackets, 1);
    assert.equal(sources.get(1).decodeQueueSaturationStops, 0);
    assert.equal(sources.get(1).packetGapCount, 0, "a local queue drop is not reported as a source sequence gap");
    assert.equal(sources.get(1).error, null);
    assert.equal(decoders[0].decodedChunks.length, 8);
    assert.equal(decoders[0].decodeQueueSize, 8, "the pending decode queue never exceeds its per-source limit");
    assert.equal(sources.get(2).active, true, "the other source remains active while this decoder is saturated");
    assert.equal(sources.get(2).decodeQueueDroppedPackets, 0);

    decoders[0].decodeQueueSize = 0;
    receiver.handleBinary(makeAudioFrame(1, 9));
    sources = new Map(receiver.snapshot().map((source) => [source.generation, source]));
    assert.equal(sources.get(1).active, true);
    assert.equal(sources.get(1).decodeQueueDroppedPackets, 1);
    assert.equal(sources.get(1).receivedPackets, 10);
    assert.equal(sources.get(1).packetGapCount, 0);
    assert.equal(decoders[0].decodeQueueSize, 1);
    assert.equal(decoders[0].decodedChunks.length, 9);
    assert.equal(sources.get(2).active, true);
    receiver.stopAll();
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
    if (previousAudioWorkletNode) Object.defineProperty(globalThis, "AudioWorkletNode", previousAudioWorkletNode);
    else delete globalThis.AudioWorkletNode;
  }
});

function makeAudioFrame(generation, sequence) {
  const frame = new ArrayBuffer(27);
  const view = new DataView(frame);
  view.setUint8(0, 0x4c);
  view.setUint8(1, 0x54);
  view.setUint8(2, 0x41);
  view.setUint8(3, 0x31);
  view.setUint32(4, generation, false);
  view.setUint32(8, sequence, false);
  view.setFloat64(12, sequence * 20_000, false);
  view.setUint32(20, 20_000, false);
  view.setUint8(24, 0xf8);
  view.setUint8(25, 0xff);
  view.setUint8(26, 0xfe);
  return frame;
}
