const AUDIO_SAMPLE_RATE = 48_000;
const AUDIO_CHANNELS = 1;
const AUDIO_BITRATE = 32_000;
const AUDIO_FRAME_DURATION_US = 20_000;
const AUDIO_FRAME_HEADER_BYTES = 24;
const MAX_OPUS_PACKET_BYTES = 4_096;
const MAX_SOCKET_BUFFERED_BYTES = 64 * 1_024;
const AUDIO_MAGIC = [0x4c, 0x54, 0x41, 0x31];

const PUBLISH_CONFIG: Record<string, unknown> = {
  codec: "opus",
  sampleRate: AUDIO_SAMPLE_RATE,
  numberOfChannels: AUDIO_CHANNELS,
  bitrate: AUDIO_BITRATE,
  opus: { format: "opus" },
};

const DECODE_CONFIG: Record<string, unknown> = {
  codec: "opus",
  sampleRate: AUDIO_SAMPLE_RATE,
  numberOfChannels: AUDIO_CHANNELS,
};

type EncodedChunk = {
  readonly type: "key" | "delta";
  readonly timestamp: number;
  readonly duration?: number;
  readonly byteLength: number;
  copyTo(destination: AllowSharedBufferSource): void;
};

type DecodedAudioData = {
  readonly numberOfFrames: number;
  readonly numberOfChannels: number;
  close(): void;
  copyTo(destination: AllowSharedBufferSource, options?: { planeIndex?: number; format?: string }): Promise<void>;
};

type AudioEncoderLike = {
  readonly state: "unconfigured" | "configured" | "closed";
  readonly encodeQueueSize: number;
  configure(config: Record<string, unknown>): void;
  encode(data: AudioDataLike): void;
  close(): void;
};

type AudioDecoderLike = {
  readonly state: "unconfigured" | "configured" | "closed";
  configure(config: Record<string, unknown>): void;
  decode(chunk: EncodedAudioChunkLike): void;
  close(): void;
};

type AudioDataLike = {
  close(): void;
};

type EncodedAudioChunkLike = object;

type EncoderConstructor = {
  new (callbacks: {
    output: (chunk: EncodedChunk, metadata?: unknown) => void;
    error: (error: DOMException) => void;
  }): AudioEncoderLike;
  isConfigSupported?: (config: Record<string, unknown>) => Promise<{ supported: boolean }>;
};

type DecoderConstructor = {
  new (callbacks: {
    output: (data: DecodedAudioData) => void;
    error: (error: DOMException) => void;
  }): AudioDecoderLike;
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

type EncodedAudioChunkConstructor = new (init: {
  type: "key";
  timestamp: number;
  duration: number;
  data: Uint8Array;
}) => EncodedAudioChunkLike;

type AudioWindow = Window & {
  AudioContext?: typeof AudioContext;
  AudioEncoder?: EncoderConstructor;
  AudioDecoder?: DecoderConstructor;
  AudioData?: AudioDataConstructor;
  EncodedAudioChunk?: EncodedAudioChunkConstructor;
  webkitAudioContext?: typeof AudioContext;
};

type ListenerState = "off" | "starting" | "ready" | "suspended" | "error";
type PublisherState = "idle" | "starting" | "broadcasting" | "denied" | "blocked" | "no-device" | "unsupported" | "error";

export type AudioSnapshot = {
  listenerState: ListenerState;
  publisherState: PublisherState;
  listenerMessage: string;
  publisherMessage: string;
  sentPackets: number;
  receivedPackets: number;
  decodedFrames: number;
  renderedSamples: number;
  queuedSamples: number;
  renderRms: number;
  queueOverflowResets: number;
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

type ParsedAudioFrame = {
  generation: number;
  sequence: number;
  timestampUs: number;
  durationUs: number;
  packet: Uint8Array;
};

const INITIAL_STATE: AudioSnapshot = {
  listenerState: "off",
  publisherState: "idle",
  listenerMessage: "尚未收聽。接收者先按「開始收聽」啟動播放。",
  publisherMessage: "麥克風尚未啟動。按下開始後，瀏覽器才會詢問麥克風權限。",
  sentPackets: 0,
  receivedPackets: 0,
  decodedFrames: 0,
  renderedSamples: 0,
  queuedSamples: 0,
  renderRms: 0,
  queueOverflowResets: 0,
};

function parseAudioFrame(data: ArrayBuffer): ParsedAudioFrame | null {
  if (data.byteLength < AUDIO_FRAME_HEADER_BYTES + 1 || data.byteLength > AUDIO_FRAME_HEADER_BYTES + MAX_OPUS_PACKET_BYTES) return null;
  const view = new DataView(data);
  for (let index = 0; index < AUDIO_MAGIC.length; index += 1) {
    if (view.getUint8(index) !== AUDIO_MAGIC[index]) return null;
  }
  const timestampUs = view.getFloat64(12, false);
  const durationUs = view.getUint32(20, false);
  if (!Number.isFinite(timestampUs) || timestampUs < 0 || durationUs !== AUDIO_FRAME_DURATION_US) return null;
  return {
    generation: view.getUint32(4, false),
    sequence: view.getUint32(8, false),
    timestampUs,
    durationUs,
    packet: new Uint8Array(data, AUDIO_FRAME_HEADER_BYTES),
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
  private playbackWorklet: AudioWorkletNode | null = null;
  private listenerActive = false;
  private listenerToken = 0;
  private captureAttempt: CaptureAttempt | null = null;
  private captureToken = 0;
  private pendingStart: CaptureAttempt | null = null;
  private publishGeneration: number | null = null;
  private publishSequence = 0;
  private streamGeneration: number | null = null;
  private lastReceivedSequence = -1;
  private decoder: AudioDecoderLike | null = null;
  private decoderEpoch = 0;
  private decoderRequestId = 0;
  private announcedStreamGeneration: number | null = null;

  constructor(socket: WebSocket, onChange: (state: AudioSnapshot) => void) {
    this.socket = socket;
    this.onChange = onChange;
    this.socket.addEventListener("message", this.handleSocketMessage);
    this.socket.addEventListener("close", this.handleSocketClose);
    this.socket.addEventListener("error", this.handleSocketError);
    this.publish();
  }

  snapshot(): AudioSnapshot {
    return { ...this.state };
  }

  startListening(): void {
    if (this.listenerStateIsActive()) {
      if (this.listenerContext?.state === "suspended") this.resumeListening();
      return;
    }
    const token = ++this.listenerToken;
    let context: AudioContext;
    let resumePromise: Promise<void>;
    try {
      context = createAudioContext();
      this.listenerContext = context;
      resumePromise = context.resume();
    } catch (error) {
      this.set({ listenerState: "error", listenerMessage: `無法啟動播放：${errorMessage(error)}` });
      return;
    }
    this.set({ listenerState: "starting", listenerMessage: "正在啟動播放裝置…" });

    void (async () => {
      try {
        await resumePromise;
        if (token !== this.listenerToken || this.listenerContext !== context) return;
        if (context.sampleRate !== AUDIO_SAMPLE_RATE) throw new Error(`瀏覽器建立了 ${context.sampleRate} Hz 音訊時鐘；本輪需要 48000 Hz。`);
        await context.audioWorklet.addModule("/audio-playback-worklet.js");
        if (token !== this.listenerToken || this.listenerContext !== context) return;
        const worklet = new AudioWorkletNode(context, "laitse-playback", {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [AUDIO_CHANNELS],
        });
        worklet.port.onmessage = (event: MessageEvent) => this.handlePlaybackStats(event.data);
        worklet.connect(context.destination);
        this.playbackWorklet = worklet;
        context.onstatechange = () => {
          if (this.listenerContext !== context || !this.listenerActive) return;
          if (context.state === "running") {
            this.set({ listenerState: "ready", listenerMessage: "播放已啟動；尚未收到發布者音訊。" });
          } else if (context.state === "suspended") {
            this.set({ listenerState: "suspended", listenerMessage: "播放目前暫停。按「繼續收聽」恢復播放。" });
          }
        };
        if (!isOpen(this.socket)) throw new Error("房間連線已關閉。");
        this.listenerActive = true;
        this.socket.send(JSON.stringify({ type: "audio.subscribe" }));
        this.set({ listenerState: "ready", listenerMessage: "播放已啟動；正在等待發布者音訊。" });
      } catch (error) {
        if (token !== this.listenerToken) return;
        this.listenerActive = false;
        this.stopListenerResources();
        this.set({ listenerState: "error", listenerMessage: `無法啟動播放：${errorMessage(error)}` });
      }
    })();
  }

  resumeListening(): void {
    const context = this.listenerContext;
    if (!context || !this.listenerActive) {
      this.startListening();
      return;
    }
    const resumePromise = context.resume();
    this.set({ listenerState: "starting", listenerMessage: "正在恢復播放…" });
    void resumePromise.then(() => {
      if (this.listenerContext !== context || !this.listenerActive) return;
      if (this.announcedStreamGeneration !== null) void this.startDecoder(this.announcedStreamGeneration);
      this.set({ listenerState: "ready", listenerMessage: this.streamGeneration === null
        ? "播放已啟動；正在等待發布者音訊。"
        : "播放已恢復，正在接收 Opus 音訊。" });
    }).catch((error: unknown) => {
      if (this.listenerContext !== context) return;
      this.set({ listenerState: "error", listenerMessage: `無法恢復播放：${errorMessage(error)}` });
    });
  }

  stopListening(): void {
    this.listenerToken += 1;
    if (this.listenerActive && isOpen(this.socket)) this.socket.send(JSON.stringify({ type: "audio.unsubscribe" }));
    this.listenerActive = false;
    this.announcedStreamGeneration = null;
    this.stopDecoder();
    this.stopListenerResources();
    this.set({
      listenerState: "off",
      listenerMessage: "已停止收聽。再次開始時，需要重新按播放手勢。",
      receivedPackets: 0,
      decodedFrames: 0,
      renderedSamples: 0,
      queuedSamples: 0,
      renderRms: 0,
      queueOverflowResets: 0,
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

  stopMicrophone(): void {
    const attempt = this.captureAttempt;
    if (attempt) attempt.cancelled = true;
    const generation = this.publishGeneration;
    this.publishGeneration = null;
    this.publishSequence = 0;
    this.captureToken += 1;
    if (generation !== null && isOpen(this.socket)) {
      this.socket.send(JSON.stringify({ type: "audio.stop", generation }));
    }
    if (this.pendingStart && !generation) this.pendingStart.cancelled = true;
    this.pendingStart = null;
    this.captureAttempt = null;
    if (attempt) this.cleanupCapture(attempt);
    this.set({ publisherState: "idle", publisherMessage: "麥克風已停止，新的音訊不再發布。" });
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
    this.announcedStreamGeneration = null;
    this.captureToken += 1;
    this.listenerToken += 1;
    if (this.captureAttempt) this.captureAttempt.cancelled = true;
    if (this.captureAttempt) this.cleanupCapture(this.captureAttempt);
    this.captureAttempt = null;
    this.pendingStart = null;
    this.stopDecoder();
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
      this.set({ publisherMessage: `房間拒絕音訊控制：${String(message.message ?? message.code ?? "protocol error")}` });
      return;
    }
    if (message.type === "audio.started") {
      this.handlePublisherStarted(message);
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
      if (Number.isInteger(generation) && generation > 0 && this.listenerActive) {
        if (generation !== this.announcedStreamGeneration) this.stopDecoder();
        this.announcedStreamGeneration = generation;
        void this.startDecoder(generation);
      }
      return;
    }
    if (message.type === "audio.streamEnded") {
      if (Number(message.generation) === this.announcedStreamGeneration) {
        this.announcedStreamGeneration = null;
        this.stopDecoder();
        this.set({ listenerMessage: "發布者已停止；播放仍保持啟動並等待下一次發布。", queuedSamples: 0, renderRms: 0 });
      }
      return;
    }
    if (message.type === "audio.subscribed") {
      if (this.listenerActive) this.set({ listenerMessage: "已加入接收訂閱；正在等待發布者音訊。" });
      return;
    }
    if (message.type === "audio.unsubscribed") {
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
    if (this.socket.bufferedAmount > MAX_SOCKET_BUFFERED_BYTES) {
      this.failCapture(attempt, new Error("The outgoing audio queue exceeded 64 KiB; publishing stopped."));
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
    const frame = parseAudioFrame(data);
    if (!frame) {
      this.set({ listenerMessage: "收到格式無效的音訊封包；此封包已略過。" });
      return;
    }
    if (frame.generation !== this.streamGeneration || frame.sequence <= this.lastReceivedSequence || !this.decoder) return;
    const Chunk = (window as unknown as AudioWindow).EncodedAudioChunk;
    if (!Chunk) {
      this.set({ listenerState: "error", listenerMessage: "此瀏覽器缺少 WebCodecs EncodedAudioChunk。" });
      return;
    }
    try {
      const chunk = new Chunk({ type: "key", timestamp: frame.timestampUs, duration: frame.durationUs, data: frame.packet });
      this.decoder.decode(chunk);
      this.lastReceivedSequence = frame.sequence;
      this.set({ receivedPackets: this.state.receivedPackets + 1 });
    } catch (error) {
      this.set({ listenerMessage: `Opus 封包無法交給解碼器：${errorMessage(error)}` });
    }
  }

  private async startDecoder(generation: number): Promise<void> {
    if (!this.listenerActive || this.listenerContext?.state !== "running") return;
    if (this.streamGeneration === generation && this.decoder) return;
    const Decoder = (window as unknown as AudioWindow).AudioDecoder;
    if (!Decoder || !this.playbackWorklet) {
      this.set({ listenerState: "error", listenerMessage: "此瀏覽器缺少 WebCodecs AudioDecoder 或播放 AudioWorklet。" });
      return;
    }
    const requestId = ++this.decoderRequestId;
    try {
      const support = await Decoder.isConfigSupported?.(DECODE_CONFIG);
      if (!support?.supported) throw new UnsupportedAudioError("此瀏覽器不支援指定的原生 Opus 解碼設定。" );
      if (
        requestId !== this.decoderRequestId ||
        this.announcedStreamGeneration !== generation ||
        !this.listenerActive ||
        this.listenerContext?.state !== "running"
      ) return;
      this.stopDecoder();
      const epoch = this.decoderEpoch;
      const decoder = new Decoder({
        output: (audioData) => { void this.handleDecodedAudio(epoch, audioData); },
        error: (error) => {
          if (this.decoderEpoch !== epoch) return;
          this.set({ listenerState: "error", listenerMessage: `Opus 解碼失敗：${error.message}` });
        },
      });
      decoder.configure(DECODE_CONFIG);
      this.decoder = decoder;
      this.streamGeneration = generation;
      this.lastReceivedSequence = -1;
      this.playbackWorklet?.port.postMessage({ type: "clear" });
      this.set({ listenerState: "ready", listenerMessage: "已收到發布資料，正在解碼 Opus 音訊。" });
    } catch (error) {
      if (requestId !== this.decoderRequestId || this.announcedStreamGeneration !== generation) return;
      const message = error instanceof UnsupportedAudioError ? error.message : `無法啟動 Opus 解碼器：${errorMessage(error)}`;
      this.set({ listenerState: "error", listenerMessage: message });
    }
  }

  private async handleDecodedAudio(epoch: number, audioData: DecodedAudioData): Promise<void> {
    try {
      if (epoch !== this.decoderEpoch || !this.listenerActive || !this.playbackWorklet) return;
      const samples = new Float32Array(audioData.numberOfFrames);
      await audioData.copyTo(samples, { planeIndex: 0, format: "f32-planar" });
      if (epoch !== this.decoderEpoch || !this.listenerActive || !this.playbackWorklet) return;
      this.playbackWorklet.port.postMessage({ type: "pcm", samples }, [samples.buffer]);
      this.set({ decodedFrames: this.state.decodedFrames + 1 });
    } catch (error) {
      if (epoch === this.decoderEpoch) this.set({ listenerMessage: `無法轉送解碼後音訊到播放佇列：${errorMessage(error)}` });
    } finally {
      audioData.close();
    }
  }

  private handlePlaybackStats(value: unknown): void {
    if (!value || typeof value !== "object") return;
    const stats = value as Record<string, unknown>;
    if (stats.type !== "stats") return;
    this.set({
      renderedSamples: Number.isFinite(stats.renderedSamples) ? Number(stats.renderedSamples) : this.state.renderedSamples,
      queuedSamples: Number.isFinite(stats.queuedSamples) ? Number(stats.queuedSamples) : this.state.queuedSamples,
      renderRms: Number.isFinite(stats.rms) ? Number(stats.rms) : this.state.renderRms,
      queueOverflowResets: Number.isFinite(stats.overflowResets) ? Number(stats.overflowResets) : this.state.queueOverflowResets,
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

  private stopDecoder(): void {
    this.decoderEpoch += 1;
    this.decoderRequestId += 1;
    this.streamGeneration = null;
    this.lastReceivedSequence = -1;
    const decoder = this.decoder;
    this.decoder = null;
    try { if (decoder && decoder.state !== "closed") decoder.close(); } catch {}
    this.playbackWorklet?.port.postMessage({ type: "clear" });
  }

  private stopListenerResources(): void {
    const worklet = this.playbackWorklet;
    this.playbackWorklet = null;
    if (worklet) {
      worklet.port.onmessage = null;
      worklet.port.close();
      try { worklet.disconnect(); } catch {}
    }
    const context = this.listenerContext;
    this.listenerContext = null;
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

  private listenerStateIsActive(): boolean {
    return this.listenerContext !== null || this.state.listenerState === "starting";
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
