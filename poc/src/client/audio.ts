import { MediaTimeline } from "./media-timeline";
import { MultiAudioReceiver, type AudioSourceStats } from "./multi-audio-receiver";

const AUDIO_SAMPLE_RATE = 48_000;
const AUDIO_CHANNELS = 1;
const AUDIO_BITRATE = 32_000;
const AUDIO_FRAME_DURATION_US = 20_000;
const AUDIO_FRAME_HEADER_BYTES = 24;
const MAX_OPUS_PACKET_BYTES = 4_096;
const MAX_SOCKET_BUFFERED_BYTES = 1_536 * 1_024;
const AUDIO_MAGIC = [0x4c, 0x54, 0x41, 0x31];

const PUBLISH_CONFIG: Record<string, unknown> = {
  codec: "opus",
  sampleRate: AUDIO_SAMPLE_RATE,
  numberOfChannels: AUDIO_CHANNELS,
  bitrate: AUDIO_BITRATE,
  opus: { format: "opus" },
};

type EncodedChunk = {
  readonly type: "key" | "delta";
  readonly timestamp: number;
  readonly duration?: number;
  readonly byteLength: number;
  copyTo(destination: AllowSharedBufferSource): void;
};

type AudioEncoderLike = {
  readonly state: "unconfigured" | "configured" | "closed";
  readonly encodeQueueSize: number;
  configure(config: Record<string, unknown>): void;
  encode(data: AudioDataLike): void;
  close(): void;
};

type AudioDataLike = {
  close(): void;
};

type EncoderConstructor = {
  new (callbacks: {
    output: (chunk: EncodedChunk, metadata?: unknown) => void;
    error: (error: DOMException) => void;
  }): AudioEncoderLike;
  isConfigSupported?: (config: Record<string, unknown>) => Promise<{ supported: boolean }>;
};

type AudioDataConstructor = new (init: {
  format: "f32";
  sampleRate: number;
  numberOfFrames: number;
  numberOfChannels: number;
  timestamp: number;
  data: Float32Array;
}) => AudioDataLike;

type AudioWindow = Window & {
  AudioContext?: typeof AudioContext;
  AudioEncoder?: EncoderConstructor;
  AudioData?: AudioDataConstructor;
  webkitAudioContext?: typeof AudioContext;
};

type ListenerState = "off" | "starting" | "ready" | "suspended" | "error";
type PublisherState = "idle" | "starting" | "broadcasting" | "denied" | "blocked" | "no-device" | "unsupported" | "error";
type AudioStreamConfig = { codec: "opus"; sampleRate: number; channels: number; bitrate: number; frameDurationUs: number };

export type AudioSnapshot = {
  listenerState: ListenerState;
  publisherState: PublisherState;
  listenerMessage: string;
  receiverSubscribed: boolean;
  publisherMessage: string;
  sentPackets: number;
  receivedPackets: number;
  decodedFrames: number;
  renderedSamples: number;
  queuedSamples: number;
  queueOldestGraphResidenceMs: number;
  queueStaleDropBatches: number;
  queueOversizeDropBatches: number;
  decodeQueueHighWater: number;
  decodeQueueDroppedPackets: number;
  decodeQueueSaturationStops: number;
  renderRms: number;
  queueOverflowResets: number;
  sources: AudioSourceStats[];
};

export type AudioObservation = {
  schemaVersion: 1;
  observedAt: string;
  environment: {
    userAgent: string;
    platform: string;
    secureContext: boolean;
  };
  audioConfiguration: {
    codec: "opus";
    sampleRateHz: number;
    channels: number;
    bitrateBps: number;
    frameDurationMs: number;
  };
  publisher: {
    state: PublisherState;
    streamGeneration: number | null;
    sentPackets: number;
    counterScope: string;
  };
  receiver: {
    state: ListenerState;
    streamGeneration: number | null;
    receivedPackets: number;
    decodedFrames: number;
    renderedSamples: number;
    queuedSamples: number;
    queueOldestGraphResidenceMs: number;
    queueStaleDropBatches: number;
    queueOversizeDropBatches: number;
    decodeQueueHighWater: number;
    decodeQueueDroppedPackets: number;
    decodeQueueSaturationStops: number;
    sampleRateHz: number;
    receiverBufferMs: number;
    packetGapCount: number;
    packetGapGeneration: number | null;
    renderRms: number;
    queueOverflowResets: number;
    sources: AudioSourceStats[];
    counterScope: {
      receiveDecodeRender: string;
      packetGaps: string;
      localDecodeDrops: string;
      queue: string;
    };
  };
  evidence: {
    endToEndLatencyMs: null;
    humanListening: "not-collected";
    physicalDeviceEvidence: "not-collected";
    publisherSource: "not-established-by-application";
    notes: string[];
  };
};

type CaptureAttempt = {
  token: number;
  context: AudioContext;
  stream: MediaStream | null;
  encoder: AudioEncoderLike | null;
  source: MediaStreamAudioSourceNode | null;
  worklet: AudioWorkletNode | null;
  cancelled: boolean;
};

const INITIAL_STATE: AudioSnapshot = {
  listenerState: "off",
  publisherState: "idle",
  listenerMessage: "尚未收聽。接收者先按「開始收聽」啟動播放。",
  receiverSubscribed: false,
  publisherMessage: "麥克風尚未啟動。按下開始後，瀏覽器才會詢問麥克風權限。",
  sentPackets: 0,
  receivedPackets: 0,
  decodedFrames: 0,
  renderedSamples: 0,
  queuedSamples: 0,
  queueOldestGraphResidenceMs: 0,
  queueStaleDropBatches: 0,
  queueOversizeDropBatches: 0,
  decodeQueueHighWater: 0,
  decodeQueueDroppedPackets: 0,
  decodeQueueSaturationStops: 0,
  renderRms: 0,
  queueOverflowResets: 0,
  sources: [],
};

function parseAudioStreamConfig(value: unknown): AudioStreamConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const config = value as Record<string, unknown>;
  if (
    config.codec !== "opus" || config.sampleRate !== AUDIO_SAMPLE_RATE || config.channels !== AUDIO_CHANNELS ||
    !Number.isInteger(config.bitrate) || Number(config.bitrate) <= 0 ||
    !Number.isInteger(config.frameDurationUs) || Number(config.frameDurationUs) <= 0
  ) return null;
  return {
    codec: "opus",
    sampleRate: AUDIO_SAMPLE_RATE,
    channels: AUDIO_CHANNELS,
    bitrate: Number(config.bitrate),
    frameDurationUs: Number(config.frameDurationUs),
  };
}

function makeAudioFrame(generation: number, sequence: number, timestampUs: number, packet: Uint8Array): ArrayBuffer {
  const frame = new ArrayBuffer(AUDIO_FRAME_HEADER_BYTES + packet.byteLength);
  const bytes = new Uint8Array(frame);
  bytes.set(AUDIO_MAGIC, 0);
  const view = new DataView(frame);
  view.setUint32(4, generation, false);
  view.setUint32(8, sequence, false);
  view.setFloat64(12, timestampUs, false);
  view.setUint32(20, AUDIO_FRAME_DURATION_US, false);
  bytes.set(packet, AUDIO_FRAME_HEADER_BYTES);
  return frame;
}

function errorName(error: unknown): string {
  return error instanceof DOMException ? error.name : error instanceof Error ? error.name : "Error";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 180) : "未知錯誤";
}

function createAudioContext(): AudioContext {
  const audioWindow = window as unknown as AudioWindow;
  const Constructor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
  if (!Constructor) throw new Error("此瀏覽器沒有 AudioContext。" );
  return new Constructor({ sampleRate: AUDIO_SAMPLE_RATE, latencyHint: "interactive" });
}

function isOpen(socket: WebSocket): boolean {
  return socket.readyState === WebSocket.OPEN;
}

export class AudioController {
  private state: AudioSnapshot = { ...INITIAL_STATE };
  private readonly socket: WebSocket;
  private readonly onChange: (state: AudioSnapshot) => void;
  private listenerContext: AudioContext | null = null;
  private audioReceiver: MultiAudioReceiver | null = null;
  private playbackVolume = 1;
  private listenerActive = false;
  private listenerToken = 0;
  private listenerSetupPromise: Promise<void> | null = null;
  private captureAttempt: CaptureAttempt | null = null;
  private captureToken = 0;
  private pendingStart: CaptureAttempt | null = null;
  private publishGeneration: number | null = null;
  private publishSequence = 0;
  private readonly timeline: MediaTimeline;

  constructor(socket: WebSocket, timeline: MediaTimeline, onChange: (state: AudioSnapshot) => void) {
    this.socket = socket;
    this.timeline = timeline;
    this.onChange = onChange;
    this.socket.addEventListener("message", this.handleSocketMessage);
    this.socket.addEventListener("close", this.handleSocketClose);
    this.socket.addEventListener("error", this.handleSocketError);
    this.publish();
  }

  snapshot(): AudioSnapshot {
    return { ...this.state, sources: this.state.sources.map((source) => ({ ...source })) };
  }

  getVolume(): number {
    return this.playbackVolume;
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.playbackVolume = Math.min(1, Math.max(0, volume));
    this.audioReceiver?.setVolume(this.playbackVolume);
  }

  getObservation(): AudioObservation {
    const state = this.snapshot();
    const activeSources = state.sources.filter((source) => source.active);
    return {
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      environment: {
        userAgent: navigator.userAgent.slice(0, 256),
        platform: navigator.platform.slice(0, 100),
        secureContext: window.isSecureContext,
      },
      audioConfiguration: {
        codec: "opus",
        sampleRateHz: AUDIO_SAMPLE_RATE,
        channels: AUDIO_CHANNELS,
        bitrateBps: AUDIO_BITRATE,
        frameDurationMs: AUDIO_FRAME_DURATION_US / 1_000,
      },
      publisher: {
        state: state.publisherState,
        streamGeneration: this.publishGeneration,
        sentPackets: state.sentPackets,
        counterScope: "sentPackets accumulates for this controller page lifetime across publisher generations.",
      },
      receiver: {
        state: state.listenerState,
        streamGeneration: activeSources.at(-1)?.generation ?? null,
        receivedPackets: state.receivedPackets,
        decodedFrames: state.decodedFrames,
        renderedSamples: state.renderedSamples,
        queuedSamples: state.queuedSamples,
        queueOldestGraphResidenceMs: state.queueOldestGraphResidenceMs,
        queueStaleDropBatches: state.queueStaleDropBatches,
        queueOversizeDropBatches: state.queueOversizeDropBatches,
        decodeQueueHighWater: state.decodeQueueHighWater,
        decodeQueueDroppedPackets: state.decodeQueueDroppedPackets,
        decodeQueueSaturationStops: state.decodeQueueSaturationStops,
        sampleRateHz: AUDIO_SAMPLE_RATE,
        receiverBufferMs: Number((state.queuedSamples / AUDIO_SAMPLE_RATE * 1_000).toFixed(2)),
        packetGapCount: state.sources.reduce((total, source) => total + source.packetGapCount, 0),
        packetGapGeneration: state.sources.length === 1 ? state.sources[0]?.generation ?? null : null,
        renderRms: state.renderRms,
        queueOverflowResets: state.queueOverflowResets,
        sources: state.sources,
        counterScope: {
          receiveDecodeRender: "receivedPackets counts valid incoming source packets evaluated with an active decoder, including locally skipped packets; decodedFrames counts decoder outputs. Aggregate counters sum retained source-generation records (up to 32); when an older inactive record is evicted, aggregates may decrease. Inspect sources for per-publisher attribution.",
          packetGaps: "packetGapCount sums source-scoped sequence gaps between consecutive valid incoming packets evaluated with an active decoder after each source generation's first packet.",
          localDecodeDrops: "decodeQueueDroppedPackets counts valid incoming packets skipped locally when that source decoder already has eight pending frames. It is not network packet loss and does not stop the source.",
          queue: "queuedSamples is the sum of independent per-source PCM queues; each source queue is capped at 500 ms. renderRms summarizes active sources. Values are local pipeline observations, not network or end-to-end latency.",
        },
      },
      evidence: {
        endToEndLatencyMs: null,
        humanListening: "not-collected",
        physicalDeviceEvidence: "not-collected",
        publisherSource: "not-established-by-application",
        notes: [
          "播放計數與 RMS 是此瀏覽器解碼／AudioWorklet 輸出管線的樣本觀測，不代表音訊硬體已輸出或真人已聽見。",
          "接收緩衝是 queuedSamples ÷ 48000 Hz 的本機佇列估計，不是端到端延遲。",
          "播放佇列居留時間使用 AudioWorklet graph clock；暫停時 graph time 停止，暫停／恢復時舊 decoder 與 PCM queue 會清除。此值不是牆鐘背景時間、網路年齡或來源到播放延遲。",
          "每個發布者分別維護接收、解碼、AudioWorklet PCM 輸出、RMS、封包缺口與有界播放佇列計數；封包缺口只計該來源第一個已接受封包後的序號空隙。",
          "彙總播放佇列是各來源獨立佇列加總，每來源上限500ms；不是單一延遲估計。",
          "來源明細最多保留32個stream generation；彙總接收／解碼／渲染及queue計數加總目前保留的來源記錄，最舊已停止來源淘汰時彙總值可能下降，不代表計數是全頁終身單調累計。",
          "封包序號缺口不代表音訊掉音或真人可聽見的中斷；送出計數是此頁存續期間累計，接收／解碼／渲染計數加總目前保留的來源記錄。",
          "streamGeneration 只在目前 server process 內有意義；報告沒有持久的 run 或 session ID。",
          "本頁無法判定發布來源是瀏覽器合成音源或真人麥克風。",
        ],
      },
    };
  }

  startListening(): void {
    if (this.listenerActive) {
      if (this.listenerContext?.state === "suspended") this.resumeListening();
      return;
    }
    if (this.listenerSetupPromise) {
      if (this.listenerContext?.state === "suspended") this.requestListenerResume(this.listenerContext, this.listenerToken);
      return;
    }
    const token = ++this.listenerToken;
    let context: AudioContext;
    try {
      context = createAudioContext();
      this.listenerContext = context;
    } catch (error) {
      this.set({ listenerState: "error", listenerMessage: `無法啟動播放：${errorMessage(error)}` });
      return;
    }
    this.set({ listenerState: "starting", listenerMessage: "正在啟動播放裝置…" });
    context.onstatechange = () => this.handleListenerContextState(context, token);

    const setup = this.prepareListener(context, token);
    this.listenerSetupPromise = setup;
    this.requestListenerResume(context, token);
    void setup.then(() => {
      if (token !== this.listenerToken || this.listenerContext !== context) return;
      if (!isOpen(this.socket)) throw new Error("房間連線已關閉。");
      this.listenerActive = true;
      this.set({ receiverSubscribed: false });
      this.socket.send(JSON.stringify({ type: "audio.subscribe" }));
      if (context.state === "running") {
        this.set({ listenerState: "ready", listenerMessage: "播放已啟動；正在等待發布者音訊。" });
      } else {
        this.set({ listenerState: "suspended", listenerMessage: "已送出接收訂閱；播放暫停，按「繼續收聽」啟動音訊。" });
      }
    }).catch((error: unknown) => {
      if (token !== this.listenerToken || this.listenerContext !== context) return;
      this.listenerActive = false;
      this.set({ receiverSubscribed: false });
      this.stopListenerResources();
      this.set({ listenerState: "error", listenerMessage: `無法啟動播放：${errorMessage(error)}` });
    }).finally(() => {
      if (this.listenerSetupPromise === setup) this.listenerSetupPromise = null;
    });
  }

  resumeListening(): void {
    const context = this.listenerContext;
    if (!context || !this.listenerActive) {
      if (context && this.listenerSetupPromise) {
        this.requestListenerResume(context, this.listenerToken);
        return;
      }
      this.startListening();
      return;
    }
    this.requestListenerResume(context, this.listenerToken);
  }

  restoreListening(): void {
    this.startListening();
  }

  private prepareListener(context: AudioContext, token: number): Promise<void> {
    return (async () => {
      if (context.sampleRate !== AUDIO_SAMPLE_RATE) throw new Error(`瀏覽器建立了 ${context.sampleRate} Hz 音訊時鐘；本輪需要 48000 Hz。`);
      await context.audioWorklet.addModule("/audio-playback-worklet.js");
      if (token !== this.listenerToken || this.listenerContext !== context) return;
      this.audioReceiver = new MultiAudioReceiver(
        context,
        this.timeline,
        this.playbackVolume,
        (sources, error) => this.handleAudioSourcesChanged(sources, error),
      );
    })();
  }

  private requestListenerResume(context: AudioContext, token: number): void {
    let resumePromise: Promise<void>;
    try {
      resumePromise = context.resume();
    } catch {
      if (this.listenerContext === context && this.listenerActive) {
        this.set({ listenerState: "suspended", listenerMessage: "播放仍暫停；按「繼續收聽」重試瀏覽器播放手勢。" });
      }
      return;
    }
    // Do not await this promise: browsers can leave resume() pending until a
    // normal user gesture. The receiver subscription is independent of that
    // policy and can still restore while the UI offers Continue.
    void resumePromise.then(() => {
      if (token !== this.listenerToken || this.listenerContext !== context || !this.listenerActive || context.state !== "running") return;
      this.audioReceiver?.resume();
      this.set({ listenerState: "ready", listenerMessage: this.state.sources.every((source) => !source.active)
        ? "播放已啟動；正在等待發布者音訊。"
        : "播放已恢復，正在接收 Opus 音訊。" });
    }).catch(() => {
      if (token !== this.listenerToken || this.listenerContext !== context || !this.listenerActive) return;
      this.set({ listenerState: "suspended", listenerMessage: "接收訂閱仍有效；瀏覽器暫停了音訊。按「繼續收聽」重試。" });
    });
  }

  private handleListenerContextState(context: AudioContext, token: number): void {
    if (token !== this.listenerToken || this.listenerContext !== context || !this.listenerActive) return;
    if (context.state === "running") {
      this.audioReceiver?.resume();
      this.set({ listenerState: "ready", listenerMessage: this.state.sources.every((source) => !source.active)
        ? "播放已啟動；正在等待發布者音訊。"
        : "播放已恢復，正在接收 Opus 音訊。" });
    } else if (context.state === "suspended") {
      this.audioReceiver?.suspend();
      this.set({ listenerState: "suspended", listenerMessage: "接收訂閱仍有效；播放目前暫停。按「繼續收聽」恢復音訊。" });
    }
  }

  stopListening(notifyServer = true): void {
    this.listenerToken += 1;
    if (notifyServer && this.listenerActive && isOpen(this.socket)) this.socket.send(JSON.stringify({ type: "audio.unsubscribe" }));
    this.listenerActive = false;
    this.listenerSetupPromise = null;
    this.audioReceiver?.stopAll();
    this.audioReceiver = null;
    this.stopListenerResources();
    this.set({
      listenerState: "off",
      listenerMessage: "已停止收聽。再次開始時，需要重新按播放手勢。",
      receiverSubscribed: false,
      receivedPackets: 0,
      decodedFrames: 0,
      renderedSamples: 0,
      queuedSamples: 0,
      queueOldestGraphResidenceMs: 0,
      queueStaleDropBatches: 0,
      queueOversizeDropBatches: 0,
      decodeQueueHighWater: 0,
      decodeQueueDroppedPackets: 0,
      decodeQueueSaturationStops: 0,
      renderRms: 0,
      queueOverflowResets: 0,
      sources: [],
    });
  }

  startMicrophone(): void {
    if (this.state.publisherState === "starting" || this.state.publisherState === "broadcasting") return;
    if (!window.isSecureContext) {
      this.set({ publisherState: "blocked", publisherMessage: "麥克風需要可信 HTTPS 或瀏覽器的 localhost 安全內容。" });
      return;
    }
    const mediaDevices = navigator.mediaDevices;
    const audioWindow = window as unknown as AudioWindow;
    const Encoder = audioWindow.AudioEncoder;
    const AudioDataType = audioWindow.AudioData;
    if (!mediaDevices || typeof mediaDevices.getUserMedia !== "function") {
      this.set({ publisherState: "unsupported", publisherMessage: "此瀏覽器沒有可用的麥克風擷取 API。" });
      return;
    }
    if (!Encoder || !AudioDataType || !audioWindow.AudioContext && !audioWindow.webkitAudioContext) {
      this.set({ publisherState: "unsupported", publisherMessage: "此瀏覽器缺少本輪需要的 AudioContext 或 WebCodecs AudioEncoder。" });
      return;
    }

    const token = ++this.captureToken;
    let context: AudioContext;
    let permissionRequest: Promise<MediaStream>;
    let resumePromise: Promise<void>;
    try {
      context = createAudioContext();
      resumePromise = context.resume();
      // Permission can fail before the async path awaits resume. Closing the
      // context then rejects resume; observe it now, and still await it below.
      void resumePromise.catch(() => {});
      permissionRequest = mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: AUDIO_CHANNELS },
          sampleRate: { ideal: AUDIO_SAMPLE_RATE },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
    } catch (error) {
      const state = this.mediaErrorState(error);
      this.set({ publisherState: state.state, publisherMessage: state.message });
      return;
    }

    const attempt: CaptureAttempt = { token, context, stream: null, encoder: null, source: null, worklet: null, cancelled: false };
    this.captureAttempt = attempt;
    this.set({ publisherState: "starting", publisherMessage: "等待麥克風權限並準備 Opus 編碼器…" });

    void (async () => {
      try {
        const stream = await permissionRequest;
        attempt.stream = stream;
        if (token !== this.captureToken || attempt.cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        for (const track of stream.getAudioTracks()) {
          track.addEventListener("ended", () => this.failCapture(attempt, new Error("The microphone track ended.")), { once: true });
        }
        await resumePromise;
        if (token !== this.captureToken || attempt.cancelled) return;
        if (context.sampleRate !== AUDIO_SAMPLE_RATE) throw new Error(`瀏覽器建立了 ${context.sampleRate} Hz 音訊時鐘；本輪需要 48000 Hz。`);

        const encoderSupport = await Encoder.isConfigSupported?.(PUBLISH_CONFIG);
        if (!encoderSupport?.supported) throw new UnsupportedAudioError("此瀏覽器不支援指定的原生 Opus 編碼設定。" );
        if (token !== this.captureToken || attempt.cancelled) return;

        const encoder = new Encoder({
          output: (chunk) => this.handleEncodedChunk(attempt, chunk),
          error: (error) => this.failCapture(attempt, error),
        });
        attempt.encoder = encoder;
        encoder.configure(PUBLISH_CONFIG);
        await context.audioWorklet.addModule("/audio-capture-worklet.js");
        if (token !== this.captureToken || attempt.cancelled) return;
        const worklet = new AudioWorkletNode(context, "laitse-capture", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [AUDIO_CHANNELS],
          channelCount: AUDIO_CHANNELS,
          channelCountMode: "explicit",
          processorOptions: {
            contextTimeUs: context.currentTime * 1_000_000,
            performanceTimeUs: performance.now() * 1_000,
          },
        });
        worklet.port.onmessage = (event: MessageEvent) => this.handleCapturePcm(attempt, event.data);
        worklet.connect(context.destination);
        attempt.worklet = worklet;
        attempt.source = context.createMediaStreamSource(stream);
        this.pendingStart = attempt;
        if (!isOpen(this.socket)) throw new Error("房間連線已關閉。");
        this.socket.send(JSON.stringify({
          type: "audio.start",
          codec: "opus",
          sampleRate: AUDIO_SAMPLE_RATE,
          channels: AUDIO_CHANNELS,
          bitrate: AUDIO_BITRATE,
          frameDurationUs: AUDIO_FRAME_DURATION_US,
        }));
        this.set({ publisherState: "starting", publisherMessage: "編碼器就緒，正在取得房間發布權…" });
      } catch (error) {
        if (token !== this.captureToken) return;
        this.captureAttempt = null;
        this.pendingStart = null;
        this.cleanupCapture(attempt);
        if (error instanceof UnsupportedAudioError) {
          this.set({ publisherState: "unsupported", publisherMessage: error.message });
        } else {
          const mediaError = this.mediaErrorState(error);
          this.set({ publisherState: mediaError.state, publisherMessage: mediaError.message });
        }
      }
    })();
  }

  stopMicrophone(notifyServer = true): void {
    const attempt = this.captureAttempt;
    if (attempt) attempt.cancelled = true;
    const generation = this.publishGeneration;
    this.publishGeneration = null;
    this.publishSequence = 0;
    this.captureToken += 1;
    if (notifyServer && generation !== null && isOpen(this.socket)) {
      this.socket.send(JSON.stringify({ type: "audio.stop", generation }));
    }
    if (this.pendingStart && !generation) this.pendingStart.cancelled = true;
    this.pendingStart = null;
    this.captureAttempt = null;
    if (attempt) this.cleanupCapture(attempt);
    this.set({ publisherState: "idle", publisherMessage: "麥克風已停止，新的音訊不再發布。" });
  }

  private stopMicrophoneAfterRevocation(reason: unknown): void {
    const attempt = this.captureAttempt;
    if (attempt) attempt.cancelled = true;
    this.publishGeneration = null;
    this.publishSequence = 0;
    this.captureToken += 1;
    if (this.pendingStart) this.pendingStart.cancelled = true;
    this.pendingStart = null;
    this.captureAttempt = null;
    if (attempt) this.cleanupCapture(attempt);
    this.set({ publisherState: "idle", publisherMessage: reason === "session_ended"
      ? "目前活動已結束；麥克風已停止。"
      : "主持人已撤銷發布權；麥克風已停止。" });
  }

  dispose(): void {
    this.socket.removeEventListener("message", this.handleSocketMessage);
    this.socket.removeEventListener("close", this.handleSocketClose);
    this.socket.removeEventListener("error", this.handleSocketError);
    const generation = this.publishGeneration;
    this.publishGeneration = null;
    if (generation !== null && isOpen(this.socket)) this.socket.send(JSON.stringify({ type: "audio.stop", generation }));
    if (this.listenerActive && isOpen(this.socket)) this.socket.send(JSON.stringify({ type: "audio.unsubscribe" }));
    this.listenerActive = false;
    this.listenerSetupPromise = null;
    this.captureToken += 1;
    this.listenerToken += 1;
    if (this.captureAttempt) this.captureAttempt.cancelled = true;
    if (this.captureAttempt) this.cleanupCapture(this.captureAttempt);
    this.captureAttempt = null;
    this.pendingStart = null;
    this.audioReceiver?.stopAll();
    this.audioReceiver = null;
    this.stopListenerResources();
  }

  private readonly handleSocketMessage = (event: MessageEvent): void => {
    if (typeof event.data !== "string") {
      if (event.data instanceof ArrayBuffer) this.handleBinaryFrame(event.data);
      return;
    }
    let message: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(event.data);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      message = parsed as Record<string, unknown>;
    } catch {
      return;
    }

    if (message.type === "protocol.error") {
      const code = String(message.code ?? "");
      if (!code.startsWith("audio_") && !code.startsWith("invalid_audio")) return;
      this.set({ publisherMessage: `房間拒絕音訊控制：${String(message.message ?? message.code ?? "protocol error")}` });
      return;
    }
    if (message.type === "audio.started") {
      this.handlePublisherStarted(message);
      return;
    }
    if (message.type === "audio.publishRevoked" || message.type === "host.publishRevoked") {
      this.stopMicrophoneAfterRevocation(message.reason);
      return;
    }
    if (message.type === "participation.modeChanged" && message.mode === "interaction") {
      this.stopMicrophone(false);
      this.stopListening(false);
      return;
    }
    if (message.type === "audio.error") {
      if (this.captureAttempt) {
        const attempt = this.captureAttempt;
        this.captureAttempt = null;
        this.pendingStart = null;
        this.cleanupCapture(attempt);
        this.publishGeneration = null;
        this.set({ publisherState: "error", publisherMessage: String(message.message ?? "房間無法開始語音發布。") });
      }
      return;
    }
    if (message.type === "audio.stream") {
      const generation = Number(message.generation);
      const clockId = typeof message.clockId === "string" ? message.clockId : "";
      const config = parseAudioStreamConfig(message.config);
      if (Number.isInteger(generation) && generation > 0 && clockId.length > 0 && config && this.listenerActive) {
        this.audioReceiver?.startStream(generation, clockId, config);
      } else if (this.listenerActive && (!config || !Number.isInteger(generation) || generation < 1 || clockId.length === 0)) {
        this.set({ listenerState: "error", listenerMessage: "伺服器提供的 Opus 設定或播放時基無效。" });
      }
      return;
    }
    if (message.type === "audio.unavailable") {
      if (message.reason === "out_of_range" && this.listenerActive) {
        this.set({ listenerMessage: "超出目前示範收聽範圍；收聽仍保持啟用，靠近後會自動恢復。" });
      }
      return;
    }
    if (message.type === "audio.streamEnded") {
      const generation = Number(message.generation);
      if (Number.isInteger(generation) && generation > 0) this.audioReceiver?.endStream(generation);
      this.set({ listenerMessage: message.reason === "out_of_range"
        ? "一位發布者超出目前示範收聽範圍；收聽仍保持啟用。"
        : message.reason === "permission_revoked"
          ? "一位發布者的發布權已撤銷；其他來源仍可播放。"
          : message.reason === "session_ended"
            ? "活動已結束；播放仍保持啟動並等待新的活動。"
            : "一位發布者已停止；其他來源仍持續播放。" });
      return;
    }
    if (message.type === "audio.subscribed") {
      if (this.listenerActive) this.set({ receiverSubscribed: true, listenerMessage: "已加入接收訂閱；正在等待發布者音訊。" });
      return;
    }
    if (message.type === "audio.unsubscribed") {
      this.set({ receiverSubscribed: false });
      if (message.reason === "mode_changed") this.stopListening(false);
      return;
    }
    if (message.type === "audio.stopped") {
      return;
    }
  };

  private readonly handleSocketClose = (): void => {
    this.dispose();
    this.set({
      listenerState: "off",
      publisherState: "idle",
      listenerMessage: "房間連線已關閉，接收播放已停止。",
      publisherMessage: "房間連線已關閉，麥克風發布已停止。",
      queuedSamples: 0,
      renderRms: 0,
      receiverSubscribed: false,
    });
  };

  private readonly handleSocketError = (): void => {
    this.set({ listenerMessage: "房間連線發生錯誤；音訊控制可能無法送達。" });
  };

  private handlePublisherStarted(message: Record<string, unknown>): void {
    const attempt = this.pendingStart;
    const generation = Number(message.generation);
    if (!attempt || !Number.isInteger(generation) || generation < 1) {
      if (Number.isInteger(generation) && generation > 0 && isOpen(this.socket)) {
        this.socket.send(JSON.stringify({ type: "audio.stop", generation }));
      }
      return;
    }
    this.pendingStart = null;
    if (attempt.cancelled || attempt.token !== this.captureToken || !attempt.source) {
      if (isOpen(this.socket)) this.socket.send(JSON.stringify({ type: "audio.stop", generation }));
      this.cleanupCapture(attempt);
      return;
    }
    try {
      this.publishGeneration = generation;
      this.publishSequence = 0;
      attempt.source.connect(attempt.worklet!);
      this.set({
        publisherState: "broadcasting",
        publisherMessage: "正在使用麥克風發布原生 Opus 音訊。按「停止麥克風」即可停止傳送。",
        ...(this.listenerActive ? { listenerMessage: "此頁正在發布自己的語音；本地播放不會回送自己的音訊。" } : {}),
      });
    } catch (error) {
      this.socket.send(JSON.stringify({ type: "audio.stop", generation }));
      this.publishGeneration = null;
      this.failCapture(attempt, error);
    }
  }

  private handleCapturePcm(attempt: CaptureAttempt, value: unknown): void {
    if (
      this.captureAttempt !== attempt ||
      attempt.cancelled ||
      this.publishGeneration === null ||
      !value || typeof value !== "object"
    ) return;
    const message = value as { type?: unknown; timestampUs?: unknown; samples?: unknown };
    if (message.type !== "pcm" || !(message.samples instanceof Float32Array) || typeof message.timestampUs !== "number") return;
    const encoder = attempt.encoder;
    const AudioDataType = (window as unknown as AudioWindow).AudioData;
    if (!encoder || !AudioDataType || encoder.state !== "configured" || !isOpen(this.socket)) return;
    if (encoder.encodeQueueSize >= 8) return;
    let audioData: AudioDataLike | null = null;
    try {
      audioData = new AudioDataType({
        format: "f32",
        sampleRate: AUDIO_SAMPLE_RATE,
        numberOfFrames: message.samples.length,
        numberOfChannels: AUDIO_CHANNELS,
        timestamp: message.timestampUs,
        data: message.samples,
      });
      encoder.encode(audioData);
    } catch (error) {
      this.failCapture(attempt, error);
    } finally {
      audioData?.close();
    }
  }

  private handleEncodedChunk(attempt: CaptureAttempt, chunk: EncodedChunk): void {
    if (this.captureAttempt !== attempt || attempt.cancelled || this.publishGeneration === null || !isOpen(this.socket)) return;
    if (this.socket.bufferedAmount + AUDIO_FRAME_HEADER_BYTES + chunk.byteLength > MAX_SOCKET_BUFFERED_BYTES) {
      this.failCapture(attempt, new Error("The shared outgoing WebSocket queue exceeded 1.5 MiB; audio publishing stopped."));
      return;
    }
    if (chunk.byteLength < 1 || chunk.byteLength > MAX_OPUS_PACKET_BYTES || !Number.isFinite(chunk.timestamp) || chunk.timestamp < 0) {
      this.failCapture(attempt, new Error("Opus encoder returned an empty, oversized, or invalid-timestamp packet."));
      return;
    }
    const packet = new Uint8Array(chunk.byteLength);
    try {
      chunk.copyTo(packet);
      const frame = makeAudioFrame(this.publishGeneration, this.publishSequence, chunk.timestamp, packet);
      this.socket.send(frame);
      this.publishSequence += 1;
      this.set({ sentPackets: this.state.sentPackets + 1 });
    } catch (error) {
      this.failCapture(attempt, error);
    }
  }

  private handleBinaryFrame(data: ArrayBuffer): void {
    const header = new Uint8Array(data, 0, Math.min(4, data.byteLength));
    if (header.byteLength !== AUDIO_MAGIC.length || AUDIO_MAGIC.some((value, index) => header[index] !== value)) return;
    this.audioReceiver?.handleBinary(data);
  }

  private handleAudioSourcesChanged(sources: AudioSourceStats[], error?: string): void {
    const sum = (select: (source: AudioSourceStats) => number) => sources.reduce((total, source) => total + select(source), 0);
    const activeSources = sources.filter((source) => source.active);
    const rmsSquareTotal = activeSources.reduce((total, source) => total + source.renderRms * source.renderRms, 0);
    this.set({
      sources,
      receivedPackets: sum((source) => source.receivedPackets),
      decodedFrames: sum((source) => source.decodedFrames),
      renderedSamples: sum((source) => source.renderedPcmSamples),
      queuedSamples: sum((source) => source.queuedSamples),
      queueOldestGraphResidenceMs: Math.max(0, ...sources.map((source) => source.queueOldestGraphResidenceMs)),
      queueStaleDropBatches: sum((source) => source.queueStaleDropBatches),
      queueOversizeDropBatches: sum((source) => source.queueOversizeDropBatches),
      decodeQueueHighWater: Math.max(0, ...sources.map((source) => source.decodeQueueHighWater)),
      decodeQueueDroppedPackets: sum((source) => source.decodeQueueDroppedPackets),
      decodeQueueSaturationStops: sum((source) => source.decodeQueueSaturationStops),
      renderRms: activeSources.length ? Math.sqrt(rmsSquareTotal / activeSources.length) : 0,
      queueOverflowResets: sum((source) => source.queueOverflowResets),
      ...(error
        ? { listenerMessage: error }
        : activeSources.length > 0 && this.listenerContext?.state === "running"
          ? { listenerMessage: `目前接收 ${activeSources.length} 個語音來源，解碼與播放佇列分開管理。` }
          : {}),
    });
  }

  private failCapture(attempt: CaptureAttempt, error: unknown): void {
    if (this.captureAttempt !== attempt) return;
    const generation = this.publishGeneration;
    this.publishGeneration = null;
    if (generation !== null && isOpen(this.socket)) this.socket.send(JSON.stringify({ type: "audio.stop", generation }));
    this.captureAttempt = null;
    this.pendingStart = null;
    this.captureToken += 1;
    this.cleanupCapture(attempt);
    this.set({ publisherState: "error", publisherMessage: `麥克風發布已停止：${errorMessage(error)}` });
  }

  private cleanupCapture(attempt: CaptureAttempt): void {
    try { attempt.source?.disconnect(); } catch {}
    try { attempt.worklet?.disconnect(); } catch {}
    attempt.worklet?.port.close();
    for (const track of attempt.stream?.getTracks() ?? []) track.stop();
    try { if (attempt.encoder && attempt.encoder.state !== "closed") attempt.encoder.close(); } catch {}
    if (attempt.context.state !== "closed") void attempt.context.close().catch(() => {});
  }

  private stopListenerResources(): void {
    this.audioReceiver?.stopAll();
    this.audioReceiver = null;
    const context = this.listenerContext;
    this.listenerContext = null;
    if (context) context.onstatechange = null;
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }

  private mediaErrorState(error: unknown): { state: PublisherState; message: string } {
    const name = errorName(error);
    if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
      return { state: name === "SecurityError" ? "blocked" : "denied", message: name === "SecurityError"
        ? "瀏覽器安全政策阻擋麥克風；請使用可信 HTTPS。"
        : "麥克風權限遭拒或被瀏覽器封鎖；目前沒有發布音訊。" };
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return { state: "no-device", message: "找不到可用的麥克風；目前沒有發布音訊。" };
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return { state: "error", message: "麥克風存在，但目前無法讀取；請確認沒有被其他程式占用。" };
    }
    if (name === "OverconstrainedError") {
      return { state: "unsupported", message: "麥克風無法提供本輪所需的音訊格式。" };
    }
    return { state: "error", message: `麥克風啟動失敗：${errorMessage(error)}` };
  }

  private set(patch: Partial<AudioSnapshot>): void {
    this.state = { ...this.state, ...patch };
    this.publish();
  }

  private publish(): void {
    this.onChange({ ...this.state });
  }
}

class UnsupportedAudioError extends Error {}
