import { mapGraphTimeToPerformanceTime, MediaTimeline } from "./media-timeline";

const AUDIO_SAMPLE_RATE = 48_000;
const AUDIO_FRAME_DURATION_US = 20_000;
const AUDIO_FRAME_HEADER_BYTES = 24;
const MAX_OPUS_PACKET_BYTES = 4_096;
const MAX_PENDING_AUDIO_DECODES = 8;
const AUDIO_MAGIC = [0x4c, 0x54, 0x41, 0x31];

type AudioStreamConfig = { codec: "opus"; sampleRate: number; channels: number; bitrate: number; frameDurationUs: number };
type DecodedAudioData = {
  readonly numberOfFrames: number;
  readonly timestamp: number;
  close(): void;
  copyTo(destination: AllowSharedBufferSource, options?: { planeIndex?: number; format?: string }): Promise<void>;
};
type EncodedAudioChunkConstructor = new (init: {
  type: "key";
  timestamp: number;
  duration: number;
  data: Uint8Array;
}) => object;
type EncodedAudioChunkConstructorHost = Window & { EncodedAudioChunk?: EncodedAudioChunkConstructor };
type AudioDecoderLike = {
  readonly state: "unconfigured" | "configured" | "closed";
  readonly decodeQueueSize: number;
  configure(config: Record<string, unknown>): void;
  decode(chunk: object): void;
  close(): void;
};
type AudioDecoderConstructor = {
  new (callbacks: {
    output: (data: DecodedAudioData) => void;
    error: (error: DOMException) => void;
  }): AudioDecoderLike;
  isConfigSupported?: (config: Record<string, unknown>) => Promise<{ supported: boolean }>;
};
type AudioDecoderHost = Window & { AudioDecoder?: AudioDecoderConstructor };

export type AudioSourceStats = {
  generation: number;
  clockId: string;
  active: boolean;
  receivedPackets: number;
  decodedFrames: number;
  renderedPcmSamples: number;
  queuedSamples: number;
  queueOldestGraphResidenceMs: number;
  queueStaleDropBatches: number;
  queueOversizeDropBatches: number;
  decodeQueueHighWater: number;
  decodeQueueDroppedPackets: number;
  decodeQueueSaturationStops: number;
  renderRms: number;
  packetGapCount: number;
  queueOverflowResets: number;
  error: string | null;
};

type AudioSourceRuntime = {
  generation: number;
  clockId: string;
  config: AudioStreamConfig;
  stats: AudioSourceStats;
  decoder: AudioDecoderLike | null;
  decoderEpoch: number;
  requestId: number;
  worklet: AudioWorkletNode | null;
  gain: GainNode | null;
  playbackEpoch: number;
  lastReceivedSequence: number;
  pulseActive: boolean;
  pulseQuietSinceMs: number | null;
  lastOverflowResets: number;
  workletBaseline: {
    renderedPcmSamples: number;
    queueStaleDropBatches: number;
    queueOversizeDropBatches: number;
    queueOverflowResets: number;
  };
};

type ParsedAudioFrame = { generation: number; sequence: number; timestampUs: number; packet: Uint8Array };

function sourceKey(generation: number): number {
  return generation;
}

function parseAudioFrame(data: ArrayBuffer): ParsedAudioFrame | null {
  if (data.byteLength < AUDIO_FRAME_HEADER_BYTES + 1 || data.byteLength > AUDIO_FRAME_HEADER_BYTES + MAX_OPUS_PACKET_BYTES) return null;
  const view = new DataView(data);
  for (let index = 0; index < AUDIO_MAGIC.length; index += 1) if (view.getUint8(index) !== AUDIO_MAGIC[index]) return null;
  const timestampUs = view.getFloat64(12, false);
  if (!Number.isFinite(timestampUs) || timestampUs < 0 || view.getUint32(20, false) !== AUDIO_FRAME_DURATION_US) return null;
  return {
    generation: view.getUint32(4, false),
    sequence: view.getUint32(8, false),
    timestampUs,
    packet: new Uint8Array(data, AUDIO_FRAME_HEADER_BYTES),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 180) : "未知錯誤";
}

function sameConfig(left: AudioStreamConfig, right: AudioStreamConfig): boolean {
  return left.codec === right.codec && left.sampleRate === right.sampleRate && left.channels === right.channels &&
    left.bitrate === right.bitrate && left.frameDurationUs === right.frameDurationUs;
}

export class MultiAudioReceiver {
  private readonly context: AudioContext;
  private readonly timeline: MediaTimeline;
  private readonly onChange: (sources: AudioSourceStats[], error?: string) => void;
  private readonly sources = new Map<number, AudioSourceRuntime>();
  private playbackVolume = 1;
  private listenerActive = true;
  private nextDecoderEpoch = 0;

  constructor(
    context: AudioContext,
    timeline: MediaTimeline,
    playbackVolume: number,
    onChange: (sources: AudioSourceStats[], error?: string) => void,
  ) {
    this.context = context;
    this.timeline = timeline;
    this.playbackVolume = playbackVolume;
    this.onChange = onChange;
  }

  snapshot(): AudioSourceStats[] {
    return [...this.sources.values()].map(({ stats }) => ({ ...stats }));
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.playbackVolume = Math.min(1, Math.max(0, volume));
    for (const source of this.sources.values()) if (source.gain) source.gain.gain.value = this.playbackVolume;
  }

  startStream(generation: number, clockId: string, config: AudioStreamConfig): void {
    const existing = this.sources.get(sourceKey(generation));
    if (existing && existing.clockId === clockId && sameConfig(existing.config, config)) {
      existing.stats.active = true;
      if (this.listenerActive && this.context.state === "running" && !existing.decoder) void this.startDecoder(existing);
      return;
    }
    if (existing) this.endStream(generation);
    const source: AudioSourceRuntime = {
      generation,
      clockId,
      config,
      stats: {
        generation,
        clockId,
        active: true,
        receivedPackets: 0,
        decodedFrames: 0,
        renderedPcmSamples: 0,
        queuedSamples: 0,
        queueOldestGraphResidenceMs: 0,
        queueStaleDropBatches: 0,
        queueOversizeDropBatches: 0,
        decodeQueueHighWater: 0,
        decodeQueueDroppedPackets: 0,
        decodeQueueSaturationStops: 0,
        renderRms: 0,
        packetGapCount: 0,
        queueOverflowResets: 0,
        error: null,
      },
      decoder: null,
      decoderEpoch: 0,
      requestId: 0,
      worklet: null,
      gain: null,
      playbackEpoch: 0,
      lastReceivedSequence: -1,
      pulseActive: false,
      pulseQuietSinceMs: null,
      lastOverflowResets: 0,
      workletBaseline: { renderedPcmSamples: 0, queueStaleDropBatches: 0, queueOversizeDropBatches: 0, queueOverflowResets: 0 },
    };
    this.sources.set(sourceKey(generation), source);
    this.publish();
    if (this.listenerActive && this.context.state === "running") void this.startDecoder(source);
  }

  handleBinary(data: ArrayBuffer): void {
    const frame = parseAudioFrame(data);
    if (!frame) {
      this.onChange(this.snapshot(), "收到格式無效的音訊封包；此封包已略過。");
      return;
    }
    const source = this.sources.get(sourceKey(frame.generation));
    const decoder = source?.decoder;
    if (!source || !source.stats.active || !decoder || frame.sequence <= source.lastReceivedSequence) return;
    if (decoder.decodeQueueSize >= MAX_PENDING_AUDIO_DECODES) {
      if (source.lastReceivedSequence >= 0 && frame.sequence > source.lastReceivedSequence + 1) {
        source.stats.packetGapCount += frame.sequence - source.lastReceivedSequence - 1;
      }
      source.lastReceivedSequence = frame.sequence;
      source.stats.receivedPackets += 1;
      source.stats.decodeQueueDroppedPackets += 1;
      this.publish();
      return;
    }
    const Chunk = (window as unknown as EncodedAudioChunkConstructorHost).EncodedAudioChunk;
    if (!Chunk) {
      source.stats.error = "此瀏覽器缺少 WebCodecs EncodedAudioChunk。";
      this.endStream(source.generation, source.stats.error);
      return;
    }
    try {
      const chunk = new Chunk({ type: "key", timestamp: frame.timestampUs, duration: AUDIO_FRAME_DURATION_US, data: frame.packet });
      decoder.decode(chunk);
      source.stats.decodeQueueHighWater = Math.max(source.stats.decodeQueueHighWater, decoder.decodeQueueSize);
      if (source.lastReceivedSequence >= 0 && frame.sequence > source.lastReceivedSequence + 1) {
        source.stats.packetGapCount += frame.sequence - source.lastReceivedSequence - 1;
      }
      source.lastReceivedSequence = frame.sequence;
      source.stats.receivedPackets += 1;
      this.publish();
    } catch (error) {
      source.stats.error = `Opus 封包無法交給來源 ${source.generation} 的解碼器：${errorMessage(error)}`;
      this.endStream(source.generation, source.stats.error);
    }
  }

  endStream(generation: number, error?: string): void {
    const source = this.sources.get(sourceKey(generation));
    if (!source) return;
    source.stats.active = false;
    source.stats.queuedSamples = 0;
    source.stats.queueOldestGraphResidenceMs = 0;
    source.stats.renderRms = 0;
    if (error) source.stats.error = error;
    this.closeRuntime(source);
    this.publish(error);
  }

  suspend(): void {
    for (const source of this.sources.values()) this.closeRuntime(source);
    this.publish();
  }

  resume(): void {
    this.listenerActive = true;
    if (this.context.state !== "running") return;
    for (const source of this.sources.values()) {
      if (source.stats.active && !source.decoder) void this.startDecoder(source);
    }
  }

  stopAll(): void {
    this.listenerActive = false;
    for (const source of this.sources.values()) this.closeRuntime(source);
    this.sources.clear();
    this.timeline.endAudioStream();
    this.publish();
  }

  private async startDecoder(source: AudioSourceRuntime): Promise<void> {
    if (!this.listenerActive || this.context.state !== "running" || !source.stats.active || source.decoder) return;
    const Decoder = (window as unknown as AudioDecoderHost).AudioDecoder;
    if (!Decoder) {
      source.stats.error = "此瀏覽器缺少 WebCodecs AudioDecoder。";
      this.endStream(source.generation, source.stats.error);
      return;
    }
    const decodeConfig = {
      codec: source.config.codec,
      sampleRate: source.config.sampleRate,
      numberOfChannels: source.config.channels,
    };
    const requestId = ++source.requestId;
    try {
      const support = await Decoder.isConfigSupported?.(decodeConfig);
      if (!support?.supported) throw new Error("此瀏覽器不支援指定的原生 Opus 解碼設定。");
      if (!this.listenerActive || this.context.state !== "running" || !source.stats.active || source.requestId !== requestId) return;
      const decoderEpoch = ++source.decoderEpoch;
      const decoder = new Decoder({
        output: (audioData) => { void this.handleDecodedAudio(source, decoderEpoch, audioData); },
        error: (error) => {
          if (source.decoderEpoch !== decoderEpoch || !source.stats.active) return;
          source.stats.error = `來源 ${source.generation} Opus 解碼失敗：${error.message}`;
          this.endStream(source.generation, source.stats.error);
        },
      });
      decoder.configure(decodeConfig);
      const worklet = new AudioWorkletNode(this.context, "laitse-playback", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      const gain = this.context.createGain();
      gain.gain.value = this.playbackVolume;
      worklet.connect(gain);
      gain.connect(this.context.destination);
      source.decoder = decoder;
      source.worklet = worklet;
      source.gain = gain;
      source.playbackEpoch = ++this.nextDecoderEpoch;
      source.lastOverflowResets = source.stats.queueOverflowResets;
      source.workletBaseline = {
        renderedPcmSamples: source.stats.renderedPcmSamples,
        queueStaleDropBatches: source.stats.queueStaleDropBatches,
        queueOversizeDropBatches: source.stats.queueOversizeDropBatches,
        queueOverflowResets: source.stats.queueOverflowResets,
      };
      source.pulseActive = false;
      source.pulseQuietSinceMs = null;
      source.lastReceivedSequence = -1;
      source.stats.queuedSamples = 0;
      source.stats.queueOldestGraphResidenceMs = 0;
      source.stats.renderRms = 0;
      this.timeline.beginAudioStream(source.clockId, source.generation, source.playbackEpoch);
      worklet.port.onmessage = (event: MessageEvent) => this.handleWorkletStats(source, source.playbackEpoch, event.data);
      worklet.port.postMessage({ type: "clear", epoch: source.playbackEpoch, generation: source.generation, clockId: source.clockId });
      this.publish();
    } catch (error) {
      if (source.requestId !== requestId || !source.stats.active) return;
      source.stats.error = `無法啟動來源 ${source.generation} 的 Opus 解碼器：${errorMessage(error)}`;
      this.endStream(source.generation, source.stats.error);
    }
  }

  private async handleDecodedAudio(source: AudioSourceRuntime, decoderEpoch: number, audioData: DecodedAudioData): Promise<void> {
    try {
      const worklet = source.worklet;
      const decoder = source.decoder;
      if (decoderEpoch !== source.decoderEpoch || !source.stats.active || !decoder || !worklet) return;
      const timestampUs = audioData.timestamp;
      if (!Number.isFinite(timestampUs) || timestampUs < 0) return;
      const samples = new Float32Array(audioData.numberOfFrames);
      await audioData.copyTo(samples, { planeIndex: 0, format: "f32-planar" });
      if (decoderEpoch !== source.decoderEpoch || !source.stats.active || source.decoder !== decoder || source.worklet !== worklet) return;
      worklet.port.postMessage({
        type: "pcm",
        samples,
        timestampUs,
        epoch: source.playbackEpoch,
        generation: source.generation,
        clockId: source.clockId,
      }, [samples.buffer]);
      source.stats.decodedFrames += 1;
      this.publish();
    } catch (error) {
      if (source.stats.active && decoderEpoch === source.decoderEpoch) {
        source.stats.error = `無法送出來源 ${source.generation} 的 PCM 播放資料：${errorMessage(error)}`;
        this.endStream(source.generation, source.stats.error);
      }
    } finally {
      audioData.close();
    }
  }

  private handleWorkletStats(source: AudioSourceRuntime, playbackEpoch: number, value: unknown): void {
    if (!value || typeof value !== "object") return;
    const stats = value as Record<string, unknown>;
    if (stats.type !== "stats" || playbackEpoch !== source.playbackEpoch || !source.stats.active ||
        stats.epoch !== playbackEpoch || stats.generation !== source.generation || stats.clockId !== source.clockId) return;
    source.stats.renderedPcmSamples = source.workletBaseline.renderedPcmSamples + (Number.isFinite(stats.renderedSamples) ? Number(stats.renderedSamples) : 0);
    source.stats.queuedSamples = Number.isFinite(stats.queuedSamples) ? Number(stats.queuedSamples) : source.stats.queuedSamples;
    source.stats.queueOldestGraphResidenceMs = Number.isFinite(stats.queueOldestGraphResidenceMs) ? Number(stats.queueOldestGraphResidenceMs) : 0;
    source.stats.queueStaleDropBatches = source.workletBaseline.queueStaleDropBatches + (Number.isFinite(stats.queueStaleDropBatches) ? Number(stats.queueStaleDropBatches) : 0);
    source.stats.queueOversizeDropBatches = source.workletBaseline.queueOversizeDropBatches + (Number.isFinite(stats.queueOversizeDropBatches) ? Number(stats.queueOversizeDropBatches) : 0);
    source.stats.renderRms = Number.isFinite(stats.rms) ? Number(stats.rms) : source.stats.renderRms;
    source.stats.queueOverflowResets = source.workletBaseline.queueOverflowResets + (Number.isFinite(stats.overflowResets) ? Number(stats.overflowResets) : 0);
    this.publish();

    if (source.stats.queueOverflowResets > source.lastOverflowResets || stats.overflowReset === true) {
      source.lastOverflowResets = source.stats.queueOverflowResets;
      this.resetTimelineAfterOverflow(source);
    }
    source.lastOverflowResets = source.stats.queueOverflowResets;
    if (!Number.isFinite(stats.playheadTimestampUs) || !Number.isFinite(stats.graphTimestampUs)) return;
    const context = this.context;
    if (context.state !== "running") return;
    const observedAtPerformanceTimeMs = performance.now();
    let outputTimestamp: AudioTimestamp | null = null;
    try {
      if (typeof context.getOutputTimestamp === "function") outputTimestamp = context.getOutputTimestamp();
    } catch {
      outputTimestamp = null;
    }
    const outputContextTime = outputTimestamp?.contextTime ?? 0;
    const outputPerformanceTime = outputTimestamp?.performanceTime ?? 0;
    const outputFresh = Boolean(outputTimestamp && Number.isFinite(outputContextTime) && outputContextTime > 0 &&
      Number.isFinite(outputPerformanceTime) && outputPerformanceTime > 0 &&
      observedAtPerformanceTimeMs - outputPerformanceTime >= -20 && observedAtPerformanceTimeMs - outputPerformanceTime <= 250);
    const mapped = mapGraphTimeToPerformanceTime({
      graphTimeUs: Number(stats.graphTimestampUs),
      observedAtPerformanceTimeMs,
      contextTimeSeconds: context.currentTime,
      outputPerformanceTimeMs: outputPerformanceTime,
      outputContextTimeSeconds: outputContextTime,
      outputTimestampFresh: outputFresh,
    });
    const sample = {
      clockId: source.clockId,
      generation: source.generation,
      epoch: source.playbackEpoch,
      sourceTimestampUs: Number(stats.playheadTimestampUs),
      graphTimestampUs: Number(stats.graphTimestampUs),
      receiverPerformanceTimeMs: mapped.performanceTimeMs,
      observationWindowMs: Number(stats.observationWindowMs),
      mappingErrorBoundMs: null,
      mapping: mapped.mapping,
    } as const;
    this.timeline.updateAudioMaster(sample, observedAtPerformanceTimeMs);
    if (source.stats.renderRms >= 0.015) {
      if (!source.pulseActive) this.timeline.recordAudioPulse(sample);
      source.pulseActive = true;
      source.pulseQuietSinceMs = null;
    } else if (source.pulseActive) {
      if (source.pulseQuietSinceMs === null) source.pulseQuietSinceMs = observedAtPerformanceTimeMs;
      if (observedAtPerformanceTimeMs - source.pulseQuietSinceMs >= 100) {
        source.pulseActive = false;
        source.pulseQuietSinceMs = null;
      }
    }
  }

  private resetTimelineAfterOverflow(source: AudioSourceRuntime): void {
    source.pulseActive = false;
    source.pulseQuietSinceMs = null;
    this.timeline.endAudioSource(source.clockId, source.generation, source.playbackEpoch);
    source.playbackEpoch = ++this.nextDecoderEpoch;
    this.timeline.beginAudioStream(source.clockId, source.generation, source.playbackEpoch);
    source.worklet?.port.postMessage({ type: "clear", epoch: source.playbackEpoch, generation: source.generation, clockId: source.clockId });
  }

  private closeRuntime(source: AudioSourceRuntime): void {
    source.requestId += 1;
    source.decoderEpoch += 1;
    this.timeline.endAudioSource(source.clockId, source.generation, source.playbackEpoch || undefined);
    const decoder = source.decoder;
    source.decoder = null;
    try { if (decoder && decoder.state !== "closed") decoder.close(); } catch {}
    const worklet = source.worklet;
    source.worklet = null;
    if (worklet) {
      worklet.port.onmessage = null;
      worklet.port.postMessage({ type: "clear", epoch: source.playbackEpoch + 1, generation: null, clockId: null });
      worklet.port.close();
      try { worklet.disconnect(); } catch {}
    }
    const gain = source.gain;
    source.gain = null;
    try { gain?.disconnect(); } catch {}
    source.stats.queuedSamples = 0;
    source.stats.queueOldestGraphResidenceMs = 0;
    source.stats.renderRms = 0;
  }

  private publish(error?: string): void {
    const sources = this.snapshot();
    // Keep diagnostic records bounded while retaining stopped sources for a short review window.
    if (sources.length > 32) {
      const inactive = sources.filter((source) => !source.active).slice(0, sources.length - 32);
      for (const source of inactive) this.sources.delete(source.generation);
    }
    this.onChange(this.snapshot(), error);
  }
}
