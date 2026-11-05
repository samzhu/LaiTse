import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hostToken = process.env.MIXED_TEST_HOST_TOKEN ?? "";
const roomPassword = process.env.MIXED_TEST_ROOM_PASSWORD ?? "";
const secretValues = new Set([hostToken, roomPassword].filter(Boolean));
const scratchRoot = resolve(root, ".scratch/t17");
const outputDirectory = resolve(root, process.env.MIXED_OUTPUT_DIR ?? ".scratch/t17/acceptance");
const outputRelative = relative(scratchRoot, outputDirectory);
if (isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(".." + sep)) {
  throw new Error("MIXED_OUTPUT_DIR must stay inside .scratch/t17.");
}
if (process.version !== "v26.13.0") {
  throw new Error("Use the repository-pinned Node v26.13.0 runtime for this smoke.");
}
if (Buffer.byteLength(hostToken, "utf8") < 32 || Buffer.byteLength(hostToken, "utf8") > 256 || !roomPassword || roomPassword === hostToken) {
  throw new Error("Set a 32–256 byte MIXED_TEST_HOST_TOKEN and a distinct non-empty MIXED_TEST_ROOM_PASSWORD in the process environment.");
}

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, ".tools/playwright-browsers");
const { firefox } = await import("playwright");
const baseURL = process.env.MIXED_BASE_URL ?? "https://localhost:4173";
const target = new URL(baseURL);
if (target.protocol !== "https:" || target.username || target.password || target.search || target.hash || target.pathname !== "/") {
  throw new Error("MIXED_BASE_URL must be a trusted HTTPS application root without credentials, query, or fragment.");
}
const caCertificate = resolve(root, process.env.MIXED_CA_CERT ?? ".scratch/t01/tls/local-ca.pem");
const certificateUtility = process.env.CERTUTIL_BIN ?? "certutil";
const headless = process.env.HEADLESS !== "0";

const CLOSE_CODE = 4003;
const WAIT_TIMEOUT_MS = 20_000;
const MEDIA_TIMEOUT_MS = 12_000;
const SAMPLE_INTERVAL_MS = 400;
const SAMPLE_COUNT = 3;
const SETTLE_MS = 350;
const MAX_CONTROLS_PER_CONNECTION = 180;
const MAX_CONNECTIONS_PER_CLIENT = 1;
const MAX_STAGES = 20;
const MAX_ERRORS = 20;
const MAX_INTERACTION_ACKS = 4;
const MAX_SCREENSHOTS = 4;
const MAX_MEDIA_HASHES_PER_CLIENT_DIRECTION = 8192;
const ROOMS = {
  lobby: { name: "Open area", color: [224, 52, 46], frequencyHz: 523 },
  studio: { name: "Meeting room", color: [38, 184, 92], frequencyHz: 997 },
};
const CLIENT_NAMES = Object.keys(ROOMS).flatMap((roomId) => [roomId + "-host", roomId + "-watch", roomId + "-interaction"]);
const contexts = [];
const runtimeFolders = new Set();
const clients = new Map();
const startedAtEpochMs = Date.now();
let failure = null;
let collectionOverflow = false;

mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });

const report = {
  schemaVersion: 1,
  purpose: "Lightweight two-room mixed-mode smoke with one synthetic Opus/VP8 host, one actual watch receiver, and one interaction-only participant per room.",
  startedAt: new Date().toISOString(),
  finishedAt: null,
  durationMs: null,
  status: "running",
  baseURL: target.origin,
  runtime: { node: process.version, platform: process.platform, architecture: process.arch, firefox: "not-reported", headless },
  tls: {
    caCertificate: relative(root, caCertificate),
    trust: "local CA imported only into isolated Firefox NSS profiles; certificate errors are not ignored",
    ignoreCertificateErrors: false,
    systemTrustChanged: false,
  },
  topology: {
    rooms: ["lobby", "studio"],
    lockedManagedStudio: true,
    perRoom: { host: 1, watchReceiver: 1, interactionOnly: 1 },
    actualFirefoxProcesses: 6,
    isolatedFirefoxProfiles: 6,
    actualDecoderReceivers: 2,
    socketOnlyLoadClients: 0,
    syntheticSourcePages: ["lobby-host", "studio-host"],
    network: "one externally running managed local HTTPS/WSS application",
  },
  credentials: {
    hostToken: "provided in process memory; value not recorded",
    roomPassword: "provided in process memory; value not recorded",
    resumeTokens: "observed only as presence flags; values not retained",
  },
  syntheticSources: {
    audio: "one per-room host oscillator routed through AudioContext MediaStreamDestination; no physical microphone",
    video: "one per-room host animated canvas returned by test-only getDisplayMedia replacement; no physical display capture",
    audioFrequencyHz: { lobby: ROOMS.lobby.frequencyHz, studio: ROOMS.studio.frequencyHz },
    videoColorRgb: { lobby: ROOMS.lobby.color, studio: ROOMS.studio.color },
    expectedSourcesPerHostPerKind: 1,
    mediaPayloadsRetained: false,
  },
  stages: [],
  streamConfigurations: {},
  clients: {},
  modeTransitions: [],
  mediaSamples: [],
  sourceHashAudit: { capPerClientDirection: MAX_MEDIA_HASHES_PER_CLIENT_DIRECTION, complete: false, publisherSources: {}, receipts: {}, mapping: null, traceReconciliation: null },
  feedbackEvidence: [],
  studioWatchStop: null,
  publisherStops: {},
  interactionAcks: [],
  playbackGestures: [],
  screenshots: [],
  privacy: {
    rawControlPayloadsRetained: false,
    rawMediaPayloadsRetained: false,
    browserStorageDumped: false,
    configuredSecretEchoObserved: false,
    tokenPasswordOrResumeValuesWritten: false,
    finalSerializationSecretScanPassed: false,
  },
  limits: {
    sampling: "Three 400 ms sample intervals; counters are local or server enqueue observations, not p95, end-to-end latency, or quality results.",
    transport: "Per-receiver server downlink is a connection-lifetime WebSocket enqueue counter; browser binary bytes and render counters are separately observed.",
    devices: "No phone, physical microphone, physical display, human listening, real backgrounding, weak-network shaping, capacity, durability, or Cloud Run result.",
    productStatus: "This short feasibility smoke does not establish full POC-05 completion or deployment readiness.",
  },
  errors: { pageErrors: [], collectionErrors: [], cleanupErrors: [], failure: null },
};

function elapsedMs() {
  return Date.now() - startedAtEpochMs;
}

function redact(value) {
  let output = String(value ?? "");
  for (const secret of secretValues) if (secret) output = output.split(secret).join("[redacted]");
  output = output.replace(/("(?:token|password|resumeToken)"\s*:\s*")[^"]*(")/giu, "$1[redacted]$2");
  output = output.replace(/\b(?:Bearer\s+)?[A-Za-z0-9_-]{48,}\b/gu, "[redacted-token]");
  return output.slice(0, 320);
}

function addBounded(array, value, label, cap = MAX_ERRORS) {
  if (array.length < cap) {
    array.push(value);
    return true;
  }
  collectionOverflow = true;
  if (!report.errors.collectionErrors.some((item) => item.code === "collection_cap_reached" && item.collection === label) &&
      report.errors.collectionErrors.length < MAX_ERRORS) {
    report.errors.collectionErrors.push({ collection: label, code: "collection_cap_reached", cap });
  }
  return false;
}

function noteCollectionError(item) {
  addBounded(report.errors.collectionErrors, item, "collection-errors");
}

async function runStage(name, operation) {
  if (report.stages.length >= MAX_STAGES) throw new Error("The bounded T17 stage cap was reached.");
  const startedAt = new Date().toISOString();
  const startedElapsedMs = elapsedMs();
  let details = {};
  let stageError = null;
  try {
    details = await operation() ?? {};
    return details;
  } catch (error) {
    stageError = redact(error?.message ?? error);
    throw error;
  } finally {
    const finishedAt = new Date().toISOString();
    const item = {
      name,
      startedAt,
      finishedAt,
      startedElapsedMs,
      finishedElapsedMs: elapsedMs(),
      durationMs: elapsedMs() - startedElapsedMs,
      ...(stageError ? { failed: true, error: stageError } : {}),
      ...details,
    };
    report.stages.push(item);
    console.log("[T17] " + name + (Object.keys(details).length ? " " + JSON.stringify(details) : ""));
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function numeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function payloadByteLength(payload) {
  if (typeof payload === "string") return Buffer.byteLength(payload, "utf8");
  if (Buffer.isBuffer(payload) || payload instanceof Uint8Array) return payload.byteLength;
  if (payload instanceof ArrayBuffer) return payload.byteLength;
  return 0;
}

function safeRoomId(value) {
  return Object.hasOwn(ROOMS, value) ? value : null;
}

function safeType(value) {
  const allowed = new Set([
    "join", "session.issued", "session.resume", "session.resumed", "room.snapshot", "participation.self", "participation.inspect", "participation.modeChanged",
    "host.claim", "host.claimed", "host.publishPermission", "host.actionResult", "audio.stream", "screen.stream",
    "audio.subscribe", "audio.subscribed", "audio.unsubscribe", "audio.unsubscribed", "audio.started", "audio.stopped", "audio.streamEnded",
    "screen.subscribe", "screen.subscribed", "screen.unsubscribe", "screen.unsubscribed", "screen.started", "screen.stopped", "screen.streamEnded",
    "screen.keyframeRequest", "interaction.submit", "interaction.ack", "interaction.event", "interaction.error", "protocol.error",
  ]);
  return typeof value === "string" && allowed.has(value) ? value : "other";
}

function summarizeTransport(value) {
  if (!value || typeof value !== "object") return null;
  return {
    maxPendingBytes: numeric(value.maxPendingBytes),
    maxPendingCallbackAgeMs: numeric(value.maxPendingCallbackAgeMs),
    pendingCallbackCount: numeric(value.pendingCallbackCount),
    pendingCallbackBytes: numeric(value.pendingCallbackBytes),
    pendingCallbackHighWaterCount: numeric(value.pendingCallbackHighWaterCount),
    pendingCallbackHighWaterBytes: numeric(value.pendingCallbackHighWaterBytes),
    oldestPendingCallbackAgeMs: numeric(value.oldestPendingCallbackAgeMs),
    highWaterBufferedBytes: numeric(value.highWaterBufferedBytes),
    closeReason: ["buffered_bytes", "pending_callback_age"].includes(value.closeReason) ? value.closeReason : null,
    scope: "application WebSocket send callback; excludes OS/TCP queues and peer receipt",
  };
}

function summarizeControl(message, direction, connection) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const type = safeType(message.type);
  const item = {
    direction,
    connectionIndex: connection.index,
    sequence: ++connection.controlSequence,
    at: new Date().toISOString(),
    elapsedMs: elapsedMs(),
    type,
  };
  const roomId = safeRoomId(message.roomId ?? message.room?.id);
  if (roomId) item.roomId = roomId;

  if (type === "join") {
    item.passwordProvided = typeof message.password === "string" && message.password.length > 0;
    item.resumable = message.resumable === true;
  } else if (type === "session.issued" || type === "session.resume") {
    item.tokenPresent = typeof message.token === "string" && message.token.length > 0;
    if (item.tokenPresent) secretValues.add(message.token);
    if (type === "session.resume") item.passwordProvided = typeof message.password === "string" && message.password.length > 0;
  } else if (type === "session.resumed") {
    item.role = message.role === "participant" || message.role === "display" ? message.role : "unknown";
    item.mode = message.mode === "watch" || message.mode === "interaction" ? message.mode : "unknown";
  } else if (type === "room.snapshot") {
    item.publishAllowed = Boolean(message.room?.publishAllowed);
    item.hostControlsEnabled = Boolean(message.room?.hostControlsEnabled);
    item.locked = Boolean(message.room?.isLocked);
  } else if (type === "participation.self") {
    item.role = message.role === "participant" || message.role === "display" ? message.role : "unknown";
    item.mode = message.mode === "watch" || message.mode === "interaction" ? message.mode : "unknown";
    item.media = {
      audioSubscribed: Boolean(message.media?.audio?.subscribed),
      audioDownlinkBytes: numeric(message.media?.audio?.downlinkBytes),
      audioDownlinkFrames: numeric(message.media?.audio?.downlinkFrames),
      screenSubscribed: Boolean(message.media?.screen?.subscribed),
      screenDownlinkBytes: numeric(message.media?.screen?.downlinkBytes),
      screenDownlinkFrames: numeric(message.media?.screen?.downlinkFrames),
    };
    item.transport = summarizeTransport(message.transport);
  } else if (type === "participation.modeChanged") {
    item.mode = message.mode === "watch" || message.mode === "interaction" ? message.mode : "unknown";
    item.media = {
      audioSubscribed: message.media?.audioSubscribed === true,
      screenSubscribed: message.media?.screenSubscribed === true,
    };
  } else if (type === "host.claim") {
    item.tokenPresent = typeof message.token === "string" && message.token.length > 0;
    if (item.tokenPresent) secretValues.add(message.token);
  } else if (type === "host.publishPermission") {
    item.allowed = message.allowed === true;
  } else if (type === "host.actionResult") {
    item.action = message.action === "grantPublisher" ? "grantPublisher" : "other";
    if (typeof message.allowed === "boolean") item.allowed = message.allowed;
  } else if (type === "audio.stream") {
    item.generation = Number.isInteger(message.generation) ? message.generation : null;
    item.clockId = typeof message.clockId === "string" ? message.clockId.slice(0, 80) : null;
    item.config = {
      codec: message.config?.codec === "opus" ? "opus" : "other",
      sampleRate: numeric(message.config?.sampleRate),
      channels: numeric(message.config?.channels),
    };
  } else if (type === "screen.stream") {
    item.generation = Number.isInteger(message.generation) ? message.generation : null;
    item.clockId = typeof message.clockId === "string" ? message.clockId.slice(0, 80) : null;
    item.config = {
      codec: message.codec === "vp8" ? "vp8" : "other",
      width: numeric(message.width),
      height: numeric(message.height),
      frameRate: numeric(message.frameRate),
    };
  } else if (type === "interaction.ack") {
    item.acknowledged = typeof message.interactionId === "string" && message.interactionId.length > 0;
    item.duplicate = message.duplicate === true;
    item.eventId = typeof message.eventId === "string" ? message.eventId.slice(0, 80) : null;
  } else if (type === "interaction.submit") {
    item.eventId = typeof message.eventId === "string" ? message.eventId.slice(0, 80) : null;
    item.kind = ["feedback", "chat", "sticker", "danmaku"].includes(message.kind) ? message.kind : "other";
  } else if (type === "interaction.event") {
    item.eventId = typeof message.event?.eventId === "string" ? message.event.eventId.slice(0, 80) : null;
    item.interactionId = typeof message.event?.id === "string" ? message.event.id.slice(0, 80) : null;
    item.kind = ["feedback", "chat", "sticker", "danmaku"].includes(message.event?.kind) ? message.event.kind : "other";
  } else if (type === "interaction.error" || type === "protocol.error") {
    item.code = typeof message.code === "string" ? message.code.slice(0, 100) : "unknown";
  } else if (type.endsWith("streamEnded")) {
    item.generation = Number.isInteger(message.generation) ? message.generation : null;
  }
  return item;
}

function observePayload(client, connection, direction, payload) {
  const byteLength = payloadByteLength(payload);
  const stats = connection.bytes[direction];
  stats.frames += 1;
  stats.bytes += byteLength;
  if (typeof payload !== "string") {
    stats.binaryFrames += 1;
    stats.binaryBytes += byteLength;
    const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload ?? []);
    const magic = bytes.toString("ascii", 0, Math.min(4, bytes.byteLength));
    let channel = null;
    if (magic === "LTA1") {
      channel = "audio";
      stats.audioFrames += 1;
      stats.audioBytes += byteLength;
    } else if (magic === "LTS1") {
      channel = "screen";
      stats.screenFrames += 1;
      stats.screenBytes += byteLength;
    }
    if (!channel) {
      connection.unparsedBinaryFrames[direction] += 1;
      return;
    }
    if (connection.mediaHashes[direction].length >= MAX_MEDIA_HASHES_PER_CLIENT_DIRECTION) {
      client.collectionOverflow = true;
      collectionOverflow = true;
      noteCollectionError({ client: client.name, direction, code: "media_hash_cap_reached", cap: MAX_MEDIA_HASHES_PER_CLIENT_DIRECTION });
      return;
    }
    connection.mediaHashes[direction].push({
      channel,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: byteLength,
      generation: bytes.byteLength >= 8 ? bytes.readUInt32BE(4) : null,
      sequence: bytes.byteLength >= 12 ? bytes.readUInt32BE(8) : null,
      elapsedMs: elapsedMs(),
    });
    return;
  }

  let message;
  try { message = JSON.parse(payload); }
  catch { return; }
  if (!message || typeof message !== "object" || Array.isArray(message)) return;
  if (direction === "received") {
    for (const secret of secretValues) if (secret && payload.includes(secret)) report.privacy.configuredSecretEchoObserved = true;
  }
  const item = summarizeControl(message, direction, connection);
  if (item && !addBounded(connection.controls, item, client.name + "-controls-" + connection.index, MAX_CONTROLS_PER_CONNECTION)) {
    client.collectionOverflow = true;
  }
}

function routeClientSocket(client, route) {
  if (client.connections.length >= MAX_CONNECTIONS_PER_CLIENT) {
    client.collectionOverflow = true;
    noteCollectionError({ client: client.name, code: "connection_cap_reached" });
    try { route.close({ code: CLOSE_CODE, reason: "T17 connection cap reached" }); } catch {}
    return;
  }
  const connection = {
    index: client.connections.length + 1,
    openedAt: new Date().toISOString(),
    openedAtElapsedMs: elapsedMs(),
    controlSequence: 0,
    controls: [],
    mediaHashes: { sent: [], received: [] },
    unparsedBinaryFrames: { sent: 0, received: 0 },
    bytes: {
      sent: { frames: 0, bytes: 0, binaryFrames: 0, binaryBytes: 0, audioFrames: 0, audioBytes: 0, screenFrames: 0, screenBytes: 0 },
      received: { frames: 0, bytes: 0, binaryFrames: 0, binaryBytes: 0, audioFrames: 0, audioBytes: 0, screenFrames: 0, screenBytes: 0 },
    },
    route,
    serverRoute: null,
  };
  try {
    const serverRoute = route.connectToServer();
    connection.serverRoute = serverRoute;
    client.connections.push(connection);
    client.activeConnection = connection;
    route.onMessage((payload) => {
      try {
        observePayload(client, connection, "sent", payload);
        serverRoute.send(payload);
      } catch (error) {
        noteCollectionError({ client: client.name, code: "outbound_route_observation_failed", message: redact(error?.message ?? error) });
        client.collectionOverflow = true;
      }
    });
    serverRoute.onMessage((payload) => {
      try {
        observePayload(client, connection, "received", payload);
        route.send(payload);
      } catch (error) {
        noteCollectionError({ client: client.name, code: "inbound_route_observation_failed", message: redact(error?.message ?? error) });
        client.collectionOverflow = true;
      }
    });
  } catch (error) {
    noteCollectionError({ client: client.name, code: "route_setup_failed", message: redact(error?.message ?? error) });
    client.collectionOverflow = true;
    try { route.close({ code: CLOSE_CODE, reason: "T17 route setup failed" }); } catch {}
  }
}

async function installWebSocketRoute(client) {
  await client.page.routeWebSocket(/\/ws(?:\?|$)/u, (route) => routeClientSocket(client, route));
}

function controls(client, connection, direction, type) {
  return connection.controls.filter((item) => item.direction === direction && item.type === type);
}

async function waitFor(predicate, label, timeoutMs = WAIT_TIMEOUT_MS, intervalMs = 25) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await delay(intervalMs);
  }
  throw new Error("Timed out waiting for " + label + " after " + timeoutMs + " ms.");
}

async function waitControl(client, connection, direction, type, previousCount = 0, timeoutMs = WAIT_TIMEOUT_MS) {
  return waitFor(() => controls(client, connection, direction, type).slice(previousCount).at(-1),
    client.name + " " + direction + " " + type, timeoutMs);
}

function countControl(client, connection, direction, type) {
  return controls(client, connection, direction, type).length;
}

function runCertutil(args) {
  execFileSync(certificateUtility, args, { stdio: "pipe" });
}

function createTrustedProfile(name) {
  const folder = join(outputDirectory, "runtime-" + name);
  runtimeFolders.add(folder);
  rmSync(folder, { recursive: true, force: true });
  const profileDirectory = join(folder, "profile");
  mkdirSync(profileDirectory, { recursive: true, mode: 0o700 });
  runCertutil(["-N", "-d", "sql:" + profileDirectory, "--empty-password"]);
  runCertutil(["-A", "-d", "sql:" + profileDirectory, "-n", "LaiTse local development CA", "-t", "C,,", "-i", caCertificate]);
  const appData = join(folder, "app-data");
  const localAppData = join(folder, "local-app-data");
  mkdirSync(appData, { recursive: true, mode: 0o700 });
  mkdirSync(localAppData, { recursive: true, mode: 0o700 });
  return { profileDirectory, appData, localAppData };
}

async function launchClient(name) {
  const profile = createTrustedProfile(name);
  const browserEnv = { ...process.env };
  for (const key of [
    "MIXED_TEST_HOST_TOKEN", "MIXED_TEST_ROOM_PASSWORD", "MIXED_BASE_URL", "MIXED_CA_CERT", "MIXED_OUTPUT_DIR",
    "FANOUT_TEST_HOST_TOKEN", "FANOUT_TEST_ROOM_PASSWORD", "HOST_CONTROL_TOKEN", "MEETING_ROOM_PASSWORD",
  ]) delete browserEnv[key];
  const context = await firefox.launchPersistentContext(profile.profileDirectory, {
    headless,
    env: { ...browserEnv, MOZ_APP_DATA: profile.appData, MOZ_LOCAL_APP_DATA: profile.localAppData },
    viewport: { width: 1440, height: 1050 },
    colorScheme: "light",
    firefoxUserPrefs: { "security.enterprise_roots.enabled": false },
  });
  context.setDefaultTimeout(8_000);
  contexts.push(context);
  const page = context.pages()[0] ?? await context.newPage();
  const client = { name, context, page, connections: [], activeConnection: null, collectionOverflow: false, pageErrorCount: 0 };
  clients.set(name, client);
  page.on("pageerror", (error) => {
    client.pageErrorCount += 1;
    addBounded(report.errors.pageErrors, { client: name, message: redact(error?.message ?? "page error") }, "page-errors");
  });
  await installWebSocketRoute(client);
  return client;
}

async function installSyntheticMedia(page, roomId) {
  const room = ROOMS[roomId];
  await page.addInitScript(({ frequency, color }) => {
    const state = { audioRequests: 0, screenRequests: 0, sources: [], audioContexts: [] };
    Object.defineProperty(window, "__t17Synthetic", { value: state, configurable: false });
    const devices = navigator.mediaDevices;
    const recordTrack = (kind, track, stopAnimation = null) => {
      const record = { kind, track, stopCalls: 0 };
      const stop = track.stop.bind(track);
      track.stop = () => {
        if (track.readyState !== "ended") record.stopCalls += 1;
        stopAnimation?.();
        stop();
      };
      state.sources.push(record);
    };
    Object.defineProperty(devices, "getUserMedia", {
      configurable: true,
      value: async () => {
        state.audioRequests += 1;
        const audioContext = new AudioContext({ sampleRate: 48_000 });
        await audioContext.resume();
        const destination = audioContext.createMediaStreamDestination();
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.value = 0.22;
        oscillator.connect(gain).connect(destination);
        oscillator.start();
        state.audioContexts.push(audioContext);
        const track = destination.stream.getAudioTracks()[0];
        if (!track) throw new Error("Synthetic audio source did not create a track.");
        recordTrack("audio", track);
        return destination.stream;
      },
    });
    Object.defineProperty(devices, "getDisplayMedia", {
      configurable: true,
      value: async () => {
        state.screenRequests += 1;
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 180;
        const drawing = canvas.getContext("2d");
        if (!drawing) throw new Error("Synthetic screen canvas could not be created.");
        let active = true;
        let frame = 0;
        const render = () => {
          if (!active) return;
          const pulse = frame++ % 2 === 0 ? 0 : 12;
          drawing.fillStyle = "rgb(" + Math.min(255, color[0] + pulse) + ", " + Math.min(255, color[1] + pulse) + ", " + Math.min(255, color[2] + pulse) + ")";
          drawing.fillRect(0, 0, canvas.width, canvas.height);
          drawing.fillStyle = "#ffffff";
          drawing.fillRect(12 + (frame % 80), 12, 48, 12);
          requestAnimationFrame(render);
        };
        render();
        const stream = canvas.captureStream(10);
        const track = stream.getVideoTracks()[0];
        if (!track) throw new Error("Synthetic canvas did not create a video track.");
        recordTrack("screen", track, () => { active = false; });
        return stream;
      },
    });
    Object.defineProperty(window, "__t17SyntheticCleanup", {
      value: async () => {
        for (const source of state.sources) if (source.track.readyState !== "ended") source.track.stop();
        await Promise.all(state.audioContexts.map((context) => context.close().catch(() => {})));
      },
      configurable: false,
    });
  }, { frequency: room.frequencyHz, color: room.color });
}

async function joinRoom(client, displayName, roomId) {
  client.roomId = roomId;
  const page = client.page;
  await page.goto(target.origin + "/?room=" + roomId, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Local room presence" }).waitFor();
  await page.getByLabel("Your display name").fill(displayName);
  await page.getByRole("button", { name: "Join room", exact: true }).click();
  if (roomId === "studio") {
    await page.locator("#meeting-room-password").waitFor({ state: "visible" });
    const connection = await waitFor(() => client.activeConnection, client.name + " entry WebSocket connection");
    const gateError = await waitFor(() => controls(client, connection, "received", "protocol.error")
      .findLast((item) => item.code === "room_password_required"), client.name + " initial locked-room password gate response");
    const initialGateErrors = controls(client, connection, "received", "protocol.error")
      .filter((item) => item.code === "room_password_required");
    assert.equal(initialGateErrors.length, 1, client.name + " should receive exactly one expected initial password-gate response.");
    client.expectedInitialGateError = { type: "protocol.error", code: gateError.code, count: 1 };
    await page.locator("#meeting-room-password").fill(roomPassword);
    await page.getByRole("button", { name: "Enter room", exact: true }).click();
  }
  await page.getByText("Connected to " + ROOMS[roomId].name, { exact: true }).waitFor();
  await page.locator('[data-testid="audio-panel"]').waitFor();
  await page.locator('[data-testid="screen-panel"]').waitFor();
  const connection = client.activeConnection;
  assert.ok(connection, client.name + " should have an observed WebSocket connection.");
  await waitControl(client, connection, "received", "room.snapshot", 0);
  const snapshot = controls(client, connection, "received", "room.snapshot").at(-1);
  assert.equal(snapshot.roomId, roomId, client.name + " must join the requested room through its normal URL entry.");
  assert.equal(snapshot.locked, roomId === "studio", client.name + " room lock state should match the configured T17 topology.");
  return connection;
}

async function claimHost(client) {
  const connection = client.activeConnection;
  const claimCount = countControl(client, connection, "sent", "host.claim");
  const claimedCount = countControl(client, connection, "received", "host.claimed");
  await client.page.getByTestId("host-control-token").fill(hostToken);
  await client.page.getByTestId("host-claim").click();
  const claim = await waitControl(client, connection, "sent", "host.claim", claimCount);
  assert.equal(claim.tokenPresent, true, "host claim should send the configured credential without retaining its value.");
  await waitControl(client, connection, "received", "host.claimed", claimedCount);
  await client.page.getByTestId("host-state").filter({ hasText: "HOST" }).waitFor();
  const permission = await waitFor(() => controls(client, connection, "received", "host.publishPermission").findLast((item) => item.allowed),
    client.name + " host publish permission");
  assert.equal(permission.allowed, true);
}

async function startReceiving(client) {
  const connection = client.activeConnection;
  const audioAckCount = countControl(client, connection, "received", "audio.subscribed");
  const screenAckCount = countControl(client, connection, "received", "screen.subscribed");
  await client.page.getByTestId("audio-start-listening").click();
  await client.page.getByTestId("screen-start-watching").click();
  await waitControl(client, connection, "received", "audio.subscribed", audioAckCount);
  await waitControl(client, connection, "received", "screen.subscribed", screenAckCount);
}

async function startPublishing(client) {
  const connection = client.activeConnection;
  const audioStartedCount = countControl(client, connection, "received", "audio.started");
  const screenStartedCount = countControl(client, connection, "received", "screen.started");
  await client.page.getByRole("button", { name: "開始麥克風", exact: true }).click();
  await waitControl(client, connection, "received", "audio.started", audioStartedCount);
  await client.page.getByRole("button", { name: "開始分享畫面", exact: true }).click();
  await waitControl(client, connection, "received", "screen.started", screenStartedCount);
}

async function setParticipationMode(client, mode) {
  const connection = client.activeConnection;
  const changedBefore = countControl(client, connection, "received", "participation.modeChanged");
  await client.page.getByTestId(mode === "interaction" ? "mode-interaction" : "mode-watch").click();
  const changed = await waitControl(client, connection, "received", "participation.modeChanged", changedBefore);
  assert.equal(changed.roomId, client.roomId, client.name + " mode change should stay in its joined room.");
  assert.equal(changed.mode, mode, client.name + " should receive the requested mode acknowledgement.");
  if (mode === "interaction") {
    assert.equal(changed.media.audioSubscribed, false, client.name + " interaction mode must clear server audio subscription.");
    assert.equal(changed.media.screenSubscribed, false, client.name + " interaction mode must clear server screen subscription.");
  }
  await client.page.getByTestId("participation-mode").filter({ hasText: mode === "interaction" ? "只互動" : "觀看＋互動" }).waitFor();
  return changed;
}

async function mediaSnapshot(page) {
  return page.evaluate(() => {
    const audio = document.querySelector('[data-testid="audio-panel"]');
    const screen = document.querySelector('[data-testid="screen-panel"]');
    const canvas = screen?.querySelector('[data-testid="screen-preview"]');
    const pixel = canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0
      ? [...canvas.getContext("2d").getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data]
      : null;
    return {
      audio: audio ? {
        receiveIntent: audio.getAttribute("data-receive-intent") === "true",
        subscribed: audio.getAttribute("data-receiver-subscribed") === "true",
        listenerState: audio.getAttribute("data-listener-state"),
        renderedSamples: Number(audio.getAttribute("data-rendered-samples") ?? 0),
        decodedFrames: Number(audio.getAttribute("data-decoded-frames") ?? 0),
        receivedPackets: Number(audio.getAttribute("data-received-packets") ?? 0),
        renderRms: Number(audio.getAttribute("data-render-rms") ?? 0),
        playbackClockId: audio.getAttribute("data-audio-playback-clock-id"),
        queuedSamples: Number(audio.getAttribute("data-queued-samples") ?? 0),
        queueOldestGraphResidenceMs: Number(audio.getAttribute("data-queue-oldest-graph-residence-ms") ?? 0),
        decodeQueueHighWater: Number(audio.getAttribute("data-audio-decode-queue-high-water") ?? 0),
      } : null,
      screen: screen ? {
        receiveIntent: screen.getAttribute("data-receive-intent") === "true",
        subscribed: screen.getAttribute("data-receiver-subscribed") === "true",
        receiverState: screen.getAttribute("data-receiver-state"),
        renderedFrames: Number(screen.getAttribute("data-rendered-frames") ?? 0),
        decodedFrames: Number(screen.getAttribute("data-decoded-frames") ?? 0),
        receivedFrames: Number(screen.getAttribute("data-received-frames") ?? 0),
        width: Number(screen.getAttribute("data-rendered-width") ?? 0),
        height: Number(screen.getAttribute("data-rendered-height") ?? 0),
        syncClockId: screen.getAttribute("data-sync-clock-id"),
        queuedDecodedFrameCount: Number(screen.getAttribute("data-queued-decoded-frame-count") ?? 0),
        queuedDecodedFrameOldestResidenceMs: Number(screen.getAttribute("data-queued-decoded-frame-oldest-residence-ms") ?? 0),
        residenceDrops: Number(screen.getAttribute("data-queued-decoded-frame-residence-drops") ?? 0),
        decodeQueueHighWater: Number(screen.getAttribute("data-decode-queue-high-water") ?? 0),
        pixel,
      } : null,
    };
  });
}

function colorDifference(actual, expected) {
  if (!Array.isArray(actual) || actual.length < 3) return Infinity;
  return Math.max(...expected.map((channel, index) => Math.abs(channel - actual[index])));
}

async function ensurePlaybackGesture(client) {
  const continueButton = client.page.getByTestId("audio-continue-listening");
  if (!(await continueButton.isVisible().catch(() => false))) return;
  const before = await mediaSnapshot(client.page);
  let result = "clicked-normal-continue";
  try {
    await continueButton.click({ timeout: 1_000 });
  } catch (error) {
    const after = await mediaSnapshot(client.page);
    addBounded(report.playbackGestures, { client: client.name, atMs: elapsedMs(), before: before.audio,
      after: after.audio, result: "continue-click-ended-or-timed-out" }, "playback-gestures", 8);
    // A transient Continue control can disappear as the existing start gesture resumes audio.
    // Only accept this race when actual playback has already started; the caller still checks growth.
    if (!(after.audio?.listenerState === "ready" && after.audio.renderedSamples > 0 && after.audio.renderRms > 0.0001)) throw error;
    return;
  }
  addBounded(report.playbackGestures, { client: client.name, atMs: elapsedMs(), before: before.audio, result }, "playback-gestures", 8);
}

async function waitForRenderedMedia(client, baseline = null) {
  await ensurePlaybackGesture(client);
  await client.page.waitForFunction((prior) => {
    const audio = document.querySelector('[data-testid="audio-panel"]');
    const screen = document.querySelector('[data-testid="screen-panel"]');
    const canvas = screen?.querySelector('[data-testid="screen-preview"]');
    const samples = Number(audio?.getAttribute("data-rendered-samples") ?? 0);
    const audioPackets = Number(audio?.getAttribute("data-received-packets") ?? 0);
    const frames = Number(screen?.getAttribute("data-rendered-frames") ?? 0);
    const screenPackets = Number(screen?.getAttribute("data-received-frames") ?? 0);
    return audio && screen && samples > (prior?.audio?.renderedSamples ?? 0) && audioPackets > 0 &&
      Number(audio.getAttribute("data-render-rms")) > 0.0001 &&
      frames >= Math.max(3, (prior?.screen?.renderedFrames ?? 0) + 1) && screenPackets > 0 &&
      canvas?.width > 0 && canvas?.height > 0;
  }, baseline, { timeout: MEDIA_TIMEOUT_MS });
  const snapshot = await mediaSnapshot(client.page);
  assert.ok(snapshot.audio.renderedSamples > (baseline?.audio?.renderedSamples ?? 0), client.name + " AudioWorklet samples must advance.");
  assert.ok(snapshot.screen.renderedFrames >= Math.max(3, (baseline?.screen?.renderedFrames ?? 0) + 1), client.name + " VP8 frames must render.");
  assert.ok(colorDifference(snapshot.screen.pixel, ROOMS[client.roomId].color) <= 45,
    client.name + " decoded canvas should show its room's synthetic color; got " + JSON.stringify(snapshot.screen.pixel));
  return snapshot;
}

async function waitUntilActiveSources(client) {
  await client.page.waitForFunction(() => {
    const state = window.__t17Synthetic;
    return state && state.sources.some((source) => source.kind === "audio") && state.sources.some((source) => source.kind === "screen");
  }, undefined, { timeout: MEDIA_TIMEOUT_MS });
}

async function readSyntheticState(client) {
  return client.page.evaluate(() => {
    const state = window.__t17Synthetic;
    if (!state) return null;
    return {
      audioRequests: state.audioRequests,
      screenRequests: state.screenRequests,
      sources: state.sources.map((source) => ({ kind: source.kind, readyState: source.track.readyState, stopCalls: source.stopCalls })),
    };
  });
}

function binaryCounts(connection) {
  return {
    audio: connection.bytes.received.audioFrames,
    audioBytes: connection.bytes.received.audioBytes,
    screen: connection.bytes.received.screenFrames,
    screenBytes: connection.bytes.received.screenBytes,
    all: connection.bytes.received.binaryFrames,
    bytes: connection.bytes.received.binaryBytes,
  };
}

function binaryCounterSummary(connection) {
  const summarize = (stats) => ({
    binaryFrames: stats.binaryFrames,
    binaryBytes: stats.binaryBytes,
    audioFrames: stats.audioFrames,
    audioBytes: stats.audioBytes,
    screenFrames: stats.screenFrames,
    screenBytes: stats.screenBytes,
  });
  return { sent: summarize(connection.bytes.sent), received: summarize(connection.bytes.received) };
}

function streamConfiguration(client) {
  const connection = client.activeConnection;
  const audio = controls(client, connection, "received", "audio.stream").at(-1);
  const screen = controls(client, connection, "received", "screen.stream").at(-1);
  assert.ok(audio, client.name + " must receive Opus stream configuration.");
  assert.ok(screen, client.name + " must receive VP8 stream configuration.");
  assert.equal(audio.config.codec, "opus", client.name + " must receive actual Opus configuration.");
  assert.equal(screen.config.codec, "vp8", client.name + " must receive actual VP8 configuration.");
  assert.ok(Number.isInteger(audio.generation) && audio.generation > 0);
  assert.ok(Number.isInteger(screen.generation) && screen.generation > 0);
  assert.ok(audio.clockId && audio.clockId === screen.clockId, client.name + " audio and video must share the publisher clock.");
  return {
    roomId: client.roomId,
    audio: { codec: audio.config.codec, sampleRate: audio.config.sampleRate, channels: audio.config.channels, generation: audio.generation, clockId: audio.clockId },
    screen: { codec: screen.config.codec, width: screen.config.width, height: screen.config.height, frameRate: screen.config.frameRate, generation: screen.generation, clockId: screen.clockId },
  };
}

function assertSameConfiguration(first, other, clientName) {
  assert.equal(other.audio.codec, first.audio.codec, clientName + " audio codec must match.");
  assert.equal(other.audio.sampleRate, first.audio.sampleRate, clientName + " audio sample rate must match.");
  assert.equal(other.audio.channels, first.audio.channels, clientName + " audio channel config must match.");
  assert.equal(other.audio.generation, first.audio.generation, clientName + " audio generation must match.");
  assert.equal(other.audio.clockId, first.audio.clockId, clientName + " audio clock must match.");
  assert.equal(other.screen.codec, first.screen.codec, clientName + " screen codec must match.");
  assert.equal(other.screen.width, first.screen.width, clientName + " screen width config must match.");
  assert.equal(other.screen.height, first.screen.height, clientName + " screen height config must match.");
  assert.equal(other.screen.frameRate, first.screen.frameRate, clientName + " screen frame-rate config must match.");
  assert.equal(other.screen.generation, first.screen.generation, clientName + " screen generation must match.");
  assert.equal(other.screen.clockId, first.screen.clockId, clientName + " screen clock must match.");
}

async function inspectParticipation(client, expectedAudio, expectedScreen) {
  const connection = client.activeConnection;
  const previousCount = countControl(client, connection, "received", "participation.self");
  await client.page.getByTestId("participation-inspect").click();
  const snapshot = await waitControl(client, connection, "received", "participation.self", previousCount);
  assert.equal(snapshot.roomId, client.roomId, client.name + " self-inspection must remain in its joined room.");
  assert.equal(snapshot.media?.audioSubscribed, expectedAudio, client.name + " audio self-subscription should match the UI action.");
  assert.equal(snapshot.media?.screenSubscribed, expectedScreen, client.name + " screen self-subscription should match the UI action.");
  return {
    at: snapshot.at,
    elapsedMs: snapshot.elapsedMs,
    role: snapshot.role,
    mode: snapshot.mode,
    media: snapshot.media,
    transport: snapshot.transport,
  };
}

function receivedInteractions(client, eventId) {
  return controls(client, client.activeConnection, "received", "interaction.event")
    .filter((item) => item.eventId === eventId);
}

function feedbackCountText(client) {
  return client.page.getByTestId("feedback-like").locator(".interaction-feedback-count");
}

async function readFeedbackCount(client) {
  const label = await feedbackCountText(client).innerText();
  return Number(/^\s*(\d+)/u.exec(label)?.[1] ?? NaN);
}

async function sendRoomFeedback(sender, roomWatch, foreignClients) {
  const connection = sender.activeConnection;
  const ackBefore = countControl(sender, connection, "received", "interaction.ack");
  const submittedBefore = countControl(sender, connection, "sent", "interaction.submit");
  const sameRoomBefore = countControl(roomWatch, roomWatch.activeConnection, "received", "interaction.event");
  const visibleBefore = await readFeedbackCount(roomWatch);
  await sender.page.getByTestId("feedback-like").click();
  const ack = await waitControl(sender, connection, "received", "interaction.ack", ackBefore);
  const submission = await waitControl(sender, connection, "sent", "interaction.submit", submittedBefore);
  assert.equal(ack.roomId, sender.roomId, sender.name + " feedback ACK should name its joined room.");
  assert.equal(ack.acknowledged, true, sender.name + " feedback should receive a normal server ACK.");
  assert.equal(submission.kind, "feedback", sender.name + " should submit a feedback event.");
  assert.ok(submission.eventId && submission.eventId === ack.eventId, "feedback submit and ACK should share an event ID.");
  const event = await waitControl(roomWatch, roomWatch.activeConnection, "received", "interaction.event", sameRoomBefore);
  assert.equal(event.eventId, submission.eventId, "same-room watch receiver should observe the matching submitted event ID.");
  assert.ok(event.interactionId, "same-room event should also expose the server interaction ID.");
  assert.equal(event.kind, "feedback", "same-room event summary should retain only allowlisted event kind.");
  await roomWatch.page.waitForFunction((prior) => {
    const value = document.querySelector('[data-testid="feedback-like"] .interaction-feedback-count')?.textContent ?? "";
    const count = Number(/^\s*(\d+)/u.exec(value)?.[1] ?? NaN);
    return Number.isFinite(count) && count > prior;
  }, visibleBefore, { timeout: WAIT_TIMEOUT_MS });
  await delay(100);
  const foreignMatches = foreignClients.flatMap((client) => receivedInteractions(client, submission.eventId));
  assert.deepEqual(foreignMatches, [], "the foreign room must receive no event with this interaction ID.");
  addBounded(report.interactionAcks, { client: sender.name, roomId: sender.roomId, elapsedMs: ack.elapsedMs, duplicate: ack.duplicate }, "interaction-acks", MAX_INTERACTION_ACKS);
  const evidence = {
    sender: sender.name,
    roomId: sender.roomId,
    eventId: submission.eventId,
    kind: "feedback",
    acknowledged: true,
    sameRoomReceiver: roomWatch.name,
    sameRoomEventObserved: true,
    visibleFeedbackCountBefore: visibleBefore,
    visibleFeedbackCountAfter: await readFeedbackCount(roomWatch),
    foreignEventIdMatches: foreignMatches.length,
  };
  addBounded(report.feedbackEvidence, evidence, "feedback-evidence", 4);
  return evidence;
}

async function sampleReceivers(receiverClients, label) {
  const previous = new Map();
  for (const client of receiverClients) {
    const media = await mediaSnapshot(client.page);
    previous.set(client.name, { media, binary: binaryCounts(client.activeConnection) });
  }
  const samples = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    await delay(SAMPLE_INTERVAL_MS);
    const sample = { index: index + 1, at: new Date().toISOString(), elapsedMs: elapsedMs(), intervalMs: SAMPLE_INTERVAL_MS, receivers: {} };
    for (const client of receiverClients) {
      const media = await mediaSnapshot(client.page);
      const binary = binaryCounts(client.activeConnection);
      const prior = previous.get(client.name);
      assert.ok(media.audio.renderedSamples > prior.media.audio.renderedSamples, label + ": " + client.name + " AudioWorklet samples must advance at every interval.");
      assert.ok(media.screen.renderedFrames > prior.media.screen.renderedFrames, label + ": " + client.name + " rendered VP8 frames must advance at every interval.");
      assert.ok(media.audio.receivedPackets > prior.media.audio.receivedPackets, label + ": " + client.name + " audio packets must advance at every interval.");
      assert.ok(media.screen.receivedFrames > prior.media.screen.receivedFrames, label + ": " + client.name + " screen packets must advance at every interval.");
      assert.ok(binary.audio > prior.binary.audio && binary.screen > prior.binary.screen && binary.all > prior.binary.all,
        label + ": " + client.name + " must carry actual binary audio and video frames at every interval.");
      sample.receivers[client.name] = {
        media,
        receivedBinary: binary,
        delta: {
          audioFrames: binary.audio - prior.binary.audio,
          screenFrames: binary.screen - prior.binary.screen,
          binaryFrames: binary.all - prior.binary.all,
          bytes: binary.bytes - prior.binary.bytes,
        },
      };
      previous.set(client.name, { media, binary });
    }
    samples.push(sample);
  }
  return samples;
}

async function saveScreenshot(client, fileName) {
  try {
    await client.page.screenshot({ path: join(outputDirectory, fileName), fullPage: true, animations: "disabled", timeout: 8_000 });
    addBounded(report.screenshots, fileName, "screenshots", MAX_SCREENSHOTS);
  } catch (error) {
    addBounded(report.errors.cleanupErrors, { client: client.name, code: "screenshot_failed", message: redact(error?.message ?? error) }, "cleanup-errors");
  }
}

async function stopPublisher(client) {
  const connection = client.activeConnection;
  const audioStoppedBefore = countControl(client, connection, "received", "audio.stopped");
  const screenStoppedBefore = countControl(client, connection, "received", "screen.stopped");
  await client.page.getByRole("button", { name: "停止麥克風", exact: true }).click();
  const audioStopped = await waitControl(client, connection, "received", "audio.stopped", audioStoppedBefore);
  await client.page.getByRole("button", { name: "停止分享", exact: true }).click();
  const screenStopped = await waitControl(client, connection, "received", "screen.stopped", screenStoppedBefore);
  await client.page.waitForFunction(() => {
    const state = window.__t17Synthetic;
    return state && state.sources.length === 2 && state.sources.every((source) => source.track.readyState === "ended");
  }, undefined, { timeout: WAIT_TIMEOUT_MS });
  const state = await readSyntheticState(client);
  assert.equal(state.audioRequests, 1, client.name + " should create one synthetic audio source.");
  assert.equal(state.screenRequests, 1, client.name + " should create one synthetic screen source.");
  return { ...state, stoppedAcks: { audio: audioStopped, screen: screenStopped } };
}

async function readReceiverQuietWindow(client, label) {
  const connection = client.activeConnection;
  const beforeMedia = await mediaSnapshot(client.page);
  const beforeBinary = binaryCounts(connection);
  const beforeControlCount = connection.controls.length;
  await delay(SETTLE_MS);
  const afterMedia = await mediaSnapshot(client.page);
  const afterBinary = binaryCounts(connection);
  assert.deepEqual(afterBinary, beforeBinary, label + " must have no new received binary media after the bounded drain.");
  assert.equal(afterMedia.audio.receivedPackets, beforeMedia.audio.receivedPackets, label + " audio receive packets must remain stable after drain.");
  assert.equal(afterMedia.screen.receivedFrames, beforeMedia.screen.receivedFrames, label + " screen receive frames must remain stable after drain.");
  assert.ok(afterMedia.audio.renderRms <= 0.0001, label + " audio render should settle to silence.");
  assert.equal(afterMedia.screen.width, 0, label + " decoded screen width should be cleared.");
  assert.equal(afterMedia.screen.height, 0, label + " decoded screen height should be cleared.");
  return {
    client: client.name,
    drainMs: SETTLE_MS,
    controlMessagesDuringDrain: connection.controls.length - beforeControlCount,
    beforeBinary,
    afterBinary,
    audioReceivedPackets: afterMedia.audio.receivedPackets,
    audioRenderRms: afterMedia.audio.renderRms,
    screenReceivedFrames: afterMedia.screen.receivedFrames,
    screenSize: { width: afterMedia.screen.width, height: afterMedia.screen.height },
  };
}

function allMediaTrafficCounts() {
  return Object.fromEntries([...clients.values()].map((client) => {
    const connection = client.activeConnection;
    if (!connection) return [client.name, null];
    return [client.name, {
      sentFrames: connection.bytes.sent.binaryFrames,
      sentBytes: connection.bytes.sent.binaryBytes,
      receivedFrames: connection.bytes.received.binaryFrames,
      receivedBytes: connection.bytes.received.binaryBytes,
    }];
  }));
}

async function waitForRawQuietWindow() {
  const before = allMediaTrafficCounts();
  await delay(SETTLE_MS);
  const after = allMediaTrafficCounts();
  assert.deepEqual(after, before, "all raw media send/receive counters should stay stable after both sources stop.");
  report.rawQuietWindow = { durationMs: SETTLE_MS, before, after, stable: true };
}

function auditSourceHashes() {
  const sourceSets = {};
  const publisherSources = {};
  const receipts = {};
  const mapping = {};
  const traceReconciliation = {};
  let allTracesReconciled = true;
  let unknownBinaryFrames = 0;
  let ambiguous = 0;
  let foreignOnly = 0;
  let unknown = 0;
  let nonSubset = 0;
  for (const roomId of Object.keys(ROOMS)) {
    const host = clients.get(roomId + "-host");
    const sent = host?.activeConnection?.mediaHashes.sent ?? [];
    publisherSources[host?.name ?? roomId + "-host"] = { roomId, sent };
    sourceSets[roomId] = Object.fromEntries(["audio", "screen"].map((channel) => [
      channel,
      new Set(sent.filter((item) => item.channel === channel).map((item) => item.sha256)),
    ]));
  }
  for (const client of clients.values()) {
    const connection = client.activeConnection;
    if (!connection) continue;
    unknownBinaryFrames += connection.unparsedBinaryFrames.sent + connection.unparsedBinaryFrames.received;
    traceReconciliation[client.name] = {};
    for (const direction of ["sent", "received"]) {
      const stats = connection.bytes[direction];
      const hashes = connection.mediaHashes[direction];
      const hashBytes = hashes.reduce((sum, item) => sum + item.bytes, 0);
      const recognizedBinaryFrames = stats.audioFrames + stats.screenFrames;
      const reconciled = hashes.length === recognizedBinaryFrames && hashBytes === stats.binaryBytes &&
        recognizedBinaryFrames + connection.unparsedBinaryFrames[direction] === stats.binaryFrames;
      traceReconciliation[client.name][direction] = {
        hashCount: hashes.length,
        recognizedBinaryFrames,
        binaryFrames: stats.binaryFrames,
        unparsedBinaryFrames: connection.unparsedBinaryFrames[direction],
        hashBytes,
        binaryBytes: stats.binaryBytes,
        reconciled,
      };
      if (!reconciled) allTracesReconciled = false;
    }
    const received = connection.mediaHashes.received;
    receipts[client.name] = { roomId: client.roomId, received };
    const tally = { sameRoomMatched: 0, foreignOnly: 0, unknown: 0, ambiguous: 0, byChannel: {} };
    for (const channel of ["audio", "screen"]) {
      const own = sourceSets[client.roomId]?.[channel] ?? new Set();
      const foreignRoom = Object.keys(ROOMS).find((roomId) => roomId !== client.roomId);
      const foreign = sourceSets[foreignRoom]?.[channel] ?? new Set();
      const channelTally = { received: 0, sameRoomMatched: 0, foreignOnly: 0, unknown: 0, ambiguous: 0 };
      for (const item of received.filter((record) => record.channel === channel)) {
        channelTally.received += 1;
        const ownMatch = own.has(item.sha256);
        const foreignMatch = foreign.has(item.sha256);
        if (ownMatch && foreignMatch) {
          channelTally.ambiguous += 1;
        } else if (ownMatch) {
          channelTally.sameRoomMatched += 1;
        } else if (foreignMatch) {
          channelTally.foreignOnly += 1;
        } else {
          channelTally.unknown += 1;
        }
      }
      tally.byChannel[channel] = channelTally;
    }
    tally.sameRoomMatched = Object.values(tally.byChannel).reduce((sum, item) => sum + item.sameRoomMatched, 0);
    tally.foreignOnly = Object.values(tally.byChannel).reduce((sum, item) => sum + item.foreignOnly, 0);
    tally.unknown = Object.values(tally.byChannel).reduce((sum, item) => sum + item.unknown, 0);
    tally.ambiguous = Object.values(tally.byChannel).reduce((sum, item) => sum + item.ambiguous, 0);
    foreignOnly += tally.foreignOnly;
    unknown += tally.unknown;
    ambiguous += tally.ambiguous;
    nonSubset += tally.foreignOnly + tally.unknown + tally.ambiguous;
    mapping[client.name] = tally;
  }
  const capsClean = !collectionOverflow && [...clients.values()].every((client) => !client.collectionOverflow);
  const sourceKindsPresent = Object.keys(ROOMS).every((roomId) => ["audio", "screen"].every((channel) => sourceSets[roomId]?.[channel]?.size > 0));
  const onlyRawZero = ["lobby-interaction", "studio-interaction"].every((name) => {
    const client = clients.get(name);
    return client?.activeConnection?.bytes.received.binaryFrames === 0 && (client?.activeConnection?.mediaHashes.received.length ?? 0) === 0;
  });
  const watchReceiptsPresent = ["lobby-watch", "studio-watch"].every((name) => {
    const tally = mapping[name];
    return tally?.byChannel.audio.received > 0 && tally.byChannel.screen.received > 0 &&
      tally.byChannel.audio.sameRoomMatched === tally.byChannel.audio.received &&
      tally.byChannel.screen.sameRoomMatched === tally.byChannel.screen.received;
  });
  const complete = capsClean && sourceKindsPresent && watchReceiptsPresent && allTracesReconciled && onlyRawZero && unknownBinaryFrames === 0 && foreignOnly === 0 && unknown === 0 && ambiguous === 0 && nonSubset === 0;
  report.sourceHashAudit = {
    capPerClientDirection: MAX_MEDIA_HASHES_PER_CLIENT_DIRECTION,
    complete,
    algorithm: "SHA-256 over each bounded raw binary LTA1/LTS1 media message; only hashes, channel, byte count, generation, sequence, and elapsed time are retained.",
    sourceKindsPresent,
    watchReceiptsPresent,
    capsClean,
    allTracesReconciled,
    unknownBinaryFrames,
    dedicatedInteractionOnlyRawMediaZero: onlyRawZero,
    publisherSources,
    receipts,
    mapping,
    traceReconciliation,
    totals: { foreignOnly, unknown, ambiguous, nonSubset },
  };
  assert.equal(capsClean, true, "raw media source/receipt hash collector must not overflow its cap.");
  assert.equal(sourceKindsPresent, true, "each publisher must provide captured audio and screen source hashes.");
  assert.equal(watchReceiptsPresent, true, "each room watch receiver must map received audio and screen hashes to its own publisher.");
  assert.equal(allTracesReconciled, true, "per-client raw binary counts and bytes must reconcile to the complete bounded hash lists.");
  assert.equal(onlyRawZero, true, "interaction-only roles must receive zero raw binary media for the full run.");
  assert.equal(unknownBinaryFrames, 0, "all binary frames must be recognized media messages for a complete hash audit.");
  assert.equal(foreignOnly, 0, "foreign-room received hashes must be zero.");
  assert.equal(unknown, 0, "received hashes must all map to the same-room publisher source.");
  assert.equal(ambiguous, 0, "received hashes must not match both room publisher source sets.");
}

async function saveFinalReport() {
  report.finishedAt = new Date().toISOString();
  report.durationMs = elapsedMs();
  report.errors.failure = failure ? redact(failure?.message ?? failure) : null;
  if (collectionOverflow || [...clients.values()].some((client) => client.collectionOverflow)) {
    addBounded(report.errors.collectionErrors, { code: "bounded_collection_overflow" }, "collection-errors");
    if (!failure) report.errors.failure = "A bounded evidence collection overflowed.";
  }
  if (report.errors.pageErrors.length || report.errors.collectionErrors.length || report.errors.cleanupErrors.length) {
    if (!report.errors.failure) report.errors.failure = "A page, collection, or cleanup error was recorded.";
  }
  if (report.privacy.configuredSecretEchoObserved && !report.errors.failure) {
    report.errors.failure = "A configured credential appeared in a received control payload; the value was not retained.";
  }
  if (!report.sourceHashAudit.complete && !report.errors.failure) {
    report.errors.failure = "The source/receipt hash audit was not complete.";
  }
  report.controlObservations = [...clients.values()].map((client) => ({
    client: client.name,
    browser: { engine: "Firefox", version: client.context.browser()?.version() ?? "not-reported", realProcess: true },
    connections: client.connections.map((connection) => ({
      index: connection.index,
      openedAt: connection.openedAt,
      openedAtElapsedMs: connection.openedAtElapsedMs,
      binaryMediaBytesOnly: binaryCounterSummary(connection),
      unparsedBinaryFrames: connection.unparsedBinaryFrames,
      controls: connection.controls,
    })),
  }));
  report.status = report.errors.failure ? "failed" : "passed";
  let serialized = JSON.stringify(report, null, 2) + "\n";
  const secretLeak = [...secretValues].some((secret) => secret && serialized.includes(secret));
  if (secretLeak) {
    report.status = "failed";
    report.errors.failure = "A configured or observed credential was found in the retained report; its value was redacted.";
    serialized = JSON.stringify(report, null, 2) + "\n";
    for (const secret of secretValues) if (secret) serialized = serialized.split(secret).join("[redacted]");
  }
  report.privacy.finalSerializationSecretScanPassed = ![...secretValues].some((secret) => secret && serialized.includes(secret));
  if (!report.privacy.finalSerializationSecretScanPassed) {
    report.status = "failed";
    report.errors.failure = "The final report secret scan failed after redaction.";
  }
  serialized = JSON.stringify(report, null, 2) + "\n";
  for (const secret of secretValues) if (secret) serialized = serialized.split(secret).join("[redacted]");
  try {
    writeFileSync(join(outputDirectory, "report.json"), serialized, { mode: 0o600 });
    writeFileSync(join(outputDirectory, "README.md"), [
      "# T17 two-room mixed-mode smoke",
      "",
      "Status: " + report.status,
      "Started: " + report.startedAt,
      "Finished: " + report.finishedAt,
      "Duration: " + report.durationMs + " ms",
      "",
      "Two actual Firefox publishers, two actual watch receivers, and two interaction-only participants joined lobby and locked studio through the normal room UI. Each room host generated one synthetic Opus source and one synthetic VP8 canvas source. The report retains bounded SHA-256 media message hashes, allowlisted control summaries, byte/frame counters, server self/downlink counters, playback counters, and screenshots; it does not retain media payloads, full control payloads, credentials, or browser storage.",
      "",
      "This short run is a core feasibility check. It does not establish capacity, quality, end-to-end latency, human listening, physical-device capture, weak-network behavior, or deployment readiness.",
      "",
      "Source-hash audit complete: " + report.sourceHashAudit.complete,
      "Failure: " + (report.errors.failure ?? "none"),
      "",
    ].join("\n"), { mode: 0o600 });
    const readBack = JSON.parse(readFileSync(join(outputDirectory, "report.json"), "utf8"));
    assert.equal(readBack.startedAt, report.startedAt, "saved report should read back with the same run ID.");
    assert.equal(readBack.status, report.status, "saved report should read back with the same status.");
    assert.equal(readBack.sourceHashAudit?.complete, report.sourceHashAudit.complete, "saved report should preserve final hash audit completeness.");
    report.privacy.reportJsonReadBackPassed = true;
    serialized = JSON.stringify(report, null, 2) + "\n";
    for (const secret of secretValues) if (secret) serialized = serialized.split(secret).join("[redacted]");
    writeFileSync(join(outputDirectory, "report.json"), serialized, { mode: 0o600 });
    const finalReadBack = JSON.parse(readFileSync(join(outputDirectory, "report.json"), "utf8"));
    assert.equal(finalReadBack.privacy.reportJsonReadBackPassed, true, "final report should retain its successful readback marker.");
    assert.equal([...secretValues].some((secret) => secret && JSON.stringify(finalReadBack).includes(secret)), false,
      "saved report readback must not contain configured or observed secrets.");
  } catch (error) {
    report.status = "failed";
    report.errors.failure = redact(error?.message ?? "report write failed");
    console.error("[T17] report write/readback failed: " + report.errors.failure);
    process.exitCode = 1;
  }
  console.log("[T17] " + report.status + " report=" + join(outputDirectory, "report.json"));
}


try {
  const caPem = readFileSync(caCertificate, "utf8");
  assert.ok(caPem.includes("BEGIN CERTIFICATE"), "Configured CA file should contain a PEM certificate.");

  const launched = await Promise.all(CLIENT_NAMES.map((name) => launchClient(name)));
  report.runtime.firefox = launched[0].context.browser()?.version() ?? "not-reported";
  const byName = (name) => clients.get(name);
  const hosts = Object.keys(ROOMS).map((roomId) => byName(roomId + "-host"));
  const watches = Object.keys(ROOMS).map((roomId) => byName(roomId + "-watch"));
  const onlyParticipants = Object.keys(ROOMS).map((roomId) => byName(roomId + "-interaction"));
  const lobbyWatch = byName("lobby-watch");
  const studioWatch = byName("studio-watch");
  const lobbyOnly = byName("lobby-interaction");
  const studioOnly = byName("studio-interaction");
  await Promise.all(Object.keys(ROOMS).map((roomId) => installSyntheticMedia(byName(roomId + "-host").page, roomId)));

  await runStage("join-six-clients-through-normal-room-entry-and-claim-two-hosts", async () => {
    await Promise.all(CLIENT_NAMES.map((name) => {
      const roomId = name.startsWith("lobby-") ? "lobby" : "studio";
      const role = name.endsWith("-host") ? "Host" : name.endsWith("-watch") ? "Watch" : "Interaction";
      return joinRoom(byName(name), "T17 " + roomId + " " + role, roomId);
    }));
    await Promise.all(hosts.map((host) => claimHost(host)));
    for (const client of clients.values()) {
      report.clients[client.name] = {
        roomId: client.roomId,
        expectedRole: client.name.endsWith("-host") ? "host and publisher" : "participant",
        intendedMode: client.name.endsWith("-interaction") ? "interaction" : "watch",
        joinedThroughNormalRoomUrlAndUI: true,
        expectedInitialGateError: client.expectedInitialGateError ?? null,
        isolatedFirefoxProfile: true,
      };
    }
    return {
      rooms: Object.keys(ROOMS),
      actualFirefoxProcesses: clients.size,
      hostClaimsThroughNormalUI: hosts.length,
      studioPasswordSubmittedThroughDoorDialog: true,
      lobbyPasswordPromptShown: false,
    };
  });

  await runStage("interaction-only-participants-switch-before-any-source-starts", async () => {
    for (const client of onlyParticipants) {
      const changed = await setParticipationMode(client, "interaction");
      const self = await inspectParticipation(client, false, false);
      assert.equal(self.role, "participant", client.name + " should be a normal participant connection.");
      assert.equal(self.mode, "interaction", client.name + " server self mode should be interaction.");
      assert.equal(self.media.audioDownlinkBytes, 0, client.name + " initial server audio downlink must be zero.");
      assert.equal(self.media.audioDownlinkFrames, 0, client.name + " initial server audio downlink frames must be zero.");
      assert.equal(self.media.screenDownlinkBytes, 0, client.name + " initial server screen downlink must be zero.");
      assert.equal(self.media.screenDownlinkFrames, 0, client.name + " initial server screen downlink frames must be zero.");
      assert.equal(client.activeConnection.bytes.received.binaryFrames, 0, client.name + " must receive no raw binary media before publication.");
      report.clients[client.name].initialModeAcknowledgement = changed;
      report.clients[client.name].initialSelf = self;
      addBounded(report.modeTransitions, { client: client.name, roomId: client.roomId, mode: "interaction", serverSelf: self }, "mode-transitions", 8);
    }
    return { interactionOnlyCount: onlyParticipants.length, beforeSourceStart: true, serverSelfModeAndNoSubscriptionVerified: true };
  });

  await runStage("two-hosts-start-one-synthetic-opus-and-vp8-source-each", async () => {
    await Promise.all(hosts.map(async (host) => {
      await startPublishing(host);
      await waitUntilActiveSources(host);
      const sourceState = await readSyntheticState(host);
      assert.equal(sourceState.audioRequests, 1, host.name + " should create one synthetic audio source.");
      assert.equal(sourceState.screenRequests, 1, host.name + " should create one synthetic screen source.");
      report.clients[host.name].syntheticSourceState = sourceState;
    }));
    return { publishers: hosts.map((host) => host.name), codecs: { audio: "opus", video: "vp8" }, opensPerPublisherPerKind: 1 };
  });

  await runStage("two-watch-receivers-decode-and-render-distinct-live-room-sources", async () => {
    await Promise.all(watches.map((watch) => startReceiving(watch)));
    const initialMedia = new Map(watches.map((watch) => [watch.name, null]));
    for (const watch of watches) {
      const media = await waitForRenderedMedia(watch);
      initialMedia.set(watch.name, media);
      const config = streamConfiguration(watch);
      report.streamConfigurations[watch.roomId] = config;
      const self = await inspectParticipation(watch, true, true);
      assert.equal(self.role, "participant", watch.name + " should remain a normal participant.");
      assert.equal(self.mode, "watch", watch.name + " server self mode should be watch.");
      assert.ok(self.media.audioDownlinkBytes > 0 && self.media.audioDownlinkFrames > 0, watch.name + " audio server downlink should be positive.");
      assert.ok(self.media.screenDownlinkBytes > 0 && self.media.screenDownlinkFrames > 0, watch.name + " screen server downlink should be positive.");
      report.clients[watch.name].configuration = config;
      report.clients[watch.name].activeSelf = self;
      report.clients[watch.name].initialRenderedMedia = media;
    }
    const lobbyConfig = report.streamConfigurations.lobby;
    const studioConfig = report.streamConfigurations.studio;
    assert.notEqual(lobbyConfig.audio.clockId, studioConfig.audio.clockId, "room publishers should use distinct source clocks.");
    assert.notDeepEqual(ROOMS.lobby.color, ROOMS.studio.color, "rooms should have distinct synthetic canvas colors.");
    const samples = await sampleReceivers(watches, "both rooms active");
    report.mediaSamples.push({ label: "both rooms active", samples });
    await Promise.all([
      saveScreenshot(lobbyWatch, "lobby-watch-live.png"),
      saveScreenshot(studioWatch, "studio-watch-live.png"),
    ]);
    assert.ok(report.screenshots.includes("lobby-watch-live.png") && report.screenshots.includes("studio-watch-live.png"),
      "both watch receivers should have live screenshots.");
    for (const client of onlyParticipants) {
      const self = await inspectParticipation(client, false, false);
      assert.equal(self.mode, "interaction", client.name + " mode should remain interaction during media activity.");
      assert.equal(self.media.audioDownlinkBytes, 0, client.name + " server audio downlink bytes must remain zero during activity.");
      assert.equal(self.media.audioDownlinkFrames, 0, client.name + " server audio downlink frames must remain zero during activity.");
      assert.equal(self.media.screenDownlinkBytes, 0, client.name + " server screen downlink bytes must remain zero during activity.");
      assert.equal(self.media.screenDownlinkFrames, 0, client.name + " server screen downlink frames must remain zero during activity.");
      assert.equal(client.activeConnection.bytes.received.binaryFrames, 0, client.name + " raw binary media must remain zero during activity.");
      report.clients[client.name].activeSelf = self;
    }
    return {
      watchReceivers: watches.length,
      allActualFirefoxDecoders: true,
      audioCodec: "opus",
      videoCodec: "vp8",
      lobbyClockId: lobbyConfig.audio.clockId,
      studioClockId: studioConfig.audio.clockId,
      samplesPerWatch: samples.length,
      interactionOnlyServerAndRawMediaRemainZero: true,
      screenshots: [...report.screenshots],
    };
  });

  await runStage("feedback-ack-same-room-visible-event-and-foreign-room-isolation", async () => {
    const lobbyEvidence = await sendRoomFeedback(lobbyOnly, lobbyWatch, [byName("studio-host"), studioWatch, studioOnly]);
    const studioEvidence = await sendRoomFeedback(studioOnly, studioWatch, [byName("lobby-host"), lobbyWatch, lobbyOnly]);
    return { feedbackEvidence: [lobbyEvidence, studioEvidence], ackIsNotUsedAsDisplayEvidence: true };
  });

  await runStage("studio-watch-switches-to-interaction-and-lobby-keeps-growing", async () => {
    const before = await inspectParticipation(studioWatch, true, true);
    const ack = await setParticipationMode(studioWatch, "interaction");
    const afterAck = await inspectParticipation(studioWatch, false, false);
    assert.equal(afterAck.mode, "interaction");
    assert.ok(before.media.audioDownlinkBytes > 0 && before.media.screenDownlinkBytes > 0,
      "studio watch should have nonzero server downlink bytes before switching mode.");
    const afterAckRaw = binaryCounts(studioWatch.activeConnection);
    const lobbyBefore = await inspectParticipation(lobbyWatch, true, true);
    const samples = await sampleReceivers([lobbyWatch], "lobby while studio watch is interaction-only");
    const afterWindowRaw = binaryCounts(studioWatch.activeConnection);
    const afterWindow = await inspectParticipation(studioWatch, false, false);
    const lobbyAfter = await inspectParticipation(lobbyWatch, true, true);
    assert.deepEqual(afterWindowRaw, afterAckRaw, "studio raw binary media should stay stable after interaction mode ACK.");
    assert.equal(afterWindow.media.audioDownlinkBytes, afterAck.media.audioDownlinkBytes, "studio audio downlink should have zero delta after interaction ACK.");
    assert.equal(afterWindow.media.audioDownlinkFrames, afterAck.media.audioDownlinkFrames, "studio audio downlink frames should have zero delta after interaction ACK.");
    assert.equal(afterWindow.media.screenDownlinkBytes, afterAck.media.screenDownlinkBytes, "studio screen downlink should have zero delta after interaction ACK.");
    assert.equal(afterWindow.media.screenDownlinkFrames, afterAck.media.screenDownlinkFrames, "studio screen downlink frames should have zero delta after interaction ACK.");
    assert.ok(lobbyAfter.media.audioDownlinkBytes > lobbyBefore.media.audioDownlinkBytes && lobbyAfter.media.screenDownlinkBytes > lobbyBefore.media.screenDownlinkBytes,
      "lobby watch server downlink should keep growing during the studio mode transition window.");
    const quiet = await readReceiverQuietWindow(studioWatch, "studio watch switched to interaction mode");
    report.studioWatchStop = {
      modeChangedAck: ack,
      serverSelfBefore: before,
      serverSelfAfterAck: afterAck,
      serverSelfAfterWindow: afterWindow,
      serverDownlinkDelta: { audioBytes: 0, audioFrames: 0, screenBytes: 0, screenFrames: 0 },
      rawBinaryAfterAck: afterAckRaw,
      rawBinaryAfterWindow: afterWindowRaw,
      activityWindowMs: samples.reduce((sum, sample) => sum + sample.intervalMs, 0),
      lobbySamples: samples,
      lobbySelfBefore: lobbyBefore,
      lobbySelfAfter: lobbyAfter,
      clearedMedia: quiet,
    };
    report.mediaSamples.push({ label: "lobby while studio watch is interaction-only", samples });
    addBounded(report.modeTransitions, { client: studioWatch.name, roomId: studioWatch.roomId, mode: "interaction", serverSelf: afterWindow }, "mode-transitions", 8);
    return { studioMode: "interaction", serverDownlinkDelta: 0, rawBinaryDelta: 0, lobbyWatchContinued: true, lobbySamples: samples.length, clearedLocalPlayback: true };
  });

  await runStage("studio-watch-mode-return-does-not-auto-subscribe-until-manual-receive", async () => {
    const watchAck = await setParticipationMode(studioWatch, "watch");
    const noAutoStartSelf = await inspectParticipation(studioWatch, false, false);
    const noAutoStartRaw = binaryCounts(studioWatch.activeConnection);
    const lobbyBefore = await inspectParticipation(lobbyWatch, true, true);
    const lobbySamples = await sampleReceivers([lobbyWatch], "lobby while studio watch has no auto-subscription");
    const afterWaitSelf = await inspectParticipation(studioWatch, false, false);
    const afterWaitRaw = binaryCounts(studioWatch.activeConnection);
    const lobbyAfter = await inspectParticipation(lobbyWatch, true, true);
    assert.equal(noAutoStartSelf.mode, "watch");
    assert.equal(noAutoStartSelf.media.audioSubscribed, false, "switching back to watch should not auto-subscribe audio.");
    assert.equal(noAutoStartSelf.media.screenSubscribed, false, "switching back to watch should not auto-subscribe screen.");
    assert.deepEqual(afterWaitRaw, noAutoStartRaw, "no raw media should arrive before manual receive after mode changes back to watch.");
    assert.equal(afterWaitSelf.media.audioDownlinkBytes, noAutoStartSelf.media.audioDownlinkBytes, "server audio downlink should remain stable before manual receive.");
    assert.equal(afterWaitSelf.media.screenDownlinkBytes, noAutoStartSelf.media.screenDownlinkBytes, "server screen downlink should remain stable before manual receive.");
    assert.ok(lobbyAfter.media.audioDownlinkBytes > lobbyBefore.media.audioDownlinkBytes && lobbyAfter.media.screenDownlinkBytes > lobbyBefore.media.screenDownlinkBytes,
      "lobby watch should continue growing while studio is eligible but not subscribed.");

    const mediaBeforeManualReceive = await mediaSnapshot(studioWatch.page);
    const audioConfigBefore = countControl(studioWatch, studioWatch.activeConnection, "received", "audio.stream");
    const screenConfigBefore = countControl(studioWatch, studioWatch.activeConnection, "received", "screen.stream");
    await startReceiving(studioWatch);
    await waitControl(studioWatch, studioWatch.activeConnection, "received", "audio.stream", audioConfigBefore);
    await waitControl(studioWatch, studioWatch.activeConnection, "received", "screen.stream", screenConfigBefore);
    const resumedMedia = await waitForRenderedMedia(studioWatch, mediaBeforeManualReceive);
    const resumedConfig = streamConfiguration(studioWatch);
    assertSameConfiguration(report.streamConfigurations.studio, resumedConfig, studioWatch.name + " fresh receive configuration");
    const resumedSelf = await inspectParticipation(studioWatch, true, true);
    assert.ok(resumedSelf.media.audioDownlinkBytes > noAutoStartSelf.media.audioDownlinkBytes && resumedSelf.media.screenDownlinkBytes > noAutoStartSelf.media.screenDownlinkBytes,
      "manual receive should resume server downlink after fresh config and keyframe.");
    const resumedSamples = await sampleReceivers(watches, "both rooms after manual studio receive");
    report.mediaSamples.push({ label: "lobby while studio watch has no auto-subscription", samples: lobbySamples });
    report.mediaSamples.push({ label: "both rooms after manual studio receive", samples: resumedSamples });
    report.clients[studioWatch.name].resumedConfiguration = resumedConfig;
    report.clients[studioWatch.name].resumedSelf = resumedSelf;
    report.clients[studioWatch.name].resumedRenderedMedia = resumedMedia;
    report.studioWatchStop.modeReturn = {
      modeChangedAck: watchAck,
      noAutoStartSelf,
      afterWaitSelf,
      noAutoStartRaw,
      afterWaitRaw,
      lobbySelfBefore: lobbyBefore,
      lobbySelfAfter: lobbyAfter,
      lobbySamples,
      manualReceiveSelf: resumedSelf,
      freshConfiguration: resumedConfig,
      resumedRenderedMedia: resumedMedia,
    };
    addBounded(report.modeTransitions, { client: studioWatch.name, roomId: studioWatch.roomId, mode: "watch", serverSelf: resumedSelf }, "mode-transitions", 8);
    return { noAutoSubscribeAfterModeChange: true, manualReceiveStarted: true, freshAudioAndScreenConfiguration: true, decodedMediaResumed: true, lobbyContinued: true };
  });

  await runStage("normal-ui-stops-both-host-sources-and-watchers-drain", async () => {
    const endedCounts = new Map(watches.map((watch) => [watch.name, {
      audio: countControl(watch, watch.activeConnection, "received", "audio.streamEnded"),
      screen: countControl(watch, watch.activeConnection, "received", "screen.streamEnded"),
    }]));
    const sourceStates = await Promise.all(hosts.map((host) => stopPublisher(host)));
    const ended = {};
    for (const watch of watches) {
      const prior = endedCounts.get(watch.name);
      ended[watch.name] = {
        audio: await waitControl(watch, watch.activeConnection, "received", "audio.streamEnded", prior.audio),
        screen: await waitControl(watch, watch.activeConnection, "received", "screen.streamEnded", prior.screen),
      };
    }
    const quietWindows = [];
    for (const watch of watches) quietWindows.push(await readReceiverQuietWindow(watch, "publisher-stopped " + watch.name));
    for (let index = 0; index < hosts.length; index += 1) {
      report.publisherStops[hosts[index].roomId] = { client: hosts[index].name, sourceState: sourceStates[index], streamEnded: Object.fromEntries(watches.filter((watch) => watch.roomId === hosts[index].roomId).map((watch) => [watch.name, ended[watch.name]])) };
    }
    report.publisherStops.receiverQuietWindows = quietWindows;
    return { normalUIStopForBothPublishers: true, audioAndScreenTracksEnded: true, watchReceiversStreamEnded: watches.length, quietDrainMs: SETTLE_MS };
  });

  await runStage("raw-trace-quiets-then-complete-two-room-source-hash-audit", async () => {
    await waitForRawQuietWindow();
    auditSourceHashes();
    return {
      sourceHashesComplete: report.sourceHashAudit.complete,
      publishers: Object.keys(report.sourceHashAudit.publisherSources),
      receiptingClients: Object.keys(report.sourceHashAudit.receipts).length,
      foreignOnly: report.sourceHashAudit.totals.foreignOnly,
      unknown: report.sourceHashAudit.totals.unknown,
      ambiguous: report.sourceHashAudit.totals.ambiguous,
      dedicatedInteractionOnlyRawMediaZero: report.sourceHashAudit.dedicatedInteractionOnlyRawMediaZero,
    };
  });

  const controlErrors = [...clients.values()].flatMap((client) => client.connections.flatMap((connection) =>
    connection.controls.filter((item) => item.direction === "received" && ["interaction.error", "protocol.error"].includes(item.type))
      .map((item) => ({ client: client.name, type: item.type, code: item.code ?? "unknown" }))));
  const expectedControlErrors = [...clients.values()].flatMap((client) => Array.from(
    { length: client.expectedInitialGateError?.count ?? 0 },
    () => ({ client: client.name, type: client.expectedInitialGateError.type, code: client.expectedInitialGateError.code }),
  ));
  const sortErrors = (items) => items.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  assert.deepEqual(sortErrors(controlErrors), sortErrors(expectedControlErrors),
    "only one expected locked-studio password-required protocol response per studio browser is allowed.");
  report.expectedEntryGateOutcomes = controlErrors;
  assert.ok(report.screenshots.length >= 2, "at least two actual live Firefox screenshots are required.");
} catch (error) {
  failure = error;
  console.error("[T17] failed: " + redact(error?.message ?? error));
} finally {
  for (const client of clients.values()) {
    try {
      if (!client.page.isClosed()) await client.page.evaluate(() => window.__t17SyntheticCleanup?.());
    } catch (error) {
      addBounded(report.errors.cleanupErrors, { client: client.name, code: "synthetic_cleanup_failed", message: redact(error?.message ?? error) }, "cleanup-errors");
    }
  }
  const closeResults = await Promise.allSettled(contexts.map((context) => context.close()));
  closeResults.forEach((result, index) => {
    if (result.status === "rejected") {
      addBounded(report.errors.cleanupErrors, { client: CLIENT_NAMES[index] ?? "unknown", code: "firefox_context_close_failed", message: redact(result.reason?.message ?? result.reason) }, "cleanup-errors");
    }
  });
  for (const folder of runtimeFolders) {
    try { rmSync(folder, { recursive: true, force: true }); }
    catch (error) { addBounded(report.errors.cleanupErrors, { code: "profile_cleanup_failed", message: redact(error?.message ?? error) }, "cleanup-errors"); }
  }
  if (!failure && report.errors.cleanupErrors.length) failure = new Error("A bounded cleanup operation reported an error.");
  await saveFinalReport();
  if (report.status !== "passed") process.exitCode = 1;
}
