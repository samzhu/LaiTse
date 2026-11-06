const MAX_QUEUED_SAMPLES = 24_000;
const MAX_QUEUE_GRAPH_RESIDENCY_US = 500_000;
const STATS_INTERVAL_SAMPLES = 960;

class LaiTsePlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.queuedSamples = 0;
    this.renderedSamples = 0;
    this.overflowResets = 0;
    this.queueStaleDropBatches = 0;
    this.queueOversizeDropBatches = 0;
    this.queueOldestGraphResidenceMs = 0;
    this.epoch = 0;
    this.generation = null;
    this.clockId = null;
    this.statsFrameCount = 0;
    this.rmsSquareSum = 0;
    this.rmsSampleCount = 0;
    this.statsGraphTimestampUs = null;
    this.statsPlayheadTimestampUs = null;
    this.port.onmessage = (event) => this.handleMessage(event.data);
  }

  handleMessage(message) {
    if (message?.type === "clear") {
      this.epoch = Number.isInteger(message.epoch) ? message.epoch : this.epoch + 1;
      this.generation = Number.isInteger(message.generation) ? message.generation : null;
      this.clockId = typeof message.clockId === "string" ? message.clockId : null;
      this.queue = [];
      this.queuedSamples = 0;
      this.queueOldestGraphResidenceMs = 0;
      this.resetStatsWindow();
      return;
    }
    if (
      message?.type !== "pcm" ||
      !(message.samples instanceof Float32Array) ||
      message.epoch !== this.epoch ||
      message.generation !== this.generation ||
      message.clockId !== this.clockId ||
      !Number.isFinite(message.timestampUs) ||
      message.timestampUs < 0
    ) return;
    const samples = message.samples;
    if (samples.length === 0) return;
    const graphNowUs = Math.round(currentFrame * 1_000_000 / sampleRate);
    this.pruneStaleQueue(graphNowUs);
    if (samples.length > MAX_QUEUED_SAMPLES) {
      this.queueOversizeDropBatches += 1;
      this.updateOldestGraphResidence(graphNowUs);
      this.port.postMessage(this.statsMessage(null, null, 0, false, 0));
      return;
    }
    if (this.queuedSamples + samples.length > MAX_QUEUED_SAMPLES) {
      this.queue = [];
      this.queuedSamples = 0;
      this.overflowResets += 1;
      this.resetStatsWindow();
      this.port.postMessage(this.statsMessage(null, null, 0, true, 0));
    }
    this.queue.push({ samples, offset: 0, timestampUs: message.timestampUs, enqueuedGraphTimestampUs: graphNowUs });
    this.queuedSamples += samples.length;
    this.updateOldestGraphResidence(graphNowUs);
  }

  pruneStaleQueue(graphNowUs) {
    while (this.queue.length > 0) {
      const head = this.queue[0];
      if (graphNowUs - head.enqueuedGraphTimestampUs < MAX_QUEUE_GRAPH_RESIDENCY_US) break;
      this.queue.shift();
      this.queuedSamples -= head.samples.length - head.offset;
      this.queueStaleDropBatches += 1;
    }
    this.updateOldestGraphResidence(graphNowUs);
  }

  updateOldestGraphResidence(graphNowUs) {
    const oldest = this.queue[0];
    this.queueOldestGraphResidenceMs = oldest
      ? Math.max(0, (graphNowUs - oldest.enqueuedGraphTimestampUs) / 1_000)
      : 0;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const channelCount = output.length;
    const frameCount = output[0].length;
    for (const channel of output) channel.fill(0);

    const graphStartUs = Math.round(currentFrame * 1_000_000 / sampleRate);
    this.pruneStaleQueue(graphStartUs);
    let outputOffset = 0;
    let intervalPlayheadUs = null;
    let intervalGraphTimestampUs = null;
    while (outputOffset < frameCount && this.queue.length > 0) {
      const head = this.queue[0];
      const available = head.samples.length - head.offset;
      const copyCount = Math.min(available, frameCount - outputOffset);
      if (intervalPlayheadUs === null) {
        intervalPlayheadUs = head.timestampUs + Math.round(head.offset * 1_000_000 / sampleRate);
        intervalGraphTimestampUs = graphStartUs + Math.round(outputOffset * 1_000_000 / sampleRate);
      }
      for (let index = 0; index < copyCount; index += 1) {
        const sample = head.samples[head.offset + index];
        for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
          output[channelIndex][outputOffset + index] = sample;
        }
        this.rmsSquareSum += sample * sample;
      }
      this.rmsSampleCount += copyCount;
      this.renderedSamples += copyCount;
      this.queuedSamples -= copyCount;
      head.offset += copyCount;
      outputOffset += copyCount;
      if (head.offset === head.samples.length) this.queue.shift();
    }

    this.statsFrameCount += frameCount;
    this.updateOldestGraphResidence(Math.round(currentFrame * 1_000_000 / sampleRate));
    if (this.statsPlayheadTimestampUs === null && intervalPlayheadUs !== null) {
      this.statsPlayheadTimestampUs = intervalPlayheadUs;
      this.statsGraphTimestampUs = intervalGraphTimestampUs;
    }
    if (this.statsFrameCount >= STATS_INTERVAL_SAMPLES) {
      const rms = this.rmsSampleCount > 0 ? Math.sqrt(this.rmsSquareSum / this.statsFrameCount) : 0;
      this.port.postMessage(this.statsMessage(
        this.statsPlayheadTimestampUs,
        this.statsGraphTimestampUs,
        rms,
        false,
        this.statsFrameCount / sampleRate * 1_000,
      ));
      this.resetStatsWindow();
    }
    return true;
  }

  statsMessage(playheadTimestampUs, graphTimestampUs, rms, overflowReset, observationWindowMs) {
    return {
      type: "stats",
      epoch: this.epoch,
      generation: this.generation,
      clockId: this.clockId,
      renderedSamples: this.renderedSamples,
      queuedSamples: this.queuedSamples,
      overflowResets: this.overflowResets,
      queueOldestGraphResidenceMs: this.queueOldestGraphResidenceMs,
      queueStaleDropBatches: this.queueStaleDropBatches,
      queueOversizeDropBatches: this.queueOversizeDropBatches,
      rms,
      playheadTimestampUs,
      graphTimestampUs,
      observationWindowMs,
      overflowReset,
    };
  }

  resetStatsWindow() {
    this.statsFrameCount = 0;
    this.rmsSquareSum = 0;
    this.rmsSampleCount = 0;
    this.statsGraphTimestampUs = null;
    this.statsPlayheadTimestampUs = null;
  }
}

registerProcessor("laitse-playback", LaiTsePlaybackProcessor);
