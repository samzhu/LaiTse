import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hostToken = process.env.INTEGRATED_TEST_HOST_TOKEN ?? "";
const roomPassword = process.env.INTEGRATED_TEST_ROOM_PASSWORD ?? "";
const secretValues = new Set([hostToken, roomPassword].filter(Boolean));
const configuredSecretValues = new Set([hostToken, roomPassword].filter(Boolean));
const scratchRoot = resolve(root, ".scratch/t15");
const outputDirectory = resolve(root, process.env.INTEGRATED_OUTPUT_DIR ?? ".scratch/t15/acceptance");
const outputRelative = relative(scratchRoot, outputDirectory);
if (isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(".." + sep)) {
  throw new Error("INTEGRATED_OUTPUT_DIR must stay inside .scratch/t15.");
}

if (process.version !== "v26.13.0") {
  throw new Error("Use the repository-pinned Node v26.13.0 runtime for this smoke.");
}
if (!hostToken || !roomPassword) {
  throw new Error("Set INTEGRATED_TEST_HOST_TOKEN and INTEGRATED_TEST_ROOM_PASSWORD in the process environment.");
}

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, ".tools/playwright-browsers");
const { firefox } = await import("playwright");
const baseURL = process.env.INTEGRATED_BASE_URL ?? "https://localhost:4173";
const target = new URL(baseURL);
if (target.protocol !== "https:" || target.username || target.password || target.search || target.hash || target.pathname !== "/") {
  throw new Error("INTEGRATED_BASE_URL must be a trusted HTTPS application root without credentials, query, or fragment.");
}

const caCertificate = resolve(root, process.env.INTEGRATED_CA_CERT ?? ".scratch/t01/tls/local-ca.pem");
const certificateUtility = process.env.CERTUTIL_BIN ?? "certutil";
const headless = process.env.HEADLESS !== "0";
const holdSeconds = Number(process.env.INTEGRATED_HOLD_SECONDS ?? "0");
if (!Number.isInteger(holdSeconds) || holdSeconds < 0 || holdSeconds > 4_200) {
  throw new Error("INTEGRATED_HOLD_SECONDS must be an integer from 0 through 4200; 0 keeps this smoke lightweight.");
}

const CLOSE_CODE = 4003;
const SIMULATED_TIMEOUT_MS = 1_000;
const RECOVERY_TIMEOUT_MS = 20_000;
const MEDIA_TIMEOUT_MS = 12_000;
const HEALTH_SAMPLE_INTERVAL_MS = 400;
const MAX_HEALTH_SAMPLES = 64;
const MAX_HOLD_SAMPLES = 160;
const MAX_CONTROLS_PER_CONNECTION = 240;
const MAX_CONNECTIONS_PER_CLIENT = 8;
const MAX_STAGES = 32;
const MAX_ERRORS = 20;
const ROOM_COLORS = { lobby: [224, 52, 46], studio: [38, 184, 92] };
const ROOM_FREQUENCIES = { lobby: 523, studio: 997 };
const CLIENTS = ["studio-host", "studio-publisher", "lobby-host", "lobby-receiver"];
const contexts = [];
const runtimeFolders = new Set();
const clients = new Map();
const pages = new Map();
const startedAtEpochMs = Date.now();
let failure = null;
let healthMonitor = null;

mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });

const report = {
  schemaVersion: 1,
  purpose: "Short T15 two-room integrated synthetic media, receiver recovery, and revoked-publisher resume smoke.",
  startedAt: new Date().toISOString(),
  finishedAt: null,
  durationMs: null,
  status: "running",
  baseURL: target.origin,
  runtime: { node: process.version, platform: process.platform, architecture: process.arch, firefox: "not-reported" },
  tls: {
    caCertificate: relative(root, caCertificate),
    trust: "local CA imported only into isolated Firefox NSS profiles; certificate errors are not ignored",
    ignoreCertificateErrors: false,
    systemTrustChanged: false,
  },
  topology: {
    rooms: ["lobby", "studio"],
    browsers: CLIENTS,
    isolatedFirefoxProfiles: 4,
    roles: {
      "studio-host": "studio host and receiver",
      "studio-publisher": "studio participant granted publishing by the studio host UI",
      "lobby-host": "lobby host and synthetic publisher",
      "lobby-receiver": "lobby participant and healthy receiver",
    },
    network: "one externally running managed local HTTPS/WSS application",
  },
  credentials: {
    hostToken: "provided in process memory; value not recorded",
    roomPassword: "provided in process memory; value not recorded",
    resumeTokens: "observed only as presence flags; values not retained",
  },
  syntheticSources: {
    audio: "per-room oscillator routed through AudioContext MediaStreamDestination; no physical microphone",
    video: "per-room animated canvas returned by test-only getDisplayMedia replacement; no physical display capture",
    frequenciesHz: ROOM_FREQUENCIES,
    colorsRgb: ROOM_COLORS,
    mediaPayloadsRetained: false,
  },
  disturbance: {
    kind: "test-only Playwright WebSocketRoute close on the studio host receiver connection",
    deadlineMs: SIMULATED_TIMEOUT_MS,
    schedule: null,
    closeCode: CLOSE_CODE,
    closeEndpoints: ["browser-route", "server-route"],
    claim: "controlled application connection close only; not a Cloud Run timeout, TCP shaping, packet loss, or real background transition",
  },
  optionalActiveHold: {
    requestedSeconds: holdSeconds,
    completedSeconds: 0,
    startedAt: null,
    finishedAt: null,
    sampleIntervalMaxSeconds: 30,
    samples: [],
    executed: false,
  },
  checks: [],
  controlObservations: [],
  streamClockIds: { lobby: null, studio: null },
  recoveries: [],
  interactionAcks: [],
  revocation: null,
  healthyLobbySamples: [],
  screenshots: [],
  privacy: {
    rawControlPayloadsRetained: false,
    rawMediaPayloadsRetained: false,
    packetHashesRetained: false,
    browserStorageDumped: false,
    configuredSecretEchoObserved: false,
    tokenPasswordOrResumeValuesWritten: false,
  },
  limits: {
    streamSeparation: "room/source clock IDs, stream configuration and synthetic decoded pixel colors are checked; no raw media hash audit is performed",
    disturbance: "route close simulates a local application connection drop; it is not a real weak network or server timeout",
    devices: "no phone, physical microphone, physical display, human listening, real backgrounding, packet loss, p95, capacity, durability, or Cloud Run result",
    productStatus: "this short feasibility smoke does not establish full POC-04 completion or deployment readiness",
  },
  errors: { pageErrors: [], collectionErrors: [], cleanupErrors: [], failure: null },
};

function elapsedMs() {
  return Date.now() - startedAtEpochMs;
}

function redact(value) {
  let output = String(value ?? "");
  for (const secret of secretValues) {
    if (secret) output = output.split(secret).join("[redacted]");
  }
  output = output.replace(/("(?:token|password|resumeToken)"\s*:\s*")[^"]*(")/giu, "$1[redacted]$2");
  output = output.replace(/\b(?:Bearer\s+)?[A-Za-z0-9_-]{48,}\b/gu, "[redacted-token]");
  return output.slice(0, 320);
}

function addBounded(array, value, label, cap = MAX_ERRORS) {
  if (array.length >= cap) {
    if (!report.errors.collectionErrors.some((item) => item.collection === label && item.code === "cap_reached") &&
        report.errors.collectionErrors.length < MAX_ERRORS) {
      report.errors.collectionErrors.push({ collection: label, code: "cap_reached", cap });
    }
    return false;
  }
  array.push(value);
  return true;
}

function stage(name, details = {}) {
  if (report.checks.length >= MAX_STAGES) throw new Error("The bounded T15 stage cap was reached.");
  const item = { name, at: new Date().toISOString(), elapsedMs: elapsedMs(), ...details };
  report.checks.push(item);
  console.log("[T15] " + name + (Object.keys(details).length ? " " + JSON.stringify(details) : ""));
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
  return value === "lobby" || value === "studio" ? value : null;
}

function safeReason(value) {
  return ["permission_revoked", "publisher_stopped", "session_ended", "mode_changed", "out_of_range"].includes(value) ? value : null;
}

function summarizeControl(message, direction, connection) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const type = typeof message.type === "string" ? message.type.slice(0, 64) : "unknown";
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
    item.participantId = typeof message.participantId === "string" ? message.participantId.slice(0, 80) : null;
    item.role = message.role === "participant" || message.role === "display" ? message.role : "unknown";
    item.mode = message.mode === "watch" || message.mode === "interaction" ? message.mode : "unknown";
  } else if (type === "room.snapshot") {
    item.publishAllowed = Boolean(message.room?.publishAllowed);
    item.hostControlsEnabled = Boolean(message.room?.hostControlsEnabled);
    item.locked = Boolean(message.room?.isLocked);
  } else if (type === "participation.self") {
    item.participantId = typeof message.participantId === "string" ? message.participantId.slice(0, 80) : null;
    item.role = message.role === "participant" || message.role === "display" ? message.role : "unknown";
    item.mode = message.mode === "watch" || message.mode === "interaction" ? message.mode : "unknown";
    item.audioSubscribed = Boolean(message.media?.audio?.subscribed);
    item.screenSubscribed = Boolean(message.media?.screen?.subscribed);
  } else if (type === "host.publishPermission") {
    item.allowed = message.allowed === true;
  } else if (type === "host.claim") {
    item.tokenPresent = typeof message.token === "string" && message.token.length > 0;
    if (item.tokenPresent) secretValues.add(message.token);
  } else if (type === "host.claimed") {
    item.hostClaimed = true;
  } else if (type === "host.actionResult") {
    item.action = ["grantPublisher", "revokePublisher", "removeParticipant", "endSession"].includes(message.action) ? message.action : "other";
    if (typeof message.allowed === "boolean") item.allowed = message.allowed;
  } else if (type === "host.publishRevoked") {
    item.reason = safeReason(message.reason);
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
  } else if (/^(audio|screen)\.(subscribe|subscribed|unsubscribe|unsubscribed|started|keyframeRequest|streamEnded)$/u.test(type)) {
    item.generation = Number.isInteger(message.generation) ? message.generation : null;
    item.clockId = typeof message.clockId === "string" ? message.clockId.slice(0, 80) : null;
    if (type.endsWith("streamEnded")) item.reason = safeReason(message.reason);
  } else if (type === "interaction.ack") {
    item.acknowledged = true;
    item.duplicate = message.duplicate === true;
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
    const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload ?? []);
    const magic = bytes.toString("ascii", 0, Math.min(4, bytes.byteLength));
    if (magic === "LTA1") stats.audioFrames += 1;
    else if (magic === "LTS1") stats.screenFrames += 1;
    return;
  }

  let message;
  try { message = JSON.parse(payload); }
  catch { return; }
  if (!message || typeof message !== "object" || Array.isArray(message)) return;
  if (direction === "received") {
    for (const secret of configuredSecretValues) {
      if (secret && payload.includes(secret)) report.privacy.configuredSecretEchoObserved = true;
    }
  }
  const item = summarizeControl(message, direction, connection);
  if (item && !addBounded(connection.controls, item, client.name + "-controls-" + connection.index, MAX_CONTROLS_PER_CONNECTION)) {
    client.collectionOverflow = true;
  }
}

function routeClientSocket(client, route) {
  if (client.connections.length >= MAX_CONNECTIONS_PER_CLIENT) {
    client.collectionOverflow = true;
    addBounded(report.errors.collectionErrors, { client: client.name, code: "connection_cap_reached" }, "connection-cap-errors");
    try { route.close({ code: CLOSE_CODE, reason: "T15 connection cap reached" }); } catch {}
    return;
  }
  const connection = {
    index: client.connections.length + 1,
    openedAt: new Date().toISOString(),
    openedAtElapsedMs: elapsedMs(),
    closedAt: null,
    closeCode: null,
    closeReason: null,
    controlSequence: 0,
    controls: [],
    bytes: {
      sent: { frames: 0, bytes: 0, binaryFrames: 0, audioFrames: 0, screenFrames: 0 },
      received: { frames: 0, bytes: 0, binaryFrames: 0, audioFrames: 0, screenFrames: 0 },
    },
    route,
    serverRoute: null,
    ended: false,
  };
  const serverRoute = route.connectToServer();
  connection.serverRoute = serverRoute;
  client.connections.push(connection);
  client.activeConnection = connection;
  route.onMessage((payload) => {
    observePayload(client, connection, "sent", payload);
    serverRoute.send(payload);
  });
  serverRoute.onMessage((payload) => {
    observePayload(client, connection, "received", payload);
    route.send(payload);
  });
}

async function installWebSocketRoute(client) {
  await client.page.routeWebSocket(/\/ws(?:\?|$)/u, (route) => routeClientSocket(client, route));
}

function controls(client, connection, direction, type) {
  return connection.controls.filter((item) => item.direction === direction && item.type === type);
}

async function waitFor(predicate, label, timeoutMs = RECOVERY_TIMEOUT_MS, intervalMs = 25) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await delay(intervalMs);
  }
  throw new Error("Timed out waiting for " + label + " after " + timeoutMs + " ms.");
}

async function waitControl(client, connection, direction, type, previousCount = 0, timeoutMs = RECOVERY_TIMEOUT_MS) {
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
  return { folder, profileDirectory, appData, localAppData };
}

async function launchClient(name) {
  const profile = createTrustedProfile(name);
  const browserEnv = { ...process.env };
  for (const key of ["INTEGRATED_TEST_HOST_TOKEN", "INTEGRATED_TEST_ROOM_PASSWORD", "HOST_CONTROL_TOKEN", "MEETING_ROOM_PASSWORD"]) delete browserEnv[key];
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
  const client = {
    name,
    context,
    page,
    connections: [],
    activeConnection: null,
    collectionOverflow: false,
    pageErrorCount: 0,
  };
  clients.set(name, client);
  pages.set(name, page);
  page.on("pageerror", (error) => {
    client.pageErrorCount += 1;
    addBounded(report.errors.pageErrors, { client: name, message: redact(error?.message ?? "page error") }, "page-errors");
  });
  await installWebSocketRoute(client);
  return client;
}

async function installSyntheticMedia(page, roomId) {
  await page.addInitScript(({ roomId, frequency, color }) => {
    const state = { roomId, audioRequests: 0, screenRequests: 0, sources: [], audioContexts: [] };
    Object.defineProperty(window, "__t15Synthetic", { value: state, configurable: false });
    const devices = navigator.mediaDevices;
    const recordTrack = (kind, sourceIndex, track, stopAnimation = null) => {
      const record = { kind, sourceIndex, track, stopCalls: 0 };
      const stop = track.stop.bind(track);
      track.stop = () => {
        if (track.readyState !== "ended") record.stopCalls += 1;
        stopAnimation?.();
        stop();
      };
      state.sources.push(record);
      return track;
    };
    Object.defineProperty(devices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const sourceIndex = state.audioRequests++;
        const audioContext = new AudioContext({ sampleRate: 48_000 });
        await audioContext.resume();
        const destination = audioContext.createMediaStreamDestination();
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency + sourceIndex * 37;
        gain.gain.value = 0.22;
        oscillator.connect(gain).connect(destination);
        oscillator.start();
        state.audioContexts.push(audioContext);
        const track = destination.stream.getAudioTracks()[0];
        if (!track) throw new Error("Synthetic audio source did not create a track.");
        recordTrack("audio", sourceIndex, track);
        return destination.stream;
      },
    });
    Object.defineProperty(devices, "getDisplayMedia", {
      configurable: true,
      value: async () => {
        const sourceIndex = state.screenRequests++;
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
        recordTrack("screen", sourceIndex, track, () => { active = false; });
        return stream;
      },
    });
    Object.defineProperty(window, "__t15SyntheticCleanup", {
      value: async () => {
        for (const source of state.sources) {
          if (source.track.readyState !== "ended") source.track.stop();
        }
        await Promise.all(state.audioContexts.map((context) => context.close().catch(() => {})));
      },
      configurable: false,
    });
  }, { roomId, frequency: ROOM_FREQUENCIES[roomId], color: ROOM_COLORS[roomId] });
}

async function joinRoom(client, displayName, roomId) {
  const page = client.page;
  await page.goto(target.origin + "/?room=" + roomId, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Local room presence" }).waitFor();
  await page.getByLabel("Your display name").fill(displayName);
  const connection = client.activeConnection;
  const joinSentBefore = connection ? countControl(client, connection, "sent", "join") : 0;
  await page.getByRole("button", { name: "Join room" }).click();
  if (roomId === "studio") {
    await page.getByLabel("Meeting room password").waitFor({ state: "visible" });
    await page.locator("#meeting-room-password").fill(roomPassword);
    await page.getByRole("button", { name: "Enter room", exact: true }).click();
  }
  const roomName = roomId === "lobby" ? "Open area" : "Meeting room";
  await page.getByText("Connected to " + roomName, { exact: true }).waitFor();
  await page.locator('[data-testid="audio-panel"]').waitFor();
  await page.locator('[data-testid="screen-panel"]').waitFor();
  const joinedConnection = client.activeConnection;
  assert.ok(joinedConnection, client.name + " should have an observed WebSocket connection.");
  await waitControl(client, joinedConnection, "sent", "join", joinSentBefore);
  await waitControl(client, joinedConnection, "received", "room.snapshot", 0);
  return joinedConnection;
}

async function claimHost(client) {
  const connection = client.activeConnection;
  const claimsBefore = countControl(client, connection, "received", "host.claimed");
  await client.page.getByTestId("host-control-token").fill(hostToken);
  await client.page.getByTestId("host-claim").click();
  await waitControl(client, connection, "received", "host.claimed", claimsBefore);
  await client.page.getByTestId("host-state").filter({ hasText: "HOST" }).waitFor();
  const permission = await waitFor(() => controls(client, connection, "received", "host.publishPermission").findLast((item) => item.allowed === true),
    client.name + " host publish permission", RECOVERY_TIMEOUT_MS);
  assert.equal(permission.allowed, true, client.name + " host claim should grant current-connection publisher authority.");
}

async function startReceiving(client) {
  const connection = client.activeConnection;
  const audioAckBefore = countControl(client, connection, "received", "audio.subscribed");
  const screenAckBefore = countControl(client, connection, "received", "screen.subscribed");
  await client.page.getByTestId("audio-start-listening").click();
  await client.page.getByTestId("screen-start-watching").click();
  await waitControl(client, connection, "received", "audio.subscribed", audioAckBefore);
  await waitControl(client, connection, "received", "screen.subscribed", screenAckBefore);
}

async function startPublishing(client) {
  const connection = client.activeConnection;
  const audioStartedBefore = countControl(client, connection, "received", "audio.started");
  const screenStartedBefore = countControl(client, connection, "received", "screen.started");
  await client.page.getByRole("button", { name: "開始麥克風", exact: true }).click();
  await waitControl(client, connection, "received", "audio.started", audioStartedBefore);
  await client.page.getByRole("button", { name: "開始分享畫面", exact: true }).click();
  await waitControl(client, connection, "received", "screen.started", screenStartedBefore);
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
        renderedSamples: Number(audio.getAttribute("data-rendered-samples") ?? 0),
        decodedFrames: Number(audio.getAttribute("data-decoded-frames") ?? 0),
        receivedPackets: Number(audio.getAttribute("data-received-packets") ?? 0),
        renderRms: Number(audio.getAttribute("data-render-rms") ?? 0),
        listenerState: audio.getAttribute("data-listener-state"),
        playbackClockId: audio.getAttribute("data-audio-playback-clock-id"),
      } : null,
      screen: screen ? {
        renderedFrames: Number(screen.getAttribute("data-rendered-frames") ?? 0),
        decodedFrames: Number(screen.getAttribute("data-decoded-frames") ?? 0),
        receivedFrames: Number(screen.getAttribute("data-received-frames") ?? 0),
        width: Number(screen.getAttribute("data-rendered-width") ?? 0),
        height: Number(screen.getAttribute("data-rendered-height") ?? 0),
        syncClockId: screen.getAttribute("data-sync-clock-id"),
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
  if (await continueButton.isVisible().catch(() => false)) await continueButton.click();
}

async function waitForRenderedMedia(client, roomId, baseline = null) {
  await ensurePlaybackGesture(client);
  await client.page.waitForFunction((prior) => {
    const audio = document.querySelector('[data-testid="audio-panel"]');
    const screen = document.querySelector('[data-testid="screen-panel"]');
    const canvas = screen?.querySelector('[data-testid="screen-preview"]');
    const samples = Number(audio?.getAttribute("data-rendered-samples") ?? 0);
    const audioPackets = Number(audio?.getAttribute("data-received-packets") ?? 0);
    const frames = Number(screen?.getAttribute("data-rendered-frames") ?? 0);
    const screenPackets = Number(screen?.getAttribute("data-received-frames") ?? 0);
    return audio && screen && samples > (prior?.audio?.renderedSamples ?? 0) &&
      audioPackets > 0 && Number(audio.getAttribute("data-render-rms")) > 0.0001 &&
      frames >= Math.max(3, (prior?.screen?.renderedFrames ?? 0) + 1) && screenPackets > 0 &&
      canvas?.width > 0 && canvas?.height > 0;
  }, baseline, { timeout: MEDIA_TIMEOUT_MS });
  const snapshot = await mediaSnapshot(client.page);
  assert.ok(snapshot.audio.renderedSamples > (baseline?.audio?.renderedSamples ?? 0), client.name + " AudioWorklet samples must advance.");
  assert.ok(snapshot.screen.renderedFrames >= Math.max(3, (baseline?.screen?.renderedFrames ?? 0) + 1), client.name + " decoded screen frames must render.");
  assert.equal(snapshot.audio.playbackClockId, report.streamClockIds[roomId], client.name + " rendered audio should use its room source clock.");
  assert.equal(snapshot.screen.syncClockId, report.streamClockIds[roomId], client.name + " rendered video should use its room source clock.");
  assert.ok(colorDifference(snapshot.screen.pixel, ROOM_COLORS[roomId]) <= 45,
    client.name + " decoded canvas should show its room-specific synthetic color; got " + JSON.stringify(snapshot.screen.pixel));
  return snapshot;
}

async function waitUntilActiveSources(client) {
  return client.page.waitForFunction(() => {
    const state = window.__t15Synthetic;
    return state && state.sources.some((source) => source.kind === "audio") && state.sources.some((source) => source.kind === "screen");
  }, undefined, { timeout: MEDIA_TIMEOUT_MS });
}

async function readSyntheticState(client) {
  return client.page.evaluate(() => {
    const state = window.__t15Synthetic;
    if (!state) return null;
    return {
      audioRequests: state.audioRequests,
      screenRequests: state.screenRequests,
      sources: state.sources.map((source) => ({
        kind: source.kind,
        sourceIndex: source.sourceIndex,
        readyState: source.track.readyState,
        stopCalls: source.stopCalls,
      })),
    };
  });
}

function activeBinaryCounts(connection) {
  return {
    audio: connection.bytes.received.audioFrames,
    screen: connection.bytes.received.screenFrames,
    all: connection.bytes.received.binaryFrames,
  };
}

function activeSentBinaryCounts(connection) {
  return {
    audio: connection.bytes.sent.audioFrames,
    screen: connection.bytes.sent.screenFrames,
    all: connection.bytes.sent.binaryFrames,
  };
}

async function closeRouteConnection(client, connection, reason) {
  assert.ok(connection?.route && connection?.serverRoute, client.name + " needs both routed WebSocket endpoints before controlled close.");
  const closedAt = new Date().toISOString();
  const closedAtElapsedMs = elapsedMs();
  connection.ended = true;
  connection.closedAt = closedAt;
  connection.closedAtElapsedMs = closedAtElapsedMs;
  connection.closeCode = CLOSE_CODE;
  connection.closeReason = reason;
  const closeOptions = { code: CLOSE_CODE, reason: "T15 test-only " + reason };
  const results = await Promise.allSettled([
    Promise.resolve().then(() => connection.route.close(closeOptions)),
    Promise.resolve().then(() => connection.serverRoute.close(closeOptions)),
  ]);
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw new Error(client.name + " test route close failed: " + redact(failed.reason?.message ?? "close rejected"));
  return { closedAt, closedAtElapsedMs, closeCode: CLOSE_CODE, closeEndpoints: ["browser-route", "server-route"] };
}

async function controlledTimeoutClose(client) {
  const oldConnection = client.activeConnection;
  assert.ok(oldConnection?.serverRoute, "studio host receiver needs an active routed socket before the timeout simulation.");
  const scheduledAtEpochMs = Date.now();
  const scheduledForEpochMs = scheduledAtEpochMs + SIMULATED_TIMEOUT_MS;
  const scheduled = {
    kind: "local application-driver deadline",
    deadlineMs: SIMULATED_TIMEOUT_MS,
    scheduledAt: new Date(scheduledAtEpochMs).toISOString(),
    scheduledAtElapsedMs: elapsedMs(),
    scheduledFor: new Date(scheduledForEpochMs).toISOString(),
    oldConnectionIndex: oldConnection.index,
  };
  report.disturbance.schedule = scheduled;
  stage("studio-receiver-application-timeout-scheduled", { deadlineMs: SIMULATED_TIMEOUT_MS, connectionIndex: oldConnection.index });
  // Timers may wake slightly early; enforce the recorded local wall-clock deadline.
  while (Date.now() < scheduledForEpochMs) await delay(Math.max(1, scheduledForEpochMs - Date.now()));
  const actualAtEpochMs = Date.now();
  const closed = await closeRouteConnection(client, oldConnection, "receiver-application-timeout-simulation");
  scheduled.actualCloseAt = closed.closedAt;
  scheduled.actualCloseElapsedMs = closed.closedAtElapsedMs;
  scheduled.deadlineLatenessMs = actualAtEpochMs - scheduledForEpochMs;
  scheduled.closeCode = closed.closeCode;
  scheduled.closeEndpoints = closed.closeEndpoints;
  assert.ok(scheduled.deadlineLatenessMs >= 0, "actual route close should follow the recorded application-driver deadline.");
  stage("studio-receiver-route-closed-on-local-deadline", {
    oldConnectionIndex: oldConnection.index,
    closeCode: closed.closeCode,
    deadlineLatenessMs: scheduled.deadlineLatenessMs,
    endpoints: closed.closeEndpoints,
  });
  return { oldConnection, scheduled };
}

async function waitForFreshResume(client, oldConnection, expectedRoomId) {
  const newConnection = await waitFor(() => client.connections.find((connection) => connection.index > oldConnection.index),
    client.name + " fresh routed connection", RECOVERY_TIMEOUT_MS);
  const resumeSent = await waitControl(client, newConnection, "sent", "session.resume", 0, RECOVERY_TIMEOUT_MS);
  const resumed = await waitControl(client, newConnection, "received", "session.resumed", 0, RECOVERY_TIMEOUT_MS);
  const room = await waitControl(client, newConnection, "received", "room.snapshot", 0, RECOVERY_TIMEOUT_MS);
  const participation = await waitControl(client, newConnection, "received", "participation.self", 0, RECOVERY_TIMEOUT_MS);
  assert.equal(resumeSent.tokenPresent, true, "resume request should use the in-memory resume credential.");
  assert.equal(resumed.roomId, expectedRoomId, "resume should keep the latest selected room.");
  assert.equal(room.roomId, expectedRoomId, "fresh authoritative room snapshot should precede media recovery.");
  assert.equal(participation.roomId, expectedRoomId, "fresh participation snapshot should precede media recovery.");
  assert.ok(resumed.sequence < room.sequence && room.sequence < participation.sequence,
    "resume confirmation, authoritative room snapshot, and participation snapshot should arrive in order.");
  return { connection: newConnection, resumeSent, resumed, room, participation };
}

async function verifyReceiverRestore(client, recovery, expectedClockId, publisher, publisherKeyframeBaseline) {
  const connection = recovery.connection;
  const audioSubscribe = await waitControl(client, connection, "sent", "audio.subscribe", 0, RECOVERY_TIMEOUT_MS);
  const audioAck = await waitControl(client, connection, "received", "audio.subscribed", 0, RECOVERY_TIMEOUT_MS);
  const audioStream = await waitControl(client, connection, "received", "audio.stream", 0, RECOVERY_TIMEOUT_MS);
  const screenSubscribe = await waitControl(client, connection, "sent", "screen.subscribe", 0, RECOVERY_TIMEOUT_MS);
  const screenAck = await waitControl(client, connection, "received", "screen.subscribed", 0, RECOVERY_TIMEOUT_MS);
  const screenStream = await waitControl(client, connection, "received", "screen.stream", 0, RECOVERY_TIMEOUT_MS);
  const publisherConnection = publisher.activeConnection;
  const keyframe = await waitControl(publisher, publisherConnection, "received", "screen.keyframeRequest", publisherKeyframeBaseline, RECOVERY_TIMEOUT_MS);
  assert.ok(recovery.participation.sequence < audioSubscribe.sequence && recovery.participation.sequence < screenSubscribe.sequence,
    "automatic media subscriptions must follow the fresh authority snapshots.");
  assert.ok(audioSubscribe.sequence < audioAck.sequence && audioAck.sequence < audioStream.sequence,
    "audio subscription should be acknowledged before its fresh stream configuration.");
  assert.ok(screenSubscribe.sequence < screenAck.sequence && screenAck.sequence < screenStream.sequence,
    "screen subscription should be acknowledged before its fresh stream configuration.");
  assert.equal(audioStream.config.codec, "opus");
  assert.equal(screenStream.config.codec, "vp8");
  assert.equal(audioStream.clockId, expectedClockId);
  assert.equal(screenStream.clockId, expectedClockId);
  assert.equal(keyframe.generation, screenStream.generation);
  const before = await mediaSnapshot(client.page);
  const rendered = await waitForRenderedMedia(client, "studio", before);
  assert.ok(connection.bytes.received.audioFrames > 0 && connection.bytes.received.screenFrames > 0,
    "fresh connection must carry actual binary audio and video while browser render counters advance.");
  return {
    connectionIndex: connection.index,
    resumeRequest: { tokenPresent: recovery.resumeSent.tokenPresent, passwordProvided: recovery.resumeSent.passwordProvided === true },
    authority: {
      resumedAtElapsedMs: recovery.resumed.elapsedMs,
      roomSnapshotAtElapsedMs: recovery.room.elapsedMs,
      participationAtElapsedMs: recovery.participation.elapsedMs,
      roomId: recovery.room.roomId,
      role: recovery.participation.role,
      publishAllowed: recovery.room.publishAllowed,
    },
    subscriptions: {
      audio: { sentAtElapsedMs: audioSubscribe.elapsedMs, acknowledgedAtElapsedMs: audioAck.elapsedMs, codec: audioStream.config.codec, generation: audioStream.generation },
      screen: { sentAtElapsedMs: screenSubscribe.elapsedMs, acknowledgedAtElapsedMs: screenAck.elapsedMs, codec: screenStream.config.codec, generation: screenStream.generation },
      keyframeRequestAtElapsedMs: keyframe.elapsedMs,
      keyframeGeneration: keyframe.generation,
    },
    render: rendered,
    newConnectionBinaryCounts: activeBinaryCounts(connection),
  };
}

function startHealthyLobbyMonitor(client) {
  let stopped = false;
  let error = null;
  const done = (async () => {
    let previous = null;
    while (!stopped) {
      if (report.healthyLobbySamples.length >= MAX_HEALTH_SAMPLES) {
        error = new Error("Healthy lobby sample cap was reached.");
        return;
      }
      const media = await mediaSnapshot(client.page);
      const sample = {
        at: new Date().toISOString(),
        elapsedMs: elapsedMs(),
        renderedSamples: media.audio?.renderedSamples ?? 0,
        renderedFrames: media.screen?.renderedFrames ?? 0,
        audioPackets: media.audio?.receivedPackets ?? 0,
        screenPackets: media.screen?.receivedFrames ?? 0,
      };
      if (previous) {
        sample.audioAdvanced = sample.renderedSamples > previous.renderedSamples;
        sample.videoAdvanced = sample.renderedFrames > previous.renderedFrames;
        sample.audioPacketsAdvanced = sample.audioPackets > previous.audioPackets;
        sample.videoPacketsAdvanced = sample.screenPackets > previous.screenPackets;
      }
      report.healthyLobbySamples.push(sample);
      previous = sample;
      await delay(HEALTH_SAMPLE_INTERVAL_MS);
    }
  })().catch((caught) => { error = caught; });
  return {
    stop: async () => {
      stopped = true;
      await done;
      if (error) throw error;
    },
  };
}

async function sendLobbyInteractionAck(client, phase) {
  const connection = client.activeConnection;
  const previousCount = countControl(client, connection, "received", "interaction.ack");
  await client.page.getByTestId("feedback-like").click();
  const ack = await waitControl(client, connection, "received", "interaction.ack", previousCount);
  assert.equal(ack.acknowledged, true, "lobby interaction should receive its normal server ACK.");
  const item = { phase, atElapsedMs: ack.elapsedMs, duplicate: ack.duplicate };
  report.interactionAcks.push(item);
  stage("healthy-lobby-interaction-acknowledged", item);
  return ack;
}

async function runOptionalActiveHold() {
  if (holdSeconds === 0) return;
  const lobbyReceiver = clients.get("lobby-receiver");
  const studioHost = clients.get("studio-host");
  const sampleIntervalMs = Math.min(30_000, Math.max(500, Math.floor((holdSeconds * 1_000) / 3)));
  report.optionalActiveHold.executed = true;
  report.optionalActiveHold.startedAt = new Date().toISOString();
  const started = Date.now();
  const endsAt = started + holdSeconds * 1_000;
  let priorLobby = await mediaSnapshot(lobbyReceiver.page);
  let priorStudio = await mediaSnapshot(studioHost.page);
  while (Date.now() < endsAt) {
    await delay(Math.min(sampleIntervalMs, endsAt - Date.now()));
    const lobby = await mediaSnapshot(lobbyReceiver.page);
    const studio = await mediaSnapshot(studioHost.page);
    const sample = {
      at: new Date().toISOString(),
      elapsedMs: elapsedMs(),
      lobby: {
        renderedSamples: lobby.audio?.renderedSamples ?? 0,
        renderedFrames: lobby.screen?.renderedFrames ?? 0,
        audioAdvanced: (lobby.audio?.renderedSamples ?? 0) > (priorLobby.audio?.renderedSamples ?? 0),
        videoAdvanced: (lobby.screen?.renderedFrames ?? 0) > (priorLobby.screen?.renderedFrames ?? 0),
      },
      studio: {
        renderedSamples: studio.audio?.renderedSamples ?? 0,
        renderedFrames: studio.screen?.renderedFrames ?? 0,
        audioAdvanced: (studio.audio?.renderedSamples ?? 0) > (priorStudio.audio?.renderedSamples ?? 0),
        videoAdvanced: (studio.screen?.renderedFrames ?? 0) > (priorStudio.screen?.renderedFrames ?? 0),
      },
    };
    if (!addBounded(report.optionalActiveHold.samples, sample, "optional-hold-samples", MAX_HOLD_SAMPLES)) {
      throw new Error("Optional hold observation cap was reached.");
    }
    assert.equal(sample.lobby.audioAdvanced, true, "lobby AudioWorklet samples must advance during the optional active hold.");
    assert.equal(sample.lobby.videoAdvanced, true, "lobby rendered frames must advance during the optional active hold.");
    assert.equal(sample.studio.audioAdvanced, true, "studio AudioWorklet samples must advance during the optional active hold.");
    assert.equal(sample.studio.videoAdvanced, true, "studio rendered frames must advance during the optional active hold.");
    priorLobby = lobby;
    priorStudio = studio;
  }
  report.optionalActiveHold.finishedAt = new Date().toISOString();
  report.optionalActiveHold.completedSeconds = Number(((Date.now() - started) / 1_000).toFixed(1));
  stage("optional-real-time-active-room-hold-completed", {
    requestedSeconds: holdSeconds,
    completedSeconds: report.optionalActiveHold.completedSeconds,
    sampleCount: report.optionalActiveHold.samples.length,
    maxSampleIntervalSeconds: 30,
  });
}

async function grantStudioPublisher(studioHost, studioPublisher, displayName) {
  const hostConnection = studioHost.activeConnection;
  const publisherConnection = studioPublisher.activeConnection;
  const memberRow = studioHost.page.locator('[data-testid="host-panel"] .host-member-row').filter({ hasText: displayName });
  await memberRow.waitFor();
  const grantButton = memberRow.getByTestId("host-grant-publisher");
  await grantButton.waitFor();
  const actionCount = countControl(studioHost, hostConnection, "received", "host.actionResult");
  const permissionCount = countControl(studioPublisher, publisherConnection, "received", "host.publishPermission");
  await grantButton.click();
  const action = await waitControl(studioHost, hostConnection, "received", "host.actionResult", actionCount);
  await waitControl(studioPublisher, publisherConnection, "received", "host.publishPermission", permissionCount);
  assert.equal(action.action, "grantPublisher");
  const permission = controls(studioPublisher, publisherConnection, "received", "host.publishPermission").at(-1);
  assert.equal(permission.allowed, true);
}

async function revokeStudioPublisher(studioHost, studioPublisher, displayName) {
  const hostConnection = studioHost.activeConnection;
  const publisherConnection = studioPublisher.activeConnection;
  const publisherBefore = await readSyntheticState(studioPublisher);
  assert.ok(publisherBefore && publisherBefore.sources.length >= 2, "studio synthetic source tracks should exist before revocation.");
  const row = studioHost.page.locator('[data-testid="host-panel"] .host-member-row').filter({ hasText: displayName });
  const actionCount = countControl(studioHost, hostConnection, "received", "host.actionResult");
  await row.getByTestId("host-revoke-publisher").click();
  const action = await waitControl(studioHost, hostConnection, "received", "host.actionResult", actionCount);
  assert.equal(action.action, "revokePublisher");
  const audioEnded = await waitControl(studioHost, hostConnection, "received", "audio.streamEnded", 0);
  const screenEnded = await waitControl(studioHost, hostConnection, "received", "screen.streamEnded", 0);
  const permission = await waitFor(() => controls(studioPublisher, publisherConnection, "received", "host.publishPermission").findLast((item) => item.allowed === false),
    "studio publisher revoke permission", RECOVERY_TIMEOUT_MS);
  const revokedSignal = await waitFor(() => controls(studioPublisher, publisherConnection, "received", "host.publishRevoked").at(-1),
    "studio publisher revoked control", RECOVERY_TIMEOUT_MS);
  await studioPublisher.page.waitForFunction(() => window.__t15Synthetic?.sources.length >= 2 &&
    window.__t15Synthetic.sources.every((source) => source.track.readyState === "ended"), undefined, { timeout: RECOVERY_TIMEOUT_MS });
  const publisherAfter = await readSyntheticState(studioPublisher);
  assert.ok(publisherAfter.sources.length >= publisherBefore.sources.length);
  assert.ok(publisherAfter.sources.every((source) => source.readyState === "ended"), "revocation must end both audio and screen tracks.");
  const studioReceiverAtEndSignal = await mediaSnapshot(studioHost.page);
  const publisherSendBeforeDrain = activeSentBinaryCounts(publisherConnection);
  const receiverBinaryBeforeDrain = activeBinaryCounts(hostConnection);
  await delay(900);
  const publisherSendAfterDrain = activeSentBinaryCounts(publisherConnection);
  const receiverBinaryAfterDrain = activeBinaryCounts(hostConnection);
  const studioReceiverAfterDrain = await mediaSnapshot(studioHost.page);
  assert.deepEqual(publisherSendAfterDrain, publisherSendBeforeDrain, "revoked source must stop sending binary media after bounded drain.");
  assert.deepEqual(receiverBinaryAfterDrain, receiverBinaryBeforeDrain, "studio receiver must stop receiving binary media after bounded drain.");
  assert.equal(studioReceiverAfterDrain.audio.receivedPackets, studioReceiverAtEndSignal.audio.receivedPackets,
    "studio audio receive packet count should remain stable after streamEnded and bounded drain.");
  assert.equal(studioReceiverAfterDrain.screen.receivedFrames, studioReceiverAtEndSignal.screen.receivedFrames,
    "studio screen receive frame count should remain stable after streamEnded and bounded drain.");
  assert.equal(studioReceiverAfterDrain.audio.renderRms <= 0.0001, true, "studio audio render should settle to silence after streamEnded.");
  assert.equal(studioReceiverAfterDrain.screen.width, 0, "studio decoded screen should be cleared after streamEnded.");
  assert.equal(studioReceiverAfterDrain.screen.height, 0, "studio decoded screen should be cleared after streamEnded.");

  report.revocation = {
    hostAction: { action: action.action, atElapsedMs: action.elapsedMs },
    audioStreamEndedAtElapsedMs: audioEnded.elapsedMs,
    screenStreamEndedAtElapsedMs: screenEnded.elapsedMs,
    permissionAllowedAfterRevoke: permission.allowed,
    revokedSignalReason: revokedSignal.reason,
    sourceTrackCount: publisherBefore.sources.length,
    tracksEnded: publisherAfter.sources.every((source) => source.readyState === "ended"),
    publisherBinaryAfterDrain: publisherSendAfterDrain,
    studioReceiverBinaryAfterDrain: receiverBinaryAfterDrain,
    boundedDrainMs: 900,
    receiverAtEndSignal: {
      audioReceivedPackets: studioReceiverAtEndSignal.audio.receivedPackets,
      screenReceivedFrames: studioReceiverAtEndSignal.screen.receivedFrames,
    },
    receiverAfterDrain: {
      audioReceivedPackets: studioReceiverAfterDrain.audio.receivedPackets,
      audioRenderRms: studioReceiverAfterDrain.audio.renderRms,
      screenReceivedFrames: studioReceiverAfterDrain.screen.receivedFrames,
      screenRenderedFrames: studioReceiverAfterDrain.screen.renderedFrames,
      screenWidth: studioReceiverAfterDrain.screen.width,
      screenHeight: studioReceiverAfterDrain.screen.height,
    },
  };
  stage("studio-publisher-revoked-tracks-ended-and-receiver-settled", {
    tracksEnded: report.revocation.tracksEnded,
    streamEndedControls: 2,
    boundedDrainMs: 900,
    publisherBinaryAfterDrain: publisherSendAfterDrain.all,
    receiverBinaryAfterDrain: receiverBinaryAfterDrain.all,
  });
}

async function resumeRevokedPublisher(client, oldConnection) {
  const recovery = await waitForFreshResume(client, oldConnection, "studio");
  assert.equal(recovery.room.publishAllowed, false, "fresh server authority must keep revoked publishing disallowed.");
  assert.equal(recovery.participation.role, "participant");
  await delay(700);
  const newConnection = recovery.connection;
  const synthetic = await readSyntheticState(client);
  const autoStarts = {
    audio: countControl(client, newConnection, "sent", "audio.start"),
    screen: countControl(client, newConnection, "sent", "screen.start"),
  };
  const sentBinary = activeSentBinaryCounts(newConnection);
  assert.equal(autoStarts.audio, 0, "resume must not automatically restart audio publishing.");
  assert.equal(autoStarts.screen, 0, "resume must not automatically restart screen publishing.");
  assert.equal(sentBinary.all, 0, "resume must not automatically send synthetic media.");
  assert.equal(synthetic.audioRequests, 1, "resume must not request another synthetic audio source.");
  assert.equal(synthetic.screenRequests, 1, "resume must not request another synthetic screen source.");
  assert.ok(synthetic.sources.every((source) => source.readyState === "ended"), "all revoked tracks should remain ended after resume.");
  assert.equal(countControl(client, newConnection, "sent", "host.claim"), 0, "resume must not restore a host claim.");
  report.revocation.publisherResume = {
    connectionIndex: newConnection.index,
    authorityAtElapsedMs: recovery.room.elapsedMs,
    publishAllowed: recovery.room.publishAllowed,
    role: recovery.participation.role,
    automaticStartControls: autoStarts,
    automaticBinaryFrames: sentBinary,
    audioCaptureRequests: synthetic.audioRequests,
    screenCaptureRequests: synthetic.screenRequests,
    tracksStillEnded: synthetic.sources.every((source) => source.readyState === "ended"),
    hostClaimControls: countControl(client, newConnection, "sent", "host.claim"),
  };
  stage("revoked-publisher-resumed-without-auto-capture-or-publish", {
    publishAllowed: recovery.room.publishAllowed,
    automaticStartControls: 0,
    automaticBinaryFrames: 0,
    tracksStillEnded: true,
  });
  return recovery;
}

async function saveFinalScreenshot(clientName, fileName) {
  const page = pages.get(clientName);
  if (!page || page.isClosed()) return;
  try {
    await page.screenshot({ path: join(outputDirectory, fileName), fullPage: true, animations: "disabled", timeout: 8_000 });
    if (!report.screenshots.includes(fileName)) report.screenshots.push(fileName);
  } catch (error) {
    addBounded(report.errors.cleanupErrors, { client: clientName, code: "screenshot_failed", message: redact(error?.message ?? "screenshot failed") }, "cleanup-errors");
  }
}

async function finalizeReport() {
  report.finishedAt = new Date().toISOString();
  report.durationMs = elapsedMs();
  report.status = failure ? "failed" : "passed";
  report.errors.failure = failure ? redact(failure?.message ?? failure) : null;
  for (const client of clients.values()) {
    if (client.collectionOverflow) {
      report.errors.collectionErrors.push({ client: client.name, code: "bounded_collection_overflow" });
      report.status = "failed";
      if (!report.errors.failure) report.errors.failure = "A bounded transport/control collection overflowed.";
    }
  }
  if (report.errors.collectionErrors.some((item) => item.code === "cap_reached")) {
    report.status = "failed";
    if (!report.errors.failure) report.errors.failure = "A bounded evidence collection reached its cap.";
  }
  if (report.privacy.configuredSecretEchoObserved) {
    report.status = "failed";
    if (!report.errors.failure) report.errors.failure = "A configured credential appeared in a received control payload; value was not retained.";
  }
  report.controlObservations = [...clients.values()].map((client) => ({
    client: client.name,
    connections: client.connections.map((connection) => ({
      index: connection.index,
      openedAt: connection.openedAt,
      openedAtElapsedMs: connection.openedAtElapsedMs,
      closedAt: connection.closedAt,
      closeCode: connection.closeCode,
      closeReason: connection.closeReason,
      bytes: connection.bytes,
      controls: connection.controls,
    })),
  }));
  try {
    let serialized = JSON.stringify(report, null, 2) + "\n";
    if ([...secretValues].some((secret) => secret && serialized.includes(secret))) {
      report.status = "failed";
      report.errors.failure = "A credential appeared in the retained report; its value was redacted.";
      serialized = JSON.stringify(report, null, 2) + "\n";
    }
    for (const secret of secretValues) if (secret) serialized = serialized.split(secret).join("[redacted]");
    writeFileSync(join(outputDirectory, "report.json"), serialized, { mode: 0o600 });
    writeFileSync(join(outputDirectory, "README.md"), [
      "# T15 integrated session smoke",
      "",
      "Status: " + report.status,
      "Started: " + report.startedAt,
      "Finished: " + report.finishedAt,
      "Duration: " + report.durationMs + " ms",
      "",
      "Four isolated real Firefox profiles used one trusted HTTPS/WSS app. Audio and video sources were generated in the two publisher pages. The report retains only allowlisted control summaries, byte/frame counts, sampled render counters, room clock IDs, and screenshots; it does not retain control payloads, media payloads, packet hashes, credentials, or browser storage.",
      "",
      "The controlled receiver close is a local application-route simulation, not a server timeout or network-shaping result. No phone, physical capture, human listening, 65-minute hold unless explicitly requested, p95, capacity, or deployment result is claimed.",
      "",
      "Failure: " + (report.errors.failure ?? "none"),
      "",
    ].join("\n"), { mode: 0o600 });
  } catch (error) {
    const message = redact(error?.message ?? "report write failed");
    console.error("[T15] report write failed: " + message);
    process.exitCode = 1;
  }
  console.log("[T15] " + report.status + " report=" + join(outputDirectory, "report.json"));
}

try {
  const caPem = readFileSync(caCertificate, "utf8");
  assert.ok(caPem.includes("BEGIN CERTIFICATE"), "Configured CA file should contain a PEM certificate.");

  const [studioHost, studioPublisher, lobbyHost, lobbyReceiver] = await Promise.all(CLIENTS.map((name) => launchClient(name)));
  report.runtime.firefox = studioHost.context.browser()?.version() ?? "not-reported";
  await Promise.all([
    installSyntheticMedia(studioPublisher.page, "studio"),
    installSyntheticMedia(lobbyHost.page, "lobby"),
  ]);
  const DISPLAY_NAMES = {
    studioHost: "T15 Studio Host",
    studioPublisher: "T15 Studio Publisher",
    lobbyHost: "T15 Lobby Host",
    lobbyReceiver: "T15 Lobby Receiver",
  };
  await Promise.all([
    joinRoom(studioHost, DISPLAY_NAMES.studioHost, "studio"),
    joinRoom(studioPublisher, DISPLAY_NAMES.studioPublisher, "studio"),
    joinRoom(lobbyHost, DISPLAY_NAMES.lobbyHost, "lobby"),
    joinRoom(lobbyReceiver, DISPLAY_NAMES.lobbyReceiver, "lobby"),
  ]);
  stage("four-isolated-firefox-clients-joined-two-rooms");

  await Promise.all([claimHost(studioHost), claimHost(lobbyHost)]);
  await grantStudioPublisher(studioHost, studioPublisher, DISPLAY_NAMES.studioPublisher);
  await Promise.all([startReceiving(studioHost), startReceiving(lobbyReceiver)]);
  await Promise.all([startPublishing(studioPublisher), startPublishing(lobbyHost)]);
  await Promise.all([waitUntilActiveSources(studioPublisher), waitUntilActiveSources(lobbyHost)]);

  const studioReceiverConnection = studioHost.activeConnection;
  const lobbyReceiverConnection = lobbyReceiver.activeConnection;
  const studioAudio = await waitControl(studioHost, studioReceiverConnection, "received", "audio.stream", 0);
  const studioScreen = await waitControl(studioHost, studioReceiverConnection, "received", "screen.stream", 0);
  const lobbyAudio = await waitControl(lobbyReceiver, lobbyReceiverConnection, "received", "audio.stream", 0);
  const lobbyScreen = await waitControl(lobbyReceiver, lobbyReceiverConnection, "received", "screen.stream", 0);
  assert.equal(studioAudio.config.codec, "opus");
  assert.equal(studioScreen.config.codec, "vp8");
  assert.equal(lobbyAudio.config.codec, "opus");
  assert.equal(lobbyScreen.config.codec, "vp8");
  assert.equal(studioAudio.clockId, studioScreen.clockId, "studio audio and video should use one publisher source clock.");
  assert.equal(lobbyAudio.clockId, lobbyScreen.clockId, "lobby audio and video should use one publisher source clock.");
  assert.notEqual(studioAudio.clockId, lobbyAudio.clockId, "independent rooms should have distinct publisher source clocks.");
  report.streamClockIds = { studio: studioAudio.clockId, lobby: lobbyAudio.clockId };
  const [studioInitial, lobbyInitial] = await Promise.all([
    waitForRenderedMedia(studioHost, "studio"),
    waitForRenderedMedia(lobbyReceiver, "lobby"),
  ]);
  assert.ok(studioReceiverConnection.bytes.received.audioFrames > 0 && studioReceiverConnection.bytes.received.screenFrames > 0);
  assert.ok(lobbyReceiverConnection.bytes.received.audioFrames > 0 && lobbyReceiverConnection.bytes.received.screenFrames > 0);
  stage("both-rooms-opus-vp8-actually-rendered-with-distinct-source-clocks", {
    clockIdsDistinct: true,
    codecs: { audio: "opus", video: "vp8" },
    studioRenderedSamples: studioInitial.audio.renderedSamples,
    studioRenderedFrames: studioInitial.screen.renderedFrames,
    lobbyRenderedSamples: lobbyInitial.audio.renderedSamples,
    lobbyRenderedFrames: lobbyInitial.screen.renderedFrames,
  });

  await runOptionalActiveHold();

  healthMonitor = startHealthyLobbyMonitor(lobbyReceiver);
  await delay(HEALTH_SAMPLE_INTERVAL_MS);
  const publisherKeyframeBaseline = countControl(studioPublisher, studioPublisher.activeConnection, "received", "screen.keyframeRequest");
  const timeoutPromise = controlledTimeoutClose(studioHost);
  await delay(120);
  const interactionAckDuringFault = await sendLobbyInteractionAck(lobbyReceiver, "during-local-studio-timeout-window-or-recovery");
  const timeout = await timeoutPromise;
  assert.ok(interactionAckDuringFault.elapsedMs >= timeout.scheduled.scheduledAtElapsedMs,
    "lobby interaction ACK should occur after the studio timeout simulation was scheduled.");
  timeout.scheduled.interactionAckAtElapsedMs = interactionAckDuringFault.elapsedMs;
  timeout.scheduled.interactionAckPhase = interactionAckDuringFault.elapsedMs <= timeout.scheduled.actualCloseElapsedMs
    ? "during-local-timeout-window"
    : "during-studio-recovery";
  const hostRecovery = await waitForFreshResume(studioHost, timeout.oldConnection, "studio");
  assert.equal(hostRecovery.room.publishAllowed, false, "the resumed studio host connection must lose its prior host publish authority.");
  assert.equal(hostRecovery.participation.role, "participant");
  assert.equal(countControl(studioHost, hostRecovery.connection, "sent", "host.claim"), 0, "host claim must not auto-resume.");
  assert.equal(countControl(studioHost, hostRecovery.connection, "received", "host.claimed"), 0, "host claim state must not auto-resume.");
  const receiverRestore = await verifyReceiverRestore(studioHost, hostRecovery, report.streamClockIds.studio, studioPublisher, publisherKeyframeBaseline);
  const hostStateAfterResume = (await studioHost.page.getByTestId("host-state").textContent())?.trim();
  assert.equal(hostStateAfterResume, "MANAGED", "studio host must visibly lose the old host claim before reclaim.");
  report.recoveries.push({
    client: "studio-host receiver",
    simulation: timeout.scheduled,
    ...receiverRestore,
    hostClaimAfterResume: { visibleState: hostStateAfterResume, automaticClaimControls: 0 },
  });
  stage("studio-receiver-resumed-authority-restored-before-media-subscriptions", {
    connectionIndex: receiverRestore.connectionIndex,
    roomId: receiverRestore.authority.roomId,
    publishAllowed: receiverRestore.authority.publishAllowed,
    audioSubscribeAck: true,
    screenSubscribeAck: true,
    freshConfig: true,
    keyframeRequested: true,
    renderedSamples: receiverRestore.render.audio.renderedSamples,
    renderedFrames: receiverRestore.render.screen.renderedFrames,
    hostClaimLost: true,
  });

  await sendLobbyInteractionAck(lobbyReceiver, "after-studio-receiver-media-recovery");

  await claimHost(studioHost);
  stage("studio-host-reclaimed-through-normal-host-ui", { roomId: "studio" });
  await revokeStudioPublisher(studioHost, studioPublisher, DISPLAY_NAMES.studioPublisher);

  const revokedConnection = studioPublisher.activeConnection;
  const closeTime = await closeRouteConnection(studioPublisher, revokedConnection, "revoked-publisher-application-close");
  stage("revoked-publisher-route-closed-after-track-stop", {
    connectionIndex: revokedConnection.index,
    closeCode: closeTime.closeCode,
    endpoints: closeTime.closeEndpoints,
  });
  await resumeRevokedPublisher(studioPublisher, revokedConnection);

  const lobbyFinal = await waitForRenderedMedia(lobbyReceiver, "lobby", lobbyInitial);
  assert.ok(lobbyFinal.audio.renderedSamples > lobbyInitial.audio.renderedSamples);
  assert.ok(lobbyFinal.screen.renderedFrames > lobbyInitial.screen.renderedFrames);
  await delay(HEALTH_SAMPLE_INTERVAL_MS);
  await healthMonitor.stop();
  healthMonitor = null;
  assert.ok(report.healthyLobbySamples.length >= 5, "lobby health monitor should retain repeated observations across the studio fault and revocation.");
  for (const sample of report.healthyLobbySamples.slice(1)) {
    assert.equal(sample.audioAdvanced, true, "healthy lobby AudioWorklet samples must advance at every bounded observation.");
    assert.equal(sample.videoAdvanced, true, "healthy lobby rendered frames must advance at every bounded observation.");
    assert.equal(sample.audioPacketsAdvanced, true, "healthy lobby audio packets must keep arriving at every bounded observation.");
    assert.equal(sample.videoPacketsAdvanced, true, "healthy lobby video packets must keep arriving at every bounded observation.");
  }
  stage("healthy-lobby-audio-video-and-interaction-remained-live-across-studio-fault", {
    sampleCount: report.healthyLobbySamples.length,
    audioSamplesAdvancedAtEveryObservation: true,
    videoFramesAdvancedAtEveryObservation: true,
    audioPacketsAdvancedAtEveryObservation: true,
    videoPacketsAdvancedAtEveryObservation: true,
    interactionAckedDuringFaultAndAfterRecovery: report.interactionAcks.length >= 2,
    finalRenderedSamples: lobbyFinal.audio.renderedSamples,
    finalRenderedFrames: lobbyFinal.screen.renderedFrames,
  });
  assert.equal(report.privacy.configuredSecretEchoObserved, false, "no received control payload should echo a configured credential.");

  await Promise.all([
    saveFinalScreenshot("studio-host", "studio-host-final.png"),
    saveFinalScreenshot("lobby-receiver", "lobby-receiver-final.png"),
  ]);
  assert.ok(report.screenshots.length >= 2, "at least two final real Firefox pages must be captured.");
} catch (error) {
  failure = error;
  console.error("[T15] failed: " + redact(error?.message ?? error));
} finally {
  if (healthMonitor) {
    try { await healthMonitor.stop(); }
    catch (error) { addBounded(report.errors.cleanupErrors, { code: "health_monitor_stop_failed", message: redact(error?.message ?? "monitor failed") }, "cleanup-errors"); }
    healthMonitor = null;
  }
  if (!report.screenshots.includes("studio-host-final.png")) await saveFinalScreenshot("studio-host", "studio-host-final.png");
  if (!report.screenshots.includes("lobby-receiver-final.png")) await saveFinalScreenshot("lobby-receiver", "lobby-receiver-final.png");
  for (const client of clients.values()) {
    try {
      if (!client.page.isClosed()) await client.page.evaluate(() => window.__t15SyntheticCleanup?.());
    } catch (error) {
      addBounded(report.errors.cleanupErrors, { client: client.name, code: "synthetic_cleanup_failed", message: redact(error?.message ?? "synthetic cleanup failed") }, "cleanup-errors");
    }
  }
  const closeResults = await Promise.allSettled(contexts.map((context) => context.close()));
  closeResults.forEach((result, index) => {
    if (result.status === "rejected") {
      addBounded(report.errors.cleanupErrors, { client: CLIENTS[index] ?? "unknown", code: "firefox_context_close_failed", message: redact(result.reason?.message ?? "context close failed") }, "cleanup-errors");
    }
  });
  for (const folder of runtimeFolders) {
    try { rmSync(folder, { recursive: true, force: true }); }
    catch (error) { addBounded(report.errors.cleanupErrors, { code: "profile_cleanup_failed", message: redact(error?.message ?? "profile cleanup failed") }, "cleanup-errors"); }
  }
  if (report.errors.cleanupErrors.length > 0 && !failure) failure = new Error("A bounded cleanup operation reported an error.");
  await finalizeReport();
  if (report.status !== "passed") process.exitCode = 1;
}
