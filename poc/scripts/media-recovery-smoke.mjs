import { enterRepositoryRootForLegacyScript, repositoryRoot, pocRoot } from "./lib/project-paths.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { get as httpsGet } from "node:https";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

enterRepositoryRootForLegacyScript();

const require = createRequire(import.meta.url);
const root = repositoryRoot;
const hostToken = process.env.MEDIA_RECOVERY_TEST_HOST_TOKEN ?? "";
const roomPassword = process.env.MEDIA_RECOVERY_TEST_ROOM_PASSWORD ?? "";
if (Buffer.byteLength(hostToken, "utf8") < 32 || Buffer.byteLength(hostToken, "utf8") > 256) {
  throw new Error("MEDIA_RECOVERY_TEST_HOST_TOKEN must be a 32–256 byte host token.");
}
if (!roomPassword || roomPassword === hostToken) {
  throw new Error("MEDIA_RECOVERY_TEST_ROOM_PASSWORD must be set and differ from the host token.");
}

const scratchRoot = resolve(root, ".scratch/t13");
const outputDirectory = resolve(root, process.env.MEDIA_RECOVERY_OUTPUT_DIR ?? ".scratch/t13/acceptance");
const outputRelative = relative(scratchRoot, outputDirectory);
if (isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(`..${sep}`)) {
  throw new Error("MEDIA_RECOVERY_OUTPUT_DIR must stay inside .scratch/t13.");
}

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, ".tools/playwright-browsers");
const { firefox } = await import("playwright");
const caCertificate = resolve(process.env.MEDIA_RECOVERY_CA_CERT ?? ".scratch/t01/tls/local-ca.pem");
const caPem = readFileSync(caCertificate);
const baseURL = process.env.MEDIA_RECOVERY_BASE_URL ?? "https://localhost:4173";
const target = new URL(baseURL);
if (target.protocol !== "https:" || target.username || target.password || target.search || target.hash || target.pathname !== "/") {
  throw new Error("MEDIA_RECOVERY_BASE_URL must be a trusted HTTPS application root without credentials, query, or fragment.");
}

const certificateUtility = process.env.CERTUTIL_BIN ?? "certutil";
const headless = process.env.HEADLESS !== "0";
const normalTimeoutMs = 10_000;
const reconnectTimeoutMs = 15_000;
const MAX_STAGES = 36;
const MAX_ERRORS = 24;
const MAX_CONNECTIONS_PER_CLIENT = 8;
const MAX_CONTROLS_PER_CONNECTION = 100;
const MAX_HELD_MESSAGES = 24;
const MAX_HELD_BYTES = 256 * 1024;
const contexts = [];
const profileFolders = new Set();
const clients = new Map();
const secretValues = new Set([hostToken, roomPassword]);
const startedAtMs = Date.now();
let failure = null;

const report = {
  schemaVersion: 1,
  purpose: "Short T13 synthetic Firefox media-recovery core smoke; controlled application WebSocket closes, not network-quality evidence.",
  startedAt: new Date().toISOString(),
  status: "running",
  baseURL: target.origin,
  runtime: { node: process.version, platform: process.platform, architecture: process.arch, firefox: "not-reported" },
  tls: {
    caCertificate,
    trust: "local CA imported only into isolated Firefox NSS profiles and supplied to the HTTPS catalogue request",
    ignoreCertificateErrors: false,
    systemTrustChanged: false,
  },
  topology: {
    browsers: ["host", "participant", "display"],
    isolatedFirefoxProfiles: 3,
    syntheticSources: "host page only: test oscillator/AudioContext stream and animated canvas stream; no physical microphone or display capture",
    controlledDisconnect: "test-only Playwright WebSocket route close code 4000; reconnect route held then released",
  },
  credentials: { hostToken: "not-recorded", roomPassword: "not-recorded", resumeToken: "not-recorded; presence booleans only" },
  checks: [],
  recoveries: [],
  connections: [],
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
    physicalNetworkInterruption: "not-tested; only a controlled application WebSocket close was used",
    physicalMicrophoneAndHumanListening: "not-tested; host audio source is a synthetic oscillator",
    physicalDisplayCapture: "not-tested; host video source is an animated canvas stream",
    autoplayPolicy: "no autoplay preferences are changed; a visible ordinary continue button is clicked only when the browser remains suspended",
    phones: "not-tested",
    repeatedReliabilityAndP95: "not-tested; only a few controlled recovery cycles, no 20-run or p95 claim",
    weakNetworkAndEndurance: "not-tested",
    cloudDeployment: "not-tested; local POC only",
  },
  errors: { pageErrors: [], socketErrors: [], collectionErrors: [], cleanupErrors: [], failure: null },
};

mkdirSync(outputDirectory, { recursive: true });

function elapsedMs() {
  return Date.now() - startedAtMs;
}

function redact(value) {
  let output = String(value ?? "");
  for (const secret of secretValues) if (secret) output = output.split(secret).join("[redacted]");
  return output.slice(0, 320);
}

function pushBounded(array, value, label, cap = MAX_ERRORS) {
  if (array.length >= cap) {
    if (!report.errors.collectionErrors.some((item) => item.collection === label && item.code === "cap_reached")) {
      if (report.errors.collectionErrors.length < MAX_ERRORS) report.errors.collectionErrors.push({ collection: label, code: "cap_reached", cap });
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
  console.log(`[T13] ${name}${Object.keys(details).length ? ` ${JSON.stringify(details)}` : ""}`);
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
  for (const key of ["roomId", "currentRoomId", "role", "mode", "code", "action"]) {
    if (typeof message?.[key] === "string" && message[key].length <= 100) item[key] = message[key];
  }
  if (type === "join") {
    item.displayNamePresent = typeof message.displayName === "string";
    item.passwordProvided = typeof message.password === "string";
    item.resumable = message.resumable === true;
  } else if (type === "session.issued") {
    item.tokenPresent = typeof message.token === "string" && message.token.length > 0;
    item.participantId = typeof message.participantId === "string" ? message.participantId : null;
    if (item.tokenPresent) secretValues.add(message.token);
  } else if (type === "session.resume") {
    item.tokenPresent = typeof message.token === "string" && message.token.length > 0;
    item.passwordProvided = typeof message.password === "string";
  } else if (type === "session.resumed") {
    item.participantId = typeof message.participantId === "string" ? message.participantId : null;
    item.role = message.role;
    item.mode = message.mode;
  } else if (type === "room.snapshot") {
    item.roomId = message.room?.id ?? message.roomId ?? null;
    item.hostControlsEnabled = Boolean(message.room?.hostControlsEnabled);
    item.publishAllowed = Boolean(message.room?.publishAllowed);
    item.locked = Boolean(message.room?.isLocked);
  } else if (type === "participation.self") {
    item.roomId = message.roomId ?? null;
    item.participantId = typeof message.participantId === "string" ? message.participantId : null;
    item.role = message.role;
    item.mode = message.mode;
    item.audioSubscribed = Boolean(message.media?.audio?.subscribed);
    item.screenSubscribed = Boolean(message.media?.screen?.subscribed);
  } else if (type === "audio.stream") {
    const config = message.config && typeof message.config === "object" ? message.config : {};
    item.generation = Number.isInteger(message.generation) ? message.generation : null;
    item.clockId = typeof message.clockId === "string" ? message.clockId.slice(0, 100) : null;
    item.config = {
      codec: typeof config.codec === "string" ? config.codec.slice(0, 40) : null,
      sampleRate: Number.isFinite(config.sampleRate) ? config.sampleRate : null,
      channels: Number.isFinite(config.channels) ? config.channels : null,
      bitrate: Number.isFinite(config.bitrate) ? config.bitrate : null,
      frameDurationUs: Number.isFinite(config.frameDurationUs) ? config.frameDurationUs : null,
    };
  } else if (type === "screen.stream") {
    item.generation = Number.isInteger(message.generation) ? message.generation : null;
    item.clockId = typeof message.clockId === "string" ? message.clockId.slice(0, 100) : null;
    item.config = {
      codec: typeof message.codec === "string" ? message.codec.slice(0, 40) : null,
      width: Number.isFinite(message.width) ? message.width : null,
      height: Number.isFinite(message.height) ? message.height : null,
      frameRate: Number.isFinite(message.frameRate) ? message.frameRate : null,
      bitrate: Number.isFinite(message.bitrate) ? message.bitrate : null,
    };
  } else if (/^(audio|screen)\.(started|stopped|streamEnded|keyframeRequest)$/u.test(type)) {
    if (Number.isInteger(message.generation)) item.generation = message.generation;
    if (typeof message.clockId === "string") item.clockId = message.clockId.slice(0, 100);
  } else if (type === "host.claimed" || type === "host.state") {
    item.hostClaimed = message.claimed === true || message.isHost === true;
    item.publisherGrantCount = Array.isArray(message.publisherGrants) ? message.publisherGrants.length : null;
  }
  return item;
}

function containsSecret(text) {
  for (const secret of secretValues) if (secret && text.includes(secret)) return true;
  return false;
}

function observePayload(client, connection, direction, payload) {
  if (typeof payload !== "string") {
    if (Buffer.isBuffer(payload) || payload instanceof Uint8Array || payload instanceof ArrayBuffer) connection.binaryFrames[direction] += 1;
    return;
  }
  const text = payload;
  let message;
  try { message = JSON.parse(text); }
  catch { return; }
  if (!message || typeof message !== "object" || Array.isArray(message)) return;
  if (direction === "received" && containsSecret(text)) report.privacy.configuredSecretEchoObserved = true;
  const summary = controlSummary(message, direction, connection);
  if (!pushBounded(connection.controls, summary, `${client.name}-connection-${connection.index}-controls`, MAX_CONTROLS_PER_CONNECTION)) {
    client.collectionOverflow = true;
  }
}

function connectRoutedSocket(client, route, connection, pendingMessages = []) {
  const serverRoute = route.connectToServer();
  connection.serverRoute = serverRoute;
  client.wire.activeConnection = connection;
  route.onMessage((payload) => {
    observePayload(client, connection, "sent", payload);
    serverRoute.send(payload);
  });
  serverRoute.onMessage((payload) => {
    observePayload(client, connection, "received", payload);
    route.send(payload);
  });
  for (const payload of pendingMessages) {
    observePayload(client, connection, "sent", payload);
    serverRoute.send(payload);
  }
  pendingMessages.length = 0;
  if (client.wire.heldRoute?.connection === connection) client.wire.heldRoute.pendingBytes = 0;
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
      binaryFrames: { sent: 0, received: 0 },
      serverRoute: null,
    };
    if (client.wire.connections.length >= MAX_CONNECTIONS_PER_CLIENT) {
      client.collectionOverflow = true;
      pushBounded(report.errors.collectionErrors, { client: client.name, code: "connection_cap_reached" }, "collection-errors");
      void route.close({ code: 1013, reason: "T13 smoke connection cap" }).catch(() => {});
      return;
    }
    client.wire.connections.push(connection);
    if (client.wire.blockNextConnection) {
      client.wire.blockNextConnection = false;
      if (client.wire.heldRoute) {
        client.collectionOverflow = true;
        pushBounded(report.errors.collectionErrors, { client: client.name, code: "multiple_held_routes" }, "collection-errors");
        return;
      }
      const held = { route, connection, pendingMessages: [], pendingBytes: 0 };
      client.wire.heldRoute = held;
      route.onMessage((payload) => {
        const bytes = typeof payload === "string" ? Buffer.byteLength(payload) : payload?.byteLength ?? 0;
        held.pendingBytes += bytes;
        if (held.pendingMessages.length >= MAX_HELD_MESSAGES || held.pendingBytes > MAX_HELD_BYTES) {
          client.collectionOverflow = true;
          pushBounded(report.errors.collectionErrors, { client: client.name, code: "held_route_buffer_cap_reached" }, "collection-errors");
          return;
        }
        held.pendingMessages.push(payload);
      });
      return;
    }
    connectRoutedSocket(client, route, connection);
  });
}

function runCertutil(args) {
  require("node:child_process").execFileSync(certificateUtility, args, { stdio: "pipe" });
}

function createTrustedProfile(name) {
  const folder = join(outputDirectory, `${name}-runtime`);
  profileFolders.add(folder);
  const profileDirectory = join(folder, "profile");
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(profileDirectory, { recursive: true });
  runCertutil(["-N", "-d", `sql:${profileDirectory}`, "--empty-password"]);
  runCertutil(["-A", "-d", `sql:${profileDirectory}`, "-n", "LaiTse local development CA", "-t", "C,,", "-i", caCertificate]);
  const appData = join(folder, "app-data");
  const localAppData = join(folder, "local-app-data");
  mkdirSync(appData, { recursive: true });
  mkdirSync(localAppData, { recursive: true });
  return { folder, profileDirectory, appData, localAppData };
}

function installSyntheticMedia(page) {
  return page.addInitScript(() => {
    const devices = navigator.mediaDevices;
    const state = { audioRequests: 0, screenRequests: 0, sources: [], audioContexts: [] };
    Object.defineProperty(window, "__t13SyntheticMedia", { value: state, configurable: false });

    const trackSource = (kind, sourceIndex, track, stopAnimation = null) => {
      const source = { kind, sourceIndex, track, stopCalls: 0 };
      const stop = track.stop.bind(track);
      track.stop = () => {
        if (track.readyState !== "ended") source.stopCalls += 1;
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
        const { width, height } = sourceIndex === 0 ? { width: 1280, height: 720 } : { width: 640, height: 360 };
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
          drawing.fillStyle = sourceIndex % 2 === 0 ? "#29c77a" : "#f6a43a";
          drawing.fillRect(36 + (frame * 7) % Math.max(1, width - 180), 48, 110, 96);
          drawing.fillStyle = "#fff";
          drawing.font = `${Math.max(22, Math.floor(height * 0.06))}px sans-serif`;
          drawing.fillText(`Synthetic VP8 source ${sourceIndex} · ${frame}`, 175, Math.floor(height * 0.18));
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

async function launchClient(name, syntheticPublisher = false) {
  const profile = createTrustedProfile(name);
  const browserEnv = { ...process.env, MOZ_APP_DATA: profile.appData, MOZ_LOCAL_APP_DATA: profile.localAppData };
  for (const key of [
    "MEDIA_RECOVERY_TEST_HOST_TOKEN", "MEDIA_RECOVERY_TEST_ROOM_PASSWORD", "HOST_CONTROL_TOKEN",
    "HOST_CONTROL_TEST_TOKEN", "HOST_CONTROL_TEST_PASSWORD", "MEETING_ROOM_PASSWORD",
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
    wire: { connections: [], activeConnection: null, heldRoute: null, blockNextConnection: false, nextConnectionIndex: 0 },
    collectionOverflow: false,
    pageErrorCount: 0,
    socketErrorCount: 0,
  };
  page.on("pageerror", (error) => {
    client.pageErrorCount += 1;
    pushBounded(report.errors.pageErrors, { client: name, message: redact(error?.message ?? "page error") }, "page-errors");
  });
  page.on("websocket", (socket) => {
    socket.on("socketerror", (error) => {
      client.socketErrorCount += 1;
      pushBounded(report.errors.socketErrors, { client: name, message: redact(String(error ?? "socket error")) }, "socket-errors");
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
      if (Date.now() >= deadline) { rejectWait(new Error(`Timed out waiting for ${description}.`)); return; }
      setTimeout(tick, 25);
    };
    tick();
  });
}

function controls(client, index, direction = null, type = null) {
  const connection = client.wire.connections.find((item) => item.index === index);
  if (!connection) return [];
  return connection.controls.filter((item) => (!direction || item.direction === direction) && (!type || item.type === type));
}

function controlCount(client, index, direction, type) {
  return controls(client, index, direction, type).length;
}

function latestControl(client, index, direction, type) {
  return controls(client, index, direction, type).at(-1) ?? null;
}

function waitControl(client, index, direction, type, countBefore = 0, timeoutMs = normalTimeoutMs) {
  return waitFor(() => controls(client, index, direction, type)[countBefore] ?? null, `${client.name} ${direction} ${type} on connection ${index}`, timeoutMs);
}

function currentConnection(client) {
  return client.wire.activeConnection;
}

function browserURL(search = "") {
  return new URL(search, target.origin).href;
}

async function readRoomCatalogue() {
  const rooms = await new Promise((resolveRooms, rejectRooms) => {
    const request = httpsGet(`${target.origin}/api/rooms`, { ca: caPem }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
        if (Buffer.byteLength(body) > 256 * 1024) request.destroy(new Error("Room catalogue exceeded the smoke size cap."));
      });
      response.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          if (response.statusCode !== 200 || !Array.isArray(parsed)) throw new Error("The local room catalogue was not a successful JSON list.");
          resolveRooms(parsed);
        } catch (error) { rejectRooms(error); }
      });
    });
    request.setTimeout(5_000, () => request.destroy(new Error("The local HTTPS room catalogue timed out.")));
    request.on("error", rejectRooms);
  });
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
  const connection = await waitFor(() => currentConnection(client), `${client.name} initial WebSocket`);
  await waitControl(client, connection.index, "received", "room.snapshot");
  const self = await waitControl(client, connection.index, "received", "participation.self");
  const issued = await waitControl(client, connection.index, "received", "session.issued");
  assert.equal(latestControl(client, connection.index, "received", "room.snapshot")?.roomId, "studio");
  assert.ok(issued.tokenPresent, `${client.name} should receive a resumable control session.`);
  assert.ok(self.participantId);
  return { participantId: self.participantId, roomId: "studio", role: self.role, mode: self.mode, connectionIndex: connection.index };
}

async function enterHost(client) {
  const identity = await enterParticipant(client, "T13 synthetic host");
  await client.page.getByTestId("host-panel").waitFor();
  await client.page.getByTestId("host-control-token").fill(hostToken);
  const connection = currentConnection(client);
  const claimedBefore = controlCount(client, connection.index, "received", "host.claimed");
  await client.page.getByTestId("host-claim").click();
  await client.page.getByTestId("host-state").filter({ hasText: "HOST" }).waitFor();
  await waitControl(client, connection.index, "received", "host.claimed", claimedBefore);
  return identity;
}

async function enterDisplay(client) {
  await client.page.goto(browserURL("/?view=display&room=studio"), { waitUntil: "domcontentloaded" });
  await client.page.getByTestId("display-page").waitFor();
  await client.page.getByTestId("display-join").click();
  await client.page.getByLabel("Meeting room password").waitFor({ state: "visible" });
  await client.page.locator("#meeting-room-password").fill(roomPassword);
  await client.page.getByRole("button", { name: "Enter room", exact: true }).click();
  await client.page.getByTestId("display-leave").waitFor();
  await client.page.getByText("唯讀展示已連線", { exact: false }).waitFor();
  const connection = await waitFor(() => currentConnection(client), "display initial WebSocket");
  const self = await waitControl(client, connection.index, "received", "participation.self");
  assert.equal(self.role, "display");
  assert.equal(self.mode, "watch");
  await waitFor(() => controlCount(client, connection.index, "sent", "screen.subscribe") === 1, "initial display auto-watch subscribe");
  return { participantId: self.participantId, roomId: "studio", role: "display", mode: "watch", connectionIndex: connection.index };
}

function readSyntheticState(page) {
  return page.evaluate(() => {
    const state = window.__t13SyntheticMedia;
    if (!state) return null;
    return {
      audioRequests: state.audioRequests,
      screenRequests: state.screenRequests,
      sources: state.sources.map(({ kind, sourceIndex, track, stopCalls }) => ({
        kind,
        sourceIndex,
        readyState: track.readyState,
        stopCalls,
      })),
      audioContextStates: state.audioContexts.map((context) => context.state),
    };
  });
}

async function mediaSnapshot(page) {
  return page.evaluate(() => {
    const audio = document.querySelector('[data-testid="audio-panel"]');
    const screen = document.querySelector('[data-testid="screen-panel"]');
    const audioStatus = document.querySelector('[data-testid="audio-recovery-status"]');
    const screenStatus = document.querySelector('[data-testid="screen-recovery-status"]');
    const numeric = (element, key) => {
      const value = Number(element?.getAttribute(key));
      return Number.isFinite(value) ? value : 0;
    };
    const canvas = screen?.querySelector('[data-testid="screen-preview"]');
    return {
      capturedAt: new Date().toISOString(),
      audio: audio ? {
        listenerState: audio.getAttribute("data-listener-state"),
        receivedPackets: numeric(audio, "data-received-packets"),
        decodedFrames: numeric(audio, "data-decoded-frames"),
        renderedSamples: numeric(audio, "data-rendered-samples"),
        renderRms: numeric(audio, "data-render-rms"),
        receiverGeneration: audio.getAttribute("data-receiver-generation"),
        playbackClockId: audio.getAttribute("data-audio-playback-clock-id"),
        recovery: audioStatus ? {
          receiveIntent: audioStatus.getAttribute("data-receive-intent"),
          roomId: audioStatus.getAttribute("data-room-id"),
          listenerState: audioStatus.getAttribute("data-listener-state"),
          subscribed: audioStatus.getAttribute("data-subscribed"),
        } : null,
      } : null,
      screen: screen ? {
        receiverState: screen.getAttribute("data-receiver-state"),
        receivedFrames: numeric(screen, "data-received-frames"),
        decodedFrames: numeric(screen, "data-decoded-frames"),
        renderedFrames: numeric(screen, "data-rendered-frames"),
        width: Number(screen.getAttribute("data-rendered-width")) || canvas?.width || 0,
        height: Number(screen.getAttribute("data-rendered-height")) || canvas?.height || 0,
        syncMode: screen.getAttribute("data-sync-mode"),
        syncClockId: screen.getAttribute("data-sync-clock-id"),
        recovery: screenStatus ? {
          receiveIntent: screenStatus.getAttribute("data-receive-intent"),
          roomId: screenStatus.getAttribute("data-room-id"),
          receiverState: screenStatus.getAttribute("data-receiver-state"),
          subscribed: screenStatus.getAttribute("data-subscribed"),
          syncClockId: screenStatus.getAttribute("data-sync-clock-id"),
        } : null,
      } : null,
    };
  });
}

async function waitForActualAudio(page, baselineSamples, phase, recovery, reconnect = null, timeoutMs = 12_000) {
  let beforeGesture = await mediaSnapshot(page);
  let state = beforeGesture.audio?.listenerState;
  let gesture = null;
  const settleUntil = Date.now() + 900;
  while (state !== "suspended" && beforeGesture.audio?.renderedSamples <= baselineSamples && Date.now() < settleUntil) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    beforeGesture = await mediaSnapshot(page);
    state = beforeGesture.audio?.listenerState;
  }
  if (state === "suspended" || beforeGesture.audio?.renderedSamples <= baselineSamples && recovery) {
    const requestedAtMs = elapsedMs();
    const button = page.getByTestId("audio-continue-listening");
    if (await button.isVisible().catch(() => false)) {
      try {
        await button.click({ timeout: 1_500 });
        gesture = { phase, result: "need-gesture", stateBefore: state, clickedOrdinaryContinue: true, requestedAtMs };
        if (reconnect) reconnect.audioGestureAtMs = requestedAtMs;
        report.gestures.push(gesture);
      } catch (error) {
        const current = await mediaSnapshot(page);
        const stillOffered = await button.isVisible().catch(() => false);
        report.gestures.push({ phase, result: "continue-click-state-readback", stateBefore: state, stateAfter: current.audio?.listenerState, samplesAfter: current.audio?.renderedSamples, stillOffered, clickedOrdinaryContinue: false });
        if (stillOffered || current.audio?.listenerState !== "ready") throw error;
        // A suspended offer can disappear when the browser starts naturally.
        // Actual output is still required below; never force playback policy.
      }
    }
  }
  await page.waitForFunction((previous) => {
    const panel = document.querySelector('[data-testid="audio-panel"]');
    return panel && Number(panel.getAttribute("data-rendered-samples")) > previous && Number(panel.getAttribute("data-render-rms")) > 0.0001;
  }, baselineSamples, { timeout: timeoutMs });
  const after = await mediaSnapshot(page);
  assert.ok(after.audio?.receivedPackets > 0 && after.audio.decodedFrames > 0 && after.audio.renderedSamples > baselineSamples,
    `${phase} must produce new received packets, decoded frames, and AudioWorklet output samples.`);
  if (gesture) {
    gesture.renderedAtMs = elapsedMs();
    gesture.msFromClickToRender = gesture.renderedAtMs - gesture.requestedAtMs;
  } else if (recovery) {
    report.gestures.push({ phase, result: "automatic-playback", stateBefore: state, clickedOrdinaryContinue: false, renderedAtMs: elapsedMs() });
  }
  return after;
}

async function waitForActualScreen(page, baselineFrames, phase, timeoutMs = 12_000) {
  await page.waitForFunction((previous) => {
    const panel = document.querySelector('[data-testid="screen-panel"]');
    const canvas = panel?.querySelector('[data-testid="screen-preview"]');
    return panel && canvas && Number(panel.getAttribute("data-rendered-frames")) > previous && canvas.width > 0 && canvas.height > 0;
  }, baselineFrames, { timeout: timeoutMs });
  const snapshot = await mediaSnapshot(page);
  assert.ok(snapshot.screen?.receivedFrames > 0 && snapshot.screen.decodedFrames > 0 && snapshot.screen.renderedFrames > baselineFrames,
    `${phase} must receive, decode, and render new VP8 frames.`);
  assert.ok(snapshot.screen.width > 0 && snapshot.screen.height > 0, `${phase} must expose rendered canvas dimensions.`);
  return snapshot;
}

async function ensureRecoveryIntent(page, channel, expected) {
  const testId = channel === "audio" ? "audio-recovery-status" : "screen-recovery-status";
  await page.getByTestId(testId).waitFor({ state: "visible" });
  await page.waitForFunction(({ statusTestId, intent }) => {
    const element = document.querySelector(`[data-testid="${statusTestId}"]`);
    return element?.getAttribute("data-receive-intent") === intent;
  }, { statusTestId: testId, intent: expected ? "true" : "false" }, { timeout: normalTimeoutMs });
  const state = await mediaSnapshot(page);
  const intent = state[channel]?.recovery?.receiveIntent;
  assert.equal(intent, expected ? "true" : "false", `${channel} recovery intent must be ${expected}.`);
  assert.equal(state[channel]?.recovery?.roomId, "studio");
  return state[channel].recovery;
}

async function saveScreenshot(client, fileName) {
  await client.page.screenshot({ path: join(outputDirectory, fileName), fullPage: true, animations: "disabled" });
  if (!report.screenshots.includes(fileName) && report.screenshots.length < 12) report.screenshots.push(fileName);
}

async function startControlledReconnect(client, screenshotPrefix) {
  const oldConnection = currentConnection(client);
  assert.ok(oldConnection?.serverRoute, `${client.name} needs an active routed socket before the controlled close.`);
  const reconnect = {
    client: client.name,
    screenshotPrefix,
    oldConnectionIndex: oldConnection.index,
    controlledCloseAtMs: elapsedMs(),
  };
  client.wire.blockNextConnection = true;
  await oldConnection.serverRoute.close({ code: 4000, reason: "T13 controlled application disconnect" });
  const held = await waitFor(() => client.wire.heldRoute, `${client.name} held reconnect route`, reconnectTimeoutMs);
  reconnect.newConnectionIndex = held.connection.index;
  reconnect.reconnectRouteOpenedAtMs = held.connection.openedAtMs;
  reconnect.heldRouteAtMs = elapsedMs();
  const statusId = client.name === "display" ? "display-status" : "control-connection-status";
  const status = client.page.getByTestId(statusId);
  await status.waitFor({ state: "visible" });
  reconnect.reconnectingStatus = redact((await status.textContent()) ?? "").slice(0, 120);
  if (client.name === "display") {
    assert.match(reconnect.reconnectingStatus, /reconnect|retry|disconnected|重連|恢復|重試|連線中/iu);
  } else {
    const text = reconnect.reconnectingStatus;
    assert.match(text, /reconnect|retry|disconnected|重連|恢復|重試|連線中/iu);
  }
  if (screenshotPrefix) await saveScreenshot(client, `${screenshotPrefix}-reconnecting.png`);
  await waitFor(() => held.pendingMessages.length > 0, `${client.name} bounded buffer receives its session.resume before release`, reconnectTimeoutMs);
  reconnect.pendingMessageCountAtRelease = held.pendingMessages.length;
  reconnect.pendingBytesAtRelease = held.pendingBytes;
  assert.ok(held.pendingMessages.length > 0, `${client.name} should send its new resume request while the route is held.`);
  return reconnect;
}

function releaseHeldRoute(client) {
  const held = client.wire.heldRoute;
  assert.ok(held, `${client.name} reconnect route must still be held.`);
  connectRoutedSocket(client, held.route, held.connection, held.pendingMessages);
  held.connection.releasedAtMs = elapsedMs();
  client.wire.heldRoute = null;
  return held.connection;
}

async function waitForControlRestore(client, identity, reconnect) {
  const connection = releaseHeldRoute(client);
  const index = connection.index;
  reconnect.routeReleasedAtMs = connection.releasedAtMs;
  const resumed = await waitControl(client, index, "received", "session.resumed", 0, reconnectTimeoutMs);
  reconnect.sessionResumedAtMs = resumed.atMs;
  assert.equal(resumed.participantId, identity.participantId, `${client.name} should resume the same server participant ID.`);
  assert.equal(resumed.roomId, identity.roomId);
  assert.equal(resumed.role, identity.role);
  assert.equal(resumed.mode, identity.mode);
  const room = await waitControl(client, index, "received", "room.snapshot", 0, reconnectTimeoutMs);
  reconnect.roomSnapshotAtMs = room.atMs;
  assert.equal(room.roomId, identity.roomId);
  const self = await waitControl(client, index, "received", "participation.self", 0, reconnectTimeoutMs);
  reconnect.participationSelfAtMs = self.atMs;
  assert.equal(self.roomId, identity.roomId);
  assert.equal(self.participantId, identity.participantId);
  assert.equal(self.role, identity.role);
  assert.equal(self.mode, identity.mode);
  assert.equal(self.audioSubscribed, false, "fresh control state must not inherit the previous socket audio subscription.");
  assert.equal(self.screenSubscribed, false, "fresh control state must not inherit the previous socket screen subscription.");
  reconnect.controlReadyAtMs = Math.max(reconnect.roomSnapshotAtMs, reconnect.participationSelfAtMs);
  reconnect.newConnectionControlCount = controls(client, index).length;
  return connection;
}

function recoveryRelativeTimes(reconnect) {
  const close = reconnect.controlledCloseAtMs;
  const entries = [
    "reconnectRouteOpenedAtMs", "heldRouteAtMs", "routeReleasedAtMs", "sessionResumedAtMs", "roomSnapshotAtMs", "participationSelfAtMs", "controlReadyAtMs",
    "audioSubscribeSentAtMs", "audioSubscribedAckAtMs", "audioStreamAtMs", "audioRenderedAtMs",
    "screenSubscribeSentAtMs", "screenSubscribedAckAtMs", "screenStreamAtMs", "screenKeyframeAtMs", "screenRenderedAtMs",
  ];
  const fromCloseMs = Object.fromEntries(entries.filter((key) => Number.isFinite(reconnect[key])).map((key) => [key.replace(/AtMs$/u, "Ms"), reconnect[key] - close]));
  const fromReleaseMs = Number.isFinite(reconnect.routeReleasedAtMs)
    ? Object.fromEntries(entries.filter((key) => Number.isFinite(reconnect[key]) && reconnect[key] >= reconnect.routeReleasedAtMs)
      .map((key) => [key.replace(/AtMs$/u, "Ms"), reconnect[key] - reconnect.routeReleasedAtMs]))
    : {};
  return { fromControlledClose: fromCloseMs, fromRouteRelease: fromReleaseMs };
}

async function recoverReceiverMedia(client, identity, reconnect, { audio, screen, publisher, baselineAudioGeneration, baselineScreenGeneration, expectedClockId, publisherKeyframeBaseline }) {
  const connection = currentConnection(client);
  assert.equal(connection?.index, reconnect.newConnectionIndex, `${client.name} media recovery must use the newly routed socket.`);
  const index = connection.index;
  if (audio) {
    await waitFor(() => controlCount(client, index, "sent", "audio.subscribe") > 0, `${client.name} auto audio subscribe on new socket`);
    reconnect.audioSubscribeSentAtMs = latestControl(client, index, "sent", "audio.subscribe").atMs;
    const ack = await waitControl(client, index, "received", "audio.subscribed", 0);
    reconnect.audioSubscribedAckAtMs = ack.atMs;
    const stream = await waitControl(client, index, "received", "audio.stream", 0);
    reconnect.audioStreamAtMs = stream.atMs;
    assert.equal(controlCount(client, index, "sent", "audio.subscribe"), 1, "audio intent must restore exactly once on the new socket.");
    assert.equal(stream.connectionIndex, index);
    assert.equal(stream.generation, baselineAudioGeneration, "receiver-only reconnect must retain the active publisher generation.");
    assert.equal(stream.clockId, expectedClockId, "receiver-only reconnect must use the active publisher timebase clock ID.");
    assert.equal(stream.config.codec, "opus");
    reconnect.audio = { subscribeCountOnNewConnection: controlCount(client, index, "sent", "audio.subscribe"), ack, stream };
  }
  if (screen) {
    await waitFor(() => controlCount(client, index, "sent", "screen.subscribe") > 0, `${client.name} auto screen subscribe on new socket`);
    reconnect.screenSubscribeSentAtMs = latestControl(client, index, "sent", "screen.subscribe").atMs;
    const ack = await waitControl(client, index, "received", "screen.subscribed", 0);
    reconnect.screenSubscribedAckAtMs = ack.atMs;
    const stream = await waitControl(client, index, "received", "screen.stream", 0);
    reconnect.screenStreamAtMs = stream.atMs;
    assert.equal(controlCount(client, index, "sent", "screen.subscribe"), 1, "screen intent must restore exactly once on the new socket.");
    assert.equal(stream.connectionIndex, index);
    assert.equal(stream.generation, baselineScreenGeneration, "receiver-only reconnect must keep the active publisher generation.");
    assert.equal(stream.clockId, expectedClockId, "screen and audio must use the current shared publisher clock.");
    assert.equal(stream.config.codec, "vp8");
    const keyframe = publisherKeyframeBaseline === undefined
      ? null
      : await waitControl(publisher, currentConnection(publisher).index, "received", "screen.keyframeRequest", publisherKeyframeBaseline);
    if (keyframe) {
      reconnect.screenKeyframeAtMs = keyframe.atMs;
      assert.equal(keyframe.generation, baselineScreenGeneration);
    }
    reconnect.screen = {
      subscribeCountOnNewConnection: controlCount(client, index, "sent", "screen.subscribe"),
      ack,
      stream,
      keyframe,
      keyframeGateEvidence: keyframe ? "relay keyframe request observed; this connection then decoded and rendered" : "fresh stream config and decoded/rendered frames observed; relay request was coalesced",
    };
  }
  return connection;
}

async function verifyRecoveredPlayback(client, reconnect, { audio, screen, prefix }) {
  const before = await mediaSnapshot(client.page);
  reconnect.renderBaseline = {
    audioRenderedSamples: before.audio?.renderedSamples ?? null,
    audioDecodedFrames: before.audio?.decodedFrames ?? null,
    screenRenderedFrames: before.screen?.renderedFrames ?? null,
    screenDecodedFrames: before.screen?.decodedFrames ?? null,
    screenSyncClockId: before.screen?.syncClockId ?? null,
    screenSyncMode: before.screen?.syncMode ?? null,
  };
  if (audio) {
    await ensureRecoveryIntent(client.page, "audio", true);
    const after = await waitForActualAudio(client.page, before.audio?.renderedSamples ?? 0, `${client.name}-recovered-audio`, true, reconnect);
    reconnect.audio.renderAfter = {
      renderedSamples: after.audio.renderedSamples,
      decodedFrames: after.audio.decodedFrames,
      receivedPackets: after.audio.receivedPackets,
      renderRms: after.audio.renderRms,
      playbackClockId: after.audio.playbackClockId,
    };
    reconnect.audioRenderedAtMs = elapsedMs();
    assert.equal(after.audio.playbackClockId, reconnect.audio.stream.clockId, "AudioWorklet playback should use the reannounced clock.");
    const connection = client.wire.connections.find((item) => item.index === reconnect.newConnectionIndex);
    assert.ok(connection?.binaryFrames.received > 0, "the new connection must carry real binary media while AudioWorklet counters rise.");
    reconnect.audio.renderAfter.binaryFramesOnNewConnection = connection.binaryFrames.received;
  }
  if (screen) {
    await ensureRecoveryIntent(client.page, "screen", true);
    const after = await waitForActualScreen(client.page, before.screen?.renderedFrames ?? 0, `${client.name}-recovered-screen`);
    reconnect.screen.renderAfter = {
      renderedFrames: after.screen.renderedFrames,
      decodedFrames: after.screen.decodedFrames,
      receivedFrames: after.screen.receivedFrames,
      width: after.screen.width,
      height: after.screen.height,
      syncMode: after.screen.syncMode,
      syncClockId: after.screen.syncClockId,
    };
    reconnect.screenRenderedAtMs = elapsedMs();
    assert.equal(after.screen.syncClockId, reconnect.screen.stream.clockId, "VP8 render timeline should adopt the new receiver's current clock mapping.");
    if (audio) {
      assert.equal(after.screen.syncClockId, reconnect.audio.stream.clockId, "Recovered audio/video must share the current publisher timebase.");
      assert.equal(after.screen.syncMode, "audio-master", "The new screen timeline must schedule against the current audio clock.");
    }
    const connection = client.wire.connections.find((item) => item.index === reconnect.newConnectionIndex);
    assert.ok(connection?.binaryFrames.received > 0, "the new connection must carry binary VP8 media while render counters rise.");
    reconnect.screen.renderAfter.binaryFramesOnNewConnection = connection.binaryFrames.received;
  }
  reconnect.timingsMs = recoveryRelativeTimes(reconnect);
  if (prefix) await saveScreenshot(client, `${prefix}-recovered.png`);
  return reconnect;
}

async function proveStoppedIntentDoesNotResubscribe(client, identity) {
  const connection = currentConnection(client);
  const audioUnsubscribeBefore = controlCount(client, connection.index, "sent", "audio.unsubscribe");
  const screenUnsubscribeBefore = controlCount(client, connection.index, "sent", "screen.unsubscribe");
  await client.page.getByTestId("audio-stop-listening").click();
  await waitFor(() => controlCount(client, connection.index, "sent", "audio.unsubscribe") > audioUnsubscribeBefore, "participant manual audio unsubscribe");
  await client.page.getByTestId("screen-stop-watching").click();
  await waitFor(() => controlCount(client, connection.index, "sent", "screen.unsubscribe") > screenUnsubscribeBefore, "participant manual screen unsubscribe");
  await ensureRecoveryIntent(client.page, "audio", false);
  await ensureRecoveryIntent(client.page, "screen", false);
  const reconnect = await startControlledReconnect(client, "participant-stopped-intent");
  const newConnection = await waitForControlRestore(client, identity, reconnect);
  await new Promise((resolveWait) => setTimeout(resolveWait, 1_200));
  assert.equal(controlCount(client, newConnection.index, "sent", "audio.subscribe"), 0, "manual audio stop must remain stopped after another socket close.");
  assert.equal(controlCount(client, newConnection.index, "sent", "screen.subscribe"), 0, "manual screen stop must remain stopped after another socket close.");
  assert.equal(controlCount(client, newConnection.index, "received", "audio.stream"), 0);
  assert.equal(controlCount(client, newConnection.index, "received", "screen.stream"), 0);
  await ensureRecoveryIntent(client.page, "audio", false);
  await ensureRecoveryIntent(client.page, "screen", false);
  reconnect.timingsMs = recoveryRelativeTimes(reconnect);
  reconnect.stoppedIntentStayedOff = true;
  report.recoveries.push(reconnect);
  stage("manual-stop-remains-off-after-a-second-new-socket", { newConnectionIndex: newConnection.index, audioSubscribes: 0, screenSubscribes: 0 });
}

async function startSyntheticPublishers(host, expectedSourceIndex = 0) {
  const connection = currentConnection(host);
  const audioStartedBefore = controlCount(host, connection.index, "received", "audio.started");
  const screenStartedBefore = controlCount(host, connection.index, "received", "screen.started");
  await host.page.getByRole("button", { name: "開始麥克風", exact: true }).click();
  await waitControl(host, connection.index, "received", "audio.started", audioStartedBefore);
  await host.page.getByRole("button", { name: "開始分享畫面", exact: true }).click();
  await waitControl(host, connection.index, "received", "screen.started", screenStartedBefore);
  const audioStart = latestControl(host, connection.index, "received", "audio.started");
  const screenStart = latestControl(host, connection.index, "received", "screen.started");
  const synthetic = await readSyntheticState(host.page);
  assert.equal(synthetic.audioRequests, expectedSourceIndex + 1, "host audio sources must be created only by normal start-button clicks.");
  assert.equal(synthetic.screenRequests, expectedSourceIndex + 1, "host screen sources must be created only by normal start-button clicks.");
  assert.equal(synthetic.sources.filter((source) => source.kind === "audio").length, expectedSourceIndex + 1);
  assert.equal(synthetic.sources.filter((source) => source.kind === "screen").length, expectedSourceIndex + 1);
  return { connectionIndex: connection.index, audioStart, screenStart, synthetic };
}

async function startParticipantReceiving(participant, { audio = true, screen = true } = {}) {
  const page = participant.page;
  const connection = currentConnection(participant);
  if (audio) {
    const sentBefore = controlCount(participant, connection.index, "sent", "audio.subscribe");
    const ackBefore = controlCount(participant, connection.index, "received", "audio.subscribed");
    await page.getByTestId("audio-start-listening").click();
    await waitFor(() => controlCount(participant, connection.index, "sent", "audio.subscribe") > sentBefore, "manual participant audio subscribe");
    await waitControl(participant, connection.index, "received", "audio.subscribed", ackBefore);
  }
  if (screen) {
    const sentBefore = controlCount(participant, connection.index, "sent", "screen.subscribe");
    const ackBefore = controlCount(participant, connection.index, "received", "screen.subscribed");
    await page.getByTestId("screen-start-watching").click();
    await waitFor(() => controlCount(participant, connection.index, "sent", "screen.subscribe") > sentBefore, "manual participant screen subscribe");
    await waitControl(participant, connection.index, "received", "screen.subscribed", ackBefore);
  }
}

async function proveSenderCloseEndsSourcesWithoutRepublish(host, hostIdentity, originalPublish) {
  const before = await readSyntheticState(host.page);
  const oldHostConnection = currentConnection(host);
  const previousHostClaims = controlCount(host, oldHostConnection.index, "sent", "host.claim");
  const reconnect = await startControlledReconnect(host, null);
  const connection = await waitForControlRestore(host, hostIdentity, reconnect);
  await host.page.getByTestId("host-state").filter({ hasText: "MANAGED" }).waitFor();
  const room = latestControl(host, connection.index, "received", "room.snapshot");
  assert.equal(room?.publishAllowed, false, "the resumed host connection must receive current non-publisher permission.");
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  const after = await readSyntheticState(host.page);
  assert.ok(after.sources.length >= before.sources.length);
  const oldSources = after.sources.filter((source) => source.sourceIndex === 0);
  assert.equal(oldSources.length, 2, "one old synthetic audio track and one old canvas track must remain inspectable.");
  assert.ok(oldSources.every((source) => source.readyState === "ended"), "closing the publishing socket must end both old synthetic tracks.");
  assert.equal(after.audioRequests, before.audioRequests, "resume must not capture audio again.");
  assert.equal(after.screenRequests, before.screenRequests, "resume must not capture display again.");
  assert.equal(controlCount(host, connection.index, "sent", "audio.start"), 0, "resume must not start old audio publishing.");
  assert.equal(controlCount(host, connection.index, "sent", "screen.start"), 0, "resume must not start old screen publishing.");
  assert.equal(controlCount(host, connection.index, "sent", "host.claim"), 0, "host claim must not auto-resume.");
  assert.equal(controlCount(host, connection.index, "received", "host.claimed"), 0, "old host permission must not return.");
  assert.equal(controlCount(host, connection.index, "received", "host.publisherGrants"), 0, "old publisher grants must not return.");
  assert.equal(controlCount(host, oldHostConnection.index, "sent", "host.claim"), previousHostClaims);
  const publisherEnded = {
    connectionIndex: connection.index,
    hostClaimedAfterResume: false,
    publishAllowedAfterResume: room.publishAllowed,
    oldPublisherGrantEventsAfterResume: 0,
    oldAudioTrackEnded: true,
    oldScreenTrackEnded: true,
    autoAudioCaptureCount: 0,
    autoScreenCaptureCount: 0,
    autoAudioStartCount: 0,
    autoScreenStartCount: 0,
    oldAudioGeneration: originalPublish.audioGeneration,
    oldScreenGeneration: originalPublish.screenGeneration,
    oldClockId: originalPublish.clockId,
  };
  reconnect.senderClosed = publisherEnded;
  reconnect.timingsMs = recoveryRelativeTimes(reconnect);
  report.recoveries.push(reconnect);
  stage("publisher-close-ends-synthetic-tracks-and-does-not-restore-publish-permission", publisherEnded);
  return reconnect;
}

async function reclaimAndRestartPublisher(host, participant, display, originalPublish) {
  const hostConnection = currentConnection(host);
  const claimedBefore = controlCount(host, hostConnection.index, "received", "host.claimed");
  const publisherKeyframeBaseline = controlCount(host, hostConnection.index, "received", "screen.keyframeRequest");
  const displayConnection = currentConnection(display);
  const displayStreamBaseline = controlCount(display, displayConnection.index, "received", "screen.stream");
  await host.page.getByTestId("host-control-token").fill(hostToken);
  await host.page.getByTestId("host-claim").click();
  await host.page.getByTestId("host-state").filter({ hasText: "HOST" }).waitFor();
  await waitControl(host, hostConnection.index, "received", "host.claimed", claimedBefore);
  const restarted = await startSyntheticPublishers(host, 1);
  assert.notEqual(restarted.audioStart.generation, originalPublish.audioGeneration, "manual publisher restart must create a new audio generation.");
  assert.notEqual(restarted.screenStart.generation, originalPublish.screenGeneration, "manual publisher restart must create a new screen generation.");
  const oldClockId = originalPublish.clockId;
  const displayStream = await waitControl(display, displayConnection.index, "received", "screen.stream", displayStreamBaseline);
  assert.equal(displayStream.generation, restarted.screenStart.generation);
  assert.equal(displayStream.config.codec, "vp8");
  const participantConnection = currentConnection(participant);
  const participantAudioStreamBaseline = controlCount(participant, participantConnection.index, "received", "audio.stream");
  const participantScreenStreamBaseline = controlCount(participant, participantConnection.index, "received", "screen.stream");
  await startParticipantReceiving(participant, { audio: true, screen: true });
  const audioStream = await waitControl(participant, participantConnection.index, "received", "audio.stream", participantAudioStreamBaseline);
  const screenStream = await waitControl(participant, participantConnection.index, "received", "screen.stream", participantScreenStreamBaseline);
  const keyframe = await waitControl(host, currentConnection(host).index, "received", "screen.keyframeRequest", publisherKeyframeBaseline);
  const newClockId = audioStream.clockId;
  assert.equal(audioStream.generation, restarted.audioStart.generation);
  assert.equal(screenStream.generation, restarted.screenStart.generation);
  assert.equal(audioStream.clockId, newClockId);
  assert.equal(screenStream.clockId, newClockId);
  assert.equal(displayStream.clockId, newClockId);
  if (oldClockId && newClockId) assert.notEqual(newClockId, oldClockId, "manual publisher restart must establish a new publisher clock.");
  assert.equal(keyframe.generation, restarted.screenStart.generation);

  let participantBefore = await mediaSnapshot(participant.page);
  participantBefore = await waitForActualAudio(participant.page, participantBefore.audio?.renderedSamples ?? 0, "manual-restart-participant-audio", false, null);
  const participantScreen = await waitForActualScreen(participant.page, participantBefore.screen?.renderedFrames ?? 0, "manual-restart-participant-screen");
  const displayBefore = await mediaSnapshot(display.page);
  const displayAfter = await waitForActualScreen(display.page, displayBefore.screen?.renderedFrames ?? 0, "display-after-manual-source-restart");
  assert.equal(participantScreen.screen.syncClockId, newClockId);
  assert.equal(displayAfter.screen.syncClockId, newClockId);
  stage("normal-claim-and-manual-source-restart-renders-new-generation-clock", {
    audioGeneration: restarted.audioStart.generation,
    screenGeneration: restarted.screenStart.generation,
    oldClockId,
    newClockId,
    participantAudioRenderedSamples: participantBefore.audio.renderedSamples,
    participantScreenRenderedFrames: participantScreen.screen.renderedFrames,
    displayScreenRenderedFrames: displayAfter.screen.renderedFrames,
  });
}

function connectionReadback() {
  return [...clients.values()].flatMap((client) => client.wire.connections.map((connection) => ({
    client: client.name,
    index: connection.index,
    openedAtMs: connection.openedAtMs,
    connectedAtMs: connection.connectedAtMs,
    binaryFrames: connection.binaryFrames,
    controls: connection.controls,
  })));
}

async function closeResources() {
  for (const client of clients.values()) {
    const held = client.wire.heldRoute;
    if (held) {
      try { held.route.close({ code: 1000, reason: "T13 cleanup" }); }
      catch { /* A closed held route needs no further forwarding. */ }
      client.wire.heldRoute = null;
    }
  }
  for (const context of contexts.splice(0)) {
    try { await context.close(); }
    catch (error) { pushBounded(report.errors.cleanupErrors, redact(error?.message ?? "Firefox close failed"), "cleanup-errors"); }
  }
  for (const folder of profileFolders) {
    try { rmSync(folder, { recursive: true, force: true }); }
    catch (error) { pushBounded(report.errors.cleanupErrors, redact(error?.message ?? "Firefox profile cleanup failed"), "cleanup-errors"); }
  }
  profileFolders.clear();
}

function writeReport() {
  report.finishedAt = new Date().toISOString();
  report.durationMs = elapsedMs();
  report.status = failure ? "failed" : "passed";
  report.connections = connectionReadback();
  report.privacy.secretsInRetainedTrace = false;
  report.errors.failure = failure ? redact(failure?.message ?? failure) : null;
  if (report.errors.collectionErrors.length > 0 || report.privacy.configuredSecretEchoObserved) report.status = "failed";
  const serialized = JSON.stringify(report, null, 2) + "\n";
  for (const secret of secretValues) {
    if (secret && serialized.includes(secret)) {
      report.status = "failed";
      report.privacy.secretsInRetainedTrace = true;
      report.errors.failure = "A configured credential or resume token was detected in the report before write.";
      break;
    }
  }
  let safeOutput = JSON.stringify(report, null, 2) + "\n";
  for (const secret of secretValues) if (secret) safeOutput = safeOutput.split(secret).join("[redacted]");
  writeFileSync(join(outputDirectory, "media-recovery-report.json"), safeOutput, { encoding: "utf8", mode: 0o600 });
}

async function main() {
  assert.equal(process.versions.node, "26.13.0", "Run the T13 smoke with pinned Node 26.13.0.");
  report.executionScope = process.env.MEDIA_RECOVERY_TEST_SCOPE === "publisher" ? "publisher-only" : "full";
  await readRoomCatalogue();
  const host = await launchClient("host", true);
  const participant = await launchClient("participant");
  const display = await launchClient("display");

  const hostIdentity = await enterHost(host);
  const participantIdentity = await enterParticipant(participant, "T13 participant");
  assert.equal(participantIdentity.role, "participant");
  assert.equal(participantIdentity.roomId, "studio");
  const displayIdentity = await enterDisplay(display);
  report.runtime.firefox = await participant.page.evaluate(() => navigator.userAgent);
  stage("host-participant-and-readonly-display-joined-through-normal-room-controls", { roomId: "studio", participantRole: participantIdentity.role, displayRole: displayIdentity.role });

  const publisher = await startSyntheticPublishers(host);
  await startParticipantReceiving(participant, { audio: true, screen: true });
  const participantConnection = currentConnection(participant);
  const initialAudioStream = await waitControl(participant, participantConnection.index, "received", "audio.stream");
  const initialScreenStream = await waitControl(participant, participantConnection.index, "received", "screen.stream");
  const initialKeyframe = await waitControl(host, currentConnection(host).index, "received", "screen.keyframeRequest");
  const initialClockId = initialAudioStream.clockId;
  const initialAudioGeneration = initialAudioStream.generation;
  const initialScreenGeneration = initialScreenStream.generation;
  publisher.clockId = initialClockId;
  publisher.audioGeneration = initialAudioGeneration;
  publisher.screenGeneration = initialScreenGeneration;
  assert.ok(initialClockId);
  assert.equal(initialScreenStream.clockId, initialClockId);
  assert.equal(initialAudioStream.config.codec, "opus");
  assert.equal(initialScreenStream.config.codec, "vp8");
  assert.equal(initialKeyframe.generation, initialScreenGeneration);

  let participantSnapshot = await mediaSnapshot(participant.page);
  participantSnapshot = await waitForActualAudio(participant.page, participantSnapshot.audio?.renderedSamples ?? 0, "initial-participant-audio", false, null);
  const participantScreen = await waitForActualScreen(participant.page, participantSnapshot.screen?.renderedFrames ?? 0, "initial-participant-screen");
  const displaySnapshot = await mediaSnapshot(display.page);
  await waitForActualScreen(display.page, displaySnapshot.screen?.renderedFrames ?? 0, "initial-display-screen");
  await ensureRecoveryIntent(participant.page, "audio", true);
  await ensureRecoveryIntent(participant.page, "screen", true);
  stage("synthetic-opus-and-vp8-are-actually-decoded-and-rendered", {
    audioGeneration: initialAudioGeneration,
    screenGeneration: initialScreenGeneration,
    clockId: initialClockId,
    audioRenderedSamples: participantSnapshot.audio.renderedSamples,
    audioDecodedFrames: participantSnapshot.audio.decodedFrames,
    screenRenderedFrames: participantScreen.screen.renderedFrames,
    screenDecodedFrames: participantScreen.screen.decodedFrames,
    displayRenderedFrames: (await mediaSnapshot(display.page)).screen.renderedFrames,
  });

  if (process.env.MEDIA_RECOVERY_TEST_SCOPE !== "publisher") {
  const publisherKeyframeBaseline = controlCount(host, currentConnection(host).index, "received", "screen.keyframeRequest");
  const participantReconnectPromise = startControlledReconnect(participant, "participant-media");
  const displayReconnectPromise = startControlledReconnect(display, "display-video");
  const [participantReconnect, displayReconnect] = await Promise.all([participantReconnectPromise, displayReconnectPromise]);
  const participantConnectionPromise = waitForControlRestore(participant, participantIdentity, participantReconnect);
  const displayConnectionPromise = waitForControlRestore(display, displayIdentity, displayReconnect);
  await Promise.all([participantConnectionPromise, displayConnectionPromise]);
  await recoverReceiverMedia(participant, participantIdentity, participantReconnect, {
    audio: true,
    screen: true,
    publisher: host,
    baselineAudioGeneration: initialAudioGeneration,
    baselineScreenGeneration: initialScreenGeneration,
    expectedClockId: initialClockId,
    publisherKeyframeBaseline,
  });
  await recoverReceiverMedia(display, displayIdentity, displayReconnect, {
    audio: false,
    screen: true,
    publisher: host,
    baselineAudioGeneration: initialAudioGeneration,
    baselineScreenGeneration: initialScreenGeneration,
    expectedClockId: initialClockId,
    publisherKeyframeBaseline,
  });
  await verifyRecoveredPlayback(participant, participantReconnect, { audio: true, screen: true, prefix: "participant-media" });
  await verifyRecoveredPlayback(display, displayReconnect, { audio: false, screen: true, prefix: "display-video" });
  report.recoveries.push(participantReconnect, displayReconnect);
  stage("participant-audio-video-and-samepage-display-video-recovered", {
    participantConnectionIndex: participantReconnect.newConnectionIndex,
    displayConnectionIndex: displayReconnect.newConnectionIndex,
    sourceGenerationRetained: true,
    sharedClockId: initialClockId,
    participantAudioRenderedSamples: participantReconnect.audio.renderAfter.renderedSamples,
    participantScreenRenderedFrames: participantReconnect.screen.renderAfter.renderedFrames,
    displayScreenRenderedFrames: displayReconnect.screen.renderAfter.renderedFrames,
    participantTimingsMs: participantReconnect.timingsMs,
    displayTimingsMs: displayReconnect.timingsMs,
  });

  await proveStoppedIntentDoesNotResubscribe(participant, participantIdentity);
  } else {
    await participant.page.getByTestId("audio-stop-listening").click();
    await participant.page.getByTestId("screen-stop-watching").click();
    await ensureRecoveryIntent(participant.page, "audio", false);
    await ensureRecoveryIntent(participant.page, "screen", false);
    stage("focused-publisher-diagnostic-skips-already-proven-receiver-reconnects", { scope: "publisher" });
  }
  await proveSenderCloseEndsSourcesWithoutRepublish(host, hostIdentity, publisher);
  await reclaimAndRestartPublisher(host, participant, display, publisher);
  await saveScreenshot(participant, "participant-manual-restart.png");
  await saveScreenshot(display, "display-manual-restart.png");

  assert.equal(report.errors.pageErrors.length, 0, "Firefox pages must not report uncaught exceptions.");
  assert.equal(report.errors.socketErrors.length, 0, "Firefox WebSockets must not report socket errors.");
  assert.equal(report.errors.collectionErrors.length, 0, "No bounded collector may overflow.");
  assert.equal(report.privacy.configuredSecretEchoObserved, false, "Server control frames must not echo configured credentials or resume tokens.");
  assert.equal([...clients.values()].some((client) => client.collectionOverflow), false, "No client control or connection collector may overflow.");
  stage("bounded-secret-safe-control-summary-and-final-assertions", {
    connectionCount: [...clients.values()].reduce((sum, client) => sum + client.wire.connections.length, 0),
    controlSummaryCount: [...clients.values()].reduce((sum, client) => sum + client.wire.connections.reduce((inner, connection) => inner + connection.controls.length, 0), 0),
    binaryFrameCountsOnly: true,
    secretsRetained: false,
  });
}

try {
  await main();
} catch (error) {
  failure = error;
  report.errors.failure = redact(error?.message ?? error);
  console.error(`[T13] failed ${redact(error?.message ?? "smoke failed")}`);
  for (const name of ["participant", "display"]) {
    const client = clients.get(name);
    if (!client) continue;
    try {
      const state = await mediaSnapshot(client.page);
      stage("failure-media-state-readback", { client: name, state });
      await saveScreenshot(client, `${name}-failure.png`);
    } catch { /* Preserve original failure if the page already closed. */ }
  }
} finally {
  await closeResources();
  if (!failure && report.errors.cleanupErrors.length > 0) failure = new Error("An isolated Firefox profile did not close cleanly.");
  if (!failure && report.errors.collectionErrors.length > 0) failure = new Error("A bounded smoke evidence collector reached its cap.");
  if (!failure && report.privacy.configuredSecretEchoObserved) failure = new Error("A server control frame echoed a configured secret or resume token.");
  try { writeReport(); }
  catch (error) {
    console.error(`[T13] report write failed ${redact(error?.message ?? "write failed")}`);
    if (!failure) failure = error;
  }
}

if (failure) process.exitCode = 1;
else console.log(`[T13] report ${join(outputDirectory, "media-recovery-report.json")}`);
