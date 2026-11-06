const CAPTURE_BLOCK_FRAMES = 960;

class LaiTseCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.block = new Float32Array(CAPTURE_BLOCK_FRAMES);
    this.blockFrames = 0;
    this.firstFrame = 0;
    const anchor = options.processorOptions ?? {};
    this.performanceOffsetUs = Number.isFinite(anchor.performanceTimeUs) && Number.isFinite(anchor.contextTimeUs)
      ? anchor.performanceTimeUs - anchor.contextTimeUs
      : 0;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (output) {
      for (const channel of output) channel.fill(0);
    }

    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const frameCount = input[0]?.length ?? 0;
    if (frameCount === 0) return true;

    for (let frame = 0; frame < frameCount; frame += 1) {
      if (this.blockFrames === 0) this.firstFrame = currentFrame + frame;
      let sample = 0;
      for (const channel of input) sample += channel[frame] ?? 0;
      this.block[this.blockFrames] = sample / input.length;
      this.blockFrames += 1;

      if (this.blockFrames === CAPTURE_BLOCK_FRAMES) {
        const samples = this.block;
        this.port.postMessage({
          type: "pcm",
          timestampUs: Math.round(this.firstFrame * 1_000_000 / sampleRate + this.performanceOffsetUs),
          samples,
        }, [samples.buffer]);
        this.block = new Float32Array(CAPTURE_BLOCK_FRAMES);
        this.blockFrames = 0;
      }
    }
    return true;
  }
}

registerProcessor("laitse-capture", LaiTseCaptureProcessor);
