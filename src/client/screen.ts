import { MediaTimeline, selectVideoFrameIndex } from "./media-timeline";

const SCREEN_FRAME_HEADER_BYTES = 24;
const MAX_SCREEN_FRAME_PAYLOAD_BYTES = 512 * 1_024;
const MAX_SCREEN_FRAME_BYTES = SCREEN_FRAME_HEADER_BYTES + MAX_SCREEN_FRAME_PAYLOAD_BYTES;
const MAX_SCREEN_SOCKET_BUFFERED_BYTES = 1_536 * 1_024;
const SCREEN_WIDTH_LIMIT = 1_280;
const SCREEN_HEIGHT_LIMIT = 720;
const SCREEN_FRAME_RATE_LIMIT = 15;
const TARGET_FRAME_RATE = 15;
const TARGET_BITRATE = 800_000;
// Cover the 500 ms PCM queue plus bounded device-output lead at 15 fps.
const MAX_DECODED_VIDEO_FRAMES = 16;
const MAX_PENDING_VIDEO_DECODES = 8;
const VIDEO_MAGIC = [0x4c, 0x54, 0x53, 0x31];

type EncodedVideoChunkLike = {
  readonly type: "key" | "delta";
  readonly timestamp: number;
  readonly byteLength: number;
  copyTo(destination: AllowSharedBufferSource): void;
};

type VideoFrameLike = {
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly timestamp: number;
  close(): void;
};

type EncodedVideoChunkConstructor = new (init: {
  type: "key" | "delta";
  timestamp: number;
  data: Uint8Array;
}) => object;

type VideoEncoderLike = {
  readonly state: "unconfigured" | "configured" | "closed";
  readonly encodeQueueSize: number;
  configure(config: Record<string, unknown>): void;
  encode(frame: object, options?: { keyFrame?: boolean }): void;
  close(): void;
};

type VideoDecoderLike = {
  readonly state: "unconfigured" | "configured" | "closed";
  readonly decodeQueueSize: number;
  configure(config: Record<string, unknown>): void;
  decode(chunk: object): void;
  close(): void;
};

type VideoEncoderConstructor = {
  new (callbacks: {
    output: (chunk: EncodedVideoChunkLike, metadata?: unknown) => void;
    error: (error: DOMException) => void;
  }): VideoEncoderLike;
  isConfigSupported?: (config: Record<string, unknown>) => Promise<{ supported: boolean }>;
};

type VideoDecoderConstructor = {
  new (callbacks: {
    output: (frame: VideoFrameLike) => void;
    error: (error: DOMException) => void;
  }): VideoDecoderLike;
};

type VideoFrameConstructor = new (source: CanvasImageSource, init: { timestamp: number }) => object & { close(): void };

type ScreenWindow = Window & {
  VideoEncoder?: VideoEncoderConstructor;
  VideoDecoder?: VideoDecoderConstructor;
  VideoFrame?: VideoFrameConstructor;
  EncodedVideoChunk?: EncodedVideoChunkConstructor;
};

type PublisherState = "idle" | "starting" | "sharing" | "denied" | "blocked" | "unsupported" | "error";
type ReceiverState = "off" | "subscribing" | "waiting" | "rendering" | "error";

export type ScreenTrackSettings = {
  width: number | null;
  height: number | null;
  frameRate: number | null;
  displaySurface: string | null;
};

export type ScreenSnapshot = {
  publisherState: PublisherState;
  receiverState: ReceiverState;
  publisherMessage: string;
  receiverMessage: string;
  trackSettings: ScreenTrackSettings | null;
  encodedWidth: number | null;
  encodedHeight: number | null;
  renderedWidth: number | null;
  renderedHeight: number | null;
  sentFrames: number;
  receivedFrames: number;
  decodedFrames: number;
  renderedFrames: number;
  captureFramesSkipped: number;
  renderFps: number;
  encodeQueueHighWater: number;
  decodeQueueHighWater: number;
  socketQueueHighWaterBytes: number;
  syncMode: "waiting" | "audio-master" | "standalone";
  syncClockId: string | null;
  scheduledSourceClockOffsetMs: number | null;
  droppedDecodedFrames: number;
};

export type ScreenObservation = {
  schemaVersion: 2;
  observedAt: string;
  environment: {
    userAgent: string;
    platform: string;
    secureContext: boolean;
  };
  capture: {
    trackSettingsReportedByBrowser: ScreenTrackSettings | null;
    physicalDisplayVerified: false;
  };
  encoding: {
    codec: "vp8";
    targetWidth: number;
    targetHeight: number;
    targetFrameRate: number;
    targetBitrateBps: number;
    sentFrames: number;
    captureFramesSkipped: number;
    encodeQueueHighWater: number;
    socketQueueHighWaterBytes: number;
  };
  rendering: {
    state: ReceiverState;
    width: number | null;
    height: number | null;
    receivedFrames: number;
    decodedFrames: number;
    renderedFrames: number;
    rollingFiveSecondRenderedFps: number;
    decodeQueueHighWater: number;
  };
  audioVideoSync: {
    mode: "waiting" | "audio-master" | "standalone";
    matchingAudioPublisherClock: boolean;
    scheduledSourceClockOffsetMs: number | null;
    audioMaster: {
      generation: number;
      sourceTimestampUs: number;
      receiverPerformanceTimeMs: number;
      mapping: "output-timestamp" | "graph-estimate";
      observationWindowMs: number;
      mappingErrorBoundMs: null;
    } | null;
    recentAudioPulseEvents: ReturnType<MediaTimeline["getPulseEvents"]>;
    queuedDecodedFrames: number;
    maximumQueuedDecodedFrames: number;
  };
  resources: {
    browserJsHeapBytes: { used: number; total: number; limit: number } | null;
    browserJsHeapScope: "browser-reported JavaScript heap only; excludes media/GPU/process memory";
  };
  evidence: {
    endToEndLatencyMs: null;
    lateJoinSynchronization: "keyframe-gated-with-config-metadata";
    serverCpuAndMemory: "not-collected-in-browser";
    sourceAttribution: "track settings are browser-reported and do not prove a physical display was selected";
  };
};

export const INITIAL_SCREEN_STATE: ScreenSnapshot = {
  publisherState: "idle",
  receiverState: "off",
  publisherMessage: "尚未分享畫面。按開始後，瀏覽器會顯示擷取來源選擇器。",
  receiverMessage: "尚未加入畫面接收。請在分享開始前加入；晚加入同步尚未實作。",
  trackSettings: null,
  encodedWidth: null,
  encodedHeight: null,
  renderedWidth: null,
  renderedHeight: null,
  sentFrames: 0,
  receivedFrames: 0,
  decodedFrames: 0,
  renderedFrames: 0,
  captureFramesSkipped: 0,
  renderFps: 0,
  encodeQueueHighWater: 0,
  decodeQueueHighWater: 0,
  socketQueueHighWaterBytes: 0,
  syncMode: "waiting",
  syncClockId: null,
  scheduledSourceClockOffsetMs: null,
  droppedDecodedFrames: 0,
};

type StartWaiter = {
  token: number;
  resolve: (generation: number) => void;
  reject: (error: Error) => void;
  cancelled: boolean;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isOpen(socket: WebSocket): boolean {
  return socket.readyState === WebSocket.OPEN;
}

function classifyCaptureError(error: unknown): { state: PublisherState; prefix: string } {
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")) {
    return { state: "denied", prefix: "已取消或拒絕畫面擷取；沒有建立分享。" };
  }
  if (error instanceof DOMException && error.name === "SecurityError") {
    return { state: "blocked", prefix: "瀏覽器安全內容或政策阻止了畫面擷取。" };
  }
  return { state: "error", prefix: "無法開始畫面分享。" };
}

function makeTrackSettings(track: MediaStreamTrack): ScreenTrackSettings {
  const settings = track.getSettings();
  const displaySurface = "displaySurface" in settings && typeof settings.displaySurface === "string"
    ? settings.displaySurface
    : null;
  return {
    width: Number.isFinite(settings.width) ? settings.width ?? null : null,
    height: Number.isFinite(settings.height) ? settings.height ?? null : null,
    frameRate: Number.isFinite(settings.frameRate) ? settings.frameRate ?? null : null,
    displaySurface,
  };
}

function encoderSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, SCREEN_WIDTH_LIMIT / width, SCREEN_HEIGHT_LIMIT / height);
  return {
    width: Math.max(2, Math.floor((width * scale) / 2) * 2),
    height: Math.max(2, Math.floor((height * scale) / 2) * 2),
  };
}

function matchesMagic(bytes: Uint8Array): boolean {
  return bytes.byteLength >= VIDEO_MAGIC.length && VIDEO_MAGIC.every((value, index) => bytes[index] === value);
}

function browserJsHeapSample(): { used: number; total: number; limit: number } | null {
  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number };
  }).memory;
  if (!memory) return null;
  const { usedJSHeapSize, totalJSHeapSize, jsHeapSizeLimit } = memory;
  if (![usedJSHeapSize, totalJSHeapSize, jsHeapSizeLimit].every((value) => Number.isFinite(value))) return null;
  return { used: usedJSHeapSize!, total: totalJSHeapSize!, limit: jsHeapSizeLimit! };
}

export class ScreenController {
  private readonly socket: WebSocket;
  private readonly canvas: HTMLCanvasElement;
  private readonly onChange: (state: ScreenSnapshot) => void;
  private readonly timeline: MediaTimeline;
  private readonly unsubscribeTimeline: () => void;
  private state: ScreenSnapshot = { ...INITIAL_SCREEN_STATE };
  private captureStream: MediaStream | null = null;
  private captureTrack: MediaStreamTrack | null = null;
  private trackEndedHandler: (() => void) | null = null;
  private sourceVideo: HTMLVideoElement | null = null;
  private captureCanvas: HTMLCanvasElement | null = null;
  private encoder: VideoEncoderLike | null = null;
  private decoder: VideoDecoderLike | null = null;
  private publisherGeneration: number | null = null;
  private publisherSequence = 0;
  private publisherToken = 0;
  private pendingStart: StartWaiter | null = null;
  private animationFrameId: number | null = null;
  private renderAnimationFrameId: number | null = null;
  private lastCaptureAt = 0;
  private lastKeyframeAt = 0;
  private forceKeyframe = true;
  private captureFramesSkipped = 0;
  private decodeGeneration: number | null = null;
  private decoderEpoch = 0;
  private activeClockId: string | null = null;
  private readonly decodedFrameQueue: VideoFrameLike[] = [];
  private receivedFrames = 0;
  private readonly renderedAt: number[] = [];

  constructor(socket: WebSocket, canvas: HTMLCanvasElement, timeline: MediaTimeline, onChange: (state: ScreenSnapshot) => void) {
    this.socket = socket;
    this.canvas = canvas;
    this.timeline = timeline;
    this.onChange = onChange;
    this.socket.addEventListener("message", this.handleSocketMessage);
    this.socket.addEventListener("close", this.handleSocketClose);
    this.unsubscribeTimeline = timeline.subscribe(() => this.scheduleRenderFrames());
    this.publish();
  }

  snapshot(): ScreenSnapshot {
    return { ...this.state, trackSettings: this.state.trackSettings ? { ...this.state.trackSettings } : null };
  }

  getObservation(): ScreenObservation {
    const state = this.snapshot();
    return {
      schemaVersion: 2,
      observedAt: new Date().toISOString(),
      environment: {
        userAgent: navigator.userAgent.slice(0, 256),
        platform: navigator.platform.slice(0, 100),
        secureContext: window.isSecureContext,
      },
      capture: {
        trackSettingsReportedByBrowser: state.trackSettings,
        physicalDisplayVerified: false,
      },
      encoding: {
        codec: "vp8",
        targetWidth: state.encodedWidth ?? 0,
        targetHeight: state.encodedHeight ?? 0,
        targetFrameRate: TARGET_FRAME_RATE,
        targetBitrateBps: TARGET_BITRATE,
        sentFrames: state.sentFrames,
        captureFramesSkipped: state.captureFramesSkipped,
        encodeQueueHighWater: state.encodeQueueHighWater,
        socketQueueHighWaterBytes: state.socketQueueHighWaterBytes,
      },
      rendering: {
        state: state.receiverState,
        width: state.renderedWidth,
        height: state.renderedHeight,
        receivedFrames: state.receivedFrames,
        decodedFrames: state.decodedFrames,
        renderedFrames: state.renderedFrames,
        rollingFiveSecondRenderedFps: state.renderFps,
        decodeQueueHighWater: state.decodeQueueHighWater,
      },
      audioVideoSync: {
        mode: state.syncMode,
        matchingAudioPublisherClock: Boolean(this.activeClockId && this.timeline.getActiveAudioStream()?.clockId === this.activeClockId),
        scheduledSourceClockOffsetMs: state.scheduledSourceClockOffsetMs,
        audioMaster: (() => {
          const master = this.timeline.getAudioMaster(this.activeClockId, performance.now());
          return master ? {
            generation: master.generation,
            sourceTimestampUs: master.sourceTimestampUs,
            receiverPerformanceTimeMs: master.receiverPerformanceTimeMs,
            mapping: master.mapping,
            observationWindowMs: master.observationWindowMs,
            mappingErrorBoundMs: null,
          } : null;
        })(),
        recentAudioPulseEvents: this.activeClockId ? this.timeline.getPulseEvents(this.activeClockId) : [],
        queuedDecodedFrames: this.decodedFrameQueue.length,
        maximumQueuedDecodedFrames: MAX_DECODED_VIDEO_FRAMES,
      },
      resources: {
        browserJsHeapBytes: browserJsHeapSample(),
        browserJsHeapScope: "browser-reported JavaScript heap only; excludes media/GPU/process memory",
      },
      evidence: {
        endToEndLatencyMs: null,
        lateJoinSynchronization: "keyframe-gated-with-config-metadata",
        serverCpuAndMemory: "not-collected-in-browser",
        sourceAttribution: "track settings are browser-reported and do not prove a physical display was selected",
      },
    };
  }

  startWatching(): void {
    if (this.state.receiverState === "subscribing" || this.state.receiverState === "waiting" || this.state.receiverState === "rendering") return;
    if (!isOpen(this.socket)) {
      this.set({ receiverState: "error", receiverMessage: "房間連線已關閉，無法加入畫面接收。" });
      return;
    }
    this.clearCanvas();
    this.stopDecoder();
    this.receivedFrames = 0;
    this.renderedAt.length = 0;
    this.set({
      receiverState: "subscribing",
      receiverMessage: "正在加入畫面接收；若分享已進行，會等待下一個可解碼關鍵影格。",
      receivedFrames: 0,
      decodedFrames: 0,
      renderedFrames: 0,
      renderedWidth: null,
      renderedHeight: null,
      renderFps: 0,
      decodeQueueHighWater: 0,
      syncMode: "waiting",
      syncClockId: null,
      scheduledSourceClockOffsetMs: null,
      droppedDecodedFrames: 0,
    });
    this.socket.send(JSON.stringify({ type: "screen.subscribe" }));
  }

  stopWatching(): void {
    const active = this.state.receiverState !== "off";
    if (active && isOpen(this.socket)) this.socket.send(JSON.stringify({ type: "screen.unsubscribe" }));
    this.stopDecoder();
    this.clearCanvas();
    this.renderedAt.length = 0;
    this.set({
      receiverState: "off",
      receiverMessage: "已停止接收並清除畫面。",
      renderedWidth: null,
      renderedHeight: null,
      renderFps: 0,
      syncMode: "waiting",
      syncClockId: null,
      scheduledSourceClockOffsetMs: null,
    });
  }

  async startShare(): Promise<void> {
    if (this.state.publisherState === "starting" || this.state.publisherState === "sharing") return;
    if (!window.isSecureContext) {
      this.set({ publisherState: "blocked", publisherMessage: "畫面擷取需要可信 HTTPS 或瀏覽器 localhost 安全內容。" });
      return;
    }
    const mediaDevices = navigator.mediaDevices;
    const screenWindow = window as unknown as ScreenWindow;
    if (!mediaDevices || typeof mediaDevices.getDisplayMedia !== "function") {
      this.set({ publisherState: "unsupported", publisherMessage: "此瀏覽器沒有 getDisplayMedia 畫面擷取 API。" });
      return;
    }
    if (!screenWindow.VideoEncoder || !screenWindow.VideoDecoder || !screenWindow.VideoFrame || !screenWindow.EncodedVideoChunk) {
      this.set({ publisherState: "unsupported", publisherMessage: "此瀏覽器缺少本輪 VP8 WebCodecs 編解碼 API。" });
      return;
    }

    const token = ++this.publisherToken;
    this.resetPublisherMetrics();
    this.set({ publisherState: "starting", publisherMessage: "正在要求瀏覽器選擇分享來源…" });
    let permissionRequest: Promise<MediaStream>;
    try {
      // This call stays directly in the user-activated handler, before async codec checks.
      permissionRequest = mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: SCREEN_FRAME_RATE_LIMIT, max: SCREEN_FRAME_RATE_LIMIT } },
        audio: false,
      });
    } catch (error) {
      const classified = classifyCaptureError(error);
      this.set({ publisherState: classified.state, publisherMessage: `${classified.prefix} ${errorMessage(error)}` });
      return;
    }

    try {
      const stream = await permissionRequest;
      if (token !== this.publisherToken) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.captureStream = stream;
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error("瀏覽器沒有提供可用的畫面影像 track。");
      this.captureTrack = track;
      this.trackEndedHandler = () => this.stopShare("瀏覽器已停止來源；畫面發布已結束。");
      track.addEventListener("ended", this.trackEndedHandler, { once: true });
      if (track.readyState !== "live") throw new Error("畫面來源在初始化前已結束。");
      const settings = makeTrackSettings(track);
      if (!settings.width || !settings.height) throw new Error("瀏覽器未回報擷取寬高，無法建立有界 VP8 編碼畫布。");
      const encoded = encoderSize(settings.width, settings.height);
      this.set({
        trackSettings: settings,
        encodedWidth: encoded.width,
        encodedHeight: encoded.height,
        publisherMessage: "已取得瀏覽器回報的來源 track；正在設定 VP8 編碼。",
      });

      const video = document.createElement("video");
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.srcObject = stream;
      this.sourceVideo = video;
      const captureCanvas = document.createElement("canvas");
      captureCanvas.width = encoded.width;
      captureCanvas.height = encoded.height;
      this.captureCanvas = captureCanvas;
      const context = captureCanvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("無法建立畫面編碼 Canvas 2D context。");
      await video.play();
      if (token !== this.publisherToken) return;
      if (track.readyState !== "live") throw new Error("畫面來源已結束，沒有開始發布。");

      const Encoder = screenWindow.VideoEncoder;
      if (!Encoder) throw new UnsupportedScreenError("此瀏覽器沒有 WebCodecs VideoEncoder。");
      const config = {
        codec: "vp8",
        width: encoded.width,
        height: encoded.height,
        bitrate: TARGET_BITRATE,
        framerate: TARGET_FRAME_RATE,
        latencyMode: "realtime",
      };
      const support = await Encoder.isConfigSupported?.(config);
      if (!support?.supported) throw new UnsupportedScreenError("此瀏覽器不支援本輪 VP8 編碼設定。");
      if (token !== this.publisherToken) return;

      const encoder = new Encoder({
        output: (chunk) => this.handleEncodedChunk(token, chunk),
        error: (error) => this.failShare(token, `VP8 編碼失敗：${error.message}`),
      });
      encoder.configure(config);
      this.encoder = encoder;

      if (token !== this.publisherToken || track.readyState !== "live") {
        this.cleanupPublisherResources();
        return;
      }
      const generation = await this.requestStart(token, encoded.width, encoded.height);
      if (token !== this.publisherToken) {
        if (isOpen(this.socket)) this.socket.send(JSON.stringify({ type: "screen.stop", generation }));
        this.cleanupPublisherResources();
        return;
      }
      this.publisherGeneration = generation;
      this.publisherSequence = 0;
      this.lastCaptureAt = 0;
      this.lastKeyframeAt = 0;
      this.forceKeyframe = true;
      this.set({ publisherState: "sharing", publisherMessage: "正在傳送瀏覽器選取的畫面；track 設定會標示來源回報值，編碼檔位與接收呈現另行觀測。" });
      this.animationFrameId = requestAnimationFrame(this.captureFrame);
    } catch (error) {
      if (token !== this.publisherToken) return;
      const classified = classifyCaptureError(error);
      const isDenied = classified.state === "denied";
      this.cleanupPublisherResources();
      this.publisherGeneration = null;
      this.set({
        publisherState: isDenied ? "denied" : (error instanceof UnsupportedScreenError ? "unsupported" : "error"),
        publisherMessage: isDenied ? `${classified.prefix} ${errorMessage(error)}` : `無法開始畫面分享：${errorMessage(error)}`,
      });
    }
  }

  replaceShareSource(): void {
    if (this.state.publisherState !== "sharing") return;
    this.stopShare("正在更換分享來源；新來源啟動時會建立新世代，語音維持獨立。");
    void this.startShare();
  }

  stopShare(message = "已停止畫面分享並釋放擷取與編碼資源。", notifyServer = true): void {
    this.publisherToken += 1;
    const waiter = this.pendingStart;
    if (waiter) {
      waiter.cancelled = true;
      this.pendingStart = null;
      waiter.reject(new Error("畫面分享啟動已取消。"));
    }
    const generation = this.publisherGeneration;
    this.publisherGeneration = null;
    if (notifyServer && generation !== null && isOpen(this.socket)) this.socket.send(JSON.stringify({ type: "screen.stop", generation }));
    this.cleanupPublisherResources();
    this.set({ publisherState: "idle", publisherMessage: message });
  }

  downloadObservation(): void {
    const observation = this.getObservation();
    const blob = new Blob([`${JSON.stringify(observation, null, 2)}\n`], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `laitse-screen-observation-${observation.observedAt.replace(/[:.]/gu, "-")}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  dispose(): void {
    this.socket.removeEventListener("message", this.handleSocketMessage);
    this.socket.removeEventListener("close", this.handleSocketClose);
    this.stopShare("房間連線已關閉，畫面發布已停止。");
    this.stopWatching();
    this.unsubscribeTimeline();
  }

  private publish(): void {
    this.onChange(this.snapshot());
  }

  private set(patch: Partial<ScreenSnapshot>): void {
    this.state = { ...this.state, ...patch };
    this.publish();
  }

  private resetPublisherMetrics(): void {
    this.set({
      trackSettings: null,
      encodedWidth: null,
      encodedHeight: null,
      sentFrames: 0,
      captureFramesSkipped: 0,
      encodeQueueHighWater: 0,
      socketQueueHighWaterBytes: 0,
    });
  }

  private requestStart(token: number, width: number, height: number): Promise<number> {
    if (!isOpen(this.socket)) return Promise.reject(new Error("房間連線已關閉，無法開始畫面發布。"));
    return new Promise((resolve, reject) => {
      this.pendingStart = { token, resolve, reject, cancelled: false };
      this.socket.send(JSON.stringify({
        type: "screen.start",
        codec: "vp8",
        width,
        height,
        frameRate: TARGET_FRAME_RATE,
        bitrate: TARGET_BITRATE,
      }));
    });
  }

  private readonly captureFrame = (now: number): void => {
    this.animationFrameId = null;
    const token = this.publisherToken;
    const video = this.sourceVideo;
    const canvas = this.captureCanvas;
    const encoder = this.encoder;
    const screenWindow = window as unknown as ScreenWindow;
    if (
      this.publisherGeneration === null ||
      this.state.publisherState !== "sharing" ||
      !video || !canvas || !encoder || encoder.state !== "configured" ||
      !screenWindow.VideoFrame || !isOpen(this.socket)
    ) return;

    // stop() changes readyState without firing ended; also handle a missed source event.
    if (this.captureTrack?.readyState !== "live") {
      this.stopShare("畫面來源已結束；畫面發布已停止。");
      return;
    }

    const intervalMs = 1_000 / TARGET_FRAME_RATE;
    if (now - this.lastCaptureAt < intervalMs || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      this.animationFrameId = requestAnimationFrame(this.captureFrame);
      return;
    }
    this.lastCaptureAt = now;

    if (this.socket.bufferedAmount > MAX_SCREEN_SOCKET_BUFFERED_BYTES / 2 || encoder.encodeQueueSize >= 2) {
      this.captureFramesSkipped += 1;
      this.forceKeyframe = true;
      this.set({ captureFramesSkipped: this.captureFramesSkipped, encodeQueueHighWater: Math.max(this.state.encodeQueueHighWater, encoder.encodeQueueSize) });
      this.animationFrameId = requestAnimationFrame(this.captureFrame);
      return;
    }

    try {
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("畫面編碼 Canvas context 已關閉。");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const timestamp = Math.max(0, Math.floor(performance.now() * 1_000));
      const frame = new screenWindow.VideoFrame(canvas, { timestamp });
      const keyFrame = this.forceKeyframe || now - this.lastKeyframeAt >= 2_000;
      try {
        encoder.encode(frame, { keyFrame });
      } finally {
        frame.close();
      }
      if (keyFrame) {
        this.forceKeyframe = false;
        this.lastKeyframeAt = now;
      }
      this.set({ encodeQueueHighWater: Math.max(this.state.encodeQueueHighWater, encoder.encodeQueueSize) });
    } catch (error) {
      this.failShare(token, `畫面擷取或送入 VP8 編碼器失敗：${errorMessage(error)}`);
      return;
    }
    this.animationFrameId = requestAnimationFrame(this.captureFrame);
  };

  private handleEncodedChunk(token: number, chunk: EncodedVideoChunkLike): void {
    if (token !== this.publisherToken || this.publisherGeneration === null || !isOpen(this.socket)) return;
    if (!Number.isFinite(chunk.timestamp) || chunk.timestamp < 0 || chunk.byteLength < 1 || chunk.byteLength > MAX_SCREEN_FRAME_PAYLOAD_BYTES) {
      this.failShare(token, "VP8 編碼器輸出了空封包、超界封包或無效 timestamp；已停止分享保護佇列。" );
      return;
    }
    const nextBufferedBytes = this.socket.bufferedAmount + SCREEN_FRAME_HEADER_BYTES + chunk.byteLength;
    if (nextBufferedBytes > MAX_SCREEN_SOCKET_BUFFERED_BYTES) {
      this.failShare(token, "畫面 WebSocket 佇列超過 1.5 MiB；已停止分享以維持有界傳輸。" );
      return;
    }
    const payload = new Uint8Array(chunk.byteLength);
    try {
      chunk.copyTo(payload);
      const packet = new Uint8Array(SCREEN_FRAME_HEADER_BYTES + payload.byteLength);
      packet.set(VIDEO_MAGIC, 0);
      const view = new DataView(packet.buffer);
      view.setUint32(4, this.publisherGeneration, false);
      view.setUint32(8, this.publisherSequence, false);
      view.setFloat64(12, chunk.timestamp, false);
      packet[20] = chunk.type === "key" ? 0 : 1;
      packet.set(payload, SCREEN_FRAME_HEADER_BYTES);
      this.socket.send(packet);
      this.publisherSequence += 1;
      this.set({
        sentFrames: this.state.sentFrames + 1,
        socketQueueHighWaterBytes: Math.max(this.state.socketQueueHighWaterBytes, nextBufferedBytes),
      });
    } catch (error) {
      this.failShare(token, `畫面封包無法送出：${errorMessage(error)}`);
    }
  }

  private failShare(token: number, message: string): void {
    if (token !== this.publisherToken) return;
    this.stopShare(message);
    this.set({ publisherState: "error", publisherMessage: message });
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

    if (message.type === "screen.started") {
      const generation = Number(message.generation);
      const waiter = this.pendingStart;
      if (!Number.isInteger(generation) || generation < 1 || !waiter) {
        if (Number.isInteger(generation) && generation > 0 && isOpen(this.socket)) {
          this.socket.send(JSON.stringify({ type: "screen.stop", generation }));
        }
        return;
      }
      this.pendingStart = null;
      if (waiter.cancelled || waiter.token !== this.publisherToken) {
        if (isOpen(this.socket)) this.socket.send(JSON.stringify({ type: "screen.stop", generation }));
        waiter.reject(new Error("畫面分享啟動已取消。"));
        return;
      }
      waiter.resolve(generation);
      return;
    }
    if (message.type === "screen.publishRevoked" || message.type === "host.publishRevoked") {
      this.stopShare(message.reason === "session_ended"
        ? "目前活動已結束；畫面擷取已停止。"
        : "主持人已撤銷發布權；畫面擷取已停止。", false);
      return;
    }
    if (message.type === "screen.keyframeRequest") {
      if (Number(message.generation) === this.publisherGeneration && this.state.publisherState === "sharing") {
        this.forceKeyframe = true;
      }
      return;
    }
    if (message.type === "screen.error") {
      const error = new Error(String(message.message ?? message.code ?? "房間無法開始畫面分享。"));
      if (this.pendingStart) {
        const waiter = this.pendingStart;
        this.pendingStart = null;
        waiter.reject(error);
      }
      if (message.code === "late_join_not_supported") {
        this.set({ receiverState: "error", receiverMessage: error.message });
      } else if (message.code === "publisher_exists") {
        this.set({ publisherState: "error", publisherMessage: error.message });
      }
      return;
    }
    if (message.type === "screen.subscribed") {
      if (this.state.receiverState === "subscribing") {
        this.set({ receiverState: "waiting", receiverMessage: "已加入接收；等待發布者開始分享。" });
      }
      return;
    }
    if (message.type === "screen.unsubscribed") return;
    if (message.type === "screen.stream") {
      this.handleStreamStarted(message);
      return;
    }
    if (message.type === "screen.streamEnded") {
      if (Number(message.generation) === this.decodeGeneration) {
        this.stopDecoder();
        this.clearCanvas();
        this.renderedAt.length = 0;
        this.set({
          receiverState: this.state.receiverState === "off" ? "off" : "waiting",
          receiverMessage: message.reason === "permission_revoked"
            ? "主持人已撤銷發布權；畫面已清除，正在等待下一次分享。"
            : message.reason === "session_ended"
              ? "活動已結束；畫面已清除，正在等待新的活動。"
              : "發布者已停止；畫面已清除，正在等待下一次分享。",
          renderedWidth: null,
          renderedHeight: null,
          renderFps: 0,
          syncMode: "waiting",
          syncClockId: null,
          scheduledSourceClockOffsetMs: null,
        });
      }
      return;
    }
    if (message.type === "screen.stopped") return;
    if (message.type === "protocol.error" && this.state.publisherState === "starting") {
      const waiter = this.pendingStart;
      this.pendingStart = null;
      waiter?.reject(new Error(String(message.message ?? "房間拒絕畫面控制。")));
    }
  };

  private handleStreamStarted(message: Record<string, unknown>): void {
    const generation = Number(message.generation);
    const width = Number(message.width);
    const height = Number(message.height);
    const clockId = typeof message.clockId === "string" ? message.clockId : "";
    if (
      !Number.isInteger(generation) || generation < 1 ||
      !Number.isInteger(width) || width < 1 || width > SCREEN_WIDTH_LIMIT ||
      !Number.isInteger(height) || height < 1 || height > SCREEN_HEIGHT_LIMIT ||
      message.codec !== "vp8" || clockId.length === 0
    ) {
      this.set({ receiverState: "error", receiverMessage: "伺服器分享設定格式無效。" });
      return;
    }
    if (this.state.receiverState === "off") return;
    this.stopDecoder();
    this.activeClockId = clockId;
    const Decoder = (window as unknown as ScreenWindow).VideoDecoder;
    if (!Decoder) {
      this.set({ receiverState: "error", receiverMessage: "此瀏覽器沒有 WebCodecs VideoDecoder。" });
      return;
    }
    try {
      const epoch = this.decoderEpoch;
      const decoder = new Decoder({
        output: (frame) => this.handleDecodedFrame(epoch, generation, frame),
        error: (error) => {
          if (this.decoderEpoch !== epoch) return;
          this.stopDecoder();
          this.clearCanvas();
          this.set({ receiverState: "error", receiverMessage: `VP8 解碼失敗：${error.message}` });
        },
      });
      decoder.configure({ codec: "vp8", codedWidth: width, codedHeight: height });
      this.decoder = decoder;
      this.decodeGeneration = generation;
      this.receivedFrames = 0;
      this.renderedAt.length = 0;
      this.set({
        receiverState: "waiting",
        receiverMessage: `已收到 VP8 設定 ${width}×${height}；伺服器會等關鍵影格再轉送，音訊同時訂閱時依同發布者時鐘呈現。`,
        receivedFrames: 0,
        decodedFrames: 0,
        renderedFrames: 0,
        renderedWidth: null,
        renderedHeight: null,
        renderFps: 0,
        decodeQueueHighWater: 0,
        syncMode: "waiting",
        syncClockId: clockId,
        scheduledSourceClockOffsetMs: null,
        droppedDecodedFrames: 0,
      });
    } catch (error) {
      this.set({ receiverState: "error", receiverMessage: `無法設定 VP8 解碼器：${errorMessage(error)}` });
    }
  }

  private handleBinaryFrame(data: ArrayBuffer): void {
    const bytes = new Uint8Array(data);
    if (!matchesMagic(bytes)) return;
    if (
      bytes.byteLength < SCREEN_FRAME_HEADER_BYTES + 1 || bytes.byteLength > MAX_SCREEN_FRAME_BYTES ||
      bytes[21] !== 0 || bytes[22] !== 0 || bytes[23] !== 0
    ) {
      this.set({ receiverState: "error", receiverMessage: "收到超界或格式錯誤的畫面影格。" });
      return;
    }
    const view = new DataView(data);
    const generation = view.getUint32(4, false);
    const sequence = view.getUint32(8, false);
    const timestamp = view.getFloat64(12, false);
    const chunkType = bytes[20];
    if (generation !== this.decodeGeneration || !Number.isFinite(timestamp) || timestamp < 0 || (chunkType !== 0 && chunkType !== 1)) return;
    const decoder = this.decoder;
    const Chunk = (window as unknown as ScreenWindow).EncodedVideoChunk;
    if (!decoder || !Chunk) return;
    if (decoder.decodeQueueSize >= MAX_PENDING_VIDEO_DECODES) {
      this.stopWatching();
      this.set({ receiverState: "error", receiverMessage: "解碼器待處理達 8 個影格；已停止接收並清除畫面以維持有界資源。" });
      return;
    }
    try {
      const payload = bytes.slice(SCREEN_FRAME_HEADER_BYTES);
      const chunk = new Chunk({ type: chunkType === 0 ? "key" : "delta", timestamp, data: payload });
      decoder.decode(chunk);
      this.receivedFrames += 1;
      this.set({
        receiverState: this.state.receiverState === "error" ? "error" : "rendering",
        receiverMessage: "正在解碼並呈現 VP8 畫面；fps 是最近 5 秒的本機 render 計數。",
        receivedFrames: this.receivedFrames,
        decodeQueueHighWater: Math.max(this.state.decodeQueueHighWater, decoder.decodeQueueSize),
      });
    } catch (error) {
      this.stopWatching();
      this.set({ receiverState: "error", receiverMessage: `畫面影格無法交給 VP8 解碼器：${errorMessage(error)}` });
    }
  }

  private handleDecodedFrame(epoch: number, generation: number, frame: VideoFrameLike): void {
    if (epoch !== this.decoderEpoch || generation !== this.decodeGeneration || this.state.receiverState === "off") {
      frame.close();
      return;
    }
    if (!Number.isFinite(frame.timestamp) || frame.timestamp < 0) {
      frame.close();
      this.set({ receiverState: "error", receiverMessage: "VP8 解碼影格沒有有效時間戳；已略過。" });
      return;
    }
    this.decodedFrameQueue.push(frame);
    this.decodedFrameQueue.sort((left, right) => left.timestamp - right.timestamp);
    while (this.decodedFrameQueue.length > MAX_DECODED_VIDEO_FRAMES) {
      this.decodedFrameQueue.shift()?.close();
      this.set({ droppedDecodedFrames: this.state.droppedDecodedFrames + 1 });
    }
    this.set({ decodedFrames: this.state.decodedFrames + 1 });
    this.scheduleRenderFrames();
  }

  private scheduleRenderFrames(): void {
    if (this.renderAnimationFrameId !== null || this.decodedFrameQueue.length === 0 || this.state.receiverState === "off") return;
    this.renderAnimationFrameId = requestAnimationFrame(this.renderQueuedFrames);
  }

  private readonly renderQueuedFrames = (): void => {
    this.renderAnimationFrameId = null;
    if (this.decodedFrameQueue.length === 0 || this.state.receiverState === "off") return;
    const now = performance.now();
    const audioMaster = this.timeline.getAudioMaster(this.activeClockId, now);
    if (audioMaster && audioMaster.receiverPerformanceTimeMs > now) {
      this.scheduleRenderFrames();
      return;
    }
    const selectedIndex = selectVideoFrameIndex(
      this.decodedFrameQueue.map((frame) => frame.timestamp),
      audioMaster?.sourceTimestampUs ?? null,
    );

    if (selectedIndex >= 0) {
      for (let index = 0; index < selectedIndex; index += 1) {
        this.decodedFrameQueue.shift()?.close();
        this.set({ droppedDecodedFrames: this.state.droppedDecodedFrames + 1 });
      }
      const frame = this.decodedFrameQueue.shift();
      if (frame) this.renderFrame(frame, audioMaster);
    }
    this.scheduleRenderFrames();
  };

  private renderFrame(frame: VideoFrameLike, audioMaster: ReturnType<MediaTimeline["getAudioMaster"]>): void {
    try {
      const context = this.canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("接收 Canvas context 已關閉。");
      if (this.canvas.width !== frame.displayWidth || this.canvas.height !== frame.displayHeight) {
        this.canvas.width = frame.displayWidth;
        this.canvas.height = frame.displayHeight;
      }
      context.drawImage(frame as unknown as CanvasImageSource, 0, 0, frame.displayWidth, frame.displayHeight);
      const now = performance.now();
      this.renderedAt.push(now);
      while (this.renderedAt.length > 75 || (this.renderedAt[0] !== undefined && now - this.renderedAt[0] > 5_000)) this.renderedAt.shift();
      const elapsedMs = this.renderedAt.length < 2 ? 0 : Math.max(1, now - (this.renderedAt[0] ?? now));
      const renderFps = elapsedMs === 0 ? 0 : Number((((this.renderedAt.length - 1) * 1_000) / elapsedMs).toFixed(2));
      const scheduledSourceClockOffsetMs = audioMaster ? Math.max(0, (audioMaster.sourceTimestampUs - frame.timestamp) / 1_000) : null;
      this.set({
        receiverState: "rendering",
        receiverMessage: audioMaster
          ? "依同一發布者時鐘取樣音訊播放位置呈現；主時鐘失去新樣本或不同來源時回到獨立顯示。"
          : "畫面以獨立模式呈現；尚無同發布者且新鮮的音訊播放時鐘。",
        renderedFrames: this.state.renderedFrames + 1,
        renderedWidth: frame.displayWidth,
        renderedHeight: frame.displayHeight,
        renderFps,
        syncMode: audioMaster ? "audio-master" : "standalone",
        syncClockId: this.activeClockId,
        scheduledSourceClockOffsetMs,
      });
    } catch (error) {
      this.set({ receiverState: "error", receiverMessage: `畫面已解碼但無法繪製：${errorMessage(error)}` });
      this.clearCanvas();
    } finally {
      frame.close();
    }
  }

  private stopDecoder(): void {
    this.decoderEpoch += 1;
    if (this.renderAnimationFrameId !== null) cancelAnimationFrame(this.renderAnimationFrameId);
    this.renderAnimationFrameId = null;
    while (this.decodedFrameQueue.length > 0) this.decodedFrameQueue.shift()?.close();
    const decoder = this.decoder;
    this.decoder = null;
    this.decodeGeneration = null;
    this.activeClockId = null;
    if (!decoder || decoder.state === "closed") return;
    try { decoder.close(); } catch { /* Decoder may have closed after an error callback. */ }
  }

  private clearCanvas(): void {
    const context = this.canvas.getContext("2d");
    context?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.canvas.width = 0;
    this.canvas.height = 0;
  }

  private cleanupPublisherResources(): void {
    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = null;
    if (this.captureTrack && this.trackEndedHandler) this.captureTrack.removeEventListener("ended", this.trackEndedHandler);
    this.trackEndedHandler = null;
    this.captureStream?.getTracks().forEach((track) => {
      if (track.readyState !== "ended") track.stop();
    });
    this.captureTrack = null;
    this.captureStream = null;
    if (this.sourceVideo) {
      this.sourceVideo.pause();
      this.sourceVideo.srcObject = null;
    }
    this.sourceVideo = null;
    this.captureCanvas = null;
    const encoder = this.encoder;
    this.encoder = null;
    if (encoder && encoder.state !== "closed") {
      try { encoder.close(); } catch { /* Encoder may be closing after an error callback. */ }
    }
  }

  private readonly handleSocketClose = (): void => {
    this.stopShare("房間連線已關閉，畫面發布已停止。");
    this.stopDecoder();
    this.clearCanvas();
    this.renderedAt.length = 0;
    this.set({
      receiverState: "off",
      receiverMessage: "房間連線已關閉，畫面接收已停止並清除。",
      renderedWidth: null,
      renderedHeight: null,
      renderFps: 0,
      syncMode: "waiting",
      syncClockId: null,
      scheduledSourceClockOffsetMs: null,
    });
  };
}

class UnsupportedScreenError extends Error {}
