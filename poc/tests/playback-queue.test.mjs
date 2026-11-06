import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import { MAX_DECODED_VIDEO_FRAME_RESIDENCY_MS, pruneExpiredDecodedFrames } from "../src/client/media-queue.ts";

test("decoded video frames are closed and pruned at the 500 ms local-residence boundary", () => {
  const closed = [];
  const queue = [
    { frame: { close: () => closed.push("old") }, enqueuedAtPerformanceMs: 10 },
    { frame: { close: () => closed.push("fresh") }, enqueuedAtPerformanceMs: 510 },
    { frame: { close: () => closed.push("also old") }, enqueuedAtPerformanceMs: 110 },
  ];
  assert.equal(MAX_DECODED_VIDEO_FRAME_RESIDENCY_MS, 500);
  assert.equal(pruneExpiredDecodedFrames(queue, 609), 1, "499 ms residence remains queued");
  assert.deepEqual(closed, ["old"]);
  assert.equal(pruneExpiredDecodedFrames(queue, 610), 1, "500 ms residence is expired");
  assert.deepEqual(closed, ["old", "also old"]);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].enqueuedAtPerformanceMs, 510);
});

async function createPlaybackProcessor() {
  const source = await readFile(new URL("../public/audio-playback-worklet.js", import.meta.url), "utf8");
  const messages = [];
  let Processor;
  const context = vm.createContext({
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { onmessage: null, postMessage: (message) => messages.push(message) };
      }
    },
    Float32Array,
    currentFrame: 0,
    sampleRate: 48_000,
    registerProcessor(_name, processor) { Processor = processor; },
  });
  vm.runInContext(source, context);
  return { processor: new Processor(), context, messages };
}

function pcm(samples, timestampUs = 0) {
  return { type: "pcm", samples: new Float32Array(samples).fill(0.25), timestampUs, epoch: 1, generation: 7, clockId: "publisher-7" };
}

test("AudioWorklet drops PCM after 500 ms of graph-time residence and reports the local drop", async () => {
  const { processor, context } = await createPlaybackProcessor();
  processor.handleMessage({ type: "clear", epoch: 1, generation: 7, clockId: "publisher-7" });
  processor.handleMessage(pcm(960, 100_000));
  assert.equal(processor.queuedSamples, 960);

  context.currentFrame = 23_952;
  processor.process([], [[new Float32Array(128)]]);
  assert.equal(processor.queueStaleDropBatches, 0, "499 ms is still within the candidate residence bound");

  context.currentFrame = 24_000;
  const output = new Float32Array(128);
  processor.process([], [[output]]);
  assert.equal(processor.queueStaleDropBatches, 1);
  assert.equal(processor.queuedSamples, 0);
  assert.ok(output.every((sample) => sample === 0), "expired samples are not rendered");
  assert.equal(processor.statsMessage(null, null, 0, false, 0).queueStaleDropBatches, 1);
});

test("AudioWorklet rejects an oversized PCM block and keeps queued samples within 24,000", async () => {
  const { processor } = await createPlaybackProcessor();
  processor.handleMessage({ type: "clear", epoch: 1, generation: 7, clockId: "publisher-7" });
  processor.handleMessage(pcm(24_001));
  assert.equal(processor.queuedSamples, 0);
  assert.equal(processor.queue.length, 0);
  assert.equal(processor.queueOversizeDropBatches, 1);

  processor.handleMessage(pcm(12_000));
  processor.handleMessage(pcm(12_001));
  assert.equal(processor.overflowResets, 1);
  assert.equal(processor.queuedSamples, 12_001);
  assert.ok(processor.queuedSamples <= 24_000);
});

test("AudioWorklet graph residence follows the graph clock and clear removes prior PCM", async () => {
  const { processor, context } = await createPlaybackProcessor();
  processor.handleMessage({ type: "clear", epoch: 1, generation: 7, clockId: "publisher-7" });
  processor.handleMessage(pcm(960));
  context.currentFrame = 0;
  processor.handleMessage(pcm(960, 20_000));
  assert.equal(processor.queueStaleDropBatches, 0, "a frozen graph frame does not manufacture wall-clock age");
  processor.handleMessage({ type: "clear", epoch: 2, generation: 7, clockId: "publisher-7" });
  assert.equal(processor.queuedSamples, 0, "context suspension/decoder reset clears old graph-time PCM");
});
