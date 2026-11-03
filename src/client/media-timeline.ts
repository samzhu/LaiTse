export const AUDIO_MASTER_STALE_AFTER_MS = 300;
export const AUDIO_MASTER_FUTURE_LIMIT_MS = 500;
const MAX_AUDIO_PULSE_EVENTS = 24;
const MAX_AUDIO_MASTER_SAMPLES = 32;

export type AudioTimelineMapping = "output-timestamp" | "graph-estimate";

export type AudioPulseEvent = {
  clockId: string;
  generation: number;
  epoch: number;
  sourceTimestampUs: number;
  graphTimestampUs: number;
  receiverPerformanceTimeMs: number;
  observationWindowMs: number;
  mappingErrorBoundMs: null;
  mapping: AudioTimelineMapping;
};

export type AudioMasterSample = AudioPulseEvent & {
  receivedAtPerformanceTimeMs: number;
};

export type PlaybackStream = {
  clockId: string;
  generation: number;
  epoch: number;
};

export function selectVideoFrameIndex(frameTimestampsUs: readonly number[], audioPlayheadTimestampUs: number | null): number {
  if (frameTimestampsUs.length === 0) return -1;
  if (audioPlayheadTimestampUs === null || !Number.isFinite(audioPlayheadTimestampUs)) return frameTimestampsUs.length - 1;
  let selectedIndex = -1;
  for (let index = 0; index < frameTimestampsUs.length; index += 1) {
    const timestampUs = frameTimestampsUs[index];
    if (!Number.isFinite(timestampUs) || timestampUs! > audioPlayheadTimestampUs) break;
    selectedIndex = index;
  }
  return selectedIndex;
}

export function mapGraphTimeToPerformanceTime(input: {
  graphTimeUs: number;
  observedAtPerformanceTimeMs: number;
  contextTimeSeconds: number;
  outputPerformanceTimeMs: number;
  outputContextTimeSeconds: number;
  outputTimestampFresh: boolean;
}): { performanceTimeMs: number; mapping: AudioTimelineMapping } {
  const validGraphTime = Number.isFinite(input.graphTimeUs) && input.graphTimeUs >= 0;
  const validObservedAt = Number.isFinite(input.observedAtPerformanceTimeMs) && input.observedAtPerformanceTimeMs >= 0;
  const validContext = Number.isFinite(input.contextTimeSeconds) && input.contextTimeSeconds >= 0;
  if (!validGraphTime || !validObservedAt || !validContext) {
    return { performanceTimeMs: Number.NaN, mapping: "graph-estimate" };
  }

  const validOutputTimestamp = input.outputTimestampFresh &&
    Number.isFinite(input.outputPerformanceTimeMs) && input.outputPerformanceTimeMs > 0 &&
    Number.isFinite(input.outputContextTimeSeconds) && input.outputContextTimeSeconds > 0;
  if (validOutputTimestamp) {
    return {
      performanceTimeMs: input.outputPerformanceTimeMs + (input.graphTimeUs / 1_000_000 - input.outputContextTimeSeconds) * 1_000,
      mapping: "output-timestamp",
    };
  }

  return {
    performanceTimeMs: input.observedAtPerformanceTimeMs + (input.graphTimeUs / 1_000_000 - input.contextTimeSeconds) * 1_000,
    mapping: "graph-estimate",
  };
}

export class MediaTimeline {
  private audioStream: PlaybackStream | null = null;
  private readonly audioMasterSamples: AudioMasterSample[] = [];
  private readonly pulseEvents: AudioPulseEvent[] = [];
  private readonly listeners = new Set<() => void>();

  beginAudioStream(clockId: string, generation: number, epoch: number): void {
    if (!clockId || !Number.isInteger(generation) || generation < 1 || !Number.isInteger(epoch) || epoch < 1) return;
    this.audioStream = { clockId, generation, epoch };
    this.audioMasterSamples.length = 0;
    this.pulseEvents.length = 0;
    this.notify();
  }

  updateAudioMaster(sample: AudioPulseEvent, receivedAtPerformanceTimeMs: number): boolean {
    const active = this.audioStream;
    if (!active || sample.clockId !== active.clockId || sample.generation !== active.generation || sample.epoch !== active.epoch) return false;
    if (![sample.sourceTimestampUs, sample.graphTimestampUs, sample.receiverPerformanceTimeMs, sample.observationWindowMs, receivedAtPerformanceTimeMs].every(Number.isFinite)) return false;
    if (sample.sourceTimestampUs < 0 || sample.graphTimestampUs < 0 || sample.observationWindowMs < 0 || sample.mappingErrorBoundMs !== null) return false;
    this.audioMasterSamples.push({ ...sample, receivedAtPerformanceTimeMs });
    while (this.audioMasterSamples.length > MAX_AUDIO_MASTER_SAMPLES) this.audioMasterSamples.shift();
    this.notify();
    return true;
  }

  recordAudioPulse(event: AudioPulseEvent): void {
    const active = this.audioStream;
    if (!active || event.clockId !== active.clockId || event.generation !== active.generation || event.epoch !== active.epoch) return;
    if (![event.sourceTimestampUs, event.graphTimestampUs, event.receiverPerformanceTimeMs, event.observationWindowMs].every(Number.isFinite)) return;
    this.pulseEvents.push({ ...event });
    while (this.pulseEvents.length > MAX_AUDIO_PULSE_EVENTS) this.pulseEvents.shift();
    this.notify();
  }

  endAudioStream(epoch?: number): void {
    if (epoch !== undefined && this.audioStream?.epoch !== epoch) return;
    this.audioStream = null;
    this.audioMasterSamples.length = 0;
    this.pulseEvents.length = 0;
    this.notify();
  }

  getAudioMaster(clockId: string | null, nowPerformanceTimeMs: number): AudioMasterSample | null {
    if (!clockId || !Number.isFinite(nowPerformanceTimeMs)) return null;
    let latestDue: AudioMasterSample | null = null;
    let earliestFuture: AudioMasterSample | null = null;
    for (const sample of this.audioMasterSamples) {
      if (sample.clockId !== clockId) continue;
      const age = nowPerformanceTimeMs - sample.receivedAtPerformanceTimeMs;
      const mappedAge = nowPerformanceTimeMs - sample.receiverPerformanceTimeMs;
      const scheduledLeadMs = Math.max(0, Math.min(AUDIO_MASTER_FUTURE_LIMIT_MS, sample.receiverPerformanceTimeMs - sample.receivedAtPerformanceTimeMs));
      if (age < -50 || age > AUDIO_MASTER_STALE_AFTER_MS + scheduledLeadMs || mappedAge > AUDIO_MASTER_STALE_AFTER_MS || mappedAge < -AUDIO_MASTER_FUTURE_LIMIT_MS) continue;
      if (mappedAge >= 0) {
        if (!latestDue || sample.receiverPerformanceTimeMs >= latestDue.receiverPerformanceTimeMs) latestDue = sample;
      } else if (!earliestFuture || sample.receiverPerformanceTimeMs < earliestFuture.receiverPerformanceTimeMs) {
        earliestFuture = sample;
      }
    }
    // New graph samples may be queued ahead of device output. Keep an older
    // due sample usable instead of waiting forever on each replacement sample.
    const selected = latestDue ?? earliestFuture;
    return selected ? { ...selected } : null;
  }

  getActiveAudioStream(): PlaybackStream | null {
    return this.audioStream ? { ...this.audioStream } : null;
  }

  getPulseEvents(clockId?: string | null): AudioPulseEvent[] {
    return this.pulseEvents
      .filter((event) => !clockId || event.clockId === clockId)
      .map((event) => ({ ...event }));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
