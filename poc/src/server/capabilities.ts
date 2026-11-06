export const MAX_CAPABILITY_MESSAGE_BYTES = 8 * 1_024;
export const MAX_STORED_CAPABILITY_REPORTS = 64;

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

type ApiAvailability = "present" | "missing" | "unknown";
type ProbeStatus = "supported" | "unsupported" | "unknown" | "missing";
type ProbeResult = { status: ProbeStatus; reason?: string };

export type SanitizedCapabilityReport = {
  schemaVersion: 1;
  observedAt: string;
  environment: { userAgent: string; platform: string; secureContext: boolean | null };
  apis: Record<(typeof API_KEYS)[number], ApiAvailability>;
  codecProbes: Record<(typeof CODEC_PROBE_KEYS)[number], ProbeResult>;
  mediaRecorderTypes: Record<(typeof MEDIA_TYPE_KEYS)[number], ProbeResult>;
  mseTypes: Record<(typeof MEDIA_TYPE_KEYS)[number], ProbeResult>;
  playbackTypes: Record<(typeof MEDIA_TYPE_KEYS)[number], ProbeResult>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function isIsoDateTime(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 32) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

function sanitizeProbeResult(value: unknown): ProbeResult | null {
  if (!isRecord(value) || !hasExactKeys(value, Object.hasOwn(value, "reason") ? ["status", "reason"] : ["status"])) return null;
  const statuses: ProbeStatus[] = ["supported", "unsupported", "unknown", "missing"];
  if (!statuses.includes(value.status as ProbeStatus)) return null;
  if (Object.hasOwn(value, "reason") && (typeof value.reason !== "string" || value.reason.length > 140)) return null;
  return {
    status: value.status as ProbeStatus,
    ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
  };
}

function sanitizeProbeMap(value: unknown, keys: readonly string[]): Record<string, ProbeResult> | null {
  if (!isRecord(value) || !hasExactKeys(value, keys)) return null;
  const sanitized: Record<string, ProbeResult> = {};
  for (const key of keys) {
    const result = sanitizeProbeResult(value[key]);
    if (!result) return null;
    sanitized[key] = result;
  }
  return sanitized;
}

export function validateCapabilityReport(value: unknown): SanitizedCapabilityReport | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "schemaVersion", "observedAt", "environment", "apis", "codecProbes", "mediaRecorderTypes", "mseTypes", "playbackTypes",
  ])) return null;
  if (value.schemaVersion !== 1 || !isIsoDateTime(value.observedAt)) return null;

  const environment = value.environment;
  if (
    !isRecord(environment) ||
    !hasExactKeys(environment, ["userAgent", "platform", "secureContext"]) ||
    typeof environment.userAgent !== "string" || environment.userAgent.length > 256 ||
    typeof environment.platform !== "string" || environment.platform.length > 64 ||
    (environment.secureContext !== true && environment.secureContext !== false && environment.secureContext !== null)
  ) return null;

  const apis = value.apis;
  if (!isRecord(apis) || !hasExactKeys(apis, API_KEYS)) return null;
  const apiCopy = {} as SanitizedCapabilityReport["apis"];
  for (const key of API_KEYS) {
    if (apis[key] !== "present" && apis[key] !== "missing" && apis[key] !== "unknown") return null;
    apiCopy[key] = apis[key];
  }

  const codecProbes = sanitizeProbeMap(value.codecProbes, CODEC_PROBE_KEYS);
  const mediaRecorderTypes = sanitizeProbeMap(value.mediaRecorderTypes, MEDIA_TYPE_KEYS);
  const mseTypes = sanitizeProbeMap(value.mseTypes, MEDIA_TYPE_KEYS);
  const playbackTypes = sanitizeProbeMap(value.playbackTypes, MEDIA_TYPE_KEYS);
  if (!codecProbes || !mediaRecorderTypes || !mseTypes || !playbackTypes) return null;

  return {
    schemaVersion: 1,
    observedAt: value.observedAt,
    environment: {
      userAgent: environment.userAgent,
      platform: environment.platform,
      secureContext: environment.secureContext,
    },
    apis: apiCopy,
    codecProbes: codecProbes as SanitizedCapabilityReport["codecProbes"],
    mediaRecorderTypes: mediaRecorderTypes as SanitizedCapabilityReport["mediaRecorderTypes"],
    mseTypes: mseTypes as SanitizedCapabilityReport["mseTypes"],
    playbackTypes: playbackTypes as SanitizedCapabilityReport["playbackTypes"],
  };
}
