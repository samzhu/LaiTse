import { enterRepositoryRootForLegacyScript, repositoryRoot, pocRoot } from "./lib/project-paths.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

enterRepositoryRootForLegacyScript();

const root = repositoryRoot;
const hostToken = process.env.FANOUT_TEST_HOST_TOKEN ?? "";
const roomPassword = process.env.FANOUT_TEST_ROOM_PASSWORD ?? "";
const secretValues = new Set([hostToken, roomPassword].filter(Boolean));
const scratchRoot = resolve(root, ".scratch/t16");
const outputDirectory = resolve(root, process.env.FANOUT_OUTPUT_DIR ?? ".scratch/t16/acceptance");
const outputRelative = relative(scratchRoot, outputDirectory);
if (isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(".." + sep)) {
  throw new Error("FANOUT_OUTPUT_DIR must stay inside .scratch/t16.");
}
if (process.version !== "v26.13.0") {
  throw new Error("Use the repository-pinned Node v26.13.0 runtime for this smoke.");
}
if (!hostToken || !roomPassword) {
  throw new Error("Set FANOUT_TEST_HOST_TOKEN and FANOUT_TEST_ROOM_PASSWORD in the process environment.");
}

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, ".tools/playwright-browsers");
const { firefox } = await import("playwright");
const baseURL = process.env.FANOUT_BASE_URL ?? "https://localhost:4173";
const target = new URL(baseURL);
if (target.protocol !== "https:" || target.username || target.password || target.search || target.hash || target.pathname !== "/") {
  throw new Error("FANOUT_BASE_URL must be a trusted HTTPS application root without credentials, query, or fragment.");
}
const caCertificate = resolve(root, process.env.FANOUT_CA_CERT ?? ".scratch/t01/tls/local-ca.pem");
const certificateUtility = process.env.CERTUTIL_BIN ?? "certutil";
const headless = process.env.HEADLESS !== "0";

const CLOSE_CODE = 4003;
const WAIT_TIMEOUT_MS = 20_000;
const MEDIA_TIMEOUT_MS = 12_000;
const SAMPLE_INTERVAL_MS = 400;
const SAMPLE_COUNT = 3;
const SETTLE_MS = 350;
const MAX_CONTROLS_PER_CONNECTION = 180;
const MAX_CONNECTIONS_PER_CLIENT = 4;
const MAX_STAGES = 12;
const MAX_ERRORS = 20;
const MAX_INTERACTION_ACKS = 4;
const MAX_SCREENSHOTS = 4;
const ROOM_ID = "studio";
const ROOM_NAME = "Meeting room";
const SYNTHETIC_COLOR = [38, 184, 92];
const SYNTHETIC_FREQUENCY_HZ = 997;
const CLIENT_NAMES = ["publisher", "receiver-a", "receiver-b", "receiver-c"];
const contexts = [];
const runtimeFolders = new Set();
const clients = new Map();
const startedAtEpochMs = Date.now();
let failure = null;
let collectionOverflow = false;

mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });

const report = {
  schemaVersion: 1,
  purpose: "Lightweight single-room synthetic Opus/VP8 fan-out smoke with one publisher and one to three actual Firefox receivers.",
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
    room: ROOM_ID,
    lockedManagedRoom: true,
    publisher: "publisher",
    receivers: ["receiver-a", "receiver-b", "receiver-c"],
    actualFirefoxProcesses: 4,
    isolatedFirefoxProfiles: 4,
    actualDecoderReceivers: 3,
    socketOnlyLoadClients: 0,
    syntheticSourcePages: ["publisher"],
    network: "one externally running managed local HTTPS/WSS application",
  },
  credentials: {
    hostToken: "provided in process memory; value not recorded",
    roomPassword: "provided in process memory; value not recorded",
    resumeTokens: "observed only as presence flags; values not retained",
  },
  syntheticSources: {
    audio: "one publisher-page oscillator routed through AudioContext MediaStreamDestination; no physical microphone",
    video: "one publisher-page animated canvas returned by test-only getDisplayMedia replacement; no physical display capture",
    audioFrequencyHz: SYNTHETIC_FREQUENCY_HZ,
    videoColorRgb: SYNTHETIC_COLOR,
    expectedSourcesPerKind: 1,
    mediaPayloadsRetained: false,
  },
  stages: [],
  streamConfiguration: null,
  receiverObservations: [],
  receiverStop: null,
  publisherStop: null,
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
    sampling: "Three 400 ms sample intervals per requested stage; counters are local or server enqueue observations, not p95, end-to-end latency, or quality results.",
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
  if (report.stages.length >= MAX_STAGES) throw new Error("The bounded T16 stage cap was reached.");
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
    console.log("[T16] " + name + (Object.keys(details).length ? " " + JSON.stringify(details) : ""));
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
  return value === ROOM_ID ? value : null;
}

function safeType(value) {
  const allowed = new Set([
    "join", "session.issued", "session.resume", "session.resumed", "room.snapshot", "participation.self", "participation.inspect",
    "host.claim", "host.claimed", "host.publishPermission", "host.actionResult", "audio.stream", "screen.stream",
    "audio.subscribe", "audio.subscribed", "audio.unsubscribe", "audio.unsubscribed", "audio.started", "audio.streamEnded",
    "screen.subscribe", "screen.subscribed", "screen.unsubscribe", "screen.unsubscribed", "screen.started", "screen.streamEnded",
    "screen.keyframeRequest", "interaction.submit", "interaction.ack",
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
    if (magic === "LTA1") {
      stats.audioFrames += 1;
      stats.audioBytes += byteLength;
    } else if (magic === "LTS1") {
      stats.screenFrames += 1;
      stats.screenBytes += byteLength;
    }
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
    try { route.close({ code: CLOSE_CODE, reason: "T16 connection cap reached" }); } catch {}
    return;
  }
  const connection = {
    index: client.connections.length + 1,
    openedAt: new Date().toISOString(),
    openedAtElapsedMs: elapsedMs(),
    controlSequence: 0,
    controls: [],
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
    try { route.close({ code: CLOSE_CODE, reason: "T16 route setup failed" }); } catch {}
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
  for (const key of ["FANOUT_TEST_HOST_TOKEN", "FANOUT_TEST_ROOM_PASSWORD", "HOST_CONTROL_TOKEN", "MEETING_ROOM_PASSWORD"]) delete browserEnv[key];
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

async function installSyntheticMedia(page) {
  await page.addInitScript(({ frequency, color }) => {
    const state = { audioRequests: 0, screenRequests: 0, sources: [], audioContexts: [] };
    Object.defineProperty(window, "__t16Synthetic", { value: state, configurable: false });
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
    Object.defineProperty(window, "__t16SyntheticCleanup", {
      value: async () => {
        for (const source of state.sources) if (source.track.readyState !== "ended") source.track.stop();
        await Promise.all(state.audioContexts.map((context) => context.close().catch(() => {})));
      },
      configurable: false,
    });
  }, { frequency: SYNTHETIC_FREQUENCY_HZ, color: SYNTHETIC_COLOR });
}

async function joinRoom(client, displayName) {
  const page = client.page;
  await page.goto(target.origin + "/?room=" + ROOM_ID, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Local room presence" }).waitFor();
  await page.getByLabel("Your display name").fill(displayName);
  await page.getByRole("button", { name: "Join room", exact: true }).click();
  await page.getByLabel("Meeting room password").waitFor({ state: "visible" });
  await page.locator("#meeting-room-password").fill(roomPassword);
  await page.getByRole("button", { name: "Enter room", exact: true }).click();
  await page.getByText("Connected to " + ROOM_NAME, { exact: true }).waitFor();
  await page.locator('[data-testid="audio-panel"]').waitFor();
  await page.locator('[data-testid="screen-panel"]').waitFor();
  const connection = client.activeConnection;
  assert.ok(connection, client.name + " should have an observed WebSocket connection.");
  await waitControl(client, connection, "received", "room.snapshot", 0);
  const snapshot = controls(client, connection, "received", "room.snapshot").at(-1);
  assert.equal(snapshot.locked, true, "the T16 room should be the configured locked managed studio.");
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
  assert.ok(colorDifference(snapshot.screen.pixel, SYNTHETIC_COLOR) <= 45,
    client.name + " decoded canvas should show the synthetic studio color; got " + JSON.stringify(snapshot.screen.pixel));
  return snapshot;
}

async function waitUntilActiveSources(client) {
  await client.page.waitForFunction(() => {
    const state = window.__t16Synthetic;
    return state && state.sources.some((source) => source.kind === "audio") && state.sources.some((source) => source.kind === "screen");
  }, undefined, { timeout: MEDIA_TIMEOUT_MS });
}

async function readSyntheticState(client) {
  return client.page.evaluate(() => {
    const state = window.__t16Synthetic;
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
  assert.equal(snapshot.roomId, ROOM_ID, client.name + " self-inspection must remain in the studio.");
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

async function sendFeedbackAck(client) {
  const connection = client.activeConnection;
  const previousCount = countControl(client, connection, "received", "interaction.ack");
  await client.page.getByTestId("feedback-like").click();
  const ack = await waitControl(client, connection, "received", "interaction.ack", previousCount);
  assert.equal(ack.acknowledged, true, client.name + " feedback should receive a normal server ACK.");
  addBounded(report.interactionAcks, { client: client.name, elapsedMs: ack.elapsedMs, duplicate: ack.duplicate }, "interaction-acks", MAX_INTERACTION_ACKS);
  return ack;
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

async function stopReceiver(client) {
  const connection = client.activeConnection;
  const audioAckCount = countControl(client, connection, "received", "audio.unsubscribed");
  const screenAckCount = countControl(client, connection, "received", "screen.unsubscribed");
  await client.page.getByTestId("audio-stop-listening").click();
  await client.page.getByTestId("screen-stop-watching").click();
  await waitControl(client, connection, "received", "audio.unsubscribed", audioAckCount);
  await waitControl(client, connection, "received", "screen.unsubscribed", screenAckCount);
}

async function stopPublisher(client) {
  const connection = client.activeConnection;
  await client.page.getByRole("button", { name: "停止麥克風", exact: true }).click();
  await client.page.getByRole("button", { name: "停止分享", exact: true }).click();
  await client.page.waitForFunction(() => {
    const state = window.__t16Synthetic;
    return state && state.sources.length === 2 && state.sources.every((source) => source.track.readyState === "ended");
  }, undefined, { timeout: WAIT_TIMEOUT_MS });
  const state = await readSyntheticState(client);
  assert.equal(state.audioRequests, 1, "publisher should create one synthetic audio source.");
  assert.equal(state.screenRequests, 1, "publisher should create one synthetic screen source.");
  return state;
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

async function saveFinalReport() {
  report.finishedAt = new Date().toISOString();
  report.durationMs = elapsedMs();
  report.errors.failure = failure ? redact(failure?.message ?? failure) : null;
  if (collectionOverflow || [...clients.values()].some((client) => client.collectionOverflow)) {
    report.errors.collectionErrors.push({ code: "bounded_collection_overflow" });
    if (!failure) report.errors.failure = "A bounded evidence collection overflowed.";
  }
  if (report.errors.pageErrors.length || report.errors.collectionErrors.length || report.errors.cleanupErrors.length) {
    if (!report.errors.failure) report.errors.failure = "A page, collection, or cleanup error was recorded.";
  }
  if (report.privacy.configuredSecretEchoObserved && !report.errors.failure) {
    report.errors.failure = "A configured credential appeared in a received control payload; the value was not retained.";
  }
  report.controlObservations = [...clients.values()].map((client) => ({
    client: client.name,
    browser: { engine: "Firefox", version: client.context.browser()?.version() ?? "not-reported", realProcess: true },
    connections: client.connections.map((connection) => ({
      index: connection.index,
      openedAt: connection.openedAt,
      openedAtElapsedMs: connection.openedAtElapsedMs,
      bytes: connection.bytes,
      controls: connection.controls,
    })),
  }));
  const detectedFailure = Boolean(report.errors.failure);
  report.status = detectedFailure ? "failed" : "passed";
  if (report.privacy.configuredSecretEchoObserved) report.status = "failed";
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
      "# T16 single-room fan-out smoke",
      "",
      "Status: " + report.status,
      "Started: " + report.startedAt,
      "Finished: " + report.finishedAt,
      "Duration: " + report.durationMs + " ms",
      "",
      "One externally running locked managed studio used one publisher and three additional real Firefox receiver processes. The publisher generated a single synthetic Opus source and a single synthetic VP8 canvas source. The report retains only allowlisted control summaries, byte/frame counters, local queue observations, render counters, and screenshots; it does not retain media payloads, full control payloads, credentials, or browser storage.",
      "",
      "This short run is a core feasibility check. It does not establish capacity, quality, end-to-end latency, human listening, physical-device capture, weak-network behavior, or deployment readiness.",
      "",
      "Failure: " + (report.errors.failure ?? "none"),
      "",
    ].join("\n"), { mode: 0o600 });
  } catch (error) {
    report.status = "failed";
    report.errors.failure = redact(error?.message ?? "report write failed");
    console.error("[T16] report write failed: " + report.errors.failure);
    process.exitCode = 1;
  }
  console.log("[T16] " + report.status + " report=" + join(outputDirectory, "report.json"));
}

try {
  const caPem = readFileSync(caCertificate, "utf8");
  assert.ok(caPem.includes("BEGIN CERTIFICATE"), "Configured CA file should contain a PEM certificate.");

  const [publisher, receiverA, receiverB, receiverC] = await Promise.all(CLIENT_NAMES.map((name) => launchClient(name)));
  report.runtime.firefox = publisher.context.browser()?.version() ?? "not-reported";
  await installSyntheticMedia(publisher.page);

  await runStage("publisher-joins-locked-studio-and-claims-host", async () => {
    await joinRoom(publisher, "T16 Publisher");
    await claimHost(publisher);
    return { room: ROOM_ID, lockedManagedRoom: true, hostClaimedThroughNormalUI: true, publisherRole: "host and publisher" };
  });

  await runStage("single-synthetic-publisher-starts-opus-and-vp8-once", async () => {
    await startPublishing(publisher);
    await waitUntilActiveSources(publisher);
    const sourceState = await readSyntheticState(publisher);
    assert.equal(sourceState.audioRequests, 1, "exactly one synthetic audio capture should be opened.");
    assert.equal(sourceState.screenRequests, 1, "exactly one synthetic screen capture should be opened.");
    return { audioRequests: sourceState.audioRequests, screenRequests: sourceState.screenRequests, codecs: { audio: "opus", video: "vp8" } };
  });

  await runStage("stage-1-one-real-firefox-receiver", async () => {
    await joinRoom(receiverA, "T16 Receiver A");
    await startReceiving(receiverA);
    await waitForRenderedMedia(receiverA);
    const config = streamConfiguration(receiverA);
    report.streamConfiguration = config;
    const self = await inspectParticipation(receiverA, true, true);
    const samples = await sampleReceivers([receiverA], "stage 1");
    await sendFeedbackAck(receiverA);
    report.receiverObservations.push({ client: receiverA.name, configuration: config, participation: self, stage1Samples: samples });
    return { receiverCount: 1, codecs: { audio: config.audio.codec, video: config.screen.codec }, audioGeneration: config.audio.generation, screenGeneration: config.screen.generation, clockId: config.audio.clockId, samples: samples.length, feedbackAck: true };
  });

  await runStage("stage-2-add-two-real-firefox-receivers", async () => {
    await Promise.all([joinRoom(receiverB, "T16 Receiver B"), joinRoom(receiverC, "T16 Receiver C")]);
    await Promise.all([startReceiving(receiverB), startReceiving(receiverC)]);
    await Promise.all([waitForRenderedMedia(receiverB), waitForRenderedMedia(receiverC)]);
    const configB = streamConfiguration(receiverB);
    const configC = streamConfiguration(receiverC);
    assertSameConfiguration(report.streamConfiguration, configB, receiverB.name);
    assertSameConfiguration(report.streamConfiguration, configC, receiverC.name);
    const [selfA, selfB, selfC] = await Promise.all([
      inspectParticipation(receiverA, true, true),
      inspectParticipation(receiverB, true, true),
      inspectParticipation(receiverC, true, true),
    ]);
    const receivers = [receiverA, receiverB, receiverC];
    const samples = await sampleReceivers(receivers, "stage 2");
    await Promise.all(receivers.map((client) => sendFeedbackAck(client)));
    await Promise.all([
      saveScreenshot(receiverA, "three-receivers-a.png"),
      saveScreenshot(receiverB, "three-receivers-b.png"),
      saveScreenshot(receiverC, "three-receivers-c.png"),
    ]);
    assert.ok(report.screenshots.length >= 2, "at least two real Firefox receiver pages must be captured while all three decode live media.");
    report.receiverObservations.push(
      { client: receiverA.name, configuration: streamConfiguration(receiverA), participation: selfA, stage2Samples: samples.map((sample) => ({ ...sample, receivers: { [receiverA.name]: sample.receivers[receiverA.name] } })) },
      { client: receiverB.name, configuration: configB, participation: selfB, stage2Samples: samples.map((sample) => ({ ...sample, receivers: { [receiverB.name]: sample.receivers[receiverB.name] } })) },
      { client: receiverC.name, configuration: configC, participation: selfC, stage2Samples: samples.map((sample) => ({ ...sample, receivers: { [receiverC.name]: sample.receivers[receiverC.name] } })) },
    );
    return {
      receiverCount: 3,
      allActualFirefoxDecoders: true,
      sameAudioGeneration: true,
      sameScreenGeneration: true,
      sameClockAndConfiguration: true,
      codecs: { audio: "opus", video: "vp8" },
      samples: samples.length,
      feedbackAcks: receivers.length,
      screenshots: [...report.screenshots],
      selfInspectionIncludesDownlinkAndTransport: [selfA, selfB, selfC].every((item) => item.media.audioDownlinkFrames > 0 && item.media.screenDownlinkFrames > 0 && item.transport !== null),
    };
  });

  await runStage("receiver-a-normal-stop-isolated-b-and-c-continue", async () => {
    await stopReceiver(receiverA);
    const selfA = await inspectParticipation(receiverA, false, false);
    assert.ok(Number.isFinite(selfA.media.audioDownlinkFrames) && Number.isFinite(selfA.media.screenDownlinkFrames),
      "T16 self observation should include its server downlink frame counters.");
    const receiverAQuiet = await readReceiverQuietWindow(receiverA, "stopped receiver A");
    const stoppedState = await mediaSnapshot(receiverA.page);
    assert.equal(stoppedState.audio.receiveIntent, false, "receiver A audio receive intent should clear after Stop listening.");
    assert.equal(stoppedState.audio.subscribed, false, "receiver A should no longer be subscribed to audio.");
    assert.equal(stoppedState.screen.receiveIntent, false, "receiver A screen receive intent should clear after Stop watching.");
    assert.equal(stoppedState.screen.subscribed, false, "receiver A should no longer be subscribed to screen.");
    const samples = await sampleReceivers([receiverB, receiverC], "stage 3 after receiver A stop");
    const [selfB, selfC] = await Promise.all([
      inspectParticipation(receiverB, true, true),
      inspectParticipation(receiverC, true, true),
    ]);
    for (const [client, latest] of [[receiverB, selfB], [receiverC, selfC]]) {
      const previous = report.receiverObservations.find((item) => item.client === client.name)?.participation;
      assert.ok(previous, client.name + " should have a prior self-inspection for downlink comparison.");
      assert.ok(latest.media.audioDownlinkBytes > previous.media.audioDownlinkBytes && latest.media.screenDownlinkBytes > previous.media.screenDownlinkBytes,
        client.name + " server downlink counters should keep growing after receiver A unsubscribes.");
    }
    report.receiverStop = { client: receiverA.name, self: selfA, quietWindow: receiverAQuiet, remainingReceiverSamples: samples, remainingReceiverSelf: [selfB, selfC] };
    report.receiverObservations.push(
      { client: receiverB.name, afterReceiverAStopParticipation: selfB },
      { client: receiverC.name, afterReceiverAStopParticipation: selfC },
    );
    return { receiverAUnsubscribedAndCleared: true, receiverABinaryStableAfterDrain: true, receiverBCContinued: true, receiverBCSamples: samples.length };
  });

  await runStage("normal-publisher-stop-ends-media-for-active-receivers", async () => {
    const activeReceivers = [receiverB, receiverC];
    const endCounts = new Map(activeReceivers.map((client) => [client.name, {
      audio: countControl(client, client.activeConnection, "received", "audio.streamEnded"),
      screen: countControl(client, client.activeConnection, "received", "screen.streamEnded"),
    }]));
    const sourceState = await stopPublisher(publisher);
    const ended = {};
    for (const client of activeReceivers) {
      ended[client.name] = {
        audio: await waitControl(client, client.activeConnection, "received", "audio.streamEnded", endCounts.get(client.name).audio),
        screen: await waitControl(client, client.activeConnection, "received", "screen.streamEnded", endCounts.get(client.name).screen),
      };
    }
    const quiet = [];
    for (const client of activeReceivers) quiet.push(await readReceiverQuietWindow(client, "publisher-stopped " + client.name));
    report.publisherStop = { sourceState, streamEnded: ended, activeReceiverQuietWindows: quiet };
    return { ordinaryUIStop: true, audioTracksEnded: true, screenTracksEnded: true, activeReceiversStreamEnded: activeReceivers.length, quietDrainMs: SETTLE_MS, screenCleared: true };
  });
} catch (error) {
  failure = error;
  console.error("[T16] failed: " + redact(error?.message ?? error));
} finally {
  for (const client of clients.values()) {
    try {
      if (!client.page.isClosed()) await client.page.evaluate(() => window.__t16SyntheticCleanup?.());
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
