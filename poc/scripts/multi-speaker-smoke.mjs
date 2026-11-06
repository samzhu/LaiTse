import { enterRepositoryRootForLegacyScript, repositoryRoot, pocRoot } from "./lib/project-paths.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

enterRepositoryRootForLegacyScript();

const root = repositoryRoot;
const scratchRoot = resolve(root, ".scratch/ma01");
const outputDirectory = resolve(root, process.env.MA01_OUTPUT_DIR ?? ".scratch/ma01/browser");
const outputRelative = relative(scratchRoot, outputDirectory);
if (isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(`..${sep}`)) {
  throw new Error("MA01_OUTPUT_DIR must stay inside .scratch/ma01.");
}
if (process.version !== "v26.13.0") {
  throw new Error("Use the repository-pinned Node v26.13.0 runtime for this smoke.");
}

const baseURL = process.env.MA01_BASE_URL ?? `https://localhost:${process.env.PORT ?? "4173"}/`;
const target = new URL(baseURL);
if (target.protocol !== "https:" || target.username || target.password || target.search || target.hash || target.pathname !== "/") {
  throw new Error("MA01_BASE_URL must be a trusted HTTPS application root without credentials, query, or fragment.");
}
const caCertificate = resolve(root, process.env.MA01_CA_CERT ?? ".scratch/t01/tls/local-ca.pem");
const certificateUtility = process.env.CERTUTIL_BIN ?? "certutil";
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, ".tools/playwright-browsers");
const { firefox } = await import("playwright");

const NORMAL_TIMEOUT_MS = 8_000;
const RECONNECT_TIMEOUT_MS = 15_000;
const RENDER_TIMEOUT_MS = 8_000;
const RAW_PACKET_RECORD_CAP = 10_000;
const CONTROL_RECORD_CAP = 180;
const CONNECTION_CAP = 6;
const MAX_CLIENT_CONTROL_RECORDS = 600;
const MAX_PAGE_ERRORS = 12;
const MAX_SCREENSHOTS = 2;
const CLOSE_CODE = 4000;
const SCREEN_COLORS = {
  A: [38, 184, 92],
  B: [224, 52, 46],
};
const AUDIO_FREQUENCIES_HZ = { A: 523, B: 997 };
const CLIENT_NAMES = { A: "MA01-A", B: "MA01-B", C: "MA01-C", D: "MA01-D" };
const contexts = [];
const runtimeFolders = new Set();
const clients = new Map();
const startedAtMs = Date.now();
let activeMediaStartedAtMs = null;
let activeMediaFinishedAtMs = null;
let failure = null;

mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });

const report = {
  schemaVersion: 1,
  purpose: "Short four-Firefox synthetic multi-speaker smoke for per-source Opus playback, recovery, room isolation, and single-screen ownership.",
  startedAt: new Date().toISOString(),
  status: "running",
  baseURL: target.origin,
  outputDirectory: relative(root, outputDirectory),
  runtime: { node: process.version, platform: process.platform, architecture: process.arch, firefox: "not-reported", headless: process.env.HEADLESS !== "0" },
  tls: {
    caCertificate: relative(root, caCertificate),
    trust: "local CA imported only into four isolated Firefox NSS profiles; certificate errors are not ignored",
    ignoreCertificateErrors: false,
    systemTrustChanged: false,
    applicationTransport: "trusted local HTTPS/WSS",
  },
  topology: {
    room: "studio",
    roomIsolationParticipant: "D",
    participants: { A: "studio publisher/receiver", B: "studio publisher/receiver", C: "late-joining studio receiver", D: "lobby receiver" },
    browserProcesses: 4,
    isolatedFirefoxProfiles: 4,
    applicationConnections: 4,
    activeMediaWindowBudgetMs: 20_000,
  },
  syntheticSources: {
    audio: "A and B use test-injected getUserMedia oscillator streams through AudioContext MediaStreamDestination; no physical microphone is opened",
    audioFrequencyHz: AUDIO_FREQUENCIES_HZ,
    screen: "A and B use test-injected getDisplayMedia canvas streams; no native picker or physical display is used",
    screenColorRgb: SCREEN_COLORS,
    nativePermissionPickerUsed: false,
    physicalMicrophoneSelected: false,
    physicalDisplaySelected: false,
    mediaPayloadsStored: false,
  },
  checks: [],
  sourceStreams: { audio: {}, screen: {} },
  packetSourceChecks: [],
  reconnect: null,
  roomIsolation: null,
  interactionMode: null,
  screenshots: [],
  transport: [],
  privacy: {
    rawControlPayloadsRetained: false,
    rawMediaPayloadsRetained: false,
    packetHashesAndHeadersOnly: true,
    recoveryTokensRetained: false,
    pageStorageDumped: false,
    configuredSecretsReadOrRecorded: false,
  },
  limits: {
    realMicrophoneAndHumanListening: "not-tested; oscillators are injected synthetic sources",
    realDisplayCapture: "not-tested; getDisplayMedia is replaced with a generated canvas in test pages",
    physicalNetworkFailure: "not-tested; C receives one controlled Playwright WebSocket close",
    phonesAndCrossDeviceUse: "not-tested",
    endToEndLatencyOrListeningQuality: "not-measured",
    capacityAndEndurance: "not-tested; short four-process feasibility flow, no load or long-duration target",
    persistenceAndCloudDeployment: "not-tested; this browser smoke attaches to the externally started local fixture",
    identity: "not-verified; labels identify synthetic browser contexts, not people",
  },
  errors: { pageErrors: [], socketErrors: [], cleanupErrors: [], failure: null },
  durationMs: null,
  activeMediaDurationMs: null,
};

function elapsedMs() {
  return Date.now() - startedAtMs;
}

function pushBounded(array, value, cap, collectionName) {
  if (array.length < cap) {
    array.push(value);
    return true;
  }
  if (!report.errors.cleanupErrors.some((item) => item.code === "collection_cap_reached" && item.collection === collectionName)) {
    if (report.errors.cleanupErrors.length < 24) report.errors.cleanupErrors.push({ code: "collection_cap_reached", collection: collectionName, cap });
  }
  return false;
}

function stage(name, details = {}) {
  if (report.checks.length >= 30) throw new Error("The bounded MA01 stage cap was reached.");
  const item = { name, at: new Date().toISOString(), atMs: elapsedMs(), ...details };
  report.checks.push(item);
  console.log(`[MA01] ${name}${Object.keys(details).length ? ` ${JSON.stringify(details)}` : ""}`);
}

function runCertutil(args) {
  execFileSync(certificateUtility, args, { stdio: "pipe" });
}

function createTrustedProfile(name) {
  const folder = join(outputDirectory, `${name}-runtime`);
  runtimeFolders.add(folder);
  rmSync(folder, { recursive: true, force: true });
  const profileDirectory = join(folder, "profile");
  mkdirSync(profileDirectory, { recursive: true, mode: 0o700 });
  runCertutil(["-N", "-d", `sql:${profileDirectory}`, "--empty-password"]);
  runCertutil(["-A", "-d", `sql:${profileDirectory}`, "-n", "LaiTse MA01 local CA", "-t", "C,,", "-i", caCertificate]);
  const appData = join(folder, "app-data");
  const localAppData = join(folder, "local-app-data");
  mkdirSync(appData, { recursive: true, mode: 0o700 });
  mkdirSync(localAppData, { recursive: true, mode: 0o700 });
  return { folder, profileDirectory, appData, localAppData };
}

function browserEnvironment(profile) {
  const env = { ...process.env, MOZ_APP_DATA: profile.appData, MOZ_LOCAL_APP_DATA: profile.localAppData };
  for (const key of Object.keys(env)) {
    if (/(?:TOKEN|PASSWORD|SECRET|CREDENTIAL|API_KEY|DATABASE_URL|PGPASSWORD)/iu.test(key)) delete env[key];
  }
  return env;
}

function bytesFromPayload(payload) {
  if (Buffer.isBuffer(payload)) return payload;
  if (payload instanceof Uint8Array) return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  if (payload instanceof ArrayBuffer) return Buffer.from(payload);
  return null;
}

function summarizeConfig(value, mediaKind) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (mediaKind === "audio") {
    return Object.fromEntries(["codec", "sampleRate", "channels", "bitrate", "frameDurationUs"]
      .filter((key) => typeof value[key] === "string" || Number.isFinite(value[key]))
      .map((key) => [key, value[key]]));
  }
  return Object.fromEntries(["codec", "width", "height", "frameRate", "bitrate"]
    .filter((key) => typeof value[key] === "string" || Number.isFinite(value[key]))
    .map((key) => [key, value[key]]));
}

function controlSummary(message, direction, connectionIndex) {
  const type = typeof message?.type === "string" ? message.type.slice(0, 64) : "unknown";
  const summary = { direction, connectionIndex, atMs: elapsedMs(), type };
  for (const key of ["roomId", "mode", "role", "code", "reason", "action"]) {
    if (typeof message?.[key] === "string" && message[key].length <= 100) summary[key] = message[key];
  }
  if (type === "join") {
    summary.displayNamePresent = typeof message.displayName === "string";
    summary.passwordProvided = typeof message.password === "string";
    summary.resumable = message.resumable === true;
  } else if (type === "session.resume") {
    summary.tokenPresent = typeof message.token === "string" && message.token.length > 0;
    summary.passwordProvided = typeof message.password === "string";
  } else if (type === "session.issued" || type === "session.resumed") {
    summary.roomId = message.roomId ?? null;
    summary.role = message.role ?? "participant";
    summary.mode = message.mode ?? null;
    if (type === "session.issued") summary.tokenPresent = typeof message.token === "string" && message.token.length > 0;
  } else if (type === "room.snapshot") {
    summary.roomId = message.room?.id ?? message.roomId ?? null;
    summary.roomName = typeof message.room?.name === "string" ? message.room.name : null;
    summary.memberCount = Array.isArray(message.members) ? message.members.length : null;
  } else if (type === "participation.self") {
    summary.roomId = message.roomId ?? null;
    summary.mode = message.mode ?? null;
    summary.audioSubscribed = message.media?.audio?.subscribed === true;
    summary.screenSubscribed = message.media?.screen?.subscribed === true;
  } else if (type === "participation.modeChanged") {
    summary.mode = message.mode ?? null;
    summary.audioSubscribed = message.media?.audioSubscribed === true;
    summary.screenSubscribed = message.media?.screenSubscribed === true;
  }
  if (/^audio\./u.test(type) || /^screen\./u.test(type)) {
    if (Number.isInteger(message.generation)) summary.generation = message.generation;
    if (typeof message.clockId === "string" && message.clockId.length <= 120) summary.clockId = message.clockId;
    if (typeof message.code === "string") summary.code = message.code.slice(0, 80);
    if (typeof message.reason === "string") summary.reason = message.reason.slice(0, 80);
    if (message.config) summary.config = summarizeConfig(message.config, type.startsWith("audio.") ? "audio" : "screen");
    if (type === "audio.subscribed" && Array.isArray(message.streams)) {
      summary.streamGenerations = message.streams.filter((stream) => Number.isInteger(stream?.generation)).map((stream) => stream.generation).slice(0, 8);
    }
  }
  return summary;
}

function packetRecord(payload, direction, connectionIndex) {
  const bytes = bytesFromPayload(payload);
  if (!bytes || bytes.byteLength < 12) return null;
  const magic = bytes.toString("ascii", 0, 4);
  const channel = magic === "LTA1" ? "audio" : magic === "LTS1" ? "screen" : null;
  if (!channel) return null;
  const record = {
    direction,
    channel,
    connectionIndex,
    atMs: elapsedMs(),
    magic,
    generation: bytes.readUInt32BE(4),
    sequence: bytes.readUInt32BE(8),
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  if (channel === "audio" && bytes.byteLength >= 24) {
    record.timestampUs = bytes.readDoubleBE(12);
    record.durationUs = bytes.readUInt32BE(20);
  }
  return record;
}

function recordFrame(client, connection, direction, payload) {
  if (typeof payload === "string") {
    let message;
    try { message = JSON.parse(payload); }
    catch {
      connection.unparsedControlFrames += 1;
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) return;
    const summary = controlSummary(message, direction, connection.index);
    if (pushBounded(connection.controls, summary, CONTROL_RECORD_CAP, `${client.name}-connection-${connection.index}-controls`)) {
      pushBounded(client.wire.controls, summary, MAX_CLIENT_CONTROL_RECORDS, `${client.name}-controls`);
    }
    connection.controlFrameCounts[direction] += 1;
    return;
  }
  const bytes = bytesFromPayload(payload);
  if (!bytes) return;
  const record = packetRecord(bytes, direction, connection.index);
  if (!record) {
    connection.unparsedBinaryFrames[direction] += 1;
    return;
  }
  connection.binaryFrameCounts[direction][record.channel] += 1;
  const records = client.wire.packetRecords[direction][record.channel];
  if (records.length < RAW_PACKET_RECORD_CAP) records.push(record);
  else client.wire.droppedPacketRecords[direction][record.channel] += 1;
}

function setupPageDiagnostics(client) {
  client.page.on("pageerror", (error) => {
    pushBounded(report.errors.pageErrors, { client: client.name, atMs: elapsedMs(), message: String(error?.message ?? error).slice(0, 320) }, MAX_PAGE_ERRORS, "page-errors");
  });
}

async function installSyntheticMedia(page, clientName) {
  const frequency = AUDIO_FREQUENCIES_HZ[clientName];
  const color = SCREEN_COLORS[clientName];
  await page.addInitScript(({ frequency, color }) => {
    const state = { contexts: [], tracks: [], oscillators: [], animationFrameId: null, stopped: false };
    Object.defineProperty(window, "__ma01SyntheticMedia", { value: state, configurable: false });
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
        if (!drawing) throw new Error("MA01 synthetic screen canvas could not be created.");
        let active = true;
        let phase = 0;
        const render = () => {
          if (!active) return;
          drawing.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
          drawing.fillRect(0, 0, canvas.width, canvas.height);
          drawing.fillStyle = "#fff";
          drawing.fillRect(12 + (phase % 220), 12, 48, 12);
          phase += 3;
          state.animationFrameId = requestAnimationFrame(render);
        };
        render();
        const stream = canvas.captureStream(10);
        const track = stream.getVideoTracks()[0];
        if (!track) throw new Error("MA01 synthetic screen canvas produced no video track.");
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
      state.stopped = true;
      if (state.animationFrameId !== null) cancelAnimationFrame(state.animationFrameId);
      for (const track of state.tracks) {
        try { track.stop(); } catch { /* Best-effort cleanup in the test page. */ }
      }
      for (const oscillator of state.oscillators) {
        try { oscillator.stop(); } catch { /* An already-stopped oscillator is harmless. */ }
      }
      await Promise.all(state.contexts.map((context) => context.close().catch(() => {})));
    };
  }, { frequency, color });
}

function newConnection(client) {
  if (client.wire.connections.length >= CONNECTION_CAP) {
    pushBounded(report.errors.socketErrors, { client: client.name, code: "connection_cap_reached", cap: CONNECTION_CAP }, 24, "socket-errors");
    return null;
  }
  const connection = {
    index: client.wire.connections.length + 1,
    startedAtMs: elapsedMs(),
    controls: [],
    controlFrameCounts: { sent: 0, received: 0 },
    binaryFrameCounts: { sent: { audio: 0, screen: 0 }, received: { audio: 0, screen: 0 } },
      droppedPacketRecords: { sent: { audio: 0, screen: 0 }, received: { audio: 0, screen: 0 } },
    unparsedBinaryFrames: { sent: 0, received: 0 },
    unparsedControlFrames: 0,
    route: null,
    serverRoute: null,
  };
  client.wire.connections.push(connection);
  client.wire.activeConnection = connection;
  return connection;
}

function connectRoute(client, connection, route) {
  const serverRoute = route.connectToServer();
  connection.route = route;
  connection.serverRoute = serverRoute;
  route.onMessage((payload) => {
    recordFrame(client, connection, "sent", payload);
    serverRoute.send(payload);
  });
  serverRoute.onMessage((payload) => {
    recordFrame(client, connection, "received", payload);
    route.send(payload);
  });
}

async function installWebSocketRoute(client) {
  await client.page.routeWebSocket(/\/ws(?:\?|$)/u, (route) => {
    const connection = newConnection(client);
    if (!connection) {
      void route.close({ code: 1013, reason: "MA01 bounded connection cap" }).catch(() => {});
      return;
    }
    connectRoute(client, connection, route);
  });
}

async function launchClient(key) {
  const name = CLIENT_NAMES[key];
  const profile = createTrustedProfile(name);
  const context = await firefox.launchPersistentContext(profile.profileDirectory, {
    headless: process.env.HEADLESS !== "0",
    env: browserEnvironment(profile),
    viewport: { width: 1360, height: 1000 },
    colorScheme: "light",
    firefoxUserPrefs: { "security.enterprise_roots.enabled": false },
  });
  context.setDefaultTimeout(NORMAL_TIMEOUT_MS);
  contexts.push(context);
  const page = context.pages()[0] ?? await context.newPage();
  const client = {
    key,
    name,
    page,
    context,
    profile,
    wire: {
      connections: [],
      activeConnection: null,
      controls: [],
      packetRecords: {
        sent: { audio: [], screen: [] },
        received: { audio: [], screen: [] },
      },
      droppedPacketRecords: {
        sent: { audio: 0, screen: 0 },
        received: { audio: 0, screen: 0 },
      },
    },
  };
  setupPageDiagnostics(client);
  clients.set(key, client);
  await installWebSocketRoute(client);
  return client;
}

function allControls(client, { type, direction, connectionIndex } = {}) {
  return client.wire.controls.filter((entry) =>
    (type === undefined || entry.type === type) &&
    (direction === undefined || entry.direction === direction) &&
    (connectionIndex === undefined || entry.connectionIndex === connectionIndex));
}

function countControls(client, type, direction = "received") {
  return allControls(client, { type, direction }).length;
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
    await new Promise((resolveWait) => setTimeout(resolveWait, 40));
  }
  const suffix = lastError ? `; last probe error: ${String(lastError.message ?? lastError).slice(0, 160)}` : "";
  throw new Error(`${label} was not observed within ${timeoutMs} ms${suffix}.`);
}

async function waitForControl(client, type, { direction = "received", after = 0, connectionIndex, predicate = () => true, timeoutMs = NORMAL_TIMEOUT_MS } = {}) {
  return waitFor(() => {
    const found = allControls(client, { type, direction, connectionIndex }).slice(after).find((entry) => predicate(entry));
    return found ?? null;
  }, `${client.name} ${direction} ${type}`, timeoutMs);
}

async function waitForJoined(client, roomId) {
  await client.page.waitForFunction((expectedRoom) => {
    const audio = document.querySelector('[data-testid="audio-panel"]');
    const connection = document.querySelector('[data-testid="control-connection-status"]');
    return audio?.getAttribute("data-room-id") === expectedRoom && /Connected/u.test(connection?.textContent ?? "");
  }, roomId, { timeout: NORMAL_TIMEOUT_MS });
  await client.page.locator('[data-testid="audio-panel"]').waitFor({ state: "visible" });
  await client.page.locator('[data-testid="screen-panel"]').waitFor({ state: "visible" });
}

async function joinRoom(client, roomId, mode = "watch") {
  await client.page.goto(`${target.origin}/?room=${encodeURIComponent(roomId)}&mode=${mode}`, { waitUntil: "domcontentloaded" });
  await client.page.getByRole("heading", { name: "Local room presence" }).waitFor();
  await client.page.getByLabel("Your display name").fill(client.name);
  await client.page.getByRole("button", { name: "Join room" }).click();
  await waitForJoined(client, roomId);
  const latestRoomSnapshot = allControls(client, { type: "room.snapshot", direction: "received" }).at(-1);
  assert.ok(latestRoomSnapshot, `${client.name} should join with a server room snapshot.`);
  assert.equal(latestRoomSnapshot.roomId, roomId);
}

async function startListening(client) {
  const subscribeCount = countControls(client, "audio.subscribe", "sent");
  const subscribedCount = countControls(client, "audio.subscribed", "received");
  await client.page.locator('[data-testid="audio-start-listening"]').click();
  await waitForControl(client, "audio.subscribe", { direction: "sent", after: subscribeCount });
  await waitForControl(client, "audio.subscribed", { direction: "received", after: subscribedCount, timeoutMs: NORMAL_TIMEOUT_MS });
}

async function startPublishingAudio(client) {
  const startedCount = countControls(client, "audio.started", "received");
  await client.page.locator('[data-testid="audio-start-publishing"]').click();
  const started = await waitForControl(client, "audio.started", { direction: "received", after: startedCount });
  const packets = await waitFor(() => client.wire.packetRecords.sent.audio.filter((packet) =>
    started.generation === undefined || packet.generation === started.generation).length >= 6, `${client.name} sent audio packets`, RENDER_TIMEOUT_MS);
  const generation = Number.isInteger(started.generation)
    ? started.generation
    : client.wire.packetRecords.sent.audio.at(-1)?.generation;
  assert.ok(Number.isInteger(generation), `${client.name} should have a generation in its audio source packets.`);
  return { generation, control: started, packetCount: packets };
}

function sourceRowsFromJson(value) {
  if (typeof value !== "string" || !value) return [];
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((source) => source && Number.isInteger(source.generation)).map((source) => ({
    generation: source.generation,
    active: source.active === true,
    clockId: typeof source.clockId === "string" ? source.clockId : "",
    receivedPackets: Number(source.receivedPackets ?? 0),
    decodedFrames: Number(source.decodedFrames ?? 0),
    renderedPcmSamples: Number(source.renderedPcmSamples ?? 0),
    queuedSamples: Number(source.queuedSamples ?? 0),
    renderRms: Number(source.renderRms ?? 0),
    packetGapCount: Number(source.packetGapCount ?? 0),
  }));
}

async function readAudioSources(client) {
  const raw = await client.page.locator('[data-testid="audio-panel"]').getAttribute("data-audio-streams");
  return sourceRowsFromJson(raw);
}

async function waitForAudioSources(client, generations, label, { exact = true, timeoutMs = RENDER_TIMEOUT_MS } = {}) {
  const expected = new Set(generations);
  return waitFor(async () => {
    const allRows = await readAudioSources(client);
    const rows = allRows.filter((row) => row.active);
    const matching = rows.filter((row) => expected.has(row.generation));
    if (matching.length !== expected.size) return null;
    if (exact && rows.length !== expected.size) return null;
    if (!matching.every((row) => row.receivedPackets > 0 && row.decodedFrames > 0 && row.renderedPcmSamples > 0 && row.renderRms > 0)) return null;
    return rows;
  }, `${client.name} actual per-source PCM output (${label})`, timeoutMs);
}

function packets(client, direction, channel, generation, afterMs = 0) {
  return client.wire.packetRecords[direction][channel].filter((packet) => packet.atMs >= afterMs && (generation === undefined || packet.generation === generation));
}

function activeAudioSources(rows) {
  return rows.filter((row) => row.active);
}

function packetHashSet(client, direction, channel, generation) {
  return new Set(packets(client, direction, channel, generation).map((packet) => packet.sha256));
}

function assertPacketSource(receiver, publisher, channel, generation, { afterMs = 0, label = "source" } = {}) {
  const publisherHashes = packetHashSet(publisher, "sent", channel, generation);
  const receiverPackets = packets(receiver, "received", channel, generation, afterMs);
  const matching = receiverPackets.filter((packet) => publisherHashes.has(packet.sha256));
  assert.ok(publisherHashes.size > 0, `${publisher.name} must expose outgoing ${channel} source packet hashes for ${label}.`);
  assert.ok(matching.length > 0, `${receiver.name} must receive exact ${label} ${channel} source packet hashes.`);
  if (report.packetSourceChecks.length < 24) {
    report.packetSourceChecks.push({
      label,
      channel,
      publisher: publisher.name,
      receiver: receiver.name,
      generation,
      publisherUniqueHashCount: publisherHashes.size,
      receiverMatchedCount: matching.length,
      matchedPacketHashes: matching.slice(0, 12).map(({ atMs, generation: packetGeneration, sequence, sha256 }) => ({ atMs, generation: packetGeneration, sequence, sha256 })),
    });
  }
  return matching;
}

function assertOnlySourceGenerations(client, channel, allowedGenerations, { afterMs = 0, label = "unexpected source" } = {}) {
  const allowed = new Set(allowedGenerations);
  const unexpected = client.wire.packetRecords.received[channel].filter((packet) => packet.atMs >= afterMs && !allowed.has(packet.generation));
  assert.deepEqual(unexpected, [], `${client.name} must not receive ${label} ${channel} generations.`);
}

function assertNoSourcePackets(receiver, channel, generations, { direction = "received", afterMs = 0, label = "forbidden source" } = {}) {
  const observed = receiver.wire.packetRecords[direction][channel].filter((packet) => packet.atMs >= afterMs && generations.includes(packet.generation));
  assert.deepEqual(observed, [], `${receiver.name} must not observe ${label} ${channel} frames.`);
}

async function readScreenSnapshot(client) {
  return client.page.evaluate(() => {
    const panel = document.querySelector('[data-testid="screen-panel"]');
    const canvas = panel?.querySelector('[data-testid="screen-preview"]');
    let centerPixel = null;
    if (canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0) {
      try { centerPixel = [...canvas.getContext("2d").getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data]; }
      catch { centerPixel = null; }
    }
    return {
      receiverState: panel?.getAttribute("data-receiver-state") ?? "missing",
      receiverSubscribed: panel?.getAttribute("data-receiver-subscribed") === "true",
      receiveIntent: panel?.getAttribute("data-receive-intent") === "true",
      receivedFrames: Number(panel?.getAttribute("data-received-frames") ?? 0),
      decodedFrames: Number(panel?.getAttribute("data-decoded-frames") ?? 0),
      renderedFrames: Number(panel?.getAttribute("data-rendered-frames") ?? 0),
      width: Number(panel?.getAttribute("data-rendered-width") ?? 0),
      height: Number(panel?.getAttribute("data-rendered-height") ?? 0),
      syncMode: panel?.getAttribute("data-sync-mode") ?? "missing",
      syncClockId: panel?.getAttribute("data-sync-clock-id") ?? "",
      centerPixel,
    };
  });
}

function assertColor(actual, expected, label) {
  assert.ok(Array.isArray(actual) && actual.length >= 3, `${label} should have a readable decoded canvas pixel.`);
  const difference = Math.max(...expected.map((channel, index) => Math.abs(channel - actual[index])));
  assert.ok(difference <= 45, `${label} should show the expected injected screen source color; got ${actual}.`);
}

async function waitForScreen(client, expectedColor, label) {
  await client.page.waitForFunction(() => {
    const panel = document.querySelector('[data-testid="screen-panel"]');
    const canvas = panel?.querySelector('[data-testid="screen-preview"]');
    return panel && Number(panel.getAttribute("data-rendered-frames")) >= 3 && canvas?.width > 0 && canvas?.height > 0;
  }, undefined, { timeout: RENDER_TIMEOUT_MS });
  const snapshot = await readScreenSnapshot(client);
  assert.ok(snapshot.receivedFrames > 0 && snapshot.decodedFrames > 0 && snapshot.renderedFrames >= 3, `${label} must receive, decode, and render screen frames.`);
  assert.ok(snapshot.width > 0 && snapshot.height > 0, `${label} should expose decoded dimensions.`);
  assertColor(snapshot.centerPixel, expectedColor, label);
  return snapshot;
}

async function startWatchingScreen(client) {
  const subscribeCount = countControls(client, "screen.subscribe", "sent");
  const subscribedCount = countControls(client, "screen.subscribed", "received");
  await client.page.locator('[data-testid="screen-start-watching"]').click();
  await waitForControl(client, "screen.subscribe", { direction: "sent", after: subscribeCount });
  await waitForControl(client, "screen.subscribed", { direction: "received", after: subscribedCount });
}

async function startScreenShare(client) {
  const startCount = countControls(client, "screen.started", "received");
  await client.page.getByRole("button", { name: "開始分享畫面" }).click();
  return await waitForControl(client, "screen.started", { direction: "received", after: startCount });
}

async function capturePanel(client, testId, fileName) {
  if (report.screenshots.length >= MAX_SCREENSHOTS) return;
  const locator = client.page.locator(`[data-testid="${testId}"]`);
  if (!(await locator.count()) || !(await locator.isVisible())) return;
  const path = join(outputDirectory, fileName);
  await locator.screenshot({ path, animations: "disabled" });
  report.screenshots.push(fileName);
}

function latestStreamControl(client, type, generation) {
  return allControls(client, { type, direction: "received" }).findLast((entry) => generation === undefined || entry.generation === generation) ?? null;
}

function safeClientTransport(client) {
  return {
    client: client.name,
    connections: client.wire.connections.map((connection) => ({
      index: connection.index,
      startedAtMs: connection.startedAtMs,
      controlFrameCounts: connection.controlFrameCounts,
      binaryFrameCounts: connection.binaryFrameCounts,
      unparsedBinaryFrames: connection.unparsedBinaryFrames,
      unparsedControlFrames: connection.unparsedControlFrames,
      controls: connection.controls,
    })),
    packetHashTrace: client.wire.packetRecords,
    droppedPacketRecords: client.wire.droppedPacketRecords,
    traceCaps: { packetRecordsPerClientChannelDirection: RAW_PACKET_RECORD_CAP, controlRecordsPerConnection: CONTROL_RECORD_CAP, connectionCapPerClient: CONNECTION_CAP },
  };
}

async function cleanupSyntheticPage(client) {
  try {
    await client.page.evaluate(async () => await window.__ma01SyntheticMedia?.stopAll?.());
  } catch { /* The page may have been closed before cleanup. */ }
}

async function saveFailureScreenshots() {
  for (const key of ["C", "B", "A", "D"]) {
    if (report.screenshots.length >= MAX_SCREENSHOTS) break;
    const client = clients.get(key);
    if (!client || client.page.isClosed()) continue;
    try {
      const path = join(outputDirectory, `${client.name.toLowerCase()}-failure.png`);
      await client.page.screenshot({ path, fullPage: true, animations: "disabled", timeout: 2_000 });
      report.screenshots.push(relative(outputDirectory, path));
    } catch { /* Preserve the original failure when a page cannot be captured. */ }
  }
}

async function runSmoke() {
  assert.ok(readFileSync(caCertificate).byteLength > 0, "The local CA certificate must not be empty.");
  const [A, B, C, D] = await Promise.all(["A", "B", "C", "D"].map((key) => launchClient(key)));
  report.runtime.firefox = contexts[0]?.browser()?.version() ?? "not-reported";

  await Promise.all([installSyntheticMedia(A.page, "A"), installSyntheticMedia(B.page, "B")]);
  await Promise.all([joinRoom(A, "studio"), joinRoom(B, "studio")]);
  await Promise.all([startListening(A), startListening(B)]);
  activeMediaStartedAtMs = Date.now();
  const [aInitial, bInitial] = await Promise.all([startPublishingAudio(A), startPublishingAudio(B)]);
  const genA1 = aInitial.generation;
  const genB = bInitial.generation;
  assert.notEqual(genA1, genB, "A and B must receive distinct server audio source generations.");
  await Promise.all([
    waitForAudioSources(A, [genB], "A receives B but not itself"),
    waitForAudioSources(B, [genA1], "B receives A but not itself"),
  ]);
  const [aRowsInitial, bRowsInitial] = await Promise.all([readAudioSources(A), readAudioSources(B)]);
  const streamBAtA = latestStreamControl(A, "audio.stream", genB);
  const streamAAtB = latestStreamControl(B, "audio.stream", genA1);
  assert.equal(aRowsInitial.find((row) => row.active && row.generation === genB)?.clockId, streamBAtA?.clockId, "A's per-source receiver clock should match B's server stream metadata.");
  assert.equal(bRowsInitial.find((row) => row.active && row.generation === genA1)?.clockId, streamAAtB?.clockId, "B's per-source receiver clock should match A's server stream metadata.");
  const generationSetInitial = [genA1, genB];
  assertPacketSource(A, B, "audio", genB, { label: "B to A" });
  assertPacketSource(B, A, "audio", genA1, { label: "A to B" });
  assertNoSourcePackets(A, "audio", [genA1], { label: "A's own audio" });
  assertNoSourcePackets(B, "audio", [genB], { label: "B's own audio" });
  assertOnlySourceGenerations(A, "audio", [genB], { label: "audio returned to A" });
  assertOnlySourceGenerations(B, "audio", [genA1], { label: "audio returned to B" });
  report.sourceStreams.audio.initial = {
    A: { generation: genA1, outgoingPackets: packets(A, "sent", "audio", genA1).length, clockId: latestStreamControl(B, "audio.stream", genA1)?.clockId ?? null },
    B: { generation: genB, outgoingPackets: packets(B, "sent", "audio", genB).length, clockId: latestStreamControl(A, "audio.stream", genB)?.clockId ?? null },
    receiverPCM: { A: aRowsInitial, B: bRowsInitial },
  };
  stage("A-and-B-publish-and-receive-other-source-with-real-per-source-PCM", {
    generations: { A: genA1, B: genB },
    pcmSamples: { A: report.sourceStreams.audio.initial.receiverPCM.A[0]?.renderedPcmSamples ?? 0, B: report.sourceStreams.audio.initial.receiverPCM.B[0]?.renderedPcmSamples ?? 0 },
  });

  // C and D join only after A/B are already publishing, so C is a true late receiver and D tests another room.
  await joinRoom(C, "studio");
  assert.ok(allControls(C, { type: "room.snapshot", direction: "received" }).at(-1)?.memberCount >= 3, "C must join the already active studio after both publishers.");
  await startListening(C);
  const cPcmBefore = await waitForAudioSources(C, generationSetInitial, "late join receives both current sources");
  const cStreamA = latestStreamControl(C, "audio.stream", genA1);
  const cStreamB = latestStreamControl(C, "audio.stream", genB);
  assert.equal(cPcmBefore.find((row) => row.generation === genA1)?.clockId, cStreamA?.clockId, "C's A source clock should match the server's current stream metadata.");
  assert.equal(cPcmBefore.find((row) => row.generation === genB)?.clockId, cStreamB?.clockId, "C's B source clock should match the server's current stream metadata.");
  await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  const cPcmAfter = await waitForAudioSources(C, generationSetInitial, "late-join per-source PCM advances");
  for (const generation of generationSetInitial) {
    assert.ok(
      cPcmAfter.find((row) => row.generation === generation).renderedPcmSamples > cPcmBefore.find((row) => row.generation === generation).renderedPcmSamples,
      `C's AudioWorklet PCM counter for generation ${generation} should advance while the other source is also active.`,
    );
  }
  assertPacketSource(C, A, "audio", genA1, { label: "late-join A to C" });
  assertPacketSource(C, B, "audio", genB, { label: "late-join B to C" });
  assertOnlySourceGenerations(C, "audio", generationSetInitial, { label: "unexpected studio source" });
  await joinRoom(D, "lobby");
  // Two Playwright mouse actions on one page share the same pointer/scroll state.
  // Keep them sequential so the second click cannot race the first one's target.
  await startListening(D);
  await startWatchingScreen(D);
  await new Promise((resolveWait) => setTimeout(resolveWait, 350));
  assert.equal(countControls(D, "audio.stream", "received"), 0, "D in lobby must not receive studio audio stream configs.");
  assert.equal(countControls(D, "screen.stream", "received"), 0, "D in lobby must not receive studio screen stream config.");
  assertNoSourcePackets(D, "audio", [genA1, genB], { label: "studio source in lobby" });
  assertOnlySourceGenerations(D, "audio", [], { label: "unexpected source in lobby" });
  assert.equal(D.wire.packetRecords.received.screen.length, 0, "D must not receive any screen frames while in the lobby.");
  stage("late-joining-C-receives-both-streams-and-lobby-D-receives-no-studio-media", {
    C: cPcmAfter.filter((row) => row.active).map((row) => ({ generation: row.generation, clockId: row.clockId, renderedPcmSamples: row.renderedPcmSamples })),
    D: { roomId: "lobby", receivedAudioFrames: D.wire.packetRecords.received.audio.length, receivedScreenFrames: D.wire.packetRecords.received.screen.length },
  });

  const screenStartedA = await startScreenShare(A);
  await Promise.all([startWatchingScreen(C), waitForControl(C, "screen.stream", { direction: "received" })]);
  const screenConfigC = await waitForControl(C, "screen.stream", { direction: "received" });
  const screenGenerationA = screenConfigC.generation ?? screenStartedA.generation;
  assert.ok(Number.isInteger(screenGenerationA), "A screen source should have a server generation.");
  const screenSnapshotBeforeConflict = await waitForScreen(C, SCREEN_COLORS.A, "C's A canvas before B's conflict attempt");
  assert.equal(screenSnapshotBeforeConflict.syncMode, "audio-master", "A's rendered screen should use the matching active audio playback clock.");
  assertPacketSource(C, A, "screen", screenGenerationA, { label: "A screen to C" });
  assert.equal(screenConfigC.clockId, latestStreamControl(C, "audio.stream", genA1)?.clockId, "A's screen stream and audio stream should retain the same publisher clock.");
  // D has no studio frame or stream config; no pixel wait is expected for a hidden foreign source.
  const dScreenBeforeConflict = await readScreenSnapshot(D);
  assert.equal(dScreenBeforeConflict.receivedFrames, 0, "D must have no rendered screen frames from studio.");

  const conflictCount = countControls(B, "screen.error", "received");
  const bScreenPacketCountBefore = B.wire.packetRecords.sent.screen.length;
  await B.page.getByRole("button", { name: "開始分享畫面" }).click();
  const conflict = await waitForControl(B, "screen.error", { direction: "received", after: conflictCount, predicate: (entry) => entry.code === "publisher_exists" });
  await new Promise((resolveWait) => setTimeout(resolveWait, 400));
  assert.equal(B.wire.packetRecords.sent.screen.length, bScreenPacketCountBefore, "B's rejected screen attempt must not send or replace A's screen packets.");
  const screenSnapshotAfterConflict = await readScreenSnapshot(C);
  assert.ok(screenSnapshotAfterConflict.renderedFrames > screenSnapshotBeforeConflict.renderedFrames, "A's screen should continue rendering after B receives the conflict.");
  assert.equal(screenSnapshotAfterConflict.syncClockId, screenConfigC.clockId, "B's conflict must not replace A's screen clock.");
  assertColor(screenSnapshotAfterConflict.centerPixel, SCREEN_COLORS.A, "C's screen after B is rejected");
  await capturePanel(C, "audio-panel", "c-two-audio-sources.png");
  await capturePanel(C, "screen-panel", "c-a-screen-clock.png");
  report.sourceStreams.screen.A = {
    generation: screenGenerationA,
    clockId: screenConfigC.clockId,
    renderedAtC: screenSnapshotAfterConflict,
    publisherFrames: packets(A, "sent", "screen", screenGenerationA).length,
    receiverFramesAtC: packets(C, "received", "screen", screenGenerationA).length,
  };
  report.sourceStreams.screen.conflict = { client: B.name, rejectedCode: conflict.code, packetsAttempted: B.wire.packetRecords.sent.screen.length - bScreenPacketCountBefore, AGenerationRetainedAtC: screenGenerationA };
  assert.equal(countControls(C, "screen.stream", "received"), 1, "A should remain the only screen stream announced to C.");
  stage("A-single-screen-clock-renders-and-B-is-rejected-without-replacement", {
    generation: screenGenerationA,
    clockId: screenConfigC.clockId,
    conflictCode: conflict.code,
    C: { renderedFrames: screenSnapshotAfterConflict.renderedFrames, syncMode: screenSnapshotAfterConflict.syncMode, centerPixel: screenSnapshotAfterConflict.centerPixel },
  });

  const bPcmBeforeAStop = (await readAudioSources(C)).find((row) => row.generation === genB)?.renderedPcmSamples ?? 0;
  const aStopCount = countControls(A, "audio.stopped", "received");
  const cEndedCount = countControls(C, "audio.streamEnded", "received");
  await A.page.locator('[data-testid="audio-stop-publishing"]').click();
  await waitForControl(A, "audio.stopped", { direction: "received", after: aStopCount });
  const aEnd = await waitForControl(C, "audio.streamEnded", { direction: "received", after: cEndedCount, predicate: (entry) => entry.generation === genA1 });
  const aEndedAtMs = aEnd.atMs;
  const cAfterAStop = await waitForAudioSources(C, [genB], "B remains audible after A stops");
  const bPcmAfterAStop = cAfterAStop.find((row) => row.generation === genB)?.renderedPcmSamples ?? 0;
  assert.ok(bPcmAfterAStop > bPcmBeforeAStop, "B's per-source AudioWorklet PCM count must advance after A stops.");
  assert.equal(packets(C, "received", "audio", genA1).some((packet) => packet.atMs > aEndedAtMs), false, "C must stop receiving A's old generation after the stream-ended control.");
  assertOnlySourceGenerations(C, "audio", [genB], { afterMs: aEndedAtMs, label: "stopped A generation" });
  const bPacketCountAfterAStop = packets(C, "received", "audio", genB).length;
  assert.ok(bPacketCountAfterAStop > 0, "C should continue receiving B frames after A stops.");
  stage("A-stop-does-not-break-B", { stoppedGeneration: genA1, retainedGeneration: genB, bRenderedPcmSamplesBefore: bPcmBeforeAStop, bRenderedPcmSamplesAfter: bPcmAfterAStop, aLastStreamEndedAtMs: aEndedAtMs });

  const aRestart = await startPublishingAudio(A);
  const genA2 = aRestart.generation;
  assert.notEqual(genA2, genA1, "Restarting A must create a fresh audio generation.");
  await Promise.all([
    waitForAudioSources(A, [genB], "A remains subscribed to B after restart"),
    waitForAudioSources(B, [genA2], "B receives A's fresh generation"),
    waitForAudioSources(C, [genA2, genB], "C receives both fresh/current generations"),
  ]);
  assertPacketSource(B, A, "audio", genA2, { label: "restarted A to B" });
  assertPacketSource(C, A, "audio", genA2, { label: "restarted A to C" });
  assertPacketSource(C, B, "audio", genB, { label: "B continues to C" });
  assertNoSourcePackets(A, "audio", [genA1, genA2], { label: "A's own generations" });
  assertNoSourcePackets(B, "audio", [genB], { label: "B's own generation" });
  assertOnlySourceGenerations(C, "audio", [genA2, genB], { afterMs: aEndedAtMs, label: "stale or foreign source after A restart" });
  const audioClockA2 = latestStreamControl(C, "audio.stream", genA2)?.clockId;
  assert.equal(audioClockA2, screenConfigC.clockId, "A's restarted audio generation should keep the same connection clock as A's still-active screen.");
  report.sourceStreams.audio.afterRestart = {
    A: { oldGeneration: genA1, currentGeneration: genA2, clockId: audioClockA2, outgoingPackets: packets(A, "sent", "audio", genA2).length },
    B: { generation: genB, clockId: latestStreamControl(C, "audio.stream", genB)?.clockId ?? null, outgoingPackets: packets(B, "sent", "audio", genB).length },
    receiverPCM: { A: await readAudioSources(A), B: await readAudioSources(B), C: await readAudioSources(C) },
  };
  stage("A-restart-uses-fresh-generation-and-retains-source-clock", { generations: { A: genA2, B: genB }, clockIdA: audioClockA2, screenClockIdA: screenConfigC.clockId });

  const connectionBefore = C.wire.activeConnection;
  assert.ok(connectionBefore?.serverRoute, "C should have an active routed WebSocket before controlled recovery.");
  const priorConnectionCount = C.wire.connections.length;
  const oldResumeCount = countControls(C, "session.resumed", "received");
  await connectionBefore.serverRoute.close({ code: CLOSE_CODE, reason: "MA01 controlled application disconnect" });
  await waitFor(() => C.wire.connections.length > priorConnectionCount, "C reconnect WebSocket", RECONNECT_TIMEOUT_MS);
  const resumed = await waitForControl(C, "session.resumed", { direction: "received", after: oldResumeCount, timeoutMs: RECONNECT_TIMEOUT_MS });
  const resumedConnection = C.wire.activeConnection;
  assert.ok(resumedConnection && resumedConnection.index > connectionBefore.index, "C should resume on a fresh WebSocket connection.");
  assert.equal(resumed.roomId, "studio", "C should resume to the current studio room.");
  assert.equal(resumed.mode, "watch", "C should resume in watch mode before the interaction-only check.");
  await waitForControl(C, "room.snapshot", { direction: "received", connectionIndex: resumedConnection.index, timeoutMs: RECONNECT_TIMEOUT_MS });
  await waitForControl(C, "participation.self", { direction: "received", connectionIndex: resumedConnection.index, predicate: (entry) => entry.mode === "watch", timeoutMs: RECONNECT_TIMEOUT_MS });
  await waitForControl(C, "audio.stream", { direction: "received", connectionIndex: resumedConnection.index, predicate: (entry) => entry.generation === genA2, timeoutMs: RECONNECT_TIMEOUT_MS });
  await waitForControl(C, "audio.stream", { direction: "received", connectionIndex: resumedConnection.index, predicate: (entry) => entry.generation === genB, timeoutMs: RECONNECT_TIMEOUT_MS });
  await waitForAudioSources(C, [genA2, genB], "C actual PCM output after controlled reconnect", { timeoutMs: RECONNECT_TIMEOUT_MS });
  const screenRestoredControl = await waitForControl(C, "screen.stream", { direction: "received", connectionIndex: resumedConnection.index, timeoutMs: 4_000 }).catch(() => null);
  if (screenRestoredControl) {
    const restoredScreen = await waitForScreen(C, SCREEN_COLORS.A, "C restored A screen after controlled reconnect");
    assert.equal(screenRestoredControl.clockId, audioClockA2, "Restored A screen keeps the current A audio source clock.");
    report.sourceStreams.screen.afterReconnect = { generation: screenRestoredControl.generation, clockId: screenRestoredControl.clockId, renderedAtC: restoredScreen };
  }
  report.reconnect = {
    controlledCloseCode: CLOSE_CODE,
    physicalNetworkInterruptionClaimed: false,
    oldConnectionIndex: connectionBefore.index,
    newConnectionIndex: resumedConnection.index,
    resumedRoomId: resumed.roomId,
    resumedMode: resumed.mode,
    resumeTokenRetained: false,
    sourceGenerationsAfterReconnect: [genA2, genB],
    receiverPCM: await readAudioSources(C),
    screenRestoreObserved: Boolean(screenRestoredControl),
  };
  stage("C-controlled-WebSocket-disconnect-restores-current-subscriptions-and-two-PCM-sources", {
    connection: { before: connectionBefore.index, after: resumedConnection.index },
    generations: [genA2, genB],
    pcmSamples: (await readAudioSources(C)).map((row) => ({ generation: row.generation, renderedPcmSamples: row.renderedPcmSamples })),
  });

  const studioPacketStartMs = elapsedMs();
  const roomSnapshotBeforeLobby = countControls(C, "room.snapshot", "received");
  await C.page.locator('[data-room-choice="lobby"]').click();
  const lobbySnapshot = await waitForControl(C, "room.snapshot", { direction: "received", after: roomSnapshotBeforeLobby, predicate: (entry) => entry.roomId === "lobby" });
  await C.page.waitForFunction(() => document.querySelector('[data-testid="audio-panel"]')?.getAttribute("data-room-id") === "lobby", undefined, { timeout: NORMAL_TIMEOUT_MS });
  await new Promise((resolveWait) => setTimeout(resolveWait, 550));
  assertNoSourcePackets(C, "audio", [genA1, genA2, genB], { afterMs: lobbySnapshot.atMs, label: "studio audio after C switches to lobby" });
  assertNoSourcePackets(C, "screen", [screenGenerationA], { afterMs: lobbySnapshot.atMs, label: "studio screen after C switches to lobby" });
  assertOnlySourceGenerations(C, "audio", [], { afterMs: lobbySnapshot.atMs, label: "audio while C is in lobby" });
  const cLobbyState = await readAudioSources(C);
  assert.deepEqual(activeAudioSources(cLobbyState), [], "C should have no active per-source audio output while in the lobby.");
  const cLobbyScreen = await readScreenSnapshot(C);
  assert.equal(cLobbyScreen.receivedFrames, 0, "C should clear the studio screen when it moves to the lobby.");
  report.roomIsolation = {
    client: C.name,
    from: "studio",
    to: "lobby",
    roomSnapshotAtMs: lobbySnapshot.atMs,
    noStudioAudioPacketsAfterRoomSnapshot: true,
    noStudioScreenPacketsAfterRoomSnapshot: true,
    DStudioMediaDownlinkFrames: 0,
    sampledSinceMediaStartMs: Math.max(0, elapsedMs() - studioPacketStartMs),
  };
  stage("C-moves-to-lobby-with-zero-studio-audio-and-screen-downlink", { roomId: "lobby", CAudioRows: cLobbyState, screenFrames: cLobbyScreen.receivedFrames, DStudioMediaDownlinkFrames: 0 });

  const roomSnapshotBeforeStudio = countControls(C, "room.snapshot", "received");
  await C.page.locator('[data-room-choice="studio"]').click();
  const returnedSnapshot = await waitForControl(C, "room.snapshot", { direction: "received", after: roomSnapshotBeforeStudio, predicate: (entry) => entry.roomId === "studio" });
  await C.page.waitForFunction(() => document.querySelector('[data-testid="audio-panel"]')?.getAttribute("data-room-id") === "studio", undefined, { timeout: NORMAL_TIMEOUT_MS });
  let manualListenRequired = false;
  const listenButton = C.page.locator('[data-testid="audio-start-listening"]');
  if (await listenButton.count() && await listenButton.isVisible()) {
    manualListenRequired = true;
    await startListening(C);
  }
  await waitForAudioSources(C, [genA2, genB], "C listens again after returning to studio", { timeoutMs: RECONNECT_TIMEOUT_MS });
  assertPacketSource(C, A, "audio", genA2, { afterMs: returnedSnapshot.atMs, label: "A to C after return" });
  assertPacketSource(C, B, "audio", genB, { afterMs: returnedSnapshot.atMs, label: "B to C after return" });
  stage("C-returns-to-studio-and-manually-resubscribes-only-if-needed", { roomId: "studio", manualListenRequired, generations: [genA2, genB] });

  const interactionButton = C.page.locator('[data-testid="mode-interaction"]');
  const modeChangeCount = countControls(C, "participation.modeChanged", "received");
  await interactionButton.click();
  const interactionAck = await waitForControl(C, "participation.modeChanged", { direction: "received", after: modeChangeCount, predicate: (entry) => entry.mode === "interaction" });
  await C.page.getByTestId("participation-mode").getByText("只互動", { exact: true }).waitFor();
  const interactionAckAtMs = interactionAck.atMs;
  await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  const quietWindowStartMs = elapsedMs();
  const audioFrameCountAtAck = C.wire.packetRecords.received.audio.filter((packet) => packet.atMs >= quietWindowStartMs).length;
  const screenFrameCountAtAck = C.wire.packetRecords.received.screen.filter((packet) => packet.atMs >= quietWindowStartMs).length;
  await new Promise((resolveWait) => setTimeout(resolveWait, 700));
  const audioFramesAfterInteraction = C.wire.packetRecords.received.audio.filter((packet) => packet.atMs >= interactionAckAtMs).length;
  const screenFramesAfterInteraction = C.wire.packetRecords.received.screen.filter((packet) => packet.atMs >= interactionAckAtMs).length;
  assert.equal(audioFramesAfterInteraction, audioFrameCountAtAck, "C's audio downlink must remain at zero after the server accepts interaction-only mode.");
  assert.equal(screenFramesAfterInteraction, screenFrameCountAtAck, "C's screen downlink must remain at zero after the server accepts interaction-only mode.");
  assertOnlySourceGenerations(C, "audio", [], { afterMs: quietWindowStartMs, label: "audio while in interaction-only mode" });
  assert.equal(interactionAck.audioSubscribed, false, "The server should report audio unsubscribed in interaction-only mode.");
  assert.equal(interactionAck.screenSubscribed, false, "The server should report screen unsubscribed in interaction-only mode.");
  report.interactionMode = {
    changedAtMs: interactionAckAtMs,
    mode: interactionAck.mode,
    serverAudioSubscribed: interactionAck.audioSubscribed,
    serverScreenSubscribed: interactionAck.screenSubscribed,
    audioDownlinkFramesIn700msWindow: audioFramesAfterInteraction - audioFrameCountAtAck,
    screenDownlinkFramesIn700msWindow: screenFramesAfterInteraction - screenFrameCountAtAck,
    quietWindowStartedAtMs: quietWindowStartMs,
  };
  stage("C-interaction-only-has-zero-media-downlink", { mode: "interaction", audioFrames: report.interactionMode.audioDownlinkFramesIn700msWindow, screenFrames: report.interactionMode.screenDownlinkFramesIn700msWindow });

  // All application media evidence is synthetic. Close the publisher controls through their normal UI, then let finally close every Firefox context.
  for (const publisher of [A, B]) {
    const stopButton = publisher.page.locator('[data-testid="audio-stop-publishing"]');
    if (await stopButton.count() && await stopButton.isVisible()) await stopButton.click().catch(() => {});
  }
  for (const client of clients.values()) {
    for (const direction of ["sent", "received"]) {
      for (const channel of ["audio", "screen"]) {
        assert.equal(client.wire.droppedPacketRecords[direction][channel], 0, `${client.name} ${direction} ${channel} trace must fit within the bounded packet cap.`);
      }
    }
  }
  activeMediaFinishedAtMs = Date.now();
}

async function writeReport() {
  report.finishedAt = new Date().toISOString();
  report.durationMs = elapsedMs();
  report.activeMediaDurationMs = activeMediaStartedAtMs === null ? null : Math.max(0, (activeMediaFinishedAtMs ?? Date.now()) - activeMediaStartedAtMs);
  report.status = failure ? "failed" : "passed";
  report.errors.failure = failure ? String(failure.stack ?? failure).slice(0, 2_000) : null;
  report.transport = [...clients.values()].map(safeClientTransport);
  writeFileSync(join(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(outputDirectory, "README.md"), [
    "# POC-MA-01 browser smoke",
    "",
    `Status: ${report.status}`,
    `Started: ${report.startedAt}`,
    `Finished: ${report.finishedAt}`,
    `Topology: four isolated Firefox processes over trusted local HTTPS/WSS; A/B publish in studio, C joins late, and D stays in lobby.`,
    "",
    "Audio and screen sources are generated in the test pages. The microphone and display APIs are replaced only in A/B test contexts; there is no physical microphone, native picker, real display capture, or human listening claim.",
    "",
    "The report retains compact WebSocket control summaries and bounded binary packet metadata plus SHA-256 hashes, never media payloads or recovery secrets. Per-source playback assertions use the source owner’s `data-audio-streams` AudioWorklet PCM counters.",
    "",
    "This is a short local feasibility smoke. It does not measure latency or listening quality, test phones, prove physical network recovery, establish capacity or endurance, or validate persistence/deployment.",
    "",
    failure ? `Failure: ${String(failure.stack ?? failure).slice(0, 1_000)}` : "Failure: none",
    "",
  ].join("\n"), { mode: 0o600 });
}

try {
  await runSmoke();
} catch (error) {
  failure = error;
  console.error(`[MA01] failure ${String(error?.stack ?? error).slice(0, 1_200)}`);
} finally {
  if (failure) await saveFailureScreenshots();
  for (const client of clients.values()) await cleanupSyntheticPage(client);
  for (const context of contexts) {
    try { await context.close(); }
    catch (error) { pushBounded(report.errors.cleanupErrors, { code: "firefox_context_close_failed", message: String(error?.message ?? error).slice(0, 240) }, 24, "cleanup-errors"); }
  }
  for (const folder of runtimeFolders) {
    try { rmSync(folder, { recursive: true, force: true }); }
    catch (error) { pushBounded(report.errors.cleanupErrors, { code: "isolated_profile_cleanup_failed", message: String(error?.message ?? error).slice(0, 240) }, 24, "cleanup-errors"); }
  }
  try { await writeReport(); }
  catch (error) {
    console.error(`[MA01] could not save report: ${String(error?.message ?? error)}`);
    if (!failure) failure = error;
  }
}

if (failure) process.exitCode = 1;
