import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { get as httpsGet } from "node:https";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hostToken = process.env.SLOW_RECEIVER_TEST_HOST_TOKEN ?? "";
const roomPassword = process.env.SLOW_RECEIVER_TEST_ROOM_PASSWORD ?? "";
const secretValues = new Set([hostToken, roomPassword].filter(Boolean));
const scratchRoot = resolve(root, ".scratch/t14");
const outputDirectory = resolve(root, process.env.SLOW_RECEIVER_OUTPUT_DIR ?? ".scratch/t14/acceptance");
const outputRelative = relative(scratchRoot, outputDirectory);
if (isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(".." + sep)) {
  throw new Error("SLOW_RECEIVER_OUTPUT_DIR must stay inside .scratch/t14.");
}

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, ".tools/playwright-browsers");
const { firefox } = await import("playwright");
const baseURL = process.env.SLOW_RECEIVER_BASE_URL ?? "https://localhost:4173";
const target = new URL(baseURL);
if (target.protocol !== "https:" || target.username || target.password || target.search || target.hash || target.pathname !== "/") {
  throw new Error("SLOW_RECEIVER_BASE_URL must be a trusted HTTPS application root without credentials, query, or fragment.");
}

const caCertificate = resolve(root, process.env.SLOW_RECEIVER_CA_CERT ?? ".scratch/t01/tls/local-ca.pem");
const certificateUtility = process.env.CERTUTIL_BIN ?? "certutil";
const headless = process.env.HEADLESS !== "0";
const normalTimeoutMs = 10_000;
const recoveryTimeoutMs = 15_000;
const sampleIntervalMs = 90;
const MAX_DRIVER_BYTES = 256 * 1024;
const MAX_DRIVER_MESSAGES = 128;
const DRIVER_AGE_LIMIT_MS = 500;
const DRIVER_CLOSE_CODE = 4003;
const MAX_CONNECTIONS_PER_CLIENT = 5;
const MAX_CONTROLS_PER_CONNECTION = 240;
const MAX_CATALOGUE_BYTES = 64 * 1024;
const MAX_ERRORS = 20;
const MAX_STAGES = 24;
const contexts = [];
const profileFolders = new Set();
const clients = new Map();
const startedAtEpochMs = Date.now();
let failure = null;

const report = {
  schemaVersion: 1,
  purpose: "Short T14 synthetic Firefox slow-receiver isolation smoke using a bounded Playwright application-layer downlink hold.",
  startedAt: new Date().toISOString(),
  status: "running",
  baseURL: target.origin,
  runtime: { node: process.version, platform: process.platform, architecture: process.arch, firefox: "not-reported" },
  tls: {
    caCertificate: relative(root, caCertificate),
    trust: "local CA imported only into isolated Firefox NSS profiles and supplied to the HTTPS catalogue request",
    ignoreCertificateErrors: false,
    systemTrustChanged: false,
  },
  topology: {
    browsers: ["host", "healthy receiver", "slow receiver"],
    isolatedFirefoxProfiles: 3,
    syntheticSources: "host page only: oscillator/AudioContext stream and animated canvas stream; no physical microphone or display capture",
  },
  disturbance: {
    scope: "slow receiver only; Playwright WebSocketRoute server-to-browser application layer",
    delivery: "hold downlink messages until the oldest queued message reaches 500 ms; do not replay held messages",
    queueLimitBytes: MAX_DRIVER_BYTES,
    queueLimitMessages: MAX_DRIVER_MESSAGES,
    queueAgeLimitMs: DRIVER_AGE_LIMIT_MS,
    closeCode: DRIVER_CLOSE_CODE,
    routeHoldCount: 0,
  },
  credentials: { hostToken: "not-recorded", roomPassword: "not-recorded; presence only", resumeToken: "not-recorded; presence booleans only" },
  checks: [],
  driver: null,
  socketConnections: [],
  recoveries: [],
  mediaSamples: { healthyDuringHold: [], healthyAfterRecovery: [], slowInitial: null, slowRecovered: null },
  interaction: null,
  inspections: [],
  gestures: [],
  screenshots: [],
  privacy: {
    rawControlPayloadsRetained: false,
    browserStorageDumped: false,
    mediaPayloadsRetained: false,
    configuredSecretEchoObserved: false,
    secretsInRetainedTrace: false,
    resumeTokensRetained: false,
  },
  limits: {
    transportClaim: "The injected hold is an application-layer Playwright route. It is not TCP shaping, packet loss, physical network age, or a real browser background transition.",
    networkAndDeviceClaims: "No physical microphone, human listening, phone, OS backgrounding, packet-loss, bandwidth, p95, endurance, capacity, or Cloud Run claim.",
    serverBuffer: "The route driver queue is separate from the server application send budget; server policy is covered by its Node contract seam.",
    autoplay: "No autoplay preferences are changed. If playback is suspended, the visible ordinary continue-listening button is clicked and actual AudioWorklet samples are still required.",
  },
  errors: { pageErrors: [], socketErrors: [], collectionErrors: [], cleanupErrors: [], failure: null },
};

mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });

function elapsedMs() {
  return Date.now() - startedAtEpochMs;
}

function redact(value) {
  let output = String(value ?? "");
  for (const secret of secretValues) {
    if (secret) output = output.split(secret).join("[redacted]");
  }
  return output.slice(0, 320);
}

function boundedPush(array, value, label, cap = MAX_ERRORS) {
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
  if (report.checks.length >= MAX_STAGES) throw new Error("The bounded smoke stage cap was reached.");
  const item = { name, atMs: elapsedMs(), ...details };
  report.checks.push(item);
  console.log("[T14] " + name + (Object.keys(details).length ? " " + JSON.stringify(details) : ""));
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function payloadBytes(payload) {
  if (typeof payload === "string") return Buffer.byteLength(payload, "utf8");
  if (Buffer.isBuffer(payload) || payload instanceof Uint8Array) return payload.byteLength;
  if (payload instanceof ArrayBuffer) return payload.byteLength;
  return 0;
}

function containsSecret(value) {
  for (const secret of secretValues) if (secret && value.includes(secret)) return true;
  return false;
}

function safeTransport(value) {
  if (!value || typeof value !== "object") return null;
  const result = {};
  for (const key of [
    "scope",
    "pendingCallbackCount",
    "pendingCallbackBytes",
    "pendingCallbackHighWaterCount",
    "pendingCallbackHighWaterBytes",
    "oldestPendingCallbackAgeMs",
    "highWaterBufferedBytes",
    "maxPendingBytes",
    "maxPendingCallbackAgeMs",
    "closeReason",
  ]) {
    const item = value[key];
    if (key === "scope" || key === "closeReason") {
      if (typeof item === "string" && item.length <= 80) result[key] = redact(item);
    } else {
      result[key] = numberOrNull(item);
    }
  }
  return result;
}

function controlSummary(message, direction, connection) {
  const type = typeof message?.type === "string" ? message.type.slice(0, 64) : "unknown";
  const item = {
    direction,
    connectionIndex: connection.index,
    sequence: ++connection.sequence,
    atMs: elapsedMs(),
    type,
  };
  if (typeof message?.roomId === "string" && message.roomId.length <= 80) item.roomId = message.roomId;
  if (type === "join") {
    item.displayNamePresent = typeof message.displayName === "string";
    item.passwordProvided = typeof message.password === "string";
    item.resumable = message.resumable === true;
  } else if (type === "session.issued") {
    item.tokenPresent = typeof message.token === "string" && message.token.length > 0;
    if (item.tokenPresent) secretValues.add(message.token);
  } else if (type === "session.resume") {
    item.tokenPresent = typeof message.token === "string" && message.token.length > 0;
    item.passwordProvided = typeof message.password === "string";
  } else if (type === "session.resumed") {
    item.role = message.role === "participant" || message.role === "display" ? message.role : "unknown";
    item.mode = message.mode === "watch" || message.mode === "interaction" ? message.mode : "unknown";
  } else if (type === "room.snapshot") {
    item.roomId = typeof message.room?.id === "string" ? message.room.id : item.roomId ?? null;
    item.hostControlsEnabled = Boolean(message.room?.hostControlsEnabled);
    item.publishAllowed = Boolean(message.room?.publishAllowed);
    item.locked = Boolean(message.room?.isLocked);
  } else if (type === "participation.self") {
    item.role = message.role === "participant" || message.role === "display" ? message.role : "unknown";
    item.mode = message.mode === "watch" || message.mode === "interaction" ? message.mode : "unknown";
    item.transport = safeTransport(message.transport);
    item.media = {
      audioSubscribed: Boolean(message.media?.audio?.subscribed),
      screenSubscribed: Boolean(message.media?.screen?.subscribed),
    };
  } else if (type === "audio.stream") {
    item.generation = Number.isInteger(message.generation) ? message.generation : null;
    item.clockId = typeof message.clockId === "string" ? message.clockId.slice(0, 80) : null;
    item.config = {
      codec: typeof message.config?.codec === "string" ? message.config.codec.slice(0, 24) : null,
      sampleRate: numberOrNull(message.config?.sampleRate),
      channels: numberOrNull(message.config?.channels),
    };
  } else if (type === "screen.stream") {
    item.generation = Number.isInteger(message.generation) ? message.generation : null;
    item.clockId = typeof message.clockId === "string" ? message.clockId.slice(0, 80) : null;
    item.config = {
      codec: typeof message.codec === "string" ? message.codec.slice(0, 24) : null,
      width: numberOrNull(message.width),
      height: numberOrNull(message.height),
      frameRate: numberOrNull(message.frameRate),
    };
  } else if (/^(audio|screen)\.(subscribe|subscribed|unsubscribe|unsubscribed|started|keyframeRequest)$/u.test(type)) {
    item.generation = Number.isInteger(message.generation) ? message.generation : null;
    item.clockId = typeof message.clockId === "string" ? message.clockId.slice(0, 80) : null;
  } else if (type === "interaction.ack") {
    item.acknowledged = true;
    item.duplicate = message.duplicate === true;
  } else if (type === "interaction.event") {
    item.eventKind = ["feedback", "chat", "sticker", "danmaku"].includes(message.event?.kind) ? message.event.kind : "other";
  } else if (type === "host.claimed" || type === "host.state") {
    item.hostClaimed = message.claimed === true || message.isHost === true;
  }
  return item;
}

function observePayload(client, connection, direction, payload) {
  const byteCount = payloadBytes(payload);
  const directionStats = direction === "sent" ? connection.bytes.browserToServer : connection.bytes.serverToBrowser;
  directionStats.messages += 1;
  directionStats.bytes += byteCount;
  if (typeof payload !== "string") {
    if (byteCount > 0) directionStats.binaryMessages += 1;
    return;
  }
  let message;
  try { message = JSON.parse(payload); }
  catch { return; }
  if (!message || typeof message !== "object" || Array.isArray(message)) return;
  if (direction === "received" && containsSecret(payload)) report.privacy.configuredSecretEchoObserved = true;
  if (!boundedPush(connection.controls, controlSummary(message, direction, connection), client.name + "-controls-" + connection.index, MAX_CONTROLS_PER_CONNECTION)) {
    client.collectionOverflow = true;
  }
}

function connectRoutedSocket(client, route, connection) {
  const serverRoute = route.connectToServer();
  connection.route = route;
  connection.serverRoute = serverRoute;
  client.wire.activeConnection = connection;

  route.onMessage((payload) => {
    observePayload(client, connection, "sent", payload);
    serverRoute.send(payload);
  });

  serverRoute.onMessage((payload) => {
    observePayload(client, connection, "received", payload);
    if (receiveDriverMessage(client, connection, payload)) return;
    route.send(payload);
  });
  connection.connectedAtMs = elapsedMs();
  return connection;
}

async function installWebSocketRoute(client) {
  await client.page.routeWebSocket(/\/ws(?:\?|$)/u, (route) => {
    const connection = {
      index: ++client.wire.nextConnectionIndex,
      openedAtMs: elapsedMs(),
      connectedAtMs: null,
      sequence: 0,
      controls: [],
      bytes: {
        browserToServer: { messages: 0, bytes: 0, binaryMessages: 0 },
        serverToBrowser: { messages: 0, bytes: 0, binaryMessages: 0 },
      },
      serverRoute: null,
      route: null,
    };
    if (client.wire.connections.length >= MAX_CONNECTIONS_PER_CLIENT) {
      client.collectionOverflow = true;
      boundedPush(report.errors.collectionErrors, { client: client.name, code: "connection_cap_reached" }, "connection-errors");
      Promise.resolve(route.close({ code: DRIVER_CLOSE_CODE, reason: "T14 smoke connection cap" })).catch(() => {});
      return;
    }
    client.wire.connections.push(connection);
    connectRoutedSocket(client, route, connection);
  });
}

function enqueueDriverMessage(client, driver, payload) {
  const bytes = payloadBytes(payload);
  const now = Date.now();
  if (driver.queue.length > 0 && now - driver.queue[0].enqueuedAtEpochMs >= DRIVER_AGE_LIMIT_MS) {
    closeDriver(client, driver, "oldest_queued_message_age_limit");
    driver.triggerBytes = bytes;
    driver.triggerMessages += 1;
    driver.discardedTriggerBytes += bytes;
    driver.discardedTriggerMessages += 1;
    return;
  }
  if (driver.queueBytes + bytes > MAX_DRIVER_BYTES) {
    closeDriver(client, driver, "driver_byte_limit");
    driver.triggerBytes = bytes;
    driver.triggerMessages += 1;
    driver.discardedTriggerBytes += bytes;
    driver.discardedTriggerMessages += 1;
    return;
  }
  if (driver.queue.length + 1 > MAX_DRIVER_MESSAGES) {
    closeDriver(client, driver, "driver_message_limit");
    driver.triggerBytes = bytes;
    driver.triggerMessages += 1;
    driver.discardedTriggerBytes += bytes;
    driver.discardedTriggerMessages += 1;
    return;
  }

  driver.queue.push({ payload, bytes, enqueuedAtEpochMs: now });
  driver.queueBytes += bytes;
  driver.highWaterBytes = Math.max(driver.highWaterBytes, driver.queueBytes);
  driver.highWaterMessages = Math.max(driver.highWaterMessages, driver.queue.length);
  driver.highWaterAgeMs = Math.max(driver.highWaterAgeMs, now - driver.queue[0].enqueuedAtEpochMs);
  scheduleAgeClose(client, driver);
}

function scheduleAgeClose(client, driver) {
  if (!driver.active || driver.ageTimer || driver.queue.length === 0) return;
  const ageMs = Date.now() - driver.queue[0].enqueuedAtEpochMs;
  const remainingMs = Math.max(1, DRIVER_AGE_LIMIT_MS - ageMs);
  driver.ageTimer = setTimeout(() => {
    driver.ageTimer = null;
    if (!driver.active || driver.queue.length === 0) return;
    const currentAgeMs = Date.now() - driver.queue[0].enqueuedAtEpochMs;
    driver.highWaterAgeMs = Math.max(driver.highWaterAgeMs, currentAgeMs);
    if (currentAgeMs >= DRIVER_AGE_LIMIT_MS) closeDriver(client, driver, "oldest_queued_message_age_limit");
    else scheduleAgeClose(client, driver);
  }, remainingMs);
}

function closeDriver(client, driver, reason) {
  if (!driver.active) return;
  driver.active = false;
  driver.closeReason = reason;
  driver.closedAtMs = elapsedMs();
  driver.closedAtEpochMs = Date.now();
  driver.highWaterAgeMs = Math.max(
    driver.highWaterAgeMs,
    driver.queue.length ? Date.now() - driver.queue[0].enqueuedAtEpochMs : 0,
  );
  if (driver.ageTimer) clearTimeout(driver.ageTimer);
  driver.ageTimer = null;
  driver.discardedMessages = driver.queue.length;
  driver.discardedBytes = driver.queueBytes;
  driver.discardedBinaryMessages = driver.queue.reduce((count, item) =>
    count + (typeof item.payload === "string" ? 0 : 1), 0);
  driver.queue.length = 0;
  driver.queueBytes = 0;

  const connection = client.wire.connections.find((item) => item.index === driver.connectionIndex);
  if (connection) {
    connection.closeCode = DRIVER_CLOSE_CODE;
    connection.closeReason = reason;
    connection.closedAtMs = driver.closedAtMs;
  }
  const closeOptions = { code: DRIVER_CLOSE_CODE, reason: "T14 smoke driver " + reason };
  // Close both test endpoints explicitly. Closing only the server endpoint
  // did not deliver a page close event in the first local route experiment.
  driver.closeEndpoints = ["browser-route", "server-route"];
  for (const endpoint of [connection?.route, connection?.serverRoute]) {
    if (!endpoint) continue;
    try {
      Promise.resolve(endpoint.close(closeOptions)).catch((error) => {
        boundedPush(report.errors.cleanupErrors, { client: client.name, code: "route_close_failed", message: redact(error?.message ?? "route close failed") }, "cleanup-errors");
      });
    } catch (error) {
      boundedPush(report.errors.cleanupErrors, { client: client.name, code: "route_close_failed", message: redact(error?.message ?? "route close failed") }, "cleanup-errors");
    }
  }
  report.driver = driverSummary(driver);
}

function driverSummary(driver) {
  return {
    client: "slow",
    connectionIndex: driver.connectionIndex,
    transportLayer: "Playwright WebSocketRoute server-to-browser application layer; not TCP packet shaping",
    holdStartedAtMs: driver.startedAtMs,
    closeAtMs: driver.closedAtMs,
    closeCode: driver.active ? null : DRIVER_CLOSE_CODE,
    closeReason: driver.closeReason,
    queueLimitBytes: MAX_DRIVER_BYTES,
    queueLimitMessages: MAX_DRIVER_MESSAGES,
    oldestAgeLimitMs: DRIVER_AGE_LIMIT_MS,
    queueHighWaterBytes: driver.highWaterBytes,
    queueHighWaterMessages: driver.highWaterMessages,
    queueAgeHighWaterMs: driver.highWaterAgeMs,
    receivedDownlinkMessages: driver.receivedMessages,
    receivedDownlinkBytes: driver.receivedBytes,
    queuedMessagesAtClose: driver.discardedMessages,
    queuedBytesAtClose: driver.discardedBytes,
    queuedBinaryMessagesAtClose: driver.discardedBinaryMessages,
    overflowTriggerMessages: driver.discardedTriggerMessages,
    overflowTriggerBytes: driver.discardedTriggerBytes,
    messagesAfterCloseBeforeReconnect: driver.postCloseMessages,
    bytesAfterCloseBeforeReconnect: driver.postCloseBytes,
    replayedMessages: 0,
    heldPayloadsRetainedAfterClose: driver.queue.length,
  };
}

function enableSlowDownlink(client) {
  const connection = client.wire.activeConnection;
  assert.ok(connection?.serverRoute, "Slow receiver must have an active routed socket before the hold.");
  assert.equal(client.wire.driver, null, "Only one bounded slow-downlink cycle is supported.");
  const driver = {
    active: true,
    connectionIndex: connection.index,
    startedAtMs: elapsedMs(),
    startedAtEpochMs: Date.now(),
    closedAtMs: null,
    closedAtEpochMs: null,
    closeReason: null,
    queue: [],
    queueBytes: 0,
    highWaterBytes: 0,
    highWaterMessages: 0,
    highWaterAgeMs: 0,
    receivedMessages: 0,
    receivedBytes: 0,
    discardedMessages: 0,
    discardedBytes: 0,
    discardedBinaryMessages: 0,
    discardedTriggerMessages: 0,
    discardedTriggerBytes: 0,
    postCloseMessages: 0,
    postCloseBytes: 0,
    ageTimer: null,
  };
  client.wire.driver = driver;

  report.disturbance.routeHoldCount += 1;
  return driver;
}

function receiveDriverMessage(client, connection, payload) {
  const driver = client.wire.driver;
  if (!driver || driver.connectionIndex !== connection.index) return false;
  if (!driver.active) {
    driver.postCloseMessages += 1;
    driver.postCloseBytes += payloadBytes(payload);
    return true;
  }
  driver.receivedMessages += 1;
  driver.receivedBytes += payloadBytes(payload);
  enqueueDriverMessage(client, driver, payload);
  return true;
}

function runCertutil(args) {
  require("node:child_process").execFileSync(certificateUtility, args, { stdio: "pipe" });
}

function createTrustedProfile(name, caCertificatePath) {
  const folder = join(outputDirectory, name + "-runtime");
  profileFolders.add(folder);
  const profileDirectory = join(folder, "profile");
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(profileDirectory, { recursive: true, mode: 0o700 });
  runCertutil(["-N", "-d", "sql:" + profileDirectory, "--empty-password"]);
  runCertutil(["-A", "-d", "sql:" + profileDirectory, "-n", "LaiTse local development CA", "-t", "C,,", "-i", caCertificatePath]);
  const appData = join(folder, "app-data");
  const localAppData = join(folder, "local-app-data");
  mkdirSync(appData, { recursive: true, mode: 0o700 });
  mkdirSync(localAppData, { recursive: true, mode: 0o700 });
  return { folder, profileDirectory, appData, localAppData };
}

function installSyntheticMedia(page) {
  return page.addInitScript(() => {
    const devices = navigator.mediaDevices;
    const state = { audioRequests: 0, screenRequests: 0, sources: [], audioContexts: [] };
    Object.defineProperty(window, "__t14SyntheticMedia", { value: state, configurable: false });

    const trackSource = (kind, sourceIndex, track, stopAnimation = null) => {
      const source = { kind, sourceIndex, track };
      const stop = track.stop.bind(track);
      track.stop = () => {
        stopAnimation?.();
        stop();
      };
      state.sources.push(source);
      return track;
    };

    Object.defineProperty(devices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const sourceIndex = state.audioRequests++;
        const context = new AudioContext({ sampleRate: 48_000 });
        await context.resume();
        const destination = context.createMediaStreamDestination();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = 620 + sourceIndex * 90;
        gain.gain.value = 0.2;
        oscillator.connect(gain).connect(destination);
        oscillator.start();
        state.audioContexts.push(context);
        const stream = destination.stream;
        for (const track of stream.getAudioTracks()) trackSource("audio", sourceIndex, track);
        return stream;
      },
    });

    Object.defineProperty(devices, "getDisplayMedia", {
      configurable: true,
      value: async () => {
        const sourceIndex = state.screenRequests++;
        const width = 1280;
        const height = 720;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const drawing = canvas.getContext("2d");
        if (!drawing) throw new Error("Could not create the synthetic canvas source.");
        let active = true;
        let frame = 0;
        const draw = () => {
          if (!active) return;
          drawing.fillStyle = "#18202e";
          drawing.fillRect(0, 0, width, height);
          drawing.fillStyle = "#29c77a";
          drawing.fillRect(36 + (frame * 7) % (width - 180), 48, 110, 96);
          drawing.fillStyle = "#fff";
          drawing.font = "38px sans-serif";
          drawing.fillText("Synthetic VP8 frame " + frame, 175, 130);
          frame += 1;
          requestAnimationFrame(draw);
        };
        draw();
        const stream = canvas.captureStream(15);
        const track = stream.getVideoTracks()[0];
        if (!track) throw new Error("Synthetic canvas did not create a video track.");
        trackSource("screen", sourceIndex, track, () => { active = false; });
        return stream;
      },
    });
  });
}

async function launchClient(name, syntheticPublisher = false, caCertificatePath) {
  const profile = createTrustedProfile(name, caCertificatePath);
  const browserEnv = { ...process.env, MOZ_APP_DATA: profile.appData, MOZ_LOCAL_APP_DATA: profile.localAppData };
  for (const key of [
    "SLOW_RECEIVER_TEST_HOST_TOKEN", "SLOW_RECEIVER_TEST_ROOM_PASSWORD", "SLOW_RECEIVER_OUTPUT_DIR",
    "HOST_CONTROL_TOKEN", "HOST_CONTROL_TEST_TOKEN", "HOST_CONTROL_TEST_PASSWORD", "MEETING_ROOM_PASSWORD",
    "HOST_TOKEN", "ROOM_PASSWORD", "TEST_HOST_TOKEN",
  ]) delete browserEnv[key];
  const context = await firefox.launchPersistentContext(profile.profileDirectory, {
    headless,
    env: browserEnv,
    viewport: { width: 1360, height: 1000 },
    colorScheme: "light",
    firefoxUserPrefs: { "security.enterprise_roots.enabled": false },
  });
  context.setDefaultTimeout(normalTimeoutMs);
  contexts.push(context);
  const page = context.pages()[0] ?? await context.newPage();
  const client = {
    name,
    page,
    profile,
    syntheticPublisher,
    wire: { connections: [], activeConnection: null, driver: null, nextConnectionIndex: 0 },
    collectionOverflow: false,
    pageErrorCount: 0,
    socketErrorCount: 0,
  };
  page.on("pageerror", (error) => {
    client.pageErrorCount += 1;
    boundedPush(report.errors.pageErrors, { client: name, message: redact(error?.message ?? "page error") }, "page-errors");
  });
  page.on("websocket", (socket) => {
    socket.on("socketerror", (error) => {
      client.socketErrorCount += 1;
      boundedPush(report.errors.socketErrors, { client: name, message: redact(String(error ?? "socket error")) }, "socket-errors");
    });
  });
  if (syntheticPublisher) await installSyntheticMedia(page);
  await installWebSocketRoute(client);
  clients.set(name, client);
  return client;
}

function waitFor(predicate, description, timeoutMs = normalTimeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolveWait, rejectWait) => {
    const tick = () => {
      let value;
      try { value = predicate(); }
      catch (error) { rejectWait(error); return; }
      if (value) { resolveWait(value); return; }
      if (Date.now() >= deadline) {
        rejectWait(new Error("Timed out waiting for " + description + "."));
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}

function controls(client, connectionIndex, direction = null, type = null) {
  const connection = client.wire.connections.find((item) => item.index === connectionIndex);
  if (!connection) return [];
  return connection.controls.filter((item) =>
    (!direction || item.direction === direction) && (!type || item.type === type));
}

function controlCount(client, connectionIndex, direction, type) {
  return controls(client, connectionIndex, direction, type).length;
}

function waitControl(client, connectionIndex, direction, type, countBefore = 0, timeoutMs = normalTimeoutMs) {
  return waitFor(
    () => controls(client, connectionIndex, direction, type)[countBefore] ?? null,
    client.name + " " + direction + " " + type + " on connection " + connectionIndex,
    timeoutMs,
  );
}

function latestControl(client, connectionIndex, direction, type) {
  return controls(client, connectionIndex, direction, type).at(-1) ?? null;
}

function currentConnection(client) {
  return client.wire.activeConnection;
}

function browserURL(search = "") {
  return new URL(search, target.origin).href;
}

function certificateGet(pathname, caPem) {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpsGet(target.origin + pathname, { ca: caPem }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
        if (Buffer.byteLength(body, "utf8") > MAX_CATALOGUE_BYTES) {
          request.destroy(new Error("The local room catalogue exceeded the bounded read limit."));
        }
      });
      response.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          if (response.statusCode !== 200 || !Array.isArray(parsed)) throw new Error("The local room catalogue was not a successful JSON list.");
          resolveRequest(parsed);
        } catch (error) {
          rejectRequest(error);
        }
      });
    });
    request.setTimeout(5_000, () => request.destroy(new Error("The local HTTPS room catalogue timed out.")));
    request.on("error", rejectRequest);
  });
}

async function readRoomCatalogue(caPem) {
  const rooms = await certificateGet("/api/rooms", caPem);
  const studio = rooms.find((room) => room.id === "studio");
  assert.ok(studio && studio.isLocked && studio.hostControlsEnabled, "The studio must be password-gated with managed host controls.");
  const serialized = JSON.stringify(rooms);
  assert.equal(serialized.includes(hostToken), false, "Room catalogue must not expose the host token.");
  assert.equal(serialized.includes(roomPassword), false, "Room catalogue must not expose the room password.");
  stage("trusted-local-catalogue-confirms-locked-managed-studio", { roomId: studio.id, locked: true, hostControlsEnabled: true });
}

async function enterParticipant(client, displayName) {
  await client.page.goto(browserURL("/?room=studio"), { waitUntil: "domcontentloaded" });
  await client.page.getByRole("heading", { name: "Local room presence" }).waitFor();
  await client.page.getByLabel("Your display name").fill(displayName);
  await client.page.getByRole("button", { name: "Join room", exact: true }).click();
  await client.page.getByLabel("Meeting room password").waitFor({ state: "visible" });
  await client.page.locator("#meeting-room-password").fill(roomPassword);
  await client.page.getByRole("button", { name: "Enter room", exact: true }).click();
  await client.page.getByText("Connected to Meeting room", { exact: true }).waitFor();
  await client.page.getByTestId("participation-controls").waitFor();
  const connection = await waitFor(() => currentConnection(client), client.name + " initial WebSocket");
  await waitControl(client, connection.index, "received", "room.snapshot");
  const self = await waitControl(client, connection.index, "received", "participation.self");
  const issued = await waitControl(client, connection.index, "received", "session.issued");
  assert.equal(latestControl(client, connection.index, "received", "room.snapshot")?.roomId, "studio");
  assert.ok(issued.tokenPresent, client.name + " should receive a resumable control session.");
  return {
    roomId: "studio",
    role: self.role,
    mode: self.mode,
    connectionIndex: connection.index,
  };
}

async function enterHost(client) {
  const identity = await enterParticipant(client, "T14 synthetic host");
  await client.page.getByTestId("host-panel").waitFor();
  await client.page.getByTestId("host-control-token").fill(hostToken);
  const connection = currentConnection(client);
  const claimedBefore = controlCount(client, connection.index, "received", "host.claimed");
  await client.page.getByTestId("host-claim").click();
  await client.page.getByTestId("host-state").filter({ hasText: "HOST" }).waitFor();
  await waitControl(client, connection.index, "received", "host.claimed", claimedBefore);
  return identity;
}

function readSyntheticState(page) {
  return page.evaluate(() => {
    const state = window.__t14SyntheticMedia;
    if (!state) return null;
    return {
      audioRequests: state.audioRequests,
      screenRequests: state.screenRequests,
      sources: state.sources.map((source) => ({
        kind: source.kind,
        readyState: source.track.readyState,
      })),
    };
  });
}

async function startSyntheticPublishers(host) {
  const connection = currentConnection(host);
  const audioBefore = controlCount(host, connection.index, "received", "audio.started");
  const screenBefore = controlCount(host, connection.index, "received", "screen.started");
  await host.page.getByRole("button", { name: "開始麥克風", exact: true }).click();
  await waitControl(host, connection.index, "received", "audio.started", audioBefore);
  await host.page.getByRole("button", { name: "開始分享畫面", exact: true }).click();
  await waitControl(host, connection.index, "received", "screen.started", screenBefore);
  const synthetic = await readSyntheticState(host.page);
  assert.equal(synthetic.audioRequests, 1, "The host audio source must come from its normal start button.");
  assert.equal(synthetic.screenRequests, 1, "The host canvas source must come from its normal share button.");
  assert.equal(synthetic.sources.length, 2);
  stage("host-started-synthetic-opus-and-vp8-before-receiver-subscriptions", { audioSources: 1, screenSources: 1 });
}

function mediaSnapshot(page) {
  return page.evaluate(() => {
    const audio = document.querySelector('[data-testid="audio-panel"]');
    const screen = document.querySelector('[data-testid="screen-panel"]');
    const attrNumber = (element, name) => {
      const raw = element?.getAttribute(name);
      if (raw === null || raw === undefined || raw === "") return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    };
    const canvas = screen?.querySelector('[data-testid="screen-preview"]');
    return {
      audio: audio ? {
        listenerState: audio.getAttribute("data-listener-state"),
        receivedPackets: attrNumber(audio, "data-received-packets"),
        decodedFrames: attrNumber(audio, "data-decoded-frames"),
        renderedSamples: attrNumber(audio, "data-rendered-samples"),
        renderRms: attrNumber(audio, "data-render-rms"),
        receiverGeneration: audio.getAttribute("data-receiver-generation"),
        playbackClockId: audio.getAttribute("data-audio-playback-clock-id"),
        graphOldestResidenceMs: attrNumber(audio, "data-queue-oldest-graph-residence-ms"),
        staleDropBatches: attrNumber(audio, "data-queue-stale-drop-batches"),
        oversizeDropBatches: attrNumber(audio, "data-queue-oversize-drop-batches"),
        recovery: document.querySelector('[data-testid="audio-recovery-status"]')?.getAttribute("data-subscribed"),
      } : null,
      screen: screen ? {
        receiverState: screen.getAttribute("data-receiver-state"),
        receivedFrames: attrNumber(screen, "data-received-frames"),
        decodedFrames: attrNumber(screen, "data-decoded-frames"),
        renderedFrames: attrNumber(screen, "data-rendered-frames"),
        renderedWidth: attrNumber(screen, "data-rendered-width") ?? canvas?.width ?? 0,
        renderedHeight: attrNumber(screen, "data-rendered-height") ?? canvas?.height ?? 0,
        syncClockId: screen.getAttribute("data-sync-clock-id"),
        queuedDecodedFrames: attrNumber(screen, "data-queued-decoded-frame-count"),
        oldestDecodedResidenceMs: attrNumber(screen, "data-queued-decoded-frame-oldest-residence-ms"),
        decodedResidenceDrops: attrNumber(screen, "data-queued-decoded-frame-residence-drops"),
        recovery: document.querySelector('[data-testid="screen-recovery-status"]')?.getAttribute("data-subscribed"),
      } : null,
    };
  });
}

function compactMediaSnapshot(clientName, snapshot, atMs = elapsedMs()) {
  return {
    client: clientName,
    atMs,
    audio: snapshot.audio ? {
      listenerState: snapshot.audio.listenerState,
      receivedPackets: snapshot.audio.receivedPackets,
      decodedFrames: snapshot.audio.decodedFrames,
      renderedSamples: snapshot.audio.renderedSamples,
      renderRms: snapshot.audio.renderRms,
      receiverGeneration: snapshot.audio.receiverGeneration,
      playbackClockId: snapshot.audio.playbackClockId,
      graphOldestResidenceMs: snapshot.audio.graphOldestResidenceMs,
      staleDropBatches: snapshot.audio.staleDropBatches,
      oversizeDropBatches: snapshot.audio.oversizeDropBatches,
      subscribed: snapshot.audio.recovery,
    } : null,
    screen: snapshot.screen ? {
      receiverState: snapshot.screen.receiverState,
      receivedFrames: snapshot.screen.receivedFrames,
      decodedFrames: snapshot.screen.decodedFrames,
      renderedFrames: snapshot.screen.renderedFrames,
      renderedWidth: snapshot.screen.renderedWidth,
      renderedHeight: snapshot.screen.renderedHeight,
      syncClockId: snapshot.screen.syncClockId,
      queuedDecodedFrames: snapshot.screen.queuedDecodedFrames,
      oldestDecodedResidenceMs: snapshot.screen.oldestDecodedResidenceMs,
      decodedResidenceDrops: snapshot.screen.decodedResidenceDrops,
      subscribed: snapshot.screen.recovery,
    } : null,
  };
}

async function waitActualAudio(page, baselineSamples, phase, clientName, timeoutMs = recoveryTimeoutMs) {
  let snapshot = await mediaSnapshot(page);
  const isAdvanced = (state) =>
    state.audio && (state.audio.renderedSamples ?? 0) > baselineSamples && (state.audio.renderRms ?? 0) > 0.0001;
  const button = page.getByTestId("audio-continue-listening");
  const gesture = { client: clientName, phase, stateBefore: snapshot.audio?.listenerState ?? "unknown", clickedOrdinaryContinue: false, requestedAtMs: null };

  const gestureDeadline = Date.now() + 1_200;
  while (!isAdvanced(snapshot) && Date.now() < gestureDeadline) {
    if (snapshot.audio?.listenerState === "suspended" && await button.isVisible().catch(() => false)) {
      gesture.requestedAtMs = elapsedMs();
      try {
        await button.click({ timeout: 900 });
        gesture.clickedOrdinaryContinue = true;
      } catch (error) {
        const readback = await mediaSnapshot(page);
        if (!isAdvanced(readback) && readback.audio?.listenerState === "suspended" &&
            await button.isVisible().catch(() => false)) throw error;
      }
      break;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    snapshot = await mediaSnapshot(page);
  }

  if (gesture.clickedOrdinaryContinue || gesture.requestedAtMs !== null) {
    report.gestures.push({
      ...gesture,
      result: gesture.clickedOrdinaryContinue ? "ordinary-continue-clicked" : "continue-offer-raced-with-audio-state-change",
    });
  }

  await page.waitForFunction((previous) => {
    const panel = document.querySelector('[data-testid="audio-panel"]');
    return panel &&
      Number(panel.getAttribute("data-rendered-samples")) > previous &&
      Number(panel.getAttribute("data-render-rms")) > 0.0001;
  }, baselineSamples, { timeout: timeoutMs });
  snapshot = await mediaSnapshot(page);
  assert.ok((snapshot.audio?.receivedPackets ?? 0) > 0 && (snapshot.audio?.decodedFrames ?? 0) > 0,
    phase + " must have actual received and decoded Opus packets.");
  assert.ok((snapshot.audio?.renderedSamples ?? 0) > baselineSamples,
    phase + " must advance actual AudioWorklet rendered samples.");
  return snapshot;
}

async function waitActualScreen(page, baselineFrames, phase, timeoutMs = recoveryTimeoutMs) {
  await page.waitForFunction((previous) => {
    const panel = document.querySelector('[data-testid="screen-panel"]');
    const canvas = panel?.querySelector('[data-testid="screen-preview"]');
    return panel && canvas &&
      Number(panel.getAttribute("data-rendered-frames")) > previous &&
      canvas.width > 0 && canvas.height > 0;
  }, baselineFrames, { timeout: timeoutMs });
  const snapshot = await mediaSnapshot(page);
  assert.ok((snapshot.screen?.receivedFrames ?? 0) > 0 && (snapshot.screen?.decodedFrames ?? 0) > 0,
    phase + " must have actual received and decoded VP8 frames.");
  assert.ok((snapshot.screen?.renderedFrames ?? 0) > baselineFrames,
    phase + " must advance actual rendered VP8 frames.");
  assert.ok((snapshot.screen?.renderedWidth ?? 0) > 0 && (snapshot.screen?.renderedHeight ?? 0) > 0,
    phase + " must expose non-empty rendered dimensions.");
  return snapshot;
}

async function startParticipantReceiving(client) {
  const connection = currentConnection(client);
  const audioSubscribeBefore = controlCount(client, connection.index, "sent", "audio.subscribe");
  const audioAckBefore = controlCount(client, connection.index, "received", "audio.subscribed");
  await client.page.getByTestId("audio-start-listening").click();
  await waitControl(client, connection.index, "sent", "audio.subscribe", audioSubscribeBefore);
  await waitControl(client, connection.index, "received", "audio.subscribed", audioAckBefore);

  const screenSubscribeBefore = controlCount(client, connection.index, "sent", "screen.subscribe");
  const screenAckBefore = controlCount(client, connection.index, "received", "screen.subscribed");
  const screenStreamBefore = controlCount(client, connection.index, "received", "screen.stream");
  await client.page.getByTestId("screen-start-watching").click();
  await waitControl(client, connection.index, "sent", "screen.subscribe", screenSubscribeBefore);
  await waitControl(client, connection.index, "received", "screen.subscribed", screenAckBefore);
  const stream = await waitControl(client, connection.index, "received", "screen.stream", screenStreamBefore);
  assert.equal(stream.config.codec, "vp8", client.name + " should receive the live VP8 configuration.");
  return connection;
}

async function inspectParticipation(client, connection, label) {
  const before = controlCount(client, connection.index, "received", "participation.self");
  await client.page.getByTestId("participation-inspect").click();
  const result = await waitControl(client, connection.index, "received", "participation.self", before);
  assert.ok(result.transport, label + " should expose only this connection's transport observation.");
  const record = {
    client: client.name,
    label,
    atMs: result.atMs,
    transport: result.transport,
    media: result.media,
    role: result.role,
    mode: result.mode,
  };
  report.inspections.push(record);
  return result;
}

async function interactionAckDuringHold(healthy, driver) {
  const connection = currentConnection(healthy);
  const before = controlCount(healthy, connection.index, "received", "interaction.ack");
  await healthy.page.getByTestId("feedback-like").click();
  const ack = await waitControl(healthy, connection.index, "received", "interaction.ack", before, 2_000);
  report.interaction = {
    client: "healthy",
    type: "interaction.ack",
    acknowledged: ack.acknowledged === true,
    duplicate: ack.duplicate === true,
    atMs: ack.atMs,
    duringSlowRouteHold: ack.atMs >= driver.startedAtMs && (driver.closedAtMs === null || ack.atMs < driver.closedAtMs),
  };
  assert.equal(report.interaction.acknowledged, true, "Healthy feedback must receive a real server acknowledgement.");
  assert.equal(report.interaction.duringSlowRouteHold, true, "Healthy feedback ACK must arrive before the slow route closes.");
}

async function sampleHealthyDuringHold(healthy, driver) {
  const points = [];
  const baseline = await mediaSnapshot(healthy.page);
  const before = compactMediaSnapshot("healthy", baseline);
  report.mediaSamples.healthyDuringHold.push(before);

  let feedbackSent = false;
  while (driver.active) {
    if (Date.now() - driver.startedAtEpochMs > 3_000) {
      throw new Error("Slow route received no bounded downlink before the driver deadline.");
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, sampleIntervalMs));
    const atMs = elapsedMs();
    const snapshot = await mediaSnapshot(healthy.page);
    if (driver.closedAtMs === null || atMs < driver.closedAtMs) {
      const point = compactMediaSnapshot("healthy", snapshot, atMs);
      points.push(point);
      report.mediaSamples.healthyDuringHold.push(point);
    }

    if (!feedbackSent && points.length >= 1 && driver.active) {
      feedbackSent = true;
      await interactionAckDuringHold(healthy, driver);
    }
  }

  assert.equal(driver.closeReason, "oldest_queued_message_age_limit",
    "The bounded downlink hold should close on its 500 ms oldest-message cap.");
  assert.ok((driver.closedAtMs ?? 0) - driver.startedAtMs >= DRIVER_AGE_LIMIT_MS,
    "The route hold must continue past the oldest-message age limit before closing.");
  assert.ok(points.length >= 3, "Healthy receiver requires at least three observations while the slow route is held.");
  assert.ok(feedbackSent, "Healthy feedback ACK must occur during the slow route hold.");
  const series = [before, ...points];
  let sampleAdvances = 0;
  let frameAdvances = 0;
  for (let index = 1; index < series.length; index += 1) {
    const previous = series[index - 1];
    const current = series[index];
    assert.ok(current.audio.renderedSamples >= previous.audio.renderedSamples,
      "Healthy AudioWorklet samples must not regress during the hold.");
    assert.ok(current.screen.renderedFrames >= previous.screen.renderedFrames,
      "Healthy VP8 frames must not regress during the hold.");
    if (current.audio.renderedSamples > previous.audio.renderedSamples) sampleAdvances += 1;
    if (current.screen.renderedFrames > previous.screen.renderedFrames) frameAdvances += 1;
  }
  assert.ok(sampleAdvances >= 2, "Healthy AudioWorklet samples must advance at multiple hold observations.");
  assert.ok(frameAdvances >= 2, "Healthy VP8 frames must advance at multiple hold observations.");
  return points;
}

async function recoverSlowReceiver(slow, host, oldConnectionIndex) {
  const hostConnection = currentConnection(host);
  const publisherAudio = latestControl(host, hostConnection.index, "received", "audio.started");
  const publisherScreen = latestControl(host, hostConnection.index, "received", "screen.started");
  const connection = await waitFor(
    () => slow.wire.connections.find((item) => item.index > oldConnectionIndex && item.serverRoute),
    "slow receiver's new pass-through WebSocket",
    recoveryTimeoutMs,
  );
  await waitControl(slow, connection.index, "received", "session.resumed", 0, recoveryTimeoutMs);
  const room = await waitControl(slow, connection.index, "received", "room.snapshot", 0, recoveryTimeoutMs);
  const self = await waitControl(slow, connection.index, "received", "participation.self", 0, recoveryTimeoutMs);
  assert.equal(room.roomId, "studio");
  assert.equal(self.role, "participant");
  assert.equal(self.mode, "watch");

  const resumed = latestControl(slow, connection.index, "received", "session.resumed");
  const authoritySequence = Math.max(resumed?.sequence ?? 0, room.sequence, self.sequence);
  const audioSubscribe = await waitControl(slow, connection.index, "sent", "audio.subscribe", 0, recoveryTimeoutMs);
  const screenSubscribe = await waitControl(slow, connection.index, "sent", "screen.subscribe", 0, recoveryTimeoutMs);
  assert.ok(audioSubscribe.sequence > authoritySequence && screenSubscribe.sequence > authoritySequence,
    "Fresh authority snapshots must precede automatic media resubscribe on the new connection.");
  const audioStream = await waitControl(slow, connection.index, "received", "audio.stream", 0, recoveryTimeoutMs);
  const screenStream = await waitControl(slow, connection.index, "received", "screen.stream", 0, recoveryTimeoutMs);
  await waitControl(slow, connection.index, "received", "audio.subscribed", 0, recoveryTimeoutMs);
  await waitControl(slow, connection.index, "received", "screen.subscribed", 0, recoveryTimeoutMs);
  assert.equal(audioStream.config.codec, "opus");
  assert.equal(screenStream.config.codec, "vp8");
  assert.equal(audioStream.generation, publisherAudio?.generation ?? audioStream.generation);
  assert.equal(screenStream.generation, publisherScreen?.generation ?? screenStream.generation);
  assert.equal(audioStream.clockId, publisherAudio?.clockId ?? audioStream.clockId);
  assert.equal(screenStream.clockId, audioStream.clockId);
  assert.ok(connection.index > oldConnectionIndex, "Slow receiver must recover on a fresh WebSocket connection.");

  const baseline = await mediaSnapshot(slow.page);
  const audioAfter = await waitActualAudio(
    slow.page,
    baseline.audio?.renderedSamples ?? 0,
    "slow-new-connection-audio-recovery",
    "slow",
  );
  const screenAfter = await waitActualScreen(
    slow.page,
    baseline.screen?.renderedFrames ?? 0,
    "slow-new-connection-vp8-recovery",
  );
  const recovered = compactMediaSnapshot("slow", {
    ...screenAfter,
    audio: audioAfter.audio,
  });
  const domAudioGeneration = numberOrNull(recovered.audio?.receiverGeneration);
  if (domAudioGeneration !== null) assert.equal(domAudioGeneration, audioStream.generation);
  assert.equal(recovered.audio?.playbackClockId, audioStream.clockId);
  assert.equal(recovered.screen?.syncClockId, screenStream.clockId);
  report.mediaSamples.slowRecovered = recovered;
  report.recoveries.push({
    client: "slow",
    oldConnectionIndex,
    newConnectionIndex: connection.index,
    closeCode: DRIVER_CLOSE_CODE,
    freshAuthority: { sessionResumed: true, roomId: room.roomId, role: self.role, mode: self.mode },
    audioSubscribeAfterFreshAuthority: true,
    screenSubscribeAfterFreshAuthority: true,
    audioStream,
    screenStream,
    audioRenderedSamplesBeforeRecoveryRender: baseline.audio?.renderedSamples ?? null,
    audioRenderedSamplesAfter: audioAfter.audio.renderedSamples,
    screenRenderedFramesBeforeRecoveryRender: baseline.screen?.renderedFrames ?? null,
    screenRenderedFramesAfter: screenAfter.screen.renderedFrames,
    newDecoderRenderedFrames: screenAfter.screen.renderedFrames,
  });
  stage("slow-receiver-reconnected-with-fresh-config-keyframe-and-real-playback", {
    oldConnectionIndex,
    newConnectionIndex: connection.index,
    audioGeneration: audioStream.generation,
    screenGeneration: screenStream.generation,
    clockId: audioStream.clockId,
    audioRenderedSamples: audioAfter.audio.renderedSamples,
    screenRenderedFrames: screenAfter.screen.renderedFrames,
    decodedResidenceDrops: screenAfter.screen.decodedResidenceDrops,
  });
  return { connection, audioAfter, screenAfter };
}

async function sampleHealthyAfterRecovery(healthy, previous) {
  const points = [];
  points.push(previous);
  for (let index = 0; index < 3; index += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 160));
    const snapshot = compactMediaSnapshot("healthy", await mediaSnapshot(healthy.page));
    points.push(snapshot);
    report.mediaSamples.healthyAfterRecovery.push(snapshot);
  }
  for (let index = 1; index < points.length; index += 1) {
    assert.ok(points[index].audio.renderedSamples > points[index - 1].audio.renderedSamples,
      "Healthy AudioWorklet samples must continue increasing after slow recovery.");
    assert.ok(points[index].screen.renderedFrames > points[index - 1].screen.renderedFrames,
      "Healthy VP8 frames must continue increasing after slow recovery.");
  }
}

async function captureScreenshot(client, fileName) {
  if (!client?.page || client.page.isClosed()) return false;
  try {
    const path = join(outputDirectory, fileName);
    await client.page.screenshot({ path, fullPage: true, animations: "disabled", timeout: 5_000 });
    chmodSync(path, 0o600);
    if (report.screenshots.length < 8) report.screenshots.push(fileName);
    return true;
  } catch (error) {
    boundedPush(report.errors.cleanupErrors, { client: client.name, code: "screenshot_failed", message: redact(error?.message ?? "screenshot failed") }, "cleanup-errors");
    return false;
  }
}

async function captureFailureScreenshots() {
  for (const clientName of ["healthy", "slow", "host"]) {
    const client = clients.get(clientName);
    if (client) await captureScreenshot(client, clientName + "-failure.png");
  }
}

function allConnectionsReadback() {
  return [...clients.values()].flatMap((client) => client.wire.connections.map((connection) => ({
    client: client.name,
    index: connection.index,
    openedAtMs: connection.openedAtMs,
    connectedAtMs: connection.connectedAtMs,
    closedAtMs: connection.closedAtMs ?? null,
    closeCode: connection.closeCode ?? null,
    closeReason: connection.closeReason ?? null,
    bytes: connection.bytes,
    controls: connection.controls,
  })));
}

async function closeResources() {
  const driver = clients.get("slow")?.wire.driver;
  if (driver?.ageTimer) clearTimeout(driver.ageTimer);
  if (driver?.queue) {
    driver.queue.length = 0;
    driver.queueBytes = 0;
  }
  for (const context of contexts.splice(0)) {
    try { await context.close(); }
    catch (error) {
      boundedPush(report.errors.cleanupErrors, { code: "firefox_close_failed", message: redact(error?.message ?? "Firefox close failed") }, "cleanup-errors");
    }
  }
  for (const folder of profileFolders) {
    try { rmSync(folder, { recursive: true, force: true }); }
    catch (error) {
      boundedPush(report.errors.cleanupErrors, { code: "profile_cleanup_failed", message: redact(error?.message ?? "Firefox profile cleanup failed") }, "cleanup-errors");
    }
  }
  profileFolders.clear();
}

function writeReport() {
  report.finishedAt = new Date().toISOString();
  report.durationMs = elapsedMs();
  report.status = failure ? "failed" : "passed";
  report.socketConnections = allConnectionsReadback();
  report.errors.failure = failure ? redact(failure?.message ?? failure) : null;
  if (report.errors.collectionErrors.length > 0 || report.privacy.configuredSecretEchoObserved) report.status = "failed";

  let serialized = JSON.stringify(report, null, 2) + "\n";
  let leaked = false;
  for (const secret of secretValues) {
    if (secret && serialized.includes(secret)) leaked = true;
  }
  if (leaked) {
    report.status = "failed";
    report.privacy.secretsInRetainedTrace = true;
    report.errors.failure = "A configured credential or resume token was detected in the report before write.";
    serialized = JSON.stringify(report, null, 2) + "\n";
  }
  for (const secret of secretValues) {
    if (secret) serialized = serialized.split(secret).join("[redacted]");
  }
  writeFileSync(join(outputDirectory, "slow-receiver-report.json"), serialized, { encoding: "utf8", mode: 0o600 });
}

async function main() {
  assert.equal(process.versions.node, "26.13.0", "Run the T14 smoke with pinned Node 26.13.0.");
  assert.ok(Buffer.byteLength(hostToken, "utf8") >= 32 && Buffer.byteLength(hostToken, "utf8") <= 256,
    "SLOW_RECEIVER_TEST_HOST_TOKEN must be a 32–256 byte host token.");
  assert.ok(roomPassword && roomPassword !== hostToken,
    "SLOW_RECEIVER_TEST_ROOM_PASSWORD must be set and differ from the host token.");

  const caPem = readFileSync(caCertificate);
  await readRoomCatalogue(caPem);

  const host = await launchClient("host", true, caCertificate);
  const healthy = await launchClient("healthy", false, caCertificate);
  const slow = await launchClient("slow", false, caCertificate);
  report.runtime.firefox = await healthy.page.evaluate(() => navigator.userAgent);

  await enterHost(host);
  await startSyntheticPublishers(host);

  const healthyIdentity = await enterParticipant(healthy, "T14 healthy receiver");
  const slowIdentity = await enterParticipant(slow, "T14 slow receiver");
  assert.equal(healthyIdentity.roomId, "studio");
  assert.equal(slowIdentity.roomId, "studio");
  assert.equal(healthyIdentity.role, "participant");
  assert.equal(slowIdentity.role, "participant");
  stage("host-and-two-real-firefox-receivers-joined-through-normal-room-controls", {
    roomId: "studio",
    hostRole: "participant",
    receivers: 2,
  });

  const hostConnection = currentConnection(host);
  const publisherAudio = latestControl(host, hostConnection.index, "received", "audio.started");
  const publisherScreen = latestControl(host, hostConnection.index, "received", "screen.started");
  assert.ok(publisherAudio && publisherScreen, "Synthetic publisher must start before any receiver subscription.");

  const healthyConnection = await startParticipantReceiving(healthy);
  const healthyAudioStream = await waitControl(healthy, healthyConnection.index, "received", "audio.stream");
  const healthyScreenStream = latestControl(healthy, healthyConnection.index, "received", "screen.stream");
  assert.equal(healthyAudioStream.config.codec, "opus");
  assert.equal(healthyScreenStream?.config.codec, "vp8");
  await inspectParticipation(healthy, healthyConnection, "healthy-initial");
  await inspectParticipation(slow, currentConnection(slow), "slow-initial");

  const slowConnection = await startParticipantReceiving(slow);
  const slowAudioStream = await waitControl(slow, slowConnection.index, "received", "audio.stream");
  const slowScreenStream = latestControl(slow, slowConnection.index, "received", "screen.stream");
  assert.equal(slowAudioStream.config.codec, "opus");
  assert.equal(slowScreenStream?.config.codec, "vp8");

  const healthyBeforeAudio = await mediaSnapshot(healthy.page);
  const healthyInitialAudio = await waitActualAudio(
    healthy.page, healthyBeforeAudio.audio?.renderedSamples ?? 0, "healthy-initial-opus-playback", "healthy");
  const healthyBeforeScreen = await mediaSnapshot(healthy.page);
  const healthyInitialScreen = await waitActualScreen(
    healthy.page, healthyBeforeScreen.screen?.renderedFrames ?? 0, "healthy-initial-vp8-playback");
  const slowBeforeAudio = await mediaSnapshot(slow.page);
  const slowInitialAudio = await waitActualAudio(
    slow.page, slowBeforeAudio.audio?.renderedSamples ?? 0, "slow-initial-opus-playback", "slow");
  const slowBeforeScreen = await mediaSnapshot(slow.page);
  const slowInitialScreen = await waitActualScreen(
    slow.page, slowBeforeScreen.screen?.renderedFrames ?? 0, "slow-initial-vp8-playback");
  report.mediaSamples.slowInitial = compactMediaSnapshot("slow", {
    ...slowInitialScreen,
    audio: slowInitialAudio.audio,
  });
  report.mediaSamples.healthyInitial = compactMediaSnapshot("healthy", {
    ...healthyInitialScreen,
    audio: healthyInitialAudio.audio,
  });

  assert.equal(healthyAudioStream.clockId, slowAudioStream.clockId);
  assert.equal(healthyScreenStream?.clockId, slowScreenStream?.clockId);
  assert.ok((report.mediaSamples.healthyInitial.audio?.renderedSamples ?? 0) > 0);
  assert.ok((report.mediaSamples.healthyInitial.screen?.renderedFrames ?? 0) > 0);
  assert.ok((report.mediaSamples.slowInitial.audio?.renderedSamples ?? 0) > 0);
  assert.ok((report.mediaSamples.slowInitial.screen?.renderedFrames ?? 0) > 0);
  stage("both-real-receivers-start-with-positive-opus-and-vp8-render", {
    healthySamples: report.mediaSamples.healthyInitial.audio.renderedSamples,
    healthyFrames: report.mediaSamples.healthyInitial.screen.renderedFrames,
    slowSamples: report.mediaSamples.slowInitial.audio.renderedSamples,
    slowFrames: report.mediaSamples.slowInitial.screen.renderedFrames,
    sharedClockId: healthyAudioStream.clockId,
  });

  const slowActiveConnection = currentConnection(slow);
  const slowOldConnectionIndex = slowActiveConnection.index;
  const driver = await enableSlowDownlink(slow);
  stage("bounded-slow-only-downlink-hold-started", {
    client: "slow",
    connectionIndex: slowOldConnectionIndex,
    transportLayer: "Playwright WebSocketRoute server-to-browser application layer",
    queueLimitBytes: MAX_DRIVER_BYTES,
    queueLimitMessages: MAX_DRIVER_MESSAGES,
    oldestAgeLimitMs: DRIVER_AGE_LIMIT_MS,
  });

  const holdSamples = await sampleHealthyDuringHold(healthy, driver);
  report.driver = driverSummary(driver);
  assert.equal(report.disturbance.routeHoldCount, 1);
  assert.ok(report.driver.queueHighWaterBytes > 0 && report.driver.queueHighWaterBytes <= MAX_DRIVER_BYTES);
  assert.ok(report.driver.queueHighWaterMessages > 0 && report.driver.queueHighWaterMessages <= MAX_DRIVER_MESSAGES);
  assert.ok(report.driver.queueAgeHighWaterMs >= DRIVER_AGE_LIMIT_MS);
  assert.equal(report.driver.closeCode, DRIVER_CLOSE_CODE);
  assert.equal(report.driver.closeReason, "oldest_queued_message_age_limit");
  assert.ok(report.driver.queuedMessagesAtClose > 0 && report.driver.queuedBytesAtClose > 0);
  assert.equal(report.driver.replayedMessages, 0);
  assert.equal(report.driver.heldPayloadsRetainedAfterClose, 0);
  stage("driver-hit-500ms-age-cap-closed-only-slow-route-and-discarded-held-buffer", {
    closeCode: report.driver.closeCode,
    closeReason: report.driver.closeReason,
    heldBytes: report.driver.queuedBytesAtClose,
    heldMessages: report.driver.queuedMessagesAtClose,
    queueHighWaterBytes: report.driver.queueHighWaterBytes,
    ageHighWaterMs: report.driver.queueAgeHighWaterMs,
  });

  assert.ok(holdSamples.length >= 3);

  const slowRecovered = await recoverSlowReceiver(slow, host, slowOldConnectionIndex);
  const healthyAfterReconnect = compactMediaSnapshot("healthy", await mediaSnapshot(healthy.page));
  await sampleHealthyAfterRecovery(healthy, healthyAfterReconnect);
  await inspectParticipation(slow, slowRecovered.connection, "slow-recovered");
  await inspectParticipation(healthy, currentConnection(healthy), "healthy-after-recovery");
  await captureScreenshot(healthy, "healthy-after-slow-recovery.png");
  await captureScreenshot(slow, "slow-after-recovery.png");

  const slowInitial = report.mediaSamples.slowInitial;
  const slowAfter = report.mediaSamples.slowRecovered;
  assert.ok(slowAfter.audio.renderedSamples > 0 && slowAfter.audio.decodedFrames > 0);
  assert.ok(slowAfter.screen.renderedFrames > 0 && slowAfter.screen.decodedFrames > 0);
  assert.ok(slowAfter.screen.syncClockId);
  assert.equal(report.errors.pageErrors.length, 0, "Firefox pages must not report uncaught page errors.");
  assert.equal(report.errors.socketErrors.length, 0, "Firefox WebSockets must not report socket errors.");
  assert.equal(report.errors.collectionErrors.length, 0, "No bounded evidence collector may overflow.");
  assert.equal(report.privacy.configuredSecretEchoObserved, false, "No server control response may echo a configured secret or resume token.");
  assert.equal([...clients.values()].some((client) => client.collectionOverflow), false);
  stage("bounded-secret-safe-report-and-final-assertions", {
    connectionCount: [...clients.values()].reduce((sum, client) => sum + client.wire.connections.length, 0),
    healthyDuringHoldSamples: report.mediaSamples.healthyDuringHold.length,
    healthyAfterRecoverySamples: report.mediaSamples.healthyAfterRecovery.length,
    slowInitialSamples: slowInitial.audio.renderedSamples,
    slowRecoveredSamples: slowAfter.audio.renderedSamples,
    slowInitialFrames: slowInitial.screen.renderedFrames,
    slowRecoveredFrames: slowAfter.screen.renderedFrames,
    resumeTokensRetained: false,
    rawMediaRetained: false,
  });
}

try {
  await main();
} catch (error) {
  failure = error;
  report.errors.failure = redact(error?.message ?? error);
  console.error("[T14] failed " + redact(error?.message ?? "smoke failed"));
  await captureFailureScreenshots();
} finally {
  await closeResources();
  if (!failure && report.errors.cleanupErrors.length > 0) failure = new Error("Firefox or isolated profile cleanup did not complete cleanly.");
  if (!failure && report.errors.collectionErrors.length > 0) failure = new Error("A bounded evidence collector reached its cap.");
  if (!failure && report.privacy.configuredSecretEchoObserved) failure = new Error("A server control response echoed a configured secret or resume token.");
  try {
    writeReport();
  } catch (error) {
    console.error("[T14] report write failed " + redact(error?.message ?? "write failed"));
    if (!failure) failure = error;
  }
}

if (failure) process.exitCode = 1;
else console.log("[T14] report " + join(outputDirectory, "slow-receiver-report.json"));
