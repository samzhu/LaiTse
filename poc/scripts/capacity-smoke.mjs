import { enterRepositoryRootForLegacyScript, repositoryRoot, pocRoot } from "./lib/project-paths.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

enterRepositoryRootForLegacyScript();

const root = repositoryRoot;
const scratchRoot = resolve(root, ".scratch/cap01");
const outputDirectory = resolve(root, process.env.CAP01_OUTPUT_DIR ?? ".scratch/cap01/browser");
const outputRelative = relative(scratchRoot, outputDirectory);
if (isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(`..${sep}`)) {
  throw new Error("CAP01_OUTPUT_DIR must stay inside .scratch/cap01.");
}
if (process.version !== "v26.13.0") {
  throw new Error("Use the repository-pinned Node v26.13.0 runtime for this smoke.");
}

const baseURL = process.env.CAP01_BASE_URL ?? `https://localhost:${process.env.PORT ?? "4173"}/`;
const target = new URL(baseURL);
if (target.protocol !== "https:" || target.username || target.password || target.search || target.hash || target.pathname !== "/") {
  throw new Error("CAP01_BASE_URL must be a trusted HTTPS application root without credentials, query, or fragment.");
}
const caCertificate = resolve(root, process.env.CAP01_CA_CERT ?? ".scratch/t01/tls/local-ca.pem");
const certificateUtility = process.env.CERTUTIL_BIN ?? "certutil";
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, ".tools/playwright-browsers");
const { firefox } = await import("playwright");

const PAGE_COUNT = 10;
const PUBLISHER_COUNT = 9;
const NORMAL_TIMEOUT_MS = 10_000;
const MEDIA_TIMEOUT_MS = 12_000;
const MAX_CONTROL_TYPES_PER_PAGE = 80;
const MAX_CONTROL_EVENTS_PER_PAGE = 240;
const MAX_GENERATION_BUCKETS_PER_PAGE_CHANNEL = 24;
const MAX_CONNECTIONS_PER_PAGE = 3;
const MAX_SCREENSHOTS = 2;
const SCREEN_COLOR = [38, 146, 78];
const AUDIO_FREQUENCIES_HZ = Array.from({ length: PUBLISHER_COUNT }, (_, index) => 440 + index * 37);
const contexts = [];
const runtimeFolders = new Set();
const clients = [];
const startedAtMs = Date.now();
let activeMediaStartedAtMs = null;
let activeMediaFinishedAtMs = null;
let failure = null;

const report = {
  schemaVersion: 1,
  purpose: "Short local 10-page capacity feasibility flow: ten studio joins and chat interactions, nine simultaneous synthetic Opus publishers, one real nine-source WebCodecs/AudioWorklet receiver, and one synthetic VP8 screen share.",
  startedAt: new Date().toISOString(),
  status: "running",
  baseURL: target.origin,
  outputDirectory: relative(root, outputDirectory),
  runtime: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    firefox: "not-reported",
    headless: process.env.HEADLESS !== "0",
  },
  tls: {
    caCertificate: relative(root, caCertificate),
    trust: "Local CA imported into each isolated Firefox NSS profile; browser certificate errors are not ignored.",
    ignoreCertificateErrors: false,
    systemTrustChanged: false,
    applicationTransport: "trusted local HTTPS/WSS",
  },
  topology: {
    room: "studio",
    pages: PAGE_COUNT,
    browserProcesses: 0,
    isolatedFirefoxProfiles: PAGE_COUNT,
    applicationConnectionsExpected: PAGE_COUNT,
    publishers: PUBLISHER_COUNT,
    receiver: "CAP01-P10",
    publisherSubscriptions: 0,
    audioPattern: "nine publishers send to one receiver; no publisher subscribes, so this is not 9x9 mutual listening",
    activeMediaWindowBudgetMs: 45_000,
  },
  syntheticSources: {
    audio: "Each publisher gets a script-injected oscillator through AudioContext MediaStreamDestination and the normal application publish button.",
    audioFrequencyHz: AUDIO_FREQUENCIES_HZ,
    screen: "CAP01-P01 gets a script-injected animated canvas captureStream through the normal share button.",
    screenColorRgb: SCREEN_COLOR,
    nativePermissionPickerUsed: false,
    physicalMicrophoneSelected: false,
    physicalDisplaySelected: false,
    mediaPayloadsStored: false,
  },
  checks: [],
  publishers: [],
  interactions: { attempted: 0, acknowledged: 0 },
  receiver: null,
  screen: null,
  screenshots: [],
  traceOverflow: {
    controlTypes: 0,
    controlEvents: 0,
    generationBuckets: 0,
    pageErrors: 0,
    consoleErrors: 0,
    protocolErrors: 0,
    collectionErrors: 0,
  },
  privacy: {
    rawControlPayloadsRetained: false,
    chatTextRetained: false,
    rawMediaPayloadsRetained: false,
    mediaHashesRetained: false,
    cookiesOrPageStorageDumped: false,
    tokensPasswordsOrConfiguredSecretsReadOrRecorded: false,
  },
  limits: {
    physicalMicrophoneAndHumanListening: "not-tested; injected oscillators are synthetic and PCM proves browser worklet output only",
    physicalDisplayCapture: "not-tested; the shared source is an injected canvas",
    nineByNineMutualListening: "not-tested; the nine publishers do not subscribe",
    endToEndLatencyOrListeningQuality: "not-measured",
    cloudRunCapacityOrResourceUsage: "not-tested; browser metadata does not measure server CPU, memory, bandwidth, or Cloud Run limits",
    longDurationOrEndurance: "not-tested; this is a bounded short flow",
    mobileAndCrossDeviceUse: "not-tested",
    persistenceAndDeployment: "not-tested; attaches to the externally started local fixture",
    productCapacityManagementUi: "not-tested by this media script; covered separately by the local capacity admin flow",
    identity: "not-verified; CAP01 labels are synthetic page names, not people",
  },
  errors: {
    pageErrors: [],
    consoleErrors: [],
    protocolErrors: [],
    collectionErrors: [],
    cleanupErrors: [],
    failure: null,
  },
  cleanup: { profilesRemoved: 0, contextsClosed: 0 },
  durationMs: null,
  activeMediaDurationMs: null,
};

mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });

function elapsedMs() {
  return Date.now() - startedAtMs;
}

function incrementOverflow(kind) {
  report.traceOverflow[kind] = Number(report.traceOverflow[kind] ?? 0) + 1;
}

function boundedPush(array, value, cap, overflowKind) {
  if (array.length < cap) {
    array.push(value);
    return true;
  }
  incrementOverflow(overflowKind);
  return false;
}

function stage(name, details = {}) {
  if (report.checks.length >= 24) throw new Error("The bounded CAP01 stage cap was reached.");
  const item = { name, at: new Date().toISOString(), atMs: elapsedMs(), ...details };
  report.checks.push(item);
  console.log(`[CAP01] ${name}${Object.keys(details).length ? ` ${JSON.stringify(details)}` : ""}`);
}

function runCertutil(args) {
  execFileSync(certificateUtility, args, { stdio: "pipe" });
}

function createTrustedProfile(clientName) {
  const folder = join(outputDirectory, `${clientName.toLowerCase()}-runtime`);
  runtimeFolders.add(folder);
  rmSync(folder, { recursive: true, force: true });
  const profileDirectory = join(folder, "profile");
  mkdirSync(profileDirectory, { recursive: true, mode: 0o700 });
  runCertutil(["-N", "-d", `sql:${profileDirectory}`, "--empty-password"]);
  runCertutil(["-A", "-d", `sql:${profileDirectory}`, "-n", "LaiTse CAP01 local CA", "-t", "C,,", "-i", caCertificate]);
  const appData = join(folder, "app-data");
  const localAppData = join(folder, "local-app-data");
  mkdirSync(appData, { recursive: true, mode: 0o700 });
  mkdirSync(localAppData, { recursive: true, mode: 0o700 });
  return { folder, profileDirectory, appData, localAppData };
}

function browserEnvironment(profile) {
  const env = { ...process.env, MOZ_APP_DATA: profile.appData, MOZ_LOCAL_APP_DATA: profile.localAppData };
  for (const key of Object.keys(env)) {
    if (/(?:TOKEN|PASSWORD|SECRET|CREDENTIAL|API[_-]?KEY|DATABASE_URL|PGPASSWORD|COOKIE|AUTH|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|REFRESH[_-]?TOKEN)/iu.test(key)) delete env[key];
  }
  return env;
}

function safeCode(value) {
  return typeof value === "string" && /^[a-zA-Z0-9._-]{1,100}$/u.test(value) ? value : "unclassified";
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function countControl(client, type, direction = "received") {
  return client.wire.controlCounts[direction][type] ?? 0;
}

function recordControl(client, direction, payload) {
  let message;
  try { message = JSON.parse(payload); }
  catch {
    client.wire.invalidControlFrames += 1;
    return;
  }
  if (!message || typeof message !== "object" || Array.isArray(message)) return;
  const type = typeof message.type === "string" ? message.type.replace(/[^a-zA-Z0-9._-]/gu, "").slice(0, 80) || "unknown" : "unknown";
  const counts = client.wire.controlCounts[direction];
  if (!(type in counts) && Object.keys(counts).length >= MAX_CONTROL_TYPES_PER_PAGE) {
    incrementOverflow("controlTypes");
    return;
  }
  counts[type] = (counts[type] ?? 0) + 1;
  client.wire.controlFrames[direction] += 1;

  const event = { direction, atMs: elapsedMs(), type };
  if (message.roomId === "studio" || message.room?.id === "studio") event.roomId = "studio";
  if (type === "session.issued" || type === "session.resumed") {
    event.roomId = message.roomId === "studio" ? "studio" : null;
    event.mode = message.mode === "watch" || message.mode === "interaction" ? message.mode : null;
    event.role = message.role === "display" ? "display" : "participant";
  }
  if (type === "room.snapshot") {
    event.roomId = message.room?.id === "studio" ? "studio" : message.roomId === "studio" ? "studio" : null;
    event.memberCount = Array.isArray(message.members) ? message.members.length : 0;
  }
  if (/^(?:audio|screen)\.(?:started|stopped|stream|streamEnded|subscribed|error)$/u.test(type)) {
    if (Number.isInteger(message.generation)) event.generation = message.generation;
    if (type === "audio.subscribed" && Array.isArray(message.streams)) {
      event.streamGenerations = message.streams
        .filter((stream) => Number.isInteger(stream?.generation))
        .map((stream) => stream.generation)
        .slice(0, PUBLISHER_COUNT + 2);
    }
  }
  if (/error$/u.test(type) || type === "error") {
    event.code = safeCode(message.code);
    client.wire.protocolErrors[event.code] = (client.wire.protocolErrors[event.code] ?? 0) + 1;
    boundedPush(report.errors.protocolErrors, { client: client.name, type, code: event.code, atMs: event.atMs }, 80, "protocolErrors");
  }
  if (type === "interaction.ack") event.duplicate = message.duplicate === true;
  if (type === "participation.self") {
    event.mode = message.mode === "watch" || message.mode === "interaction" ? message.mode : null;
    event.audioSubscribed = message.media?.audio?.subscribed === true;
    event.screenSubscribed = message.media?.screen?.subscribed === true;
  }

  const relevant = type === "session.issued" || type === "session.resumed" || type === "room.snapshot" ||
    type === "interaction.submit" || type === "interaction.ack" || type === "audio.subscribe" || type === "audio.started" || type === "audio.stopped" ||
    type === "audio.stream" || type === "audio.streamEnded" || type === "audio.subscribed" ||
    type === "audio.error" || type === "screen.subscribe" || type === "screen.started" || type === "screen.stopped" ||
    type === "screen.stream" || type === "screen.subscribed" || type === "screen.error" ||
    type === "participation.self" || /error$/u.test(type) || type === "error";
  if (relevant) boundedPush(client.wire.events, event, MAX_CONTROL_EVENTS_PER_PAGE, "controlEvents");
}

function mediaBytes(payload) {
  if (Buffer.isBuffer(payload)) return payload;
  if (payload instanceof Uint8Array) return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  if (payload instanceof ArrayBuffer) return Buffer.from(payload);
  return null;
}

function recordPacket(client, direction, payload) {
  const bytes = mediaBytes(payload);
  if (!bytes || bytes.byteLength < 12) {
    client.wire.otherBinaryFrames[direction] += 1;
    return;
  }
  const magic = bytes.toString("ascii", 0, 4);
  const channel = magic === "LTA1" ? "audio" : magic === "LTS1" ? "screen" : null;
  if (!channel) {
    client.wire.otherBinaryFrames[direction] += 1;
    return;
  }
  const totals = client.wire.packets[direction][channel];
  totals.frames += 1;
  totals.bytes += bytes.byteLength;
  const generation = bytes.readUInt32BE(4);
  const key = String(generation);
  if (!(key in totals.byGeneration) && Object.keys(totals.byGeneration).length >= MAX_GENERATION_BUCKETS_PER_PAGE_CHANNEL) {
    incrementOverflow("generationBuckets");
    return;
  }
  const sequence = bytes.readUInt32BE(8);
  const bucket = totals.byGeneration[key] ?? { generation, frames: 0, bytes: 0, firstSequence: sequence, lastSequence: sequence };
  bucket.frames += 1;
  bucket.bytes += bytes.byteLength;
  bucket.lastSequence = sequence;
  totals.byGeneration[key] = bucket;
}

function recordFrame(client, direction, payload) {
  if (typeof payload === "string") recordControl(client, direction, payload);
  else recordPacket(client, direction, payload);
}

function noteCollectionError(client, code) {
  client.wire.collectionErrors += 1;
  boundedPush(report.errors.collectionErrors, { client: client?.name ?? "setup", code: safeCode(code), atMs: elapsedMs() }, 60, "collectionErrors");
}

function newClient(index) {
  const name = `CAP01-P${String(index + 1).padStart(2, "0")}`;
  return {
    index,
    name,
    page: null,
    context: null,
    profile: null,
    wire: {
      connections: 0,
      controlFrames: { sent: 0, received: 0 },
      controlCounts: { sent: {}, received: {} },
      events: [],
      invalidControlFrames: 0,
      protocolErrors: {},
      collectionErrors: 0,
      otherBinaryFrames: { sent: 0, received: 0 },
      packets: {
        sent: { audio: { frames: 0, bytes: 0, byGeneration: {} }, screen: { frames: 0, bytes: 0, byGeneration: {} } },
        received: { audio: { frames: 0, bytes: 0, byGeneration: {} }, screen: { frames: 0, bytes: 0, byGeneration: {} } },
      },
    },
  };
}

function connectWebSocketRoute(client, route) {
  client.wire.connections += 1;
  if (client.wire.connections > MAX_CONNECTIONS_PER_PAGE) {
    noteCollectionError(client, "websocket_connection_cap_reached");
    void route.close({ code: 1013, reason: "CAP01 bounded connection cap" }).catch(() => {});
    return;
  }
  const serverRoute = route.connectToServer();
  route.onMessage((payload) => {
    try { recordFrame(client, "sent", payload); }
    catch { noteCollectionError(client, "outbound_frame_observation_failed"); }
    serverRoute.send(payload);
  });
  serverRoute.onMessage((payload) => {
    try { recordFrame(client, "received", payload); }
    catch { noteCollectionError(client, "inbound_frame_observation_failed"); }
    route.send(payload);
  });
}

async function installWebSocketRoute(client) {
  await client.page.routeWebSocket(/\/ws(?:\?|$)/u, (route) => connectWebSocketRoute(client, route));
}

async function installSyntheticMedia(client) {
  const frequency = AUDIO_FREQUENCIES_HZ[client.index];
  const color = SCREEN_COLOR;
  await client.page.addInitScript(({ frequency, color }) => {
    const state = { contexts: [], tracks: [], oscillators: [], animationFrameId: null };
    Object.defineProperty(window, "__cap01SyntheticMedia", { value: state, configurable: false });
    const devices = navigator.mediaDevices;
    Object.defineProperty(devices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const context = new AudioContext({ sampleRate: 48_000 });
        await context.resume();
        const destination = context.createMediaStreamDestination();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.value = 0.24;
        oscillator.connect(gain).connect(destination);
        oscillator.start();
        state.contexts.push(context);
        state.oscillators.push(oscillator);
        state.tracks.push(...destination.stream.getTracks());
        return destination.stream;
      },
    });
    Object.defineProperty(devices, "getDisplayMedia", {
      configurable: true,
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 180;
        const drawing = canvas.getContext("2d", { alpha: false });
        if (!drawing) throw new Error("CAP01 synthetic screen canvas could not be created.");
        let active = true;
        let phase = 0;
        const render = () => {
          if (!active) return;
          drawing.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
          drawing.fillRect(0, 0, canvas.width, canvas.height);
          drawing.fillStyle = "#fff";
          drawing.fillRect(12 + (phase % 72), 12, 24, 12);
          phase += 3;
          state.animationFrameId = requestAnimationFrame(render);
        };
        render();
        const stream = canvas.captureStream(10);
        const track = stream.getVideoTracks()[0];
        if (!track) throw new Error("CAP01 synthetic screen canvas produced no video track.");
        state.tracks.push(track);
        const originalStop = track.stop.bind(track);
        track.stop = () => {
          active = false;
          originalStop();
        };
        return stream;
      },
    });
    state.stopAll = async () => {
      if (state.animationFrameId !== null) cancelAnimationFrame(state.animationFrameId);
      for (const track of state.tracks) {
        try { track.stop(); } catch { /* Best-effort synthetic media cleanup. */ }
      }
      for (const oscillator of state.oscillators) {
        try { oscillator.stop(); } catch { /* An already stopped oscillator is harmless. */ }
      }
      await Promise.all(state.contexts.map((context) => context.close().catch(() => {})));
    };
  }, { frequency, color });
}

function setupPageDiagnostics(client) {
  client.page.on("pageerror", (error) => {
    boundedPush(report.errors.pageErrors, {
      client: client.name,
      atMs: elapsedMs(),
      message: String(error?.message ?? error).replace(/[\r\n\t]+/gu, " ").slice(0, 240),
    }, 40, "pageErrors");
  });
  client.page.on("console", (message) => {
    if (message.type() !== "error") return;
    boundedPush(report.errors.consoleErrors, {
      client: client.name,
      atMs: elapsedMs(),
      message: message.text().replace(/[\r\n\t]+/gu, " ").slice(0, 240),
    }, 40, "consoleErrors");
  });
}

async function launchClient(index) {
  const client = newClient(index);
  const profile = createTrustedProfile(client.name);
  const context = await firefox.launchPersistentContext(profile.profileDirectory, {
    headless: process.env.HEADLESS !== "0",
    env: browserEnvironment(profile),
    viewport: { width: 1360, height: 1000 },
    colorScheme: "light",
    firefoxUserPrefs: { "security.enterprise_roots.enabled": false },
  });
  context.setDefaultTimeout(NORMAL_TIMEOUT_MS);
  const page = context.pages()[0] ?? await context.newPage();
  client.profile = profile;
  client.context = context;
  client.page = page;
  clients.push(client);
  contexts.push(context);
  setupPageDiagnostics(client);
  await installWebSocketRoute(client);
  if (index < PUBLISHER_COUNT) await installSyntheticMedia(client);
  return client;
}

function clientEvents(client, type, direction = "received") {
  return client.wire.events.filter((event) => event.type === type && event.direction === direction);
}

async function waitFor(predicate, label, timeoutMs = NORMAL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  const suffix = lastError ? `; last probe error: ${String(lastError.message ?? lastError).slice(0, 160)}` : "";
  throw new Error(`${label} was not observed within ${timeoutMs} ms${suffix}.`);
}

async function waitForControl(client, type, { direction = "received", after = 0, predicate = () => true, timeoutMs = NORMAL_TIMEOUT_MS } = {}) {
  return waitFor(() => clientEvents(client, type, direction).slice(after).find(predicate) ?? null, `${client.name} ${direction} ${type}`, timeoutMs);
}

async function waitForJoined(client) {
  const issued = await waitForControl(client, "session.issued", { predicate: (event) => event.roomId === "studio" });
  const snapshot = await waitForControl(client, "room.snapshot", { predicate: (event) => event.roomId === "studio" });
  assert.equal(issued.mode, "watch", `${client.name} should join in watch mode.`);
  assert.ok(snapshot.memberCount >= 1, `${client.name} should observe a studio member snapshot.`);
  await client.page.waitForFunction(() => {
    const panel = document.querySelector('[data-testid="audio-panel"]');
    const connection = document.querySelector('[data-testid="control-connection-status"]');
    return panel?.getAttribute("data-room-id") === "studio" && /Connected/u.test(connection?.textContent ?? "");
  }, undefined, { timeout: NORMAL_TIMEOUT_MS });
  await client.page.locator('[data-testid="audio-panel"]').waitFor({ state: "visible" });
  await client.page.locator('[data-testid="screen-panel"]').waitFor({ state: "visible" });
  return snapshot;
}

async function joinStudio(client) {
  await client.page.goto(`${target.origin}/?room=studio&mode=watch`, { waitUntil: "domcontentloaded" });
  await client.page.getByRole("heading", { name: "Local room presence" }).waitFor();
  await client.page.getByLabel("Your display name").fill(client.name);
  await client.page.getByRole("button", { name: "Join room" }).click();
  const snapshot = await waitForJoined(client);
  return snapshot;
}

async function submitInteraction(client) {
  const sentBefore = countControl(client, "interaction.submit", "sent");
  const ackBefore = countControl(client, "interaction.ack", "received");
  const text = `CAP01 short interaction ${String(client.index + 1).padStart(2, "0")}`;
  await client.page.getByTestId("chat-input").fill(text);
  await client.page.getByTestId("chat-send").click();
  await waitForControl(client, "interaction.submit", { direction: "sent", after: sentBefore });
  await waitForControl(client, "interaction.ack", { direction: "received", after: ackBefore });
  assert.equal(countControl(client, "interaction.submit", "sent") - sentBefore, 1, `${client.name} should submit one UI interaction.`);
}

function generationBucket(client, direction, channel, generation) {
  return client.wire.packets[direction][channel].byGeneration[String(generation)] ?? null;
}

async function startPublishingAudio(client) {
  const startedBefore = countControl(client, "audio.started", "received");
  await client.page.locator('[data-testid="audio-start-publishing"]').click();
  const started = await waitForControl(client, "audio.started", { after: startedBefore });
  assert.ok(Number.isInteger(started.generation), `${client.name} audio.started should expose a source generation.`);
  const sent = await waitFor(() => generationBucket(client, "sent", "audio", started.generation), `${client.name} outgoing audio packet metadata`, MEDIA_TIMEOUT_MS);
  await waitFor(() => sent.frames >= 6 ? true : null, `${client.name} initial audio packets`, MEDIA_TIMEOUT_MS);
  await client.page.waitForFunction(() => document.querySelector('[data-testid="audio-panel"]')?.getAttribute("data-publisher-state") === "broadcasting", undefined, { timeout: MEDIA_TIMEOUT_MS });
  return { generation: started.generation, sentFramesAtStart: sent.frames };
}

function parseAudioRows(value) {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((source) => source && Number.isInteger(source.generation)).map((source) => ({
      generation: source.generation,
      active: source.active === true,
      clockId: typeof source.clockId === "string" ? source.clockId : "",
      receivedPackets: numeric(source.receivedPackets),
      decodedFrames: numeric(source.decodedFrames),
      renderedPcmSamples: numeric(source.renderedPcmSamples),
      queuedSamples: numeric(source.queuedSamples),
      renderRms: numeric(source.renderRms),
      packetGapCount: numeric(source.packetGapCount),
      queueStaleDropBatches: numeric(source.queueStaleDropBatches),
      queueOversizeDropBatches: numeric(source.queueOversizeDropBatches),
      decodeQueueDroppedPackets: numeric(source.decodeQueueDroppedPackets),
      error: typeof source.error === "string" ? source.error.slice(0, 120) : "",
    }));
  } catch {
    return [];
  }
}

async function readAudioSources(client) {
  const raw = await client.page.locator('[data-testid="audio-panel"]').getAttribute("data-audio-streams");
  return parseAudioRows(raw);
}

async function waitForAudioSources(client, generations) {
  const expected = new Set(generations);
  return waitFor(async () => {
    const rows = (await readAudioSources(client)).filter((row) => row.active);
    const matching = rows.filter((row) => expected.has(row.generation));
    if (rows.length !== expected.size || matching.length !== expected.size) return null;
    if (!matching.every((row) => row.receivedPackets > 0 && row.decodedFrames > 0 && row.renderedPcmSamples > 0 && row.renderRms > 0 && !row.error)) return null;
    return rows;
  }, `${client.name} nine active source AudioWorklet PCM rows`, MEDIA_TIMEOUT_MS);
}

async function readReceiverSummary(client) {
  return client.page.evaluate(() => {
    const panel = document.querySelector('[data-testid="audio-panel"]');
    const attrs = [
      "data-queue-stale-drop-batches",
      "data-queue-oversize-drop-batches",
      "data-audio-decode-queue-high-water",
      "data-audio-decode-queue-saturation-stops",
      "data-queue-overflow-resets",
      "data-packet-gap-count",
      "data-receiver-buffer-ms",
    ];
    const values = Object.fromEntries(attrs.map((name) => [name, Number(panel?.getAttribute(name) ?? 0)]));
    return {
      receiverSubscribed: panel?.getAttribute("data-receiver-subscribed") === "true",
      activeSourceCount: Number(panel?.getAttribute("data-audio-active-stream-count") ?? 0),
      receivedPackets: Number(panel?.getAttribute("data-received-packets") ?? 0),
      decodedFrames: Number(panel?.getAttribute("data-decoded-frames") ?? 0),
      renderedSamples: Number(panel?.getAttribute("data-rendered-samples") ?? 0),
      renderRms: Number(panel?.getAttribute("data-render-rms") ?? 0),
      queueStaleDropBatches: Number(values["data-queue-stale-drop-batches"] ?? 0),
      queueOversizeDropBatches: Number(values["data-queue-oversize-drop-batches"] ?? 0),
      decodeQueueHighWater: Number(values["data-audio-decode-queue-high-water"] ?? 0),
      decodeQueueSaturationStops: Number(values["data-audio-decode-queue-saturation-stops"] ?? 0),
      decodeQueueDroppedPackets: Number(panel?.querySelector('[data-testid="audio-decode-queue-dropped-packets"]')?.textContent ?? 0),
      queueOverflowResets: Number(values["data-queue-overflow-resets"] ?? 0),
      packetGapCount: Number(values["data-packet-gap-count"] ?? 0),
      receiverBufferMs: Number(values["data-receiver-buffer-ms"] ?? 0),
    };
  });
}

function readScreenSnapshot(client) {
  return client.page.evaluate(() => {
    const panel = document.querySelector('[data-testid="screen-panel"]');
    const canvas = panel?.querySelector('[data-testid="screen-preview"]');
    let centerPixel = null;
    if (canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0) {
      try {
        const context = canvas.getContext("2d");
        if (context) centerPixel = [...context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data];
      } catch { centerPixel = null; }
    }
    return {
      publisherState: panel?.getAttribute("data-publisher-state") ?? "missing",
      receiverState: panel?.getAttribute("data-receiver-state") ?? "missing",
      receiverSubscribed: panel?.getAttribute("data-receiver-subscribed") === "true",
      receivedFrames: Number(panel?.getAttribute("data-received-frames") ?? 0),
      decodedFrames: Number(panel?.getAttribute("data-decoded-frames") ?? 0),
      renderedFrames: Number(panel?.getAttribute("data-rendered-frames") ?? 0),
      width: Number(panel?.getAttribute("data-rendered-width") ?? 0),
      height: Number(panel?.getAttribute("data-rendered-height") ?? 0),
      decodeQueueHighWater: Number(panel?.getAttribute("data-decode-queue-high-water") ?? 0),
      droppedDecodedFrames: Number(panel?.getAttribute("data-dropped-decoded-frames") ?? 0),
      residenceDrops: Number(panel?.getAttribute("data-queued-decoded-frame-residence-drops") ?? 0),
      centerPixel,
    };
  });
}

function assertScreenColor(actual, expected) {
  assert.ok(Array.isArray(actual) && actual.length >= 3, "The receiver should expose a readable decoded screen canvas pixel.");
  const difference = Math.max(...expected.map((channel, index) => Math.abs(channel - actual[index])));
  assert.ok(difference <= 48, `The screen receiver should display the injected canvas color; got ${actual}.`);
}

async function capturePanel(client, testId, filename) {
  if (report.screenshots.length >= MAX_SCREENSHOTS) return;
  const locator = client.page.locator(`[data-testid="${testId}"]`);
  if (!(await locator.count()) || !(await locator.isVisible())) return;
  const path = join(outputDirectory, filename);
  await locator.screenshot({ path, animations: "disabled", timeout: 3_000 });
  report.screenshots.push(filename);
}

async function saveFailureScreenshots() {
  const receiver = clients.at(-1);
  if (!receiver || receiver.page.isClosed()) return;
  for (const [testId, filename] of [["audio-panel", "receiver-audio-failure.png"], ["screen-panel", "receiver-screen-failure.png"]]) {
    if (report.screenshots.length >= MAX_SCREENSHOTS) break;
    try { await capturePanel(receiver, testId, filename); }
    catch { /* Keep the original failure if screenshot capture is unavailable. */ }
  }
}

async function startListening(client, generations) {
  const sentBefore = countControl(client, "audio.subscribe", "sent");
  const subscribedBefore = countControl(client, "audio.subscribed", "received");
  const streamsBefore = countControl(client, "audio.stream", "received");
  await client.page.locator('[data-testid="audio-start-listening"]').click();
  await waitForControl(client, "audio.subscribe", { direction: "sent", after: sentBefore });
  await waitForControl(client, "audio.subscribed", { after: subscribedBefore });
  await waitFor(() => {
    const announced = new Set(clientEvents(client, "audio.stream").slice(streamsBefore).map((event) => event.generation));
    return generations.every((generation) => announced.has(generation)) ? true : null;
  }, `${client.name} receives all nine audio stream announcements`, MEDIA_TIMEOUT_MS);
}

async function startScreenShare(publisher) {
  const before = countControl(publisher, "screen.started", "received");
  await publisher.page.getByRole("button", { name: "開始分享畫面" }).click();
  const started = await waitForControl(publisher, "screen.started", { after: before });
  assert.ok(Number.isInteger(started.generation), "The screen publisher should expose a source generation.");
  await publisher.page.waitForFunction(() => document.querySelector('[data-testid="screen-panel"]')?.getAttribute("data-publisher-state") === "sharing", undefined, { timeout: MEDIA_TIMEOUT_MS });
  await waitFor(() => generationBucket(publisher, "sent", "screen", started.generation), `${publisher.name} outgoing VP8 packet metadata`, MEDIA_TIMEOUT_MS);
  return started;
}

async function startWatchingScreen(receiver) {
  const sentBefore = countControl(receiver, "screen.subscribe", "sent");
  const subscribedBefore = countControl(receiver, "screen.subscribed", "received");
  const streamsBefore = countControl(receiver, "screen.stream", "received");
  await receiver.page.locator('[data-testid="screen-start-watching"]').click();
  await waitForControl(receiver, "screen.subscribe", { direction: "sent", after: sentBefore });
  await waitForControl(receiver, "screen.subscribed", { after: subscribedBefore });
  return await waitForControl(receiver, "screen.stream", { after: streamsBefore, timeoutMs: MEDIA_TIMEOUT_MS });
}

async function runSmoke() {
  assert.ok(readFileSync(caCertificate).byteLength > 0, "The local CA certificate must exist and be non-empty.");
  for (let index = 0; index < PAGE_COUNT; index += 1) await launchClient(index);
  report.runtime.firefox = contexts[0]?.browser()?.version() ?? "not-reported";
  report.topology.browserProcesses = contexts.length;

  const joinSnapshots = [];
  for (const client of clients) joinSnapshots.push(await joinStudio(client));
  const finalMemberCount = joinSnapshots.at(-1)?.memberCount ?? 0;
  assert.equal(finalMemberCount, PAGE_COUNT, `The last join snapshot should contain all ${PAGE_COUNT} studio pages.`);
  stage("ten-real-firefox-pages-joined-studio", { pages: clients.length, browserProcesses: contexts.length, isolatedFirefoxProfiles: runtimeFolders.size, finalMemberCount });

  for (const client of clients) {
    report.interactions.attempted += 1;
    await submitInteraction(client);
    report.interactions.acknowledged += 1;
  }
  assert.equal(report.interactions.acknowledged, PAGE_COUNT, "Every studio page should receive the acknowledgement for one UI chat interaction.");
  stage("all-pages-completed-one-ui-interaction", { attempted: report.interactions.attempted, acknowledged: report.interactions.acknowledged });

  activeMediaStartedAtMs = Date.now();
  const sourceGenerations = [];
  for (const client of clients.slice(0, PUBLISHER_COUNT)) {
    const started = await startPublishingAudio(client);
    sourceGenerations.push(started.generation);
    report.publishers.push({
      client: client.name,
      generation: started.generation,
      audioFramesAtStart: started.sentFramesAtStart,
    });
  }
  assert.equal(new Set(sourceGenerations).size, PUBLISHER_COUNT, "All nine publishers should receive unique server generations.");
  for (const client of clients.slice(0, PUBLISHER_COUNT)) {
    assert.equal(client.wire.packets.received.audio.frames, 0, `${client.name} must not subscribe to or receive publisher audio.`);
  }
  report.publishers = report.publishers.map((publisher, index) => ({
    client: publisher.client,
    generation: publisher.generation,
    audioFramesAtStart: publisher.audioFramesAtStart,
    audioFramesBeforeReceiver: generationBucket(clients[index], "sent", "audio", publisher.generation)?.frames ?? 0,
    receiver: clients.at(-1).name,
  }));
  report.topology.publisherSubscriptions = 0;
  stage("nine-synthetic-opus-publishers-active-without-publisher-subscriptions", {
    publishers: report.publishers.map(({ client, generation, audioFramesBeforeReceiver }) => ({ client, generation, audioFramesBeforeReceiver })),
    receiverSubscriptions: 0,
  });

  const receiver = clients.at(-1);
  await startListening(receiver, sourceGenerations);
  const audioRowsBefore = await waitForAudioSources(receiver, sourceGenerations);
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  const audioRowsAfter = await waitForAudioSources(receiver, sourceGenerations);
  for (const generation of sourceGenerations) {
    const before = audioRowsBefore.find((row) => row.generation === generation);
    const after = audioRowsAfter.find((row) => row.generation === generation);
    assert.ok(after.renderedPcmSamples > before.renderedPcmSamples, `AudioWorklet PCM for generation ${generation} should advance during the observation window.`);
    assert.ok(generationBucket(receiver, "received", "audio", generation)?.frames > 0, `The receiver should observe actual audio packets for generation ${generation}.`);
  }
  const receiverAudio = await readReceiverSummary(receiver);
  assert.equal(receiverAudio.receiverSubscribed, true, "The receiver should hold active audio subscription intent.");
  assert.equal(receiverAudio.activeSourceCount, PUBLISHER_COUNT, "The receiver should have nine active audio source rows.");
  assert.equal(receiverAudio.queueOverflowResets, 0, "The receiver must not reset an overflowing PCM queue.");
  assert.equal(receiverAudio.queueOversizeDropBatches, 0, "The receiver must not drop oversized PCM queue batches.");
  assert.equal(receiverAudio.decodeQueueSaturationStops, 0, "The receiver must not stop a decoder due to queue saturation.");
  assert.ok(audioRowsAfter.every((row) => row.queueOversizeDropBatches === 0 && !row.error), "No active source may report an oversized queue drop or decode error.");
  report.receiver = {
    client: receiver.name,
    uniqueAudioGenerations: sourceGenerations,
    audioSubscription: true,
    perSource: audioRowsAfter,
    aggregate: receiverAudio,
    localDecodeDropsDuringObservationWindow: audioRowsAfter.reduce((sum, row) => sum + row.decodeQueueDroppedPackets - (audioRowsBefore.find((before) => before.generation === row.generation)?.decodeQueueDroppedPackets ?? 0), 0),
    ingressFramesByGeneration: Object.fromEntries(sourceGenerations.map((generation) => [generation, generationBucket(receiver, "received", "audio", generation)?.frames ?? 0])),
  };
  stage("receiver-has-nine-webcodecs-opus-sources-and-nine-advancing-audioworklet-pcm-outputs", {
    sources: audioRowsAfter.map(({ generation, receivedPackets, decodedFrames, renderedPcmSamples, renderRms, packetGapCount }) => ({ generation, receivedPackets, decodedFrames, renderedPcmSamples, renderRms, packetGapCount })),
    queueOverflowResets: receiverAudio.queueOverflowResets,
    oversizedQueueDrops: receiverAudio.queueOversizeDropBatches,
    decoderSaturationStops: receiverAudio.decodeQueueSaturationStops,
  });

  const screenPublisher = clients[0];
  const screenStarted = await startScreenShare(screenPublisher);
  const screenSubscribed = await startWatchingScreen(receiver);
  assert.equal(screenSubscribed.generation, screenStarted.generation, "The receiver should subscribe to the one published screen generation.");
  await waitFor(() => generationBucket(receiver, "received", "screen", screenStarted.generation)?.frames >= 3, "receiver screen binary frames", MEDIA_TIMEOUT_MS);
  await receiver.page.waitForFunction(() => {
    const panel = document.querySelector('[data-testid="screen-panel"]');
    const canvas = panel?.querySelector('[data-testid="screen-preview"]');
    return Number(panel?.getAttribute("data-rendered-frames") ?? 0) >= 3 && canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0;
  }, undefined, { timeout: MEDIA_TIMEOUT_MS });
  const screenSnapshot = await readScreenSnapshot(receiver);
  assert.equal(screenSnapshot.receiverSubscribed, true, "The receiver should subscribe to the screen share.");
  assert.ok(screenSnapshot.receivedFrames > 0 && screenSnapshot.decodedFrames > 0 && screenSnapshot.renderedFrames >= 3, "The receiver must receive, decode, and render screen frames.");
  assert.ok(screenSnapshot.width > 0 && screenSnapshot.height > 0, "The rendered screen should expose non-zero dimensions.");
  assertScreenColor(screenSnapshot.centerPixel, SCREEN_COLOR);
  report.screen = {
    publisher: screenPublisher.name,
    receiver: receiver.name,
    generation: screenStarted.generation,
    publisherFrames: generationBucket(screenPublisher, "sent", "screen", screenStarted.generation)?.frames ?? 0,
    receiverFrames: generationBucket(receiver, "received", "screen", screenStarted.generation)?.frames ?? 0,
    rendered: screenSnapshot,
  };
  await capturePanel(receiver, "audio-panel", "receiver-nine-audio-sources.png");
  await capturePanel(receiver, "screen-panel", "receiver-one-screen-share.png");
  stage("one-synthetic-screen-share-was-decoded-and-rendered", {
    generation: screenStarted.generation,
    publisher: screenPublisher.name,
    receiver: receiver.name,
    receivedFrames: screenSnapshot.receivedFrames,
    decodedFrames: screenSnapshot.decodedFrames,
    renderedFrames: screenSnapshot.renderedFrames,
    dimensions: [screenSnapshot.width, screenSnapshot.height],
    centerPixel: screenSnapshot.centerPixel,
  });

  for (const client of clients.slice(0, PUBLISHER_COUNT)) {
    const stop = client.page.locator('[data-testid="audio-stop-publishing"]');
    if (await stop.count() && await stop.isVisible()) await stop.click();
  }
  const stopScreen = screenPublisher.page.getByRole("button", { name: "停止分享" });
  if (await stopScreen.count() && await stopScreen.isVisible()) await stopScreen.click();
  report.publishers = report.publishers.map((publisher, index) => ({
    ...publisher,
    audioFramesTotal: generationBucket(clients[index], "sent", "audio", publisher.generation)?.frames ?? 0,
  }));

  for (const client of clients) {
    assert.equal(client.wire.collectionErrors, 0, `${client.name} WebSocket metadata observation must not fail.`);
    assert.equal(client.wire.invalidControlFrames, 0, `${client.name} must not receive malformed control frames.`);
  }
  assert.equal(report.traceOverflow.controlTypes + report.traceOverflow.controlEvents + report.traceOverflow.generationBuckets, 0, "All bounded metadata collectors must remain below their caps.");
  assert.equal(report.traceOverflow.pageErrors + report.traceOverflow.consoleErrors + report.traceOverflow.protocolErrors + report.traceOverflow.collectionErrors, 0, "Error collectors must not overflow.");
  assert.deepEqual(report.errors.pageErrors, [], "No unhandled page errors should occur.");
  assert.deepEqual(report.errors.consoleErrors, [], "No browser console errors should occur.");
  assert.deepEqual(report.errors.protocolErrors, [], "No application protocol errors should occur.");
  activeMediaFinishedAtMs = Date.now();
}

async function cleanupSyntheticPage(client) {
  if (!client.page || client.page.isClosed()) return;
  try { await client.page.evaluate(async () => await window.__cap01SyntheticMedia?.stopAll?.()); }
  catch { /* The page may already be closing. */ }
}

async function writeReport() {
  report.finishedAt = new Date().toISOString();
  report.durationMs = elapsedMs();
  report.activeMediaDurationMs = activeMediaStartedAtMs === null ? null : Math.max(0, (activeMediaFinishedAtMs ?? Date.now()) - activeMediaStartedAtMs);
  report.status = failure ? "failed" : "passed";
  report.errors.failure = failure ? String(failure.stack ?? failure).slice(0, 2_000) : null;
  report.clients = clients.map((client) => ({
    name: client.name,
    connections: client.wire.connections,
    controlFrames: client.wire.controlFrames,
    controlCounts: client.wire.controlCounts,
    relevantControls: client.wire.events,
    invalidControlFrames: client.wire.invalidControlFrames,
    protocolErrors: client.wire.protocolErrors,
    otherBinaryFrames: client.wire.otherBinaryFrames,
    packets: client.wire.packets,
  }));
  writeFileSync(join(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(outputDirectory, "README.md"), [
    "# POC-CAP-01 browser smoke",
    "",
    `Status: ${report.status}`,
    `Started: ${report.startedAt}`,
    `Finished: ${report.finishedAt}`,
    `Topology: ${PAGE_COUNT} isolated Firefox processes and NSS profiles, ${PAGE_COUNT} studio pages, nine audio publishers, one receiver, and one screen share.`,
    "",
    "The browser interactions use the application UI. Audio oscillators and the animated canvas are injected into test pages only; no physical microphone, native display picker, real display, or human listening claim is involved.",
    "",
    "Nine publishers do not subscribe to audio. The single receiver checks per-generation Opus packet arrival and the application's per-source WebCodecs decode and AudioWorklet PCM/RMS counters. This is not 9x9 mutual listening.",
    "",
    "The report stores bounded control summaries and binary packet counters/generations/sequence metadata only. It does not retain control payloads, chat text, media payloads, hashes, browser storage, tokens, or passwords.",
    "",
    "This short local flow does not establish Cloud Run capacity, server resource use, endurance, p95 latency, phones, physical microphones/displays, human listening quality, or product capacity-management behavior.",
    "",
    failure ? `Failure: ${String(failure.stack ?? failure).slice(0, 1_000)}` : "Failure: none",
    "",
  ].join("\n"), { mode: 0o600 });
}

try {
  await runSmoke();
} catch (error) {
  failure = error;
  try { const receiver = clients.at(-1); if (receiver?.page) report.receiverAtFailure = { perSource: await readAudioSources(receiver), aggregate: await readReceiverSummary(receiver) }; } catch { /* Preserve the original failure. */ }
  console.error(`[CAP01] failure ${String(error?.stack ?? error).slice(0, 1_200)}`);
} finally {
  if (failure) await saveFailureScreenshots();
  for (const client of clients) await cleanupSyntheticPage(client);
  for (const context of contexts) {
    try {
      await context.close();
      report.cleanup.contextsClosed += 1;
    } catch (error) {
      boundedPush(report.errors.cleanupErrors, { code: "firefox_context_close_failed", message: String(error?.message ?? error).slice(0, 240) }, 30, "collectionErrors");
    }
  }
  for (const folder of runtimeFolders) {
    try {
      rmSync(folder, { recursive: true, force: true });
      report.cleanup.profilesRemoved += 1;
    } catch (error) {
      boundedPush(report.errors.cleanupErrors, { code: "isolated_profile_cleanup_failed", message: String(error?.message ?? error).slice(0, 240) }, 30, "collectionErrors");
    }
  }
  if (report.errors.cleanupErrors.length > 0 && !failure) failure = new Error("One or more Firefox profiles or contexts could not be cleaned up.");
  try { await writeReport(); }
  catch (error) {
    console.error(`[CAP01] could not save report: ${String(error?.message ?? error)}`);
    if (!failure) failure = error;
  }
}

if (failure) process.exitCode = 1;
