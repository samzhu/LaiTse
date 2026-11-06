import assert from "node:assert/strict";
import { test } from "node:test";
import { mapGraphTimeToPerformanceTime, MediaTimeline, selectVideoFrameIndex } from "../src/client/media-timeline.ts";

test("receiver graph samples map through a fresh output timestamp pair or an explicit graph estimate", () => {
  const outputMapped = mapGraphTimeToPerformanceTime({
    graphTimeUs: 5_250_000,
    observedAtPerformanceTimeMs: 6_000,
    contextTimeSeconds: 5.9,
    outputPerformanceTimeMs: 5_950,
    outputContextTimeSeconds: 5.2,
    outputTimestampFresh: true,
  });
  assert.deepEqual(outputMapped, { performanceTimeMs: 6_000, mapping: "output-timestamp" });

  const graphEstimate = mapGraphTimeToPerformanceTime({
    graphTimeUs: 5_250_000,
    observedAtPerformanceTimeMs: 6_000,
    contextTimeSeconds: 5.9,
    outputPerformanceTimeMs: 0,
    outputContextTimeSeconds: 0,
    outputTimestampFresh: false,
  });
  assert.deepEqual(graphEstimate, { performanceTimeMs: 5_350, mapping: "graph-estimate" });
});

test("video scheduling never selects a frame newer than a same-clock audio playhead", () => {
  const frames = [100_000, 200_000, 300_000, 400_000];
  assert.equal(selectVideoFrameIndex(frames, 250_000), 1);
  assert.equal(selectVideoFrameIndex(frames, 50_000), -1, "future video waits for audio to reach its source timestamp");
  assert.equal(selectVideoFrameIndex(frames, null), 3, "no usable audio master uses standalone latest-frame fallback");
  assert.equal(selectVideoFrameIndex([], 250_000), -1);
});

test("publisher playback samples stay isolated; stale generations and stopped clocks are rejected", () => {
  const timeline = new MediaTimeline();
  timeline.beginAudioStream("publisher-a", 3, 9);
  const sample = {
    clockId: "publisher-a",
    generation: 3,
    epoch: 9,
    sourceTimestampUs: 2_000_000,
    graphTimestampUs: 800_000,
    receiverPerformanceTimeMs: 1_100,
    observationWindowMs: 20,
    mappingErrorBoundMs: null,
    mapping: "output-timestamp",
  };
  assert.equal(timeline.updateAudioMaster({ ...sample, clockId: "publisher-b" }, 1_100), false);
  assert.equal(timeline.updateAudioMaster({ ...sample, generation: 2 }, 1_100), false);
  assert.equal(timeline.updateAudioMaster({ ...sample, epoch: 8 }, 1_100), false);
  assert.equal(timeline.updateAudioMaster(sample, 1_100), true);
  assert.equal(timeline.getAudioMaster("publisher-b", 1_120), null);
  assert.equal(timeline.getAudioMaster("publisher-a", 1_200)?.sourceTimestampUs, 2_000_000);
  assert.equal(timeline.getAudioMaster("publisher-a", 1_050)?.receiverPerformanceTimeMs, 1_100, "a mapped output sample can be valid but not yet audible");
  assert.equal(timeline.getAudioMaster("publisher-a", 1_450), null, "a fresh message with an old output sample is not a fresh playhead");

  timeline.beginAudioStream("publisher-a", 4, 10);
  assert.equal(timeline.getAudioMaster("publisher-a", 1_200), null, "new generation resets the prior master sample");
  assert.equal(timeline.updateAudioMaster(sample, 1_200), false, "delayed old generation cannot revive the master");
  timeline.endAudioStream(10);
  assert.equal(timeline.getActiveAudioStream(), null);
});

test("pulse diagnostics stay bounded and scoped to the active publisher generation", () => {
  const timeline = new MediaTimeline();
  timeline.beginAudioStream("publisher-a", 1, 1);
  for (let index = 0; index < 30; index += 1) {
    timeline.recordAudioPulse({
      clockId: "publisher-a",
      generation: 1,
      epoch: 1,
      sourceTimestampUs: index * 2_000_000,
      graphTimestampUs: index * 2_000_000,
      receiverPerformanceTimeMs: index * 2_000,
      observationWindowMs: 20,
      mappingErrorBoundMs: null,
      mapping: "graph-estimate",
    });
  }
  assert.equal(timeline.getPulseEvents().length, 24);
  assert.equal(timeline.getPulseEvents()[0]?.sourceTimestampUs, 12_000_000);
  timeline.beginAudioStream("publisher-b", 1, 2);
  assert.equal(timeline.getPulseEvents("publisher-a").length, 24, "starting another publisher does not reset this source's diagnostics");
  assert.deepEqual(timeline.getPulseEvents("publisher-b"), []);
});


test("new future output samples do not hide a due audio-master sample", () => {
  const timeline = new MediaTimeline();
  timeline.beginAudioStream("publisher-a", 1, 1);
  const point = {
    clockId: "publisher-a", generation: 1, epoch: 1,
    sourceTimestampUs: 1_000_000, graphTimestampUs: 500_000,
    receiverPerformanceTimeMs: 1_100, observationWindowMs: 21.333,
    mappingErrorBoundMs: null, mapping: "output-timestamp",
  };
  timeline.updateAudioMaster(point, 1_080);
  timeline.updateAudioMaster({ ...point, sourceTimestampUs: 1_040_000, receiverPerformanceTimeMs: 1_140 }, 1_100);
  assert.equal(timeline.getAudioMaster("publisher-a", 1_120)?.sourceTimestampUs, 1_000_000);
  assert.equal(timeline.getAudioMaster("publisher-a", 1_160)?.sourceTimestampUs, 1_040_000);
  timeline.updateAudioMaster({ ...point, sourceTimestampUs: 2_000_000, receiverPerformanceTimeMs: 1_000 }, 1_500);
  assert.equal(timeline.getAudioMaster("publisher-a", 1_500), null, "recent arrival cannot revive a stale output sample");
});

test("adding and stopping one concurrent audio source preserves the other publisher clock", () => {
  const timeline = new MediaTimeline();
  const sampleFor = (clockId, generation, epoch, sourceTimestampUs) => ({
    clockId, generation, epoch,
    sourceTimestampUs, graphTimestampUs: sourceTimestampUs,
    receiverPerformanceTimeMs: 1_100, observationWindowMs: 20,
    mappingErrorBoundMs: null, mapping: "output-timestamp",
  });
  timeline.beginAudioStream("publisher-a", 1, 1);
  timeline.beginAudioStream("publisher-b", 2, 2);
  assert.equal(timeline.updateAudioMaster(sampleFor("publisher-a", 1, 1, 1_000), 1_100), true);
  assert.equal(timeline.updateAudioMaster(sampleFor("publisher-b", 2, 2, 2_000), 1_100), true);
  assert.equal(timeline.getAudioMaster("publisher-a", 1_120)?.sourceTimestampUs, 1_000);
  assert.equal(timeline.getAudioMaster("publisher-b", 1_120)?.sourceTimestampUs, 2_000);

  timeline.endAudioSource("publisher-b", 2, 2);
  assert.equal(timeline.getAudioMaster("publisher-b", 1_120), null);
  assert.equal(timeline.getAudioMaster("publisher-a", 1_120)?.sourceTimestampUs, 1_000, "stopping B leaves A's master intact");

  timeline.beginAudioStream("publisher-a", 3, 3);
  assert.equal(timeline.getAudioMaster("publisher-a", 1_120), null, "a new generation for the same publisher replaces its old clock");
  assert.equal(timeline.updateAudioMaster(sampleFor("publisher-a", 1, 1, 1_200), 1_120), false);
});
