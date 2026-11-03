export type ApiAvailability = "present" | "missing" | "unknown";
export type ProbeStatus = "supported" | "unsupported" | "unknown" | "missing";

export type ProbeResult = {
  status: ProbeStatus;
  reason?: string;
};

export const API_KEYS = [
  "getUserMedia",
  "getDisplayMedia",
  "AudioContext",
  "AudioWorklet",
  "MediaRecorder",
  "MediaSource",
  "AudioEncoder",
  "AudioDecoder",
  "VideoEncoder",
  "VideoDecoder",
] as const;

export const CODEC_PROBE_KEYS = [
  "audioEncoderOpus",
  "audioEncoderAac",
  "audioDecoderOpus",
  "audioDecoderAac",
  "videoEncoderVp8",
  "videoEncoderH264",
  "videoDecoderVp8",
  "videoDecoderH264",
] as const;

export const MEDIA_TYPE_KEYS = ["audioWebmOpus", "audioMp4Aac", "videoWebmVp8Opus", "videoMp4H264Aac"] as const;

export type ApiKey = (typeof API_KEYS)[number];
export type CodecProbeKey = (typeof CODEC_PROBE_KEYS)[number];
export type MediaTypeKey = (typeof MEDIA_TYPE_KEYS)[number];

export type CapabilityReport = {
  schemaVersion: 1;
  observedAt: string;
  environment: {
    userAgent: string;
    platform: string;
    secureContext: boolean | null;
  };
  apis: Record<ApiKey, ApiAvailability>;
  codecProbes: Record<CodecProbeKey, ProbeResult>;
  mediaRecorderTypes: Record<MediaTypeKey, ProbeResult>;
  mseTypes: Record<MediaTypeKey, ProbeResult>;
  playbackTypes: Record<MediaTypeKey, ProbeResult>;
};

const PROBE_TIMEOUT_MS = 3_000;

const MEDIA_TYPES: Record<MediaTypeKey, string> = {
  audioWebmOpus: 'audio/webm;codecs="opus"',
  audioMp4Aac: 'audio/mp4;codecs="mp4a.40.2"',
  videoWebmVp8Opus: 'video/webm;codecs="vp8,opus"',
  videoMp4H264Aac: 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
};

type ConfigProbeConstructor = {
  isConfigSupported?: (config: Record<string, unknown>) => Promise<{ supported?: unknown }>;
};

function boundedReason(error: unknown): string {
  if (error instanceof Error && error.name === "ProbeTimeoutError") return "Probe timed out after 3 seconds.";
  const message = error instanceof Error ? error.message : "The browser rejected the probe.";
  return message.replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 140) || "The browser rejected the probe.";
}

function timedProbe(probe: () => Promise<unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      const error = new Error("Probe timed out");
      error.name = "ProbeTimeoutError";
      reject(error);
    }, PROBE_TIMEOUT_MS);

    Promise.resolve()
      .then(probe)
      .then(resolve, reject)
      .finally(() => window.clearTimeout(timeout));
  });
}

function apiAvailability(value: unknown): ApiAvailability {
  return typeof value === "function" ? "present" : "missing";
}

function unknownProbe(reason: string): ProbeResult {
  return { status: "unknown", reason };
}

async function configProbe(api: unknown, config: Record<string, unknown>): Promise<ProbeResult> {
  if (typeof api !== "function") return { status: "missing" };
  const probeApi = api as ConfigProbeConstructor;
  if (typeof probeApi.isConfigSupported !== "function") {
    return unknownProbe("The API exists, but isConfigSupported is unavailable.");
  }

  try {
    const result = await timedProbe(() => probeApi.isConfigSupported?.call(api, config) ?? Promise.resolve(null));
    if (!result || typeof result !== "object" || typeof (result as { supported?: unknown }).supported !== "boolean") {
      return unknownProbe("The browser returned an unreadable probe result.");
    }
    return { status: (result as { supported: boolean }).supported ? "supported" : "unsupported" };
  } catch (error) {
    return unknownProbe(boundedReason(error));
  }
}

function typeProbe(api: unknown, type: string, mode: "recorder" | "mse" | "playback"): ProbeResult {
  if (mode === "recorder") {
    if (typeof api !== "function") return { status: "missing" };
    const recorder = api as { isTypeSupported?: (mimeType: string) => boolean };
    if (typeof recorder.isTypeSupported !== "function") return unknownProbe("MediaRecorder.isTypeSupported is unavailable.");
    try {
      return { status: recorder.isTypeSupported.call(api, type) ? "supported" : "unsupported" };
    } catch (error) {
      return unknownProbe(boundedReason(error));
    }
  }

  if (mode === "mse") {
    if (typeof api !== "function") return { status: "missing" };
    const source = api as { isTypeSupported?: (mimeType: string) => boolean };
    if (typeof source.isTypeSupported !== "function") return unknownProbe("MediaSource.isTypeSupported is unavailable.");
    try {
      return { status: source.isTypeSupported.call(api, type) ? "supported" : "unsupported" };
    } catch (error) {
      return unknownProbe(boundedReason(error));
    }
  }

  try {
    const tagName = type.startsWith("audio/") ? "audio" : "video";
    const element = document.createElement(tagName) as HTMLMediaElement;
    const canPlayType = element.canPlayType;
    if (typeof canPlayType !== "function") return unknownProbe("HTMLMediaElement.canPlayType is unavailable.");
    const result = canPlayType.call(element, type);
    return result === ""
      ? { status: "unsupported", reason: "canPlayType returned an empty string; actual playback was not tested." }
      : { status: "supported", reason: `canPlayType returned ${result}; this is only a hint, not a playback test.` };
  } catch (error) {
    return unknownProbe(boundedReason(error));
  }
}

export async function probeBrowserCapabilities(): Promise<CapabilityReport> {
  const browserWindow = window as unknown as Record<string, unknown>;
  const mediaDevices = navigator.mediaDevices;
  const audioContext = browserWindow.AudioContext ?? browserWindow.webkitAudioContext;
  const audioContextPrototype = typeof audioContext === "function"
    ? (audioContext as { prototype?: Record<string, unknown> }).prototype
    : undefined;

  const apis: Record<ApiKey, ApiAvailability> = {
    getUserMedia: apiAvailability(mediaDevices?.getUserMedia),
    getDisplayMedia: apiAvailability(mediaDevices?.getDisplayMedia),
    AudioContext: apiAvailability(audioContext),
    AudioWorklet: audioContextPrototype && "audioWorklet" in audioContextPrototype ? "present" : "missing",
    MediaRecorder: apiAvailability(browserWindow.MediaRecorder),
    MediaSource: apiAvailability(browserWindow.MediaSource),
    AudioEncoder: apiAvailability(browserWindow.AudioEncoder),
    AudioDecoder: apiAvailability(browserWindow.AudioDecoder),
    VideoEncoder: apiAvailability(browserWindow.VideoEncoder),
    VideoDecoder: apiAvailability(browserWindow.VideoDecoder),
  };

  const codecEntries: [CodecProbeKey, unknown, Record<string, unknown>][] = [
    ["audioEncoderOpus", browserWindow.AudioEncoder, { codec: "opus", sampleRate: 48_000, numberOfChannels: 2, bitrate: 64_000 }],
    ["audioEncoderAac", browserWindow.AudioEncoder, { codec: "mp4a.40.2", sampleRate: 48_000, numberOfChannels: 2, bitrate: 96_000 }],
    ["audioDecoderOpus", browserWindow.AudioDecoder, { codec: "opus", sampleRate: 48_000, numberOfChannels: 2 }],
    ["audioDecoderAac", browserWindow.AudioDecoder, { codec: "mp4a.40.2", sampleRate: 48_000, numberOfChannels: 2 }],
    ["videoEncoderVp8", browserWindow.VideoEncoder, { codec: "vp8", width: 320, height: 240, bitrate: 250_000, framerate: 15 }],
    ["videoEncoderH264", browserWindow.VideoEncoder, { codec: "avc1.42E01E", width: 320, height: 240, bitrate: 250_000, framerate: 15 }],
    ["videoDecoderVp8", browserWindow.VideoDecoder, { codec: "vp8", codedWidth: 320, codedHeight: 240 }],
    ["videoDecoderH264", browserWindow.VideoDecoder, { codec: "avc1.42E01E", codedWidth: 320, codedHeight: 240 }],
  ];

  const codecResults = await Promise.all(codecEntries.map(async ([key, api, config]) => [key, await configProbe(api, config)] as const));
  const codecProbes = Object.fromEntries(codecResults) as Record<CodecProbeKey, ProbeResult>;
  const mediaRecorder = browserWindow.MediaRecorder;
  const mediaSource = browserWindow.MediaSource;
  const mediaRecorderTypes = Object.fromEntries(MEDIA_TYPE_KEYS.map((key) => [key, typeProbe(mediaRecorder, MEDIA_TYPES[key], "recorder")])) as Record<MediaTypeKey, ProbeResult>;
  const mseTypes = Object.fromEntries(MEDIA_TYPE_KEYS.map((key) => [key, typeProbe(mediaSource, MEDIA_TYPES[key], "mse")])) as Record<MediaTypeKey, ProbeResult>;
  const playbackTypes = Object.fromEntries(MEDIA_TYPE_KEYS.map((key) => [key, typeProbe(undefined, MEDIA_TYPES[key], "playback")])) as Record<MediaTypeKey, ProbeResult>;

  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    environment: {
      userAgent: String(navigator.userAgent ?? "").slice(0, 256),
      platform: String(navigator.platform ?? "").slice(0, 64),
      secureContext: typeof window.isSecureContext === "boolean" ? window.isSecureContext : null,
    },
    apis,
    codecProbes,
    mediaRecorderTypes,
    mseTypes,
    playbackTypes,
  };
}

export const API_LABELS: Record<ApiKey, string> = {
  getUserMedia: "麥克風／相機擷取 API",
  getDisplayMedia: "螢幕擷取 API",
  AudioContext: "AudioContext",
  AudioWorklet: "AudioWorklet",
  MediaRecorder: "MediaRecorder",
  MediaSource: "Media Source Extensions",
  AudioEncoder: "WebCodecs AudioEncoder",
  AudioDecoder: "WebCodecs AudioDecoder",
  VideoEncoder: "WebCodecs VideoEncoder",
  VideoDecoder: "WebCodecs VideoDecoder",
};

export const CODEC_PROBE_LABELS: Record<CodecProbeKey, string> = {
  audioEncoderOpus: "AudioEncoder · Opus · 48 kHz / 2 ch",
  audioEncoderAac: "AudioEncoder · AAC · 48 kHz / 2 ch",
  audioDecoderOpus: "AudioDecoder · Opus · 48 kHz / 2 ch",
  audioDecoderAac: "AudioDecoder · AAC · 48 kHz / 2 ch",
  videoEncoderVp8: "VideoEncoder · VP8 · 320 × 240 / 15 fps",
  videoEncoderH264: "VideoEncoder · H.264 · 320 × 240 / 15 fps",
  videoDecoderVp8: "VideoDecoder · VP8 · 320 × 240",
  videoDecoderH264: "VideoDecoder · H.264 · 320 × 240",
};

export const MEDIA_TYPE_LABELS: Record<MediaTypeKey, string> = {
  audioWebmOpus: "audio/webm · Opus",
  audioMp4Aac: "audio/mp4 · AAC",
  videoWebmVp8Opus: "video/webm · VP8 + Opus",
  videoMp4H264Aac: "video/mp4 · H.264 + AAC",
};
