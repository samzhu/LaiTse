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

type ActivePlaybackStream = PlaybackStream & {
  order: number;
  audioMasterSamples: AudioMasterSample[];
  pulseEvents: AudioPulseEvent[];
};

function streamKey(clockId: string, generation: number): string {
  return `${clockId}\u0000${generation}`;
}

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
  private readonly audioStreams = new Map<string, ActivePlaybackStream>();
  private nextStreamOrder = 0;
  private readonly listeners = new Set<() => void>();

  beginAudioStream(clockId: string, generation: number, epoch: number): void {
    if (!clockId || !Number.isInteger(generation) || generation < 1 || !Number.isInteger(epoch) || epoch < 1) return;
    for (const [key, stream] of this.audioStreams) {
      if (stream.clockId === clockId) this.audioStreams.delete(key);
    }
    this.audioStreams.set(streamKey(clockId, generation), {
      clockId,
      generation,
      epoch,
      order: ++this.nextStreamOrder,
      audioMasterSamples: [],
      pulseEvents: [],
    });
    this.notify();
  }

  updateAudioMaster(sample: AudioPulseEvent, receivedAtPerformanceTimeMs: number): boolean {
    const active = this.audioStreams.get(streamKey(sample.clockId, sample.generation));
    if (!active || sample.epoch !== active.epoch) return false;
    if (![sample.sourceTimestampUs, sample.graphTimestampUs, sample.receiverPerformanceTimeMs, sample.observationWindowMs, receivedAtPerformanceTimeMs].every(Number.isFinite)) return false;
    if (sample.sourceTimestampUs < 0 || sample.graphTimestampUs < 0 || sample.observationWindowMs < 0 || sample.mappingErrorBoundMs !== null) return false;
    active.audioMasterSamples.push({ ...sample, receivedAtPerformanceTimeMs });
    while (active.audioMasterSamples.length > MAX_AUDIO_MASTER_SAMPLES) active.audioMasterSamples.shift();
    this.notify();
    return true;
  }

  recordAudioPulse(event: AudioPulseEvent): void {
    const active = this.audioStreams.get(streamKey(event.clockId, event.generation));
    if (!active || event.epoch !== active.epoch) return;
    if (![event.sourceTimestampUs, event.graphTimestampUs, event.receiverPerformanceTimeMs, event.observationWindowMs].every(Number.isFinite)) return;
    active.pulseEvents.push({ ...event });
    while (active.pulseEvents.length > MAX_AUDIO_PULSE_EVENTS) active.pulseEvents.shift();
    this.notify();
  }

  endAudioStream(epoch?: number): void {
    if (epoch === undefined) this.audioStreams.clear();
    else {
      for (const [key, stream] of this.audioStreams) if (stream.epoch === epoch) this.audioStreams.delete(key);
    }
    this.notify();
  }

  endAudioSource(clockId: string, generation: number, epoch?: number): void {
    const key = streamKey(clockId, generation);
    const active = this.audioStreams.get(key);
    if (!active || (epoch !== undefined && active.epoch !== epoch)) return;
    this.audioStreams.delete(key);
    this.notify();
  }

  getAudioMaster(clockId: string | null, nowPerformanceTimeMs: number): AudioMasterSample | null {
    if (!clockId || !Number.isFinite(nowPerformanceTimeMs)) return null;
    const active = [...this.audioStreams.values()]
      .filter((stream) => stream.clockId === clockId)
      .sort((left, right) => right.order - left.order)[0];
    if (!active) return null;
    let latestDue: AudioMasterSample | null = null;
    let earliestFuture: AudioMasterSample | null = null;
    for (const sample of active.audioMasterSamples) {
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
    const active = [...this.audioStreams.values()].sort((left, right) => right.order - left.order)[0];
    return active ? { clockId: active.clockId, generation: active.generation, epoch: active.epoch } : null;
  }

  getAudioStream(clockId: string): PlaybackStream | null {
    const active = [...this.audioStreams.values()]
      .filter((stream) => stream.clockId === clockId)
      .sort((left, right) => right.order - left.order)[0];
    return active ? { clockId: active.clockId, generation: active.generation, epoch: active.epoch } : null;
  }

  getPulseEvents(clockId?: string | null): AudioPulseEvent[] {
    return [...this.audioStreams.values()]
      .filter((stream) => !clockId || stream.clockId === clockId)
      .flatMap((stream) => stream.pulseEvents)
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
