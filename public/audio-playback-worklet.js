const MAX_QUEUED_SAMPLES = 24_000;
const STATS_INTERVAL_SAMPLES = 9_600;

class LaiTsePlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.queuedSamples = 0;
    this.renderedSamples = 0;
    this.overflowResets = 0;
    this.statsFrameCount = 0;
    this.rmsSquareSum = 0;
    this.rmsSampleCount = 0;
    this.port.onmessage = (event) => {
      const message = event.data;
      if (message?.type === "clear") {
        this.queue = [];
        this.queuedSamples = 0;
        this.port.postMessage({
          type: "stats",
          renderedSamples: this.renderedSamples,
          queuedSamples: 0,
          overflowResets: this.overflowResets,
          rms: 0,
        });
        return;
      }
      if (message?.type !== "pcm" || !(message.samples instanceof Float32Array)) return;
      const samples = message.samples;
      if (samples.length === 0) return;
      if (this.queuedSamples + samples.length > MAX_QUEUED_SAMPLES) {
        this.queue = [];
        this.queuedSamples = 0;
        this.overflowResets += 1;
      }
      this.queue.push({ samples, offset: 0 });
      this.queuedSamples += samples.length;
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const channelCount = output.length;
    const frameCount = output[0].length;
    for (const channel of output) channel.fill(0);

    let outputOffset = 0;
    while (outputOffset < frameCount && this.queue.length > 0) {
      const head = this.queue[0];
      const available = head.samples.length - head.offset;
      const copyCount = Math.min(available, frameCount - outputOffset);
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
    if (this.statsFrameCount >= STATS_INTERVAL_SAMPLES) {
      const rms = this.rmsSampleCount > 0 ? Math.sqrt(this.rmsSquareSum / this.rmsSampleCount) : 0;
      this.port.postMessage({
        type: "stats",
        renderedSamples: this.renderedSamples,
        queuedSamples: this.queuedSamples,
        overflowResets: this.overflowResets,
        rms,
      });
      this.statsFrameCount = 0;
      this.rmsSquareSum = 0;
      this.rmsSampleCount = 0;
    }
    return true;
  }
}

registerProcessor("laitse-playback", LaiTsePlaybackProcessor);
