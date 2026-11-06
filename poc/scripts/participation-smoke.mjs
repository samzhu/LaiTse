import { enterRepositoryRootForLegacyScript, repositoryRoot, pocRoot } from "./lib/project-paths.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { get as httpsGet } from "node:https";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

enterRepositoryRootForLegacyScript();

const require = createRequire(import.meta.url);
const jsQR = require("jsqr");
const root = repositoryRoot;
const hostToken = process.env.PARTICIPATION_TEST_HOST_TOKEN ?? "";
const roomPassword = process.env.PARTICIPATION_TEST_ROOM_PASSWORD ?? "";
if (Buffer.byteLength(hostToken, "utf8") < 32 || Buffer.byteLength(hostToken, "utf8") > 256) {
  throw new Error("PARTICIPATION_TEST_HOST_TOKEN must be a 32–256 byte host token.");
}
if (!roomPassword || roomPassword === hostToken) {
  throw new Error("PARTICIPATION_TEST_ROOM_PASSWORD must be set and distinct from the host token.");
}

const secrets = [hostToken, roomPassword, "T11_PRIVATE_" + randomUUID()];
const privateChatSentinel = secrets[2];
const publicDanmaku = "T11 public room check";
const chatDraft = "T11 unsent chat draft";
const danmakuDraft = "T11 unsent public draft";
const scratchRoot = resolve(root, ".scratch/t11");
const outputDirectory = resolve(root, process.env.PARTICIPATION_OUTPUT_DIR ?? ".scratch/t11/acceptance");
const outputRelative = relative(scratchRoot, outputDirectory);
if (isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(".." + sep)) {
  throw new Error("PARTICIPATION_OUTPUT_DIR must stay inside .scratch/t11.");
}

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, ".tools/playwright-browsers");
const { firefox } = await import("playwright");
const caCertificate = resolve(process.env.PARTICIPATION_CA_CERT ?? process.env.CA_CERT ?? ".scratch/t01/tls/local-ca.pem");
const caPem = readFileSync(caCertificate);
const baseURL = process.env.PARTICIPATION_BASE_URL ?? "https://localhost:4173";
const target = new URL(baseURL);
if (target.protocol !== "https:" || target.username || target.password || target.search || target.hash) {
  throw new Error("PARTICIPATION_BASE_URL must be an HTTPS origin without credentials, query, or fragment.");
}
const certificateUtility = process.env.CERTUTIL_BIN ?? "certutil";
const headless = process.env.HEADLESS !== "0";
const MAX_CONTROL_RECORDS = 1_200;
const MAX_PACKET_RECORDS = 8_000;
const MAX_PROBE_RECORDS = 250;
const ZERO_WINDOW_TARGET_MS = 425;
const ZERO_WINDOW_MAX_MS = 2_000;
const contexts = [];
const clients = {};
const probeSockets = new Set();
let failure = null;
let hostSourcesStarted = false;
let hostSourcesStopped = false;
const runStartedMs = Date.now();

const report = {
  schemaVersion: 1,
  purpose: "Short T11 local desktop check for deep room entry, interaction-only media gating, read-only display privacy, screen rendering, and QR pixel decoding.",
  startedAt: new Date().toISOString(),
  status: "running",
  baseURL: target.origin,
  runtime: { node: process.version, platform: process.platform, architecture: process.arch, firefox: "not-reported" },
  tls: {
    caCertificate,
    trust: "local CA imported only into three isolated Firefox profiles and supplied to Node WSS probes",
    ignoreCertificateErrors: false,
    systemTrustChanged: false,
  },
  topology: { isolatedFirefoxProfiles: 3, roomId: "studio", browsers: ["host", "participant", "display"] },
  source: {
    audio: "synthetic oscillator routed through AudioContext MediaStreamDestination",
    screen: "synthetic animated canvas captureStream",
    physicalMicrophone: false,
    physicalDisplay: false,
    mediaPayloadsRetained: false,
  },
  checks: [],
  sourceWitness: [],
  clients: {},
  probes: [],
  qr: { pixelDecode: "not-run", decodedPublicJoinUrl: null, width: null, height: null },
  privacy: {
    privateChatTextRecorded: false,
    displayRawPrivateChatLeak: false,
    displayRawHistoryCount: 0,
    displayNonPublicInteractionEventCount: 0,
    displayReceivedAudioBinaryFrames: 0,
    displayPublishedMediaControls: 0,
  },
  screenshots: [],
  limits: {
    phonesAndCameraQRScan: "not-tested",
    realMicrophoneOrHumanListening: "not-tested; all audio is synthetic",
    physicalDisplayCapture: "not-tested; the source is an injected canvas",
    endToEndQualityOrLatency: "not-tested",
    accountsAndDurableIdentity: "not-tested; participant IDs are connection-scoped",
    capacityOrLongRun: "not-tested; no 100-event benchmark or p95 claim",
    deployment: "not-tested; local POC only",
  },
  errors: { pageErrors: [], socketErrors: [], collectionErrors: [], cleanupErrors: [], failure: null },
};

mkdirSync(outputDirectory, { recursive: true });

function redact(value) {
  let output = String(value ?? "");
  for (const secret of secrets) if (secret) output = output.split(secret).join("[redacted]");
  return output.slice(0, 8_000);
}

function sanitize(value) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  const clean = {};
  for (const [key, item] of Object.entries(value)) clean[key] = sanitize(item);
  return clean;
}

function stage(name, details = {}) {
  const item = sanitize({ name, at: new Date().toISOString(), ...details });
  report.checks.push(item);
  const safeDetails = { ...item };
  delete safeDetails.name;
  delete safeDetails.at;
  console.log("[T11] " + name + (Object.keys(safeDetails).length ? " " + JSON.stringify(safeDetails) : ""));
}

function currentConnection(client) {
  assert.ok(client?.currentConnection, "expected the browser WebSocket connection to exist.");
  return client.currentConnection;
}

function runCertutil(args) {
  execFileSync(certificateUtility, args, { stdio: "pipe" });
}

function createTrustedProfile(name) {
  const folder = join(outputDirectory, name);
  const profileDirectory = join(folder, "profile");
  rmSync(profileDirectory, { recursive: true, force: true });
  mkdirSync(profileDirectory, { recursive: true });
  runCertutil(["-N", "-d", "sql:" + profileDirectory, "--empty-password"]);
  runCertutil(["-A", "-d", "sql:" + profileDirectory, "-n", "LaiTse local development CA", "-t", "C,,", "-i", caCertificate]);
  const appData = join(folder, "app-data");
  const localAppData = join(folder, "local-app-data");
  mkdirSync(appData, { recursive: true });
  mkdirSync(localAppData, { recursive: true });
  return { profileDirectory, appData, localAppData };
}

function parseControl(raw, direction, sequence, connectionId) {
  let message;
  try { message = JSON.parse(raw); } catch { return { direction, sequence, connectionId, type: "unparsed-control" }; }
  const record = {
    direction,
    sequence,
    connectionId,
    type: typeof message?.type === "string" ? message.type : "unknown",
  };
  for (const key of [
    "roomId", "currentRoomId", "participantId", "role", "mode", "code", "action",
    "eventId", "interactionId", "kind", "paused", "enabled", "duplicate",
  ]) {
    if (typeof message?.[key] === "string" || typeof message?.[key] === "boolean") record[key] = message[key];
  }
  if (message?.type === "room.snapshot") {
    record.roomId = message.room?.id ?? "";
    record.isLocked = Boolean(message.room?.isLocked);
    record.memberCount = Array.isArray(message.members) ? message.members.length : 0;
  }
  if (message?.type === "participation.self") {
    record.roomId = message.roomId ?? null;
    record.participantId = message.participantId ?? null;
    record.role = message.role;
    record.mode = message.mode;
    record.media = {
      audio: {
        subscribed: Boolean(message.media?.audio?.subscribed),
        downlinkBytes: Number(message.media?.audio?.downlinkBytes ?? 0),
        downlinkFrames: Number(message.media?.audio?.downlinkFrames ?? 0),
      },
      screen: {
        subscribed: Boolean(message.media?.screen?.subscribed),
        downlinkBytes: Number(message.media?.screen?.downlinkBytes ?? 0),
        downlinkFrames: Number(message.media?.screen?.downlinkFrames ?? 0),
      },
    };
  }
  if (message?.type === "participation.modeChanged") {
    record.roomId = message.roomId;
    record.role = message.role;
    record.mode = message.mode;
    record.media = {
      audioSubscribed: Boolean(message.media?.audioSubscribed),
      screenSubscribed: Boolean(message.media?.screenSubscribed),
    };
  }
  if (message?.type === "interaction.snapshot" || message?.type === "interaction.state") {
    record.roomId = message.roomId;
    record.historyCount = Array.isArray(message.history) ? message.history.length : 0;
    record.historyKinds = Array.isArray(message.history) ? message.history.map((event) => event.kind) : [];
    record.publicKinds = Array.isArray(message.publicQueue) ? message.publicQueue.map((event) => event.kind) : [];
    record.queueCount = Number(message.queueCount ?? 0);
    record.feedbackCounts = {};
    for (const [key, item] of Object.entries(message.feedbackStats ?? {})) {
      record.feedbackCounts[key] = Number(item?.count ?? 0);
    }
  }
  if (message?.type === "interaction.event") {
    record.roomId = message.roomId;
    record.eventKind = message.event?.kind;
    record.participantId = message.event?.participantId;
    record.interactionId = message.event?.id;
    record.stateHistoryCount = Array.isArray(message.state?.history) ? message.state.history.length : 0;
  }
  if (message?.type === "interaction.ack") record.acknowledged = true;
  return record;
}

function asBuffer(payload) {
  if (Buffer.isBuffer(payload)) return payload;
  if (payload instanceof Uint8Array) return Buffer.from(payload);
  if (typeof payload === "string") return Buffer.from(payload, "binary");
  return null;
}

function addBinary(client, connection, payload, direction) {
  const bytes = asBuffer(payload);
  if (!bytes) return;
  const magic = bytes.toString("ascii", 0, 4);
  const channel = magic === "LTA1" ? "audio" : magic === "LTS1" ? "screen" : "unknown";
  connection.packets[direction][channel].frames += 1;
  connection.packets[direction][channel].bytes += bytes.byteLength;
  if (connection.packetFrames.length >= MAX_PACKET_RECORDS) {
    connection.collectionOverflow = true;
    return;
  }
  connection.packetFrames.push({
    sequence: ++client.sequence,
    direction,
    channel,
    bytes: bytes.byteLength,
    afterStartMs: Date.now() - runStartedMs,
  });
}

function addControl(client, connection, payload, direction) {
  const raw = typeof payload === "string" ? payload : asBuffer(payload)?.toString("utf8") ?? "";
  if (direction === "received") {
    if (raw.includes(hostToken)) client.inboundHostTokenLeak = true;
    if (raw.includes(roomPassword)) client.inboundRoomPasswordLeak = true;
    if (client.name === "display" && raw.includes(privateChatSentinel)) client.privateChatLeak = true;
  }
  const record = parseControl(raw, direction, ++client.sequence, connection.id);
  record.afterStartMs = Date.now() - runStartedMs;
  if (connection.controls.length >= MAX_CONTROL_RECORDS) {
    connection.collectionOverflow = true;
    return;
  }
  connection.controls.push(record);
  if (record.type === "participation.self") connection.latestSelf = record;
  if (client.name === "display" && direction === "received") {
    if ((record.type === "interaction.snapshot" || record.type === "interaction.state") && record.historyCount > 0) {
      client.displayHistoryCount += record.historyCount;
    }
    if (record.type === "interaction.event" && record.eventKind !== "feedback" && record.eventKind !== "danmaku") {
      client.displayNonPublicEventCount += 1;
    }
  }
}

function attachPage(page, name) {
  const client = {
    name,
    page,
    connections: [],
    currentConnection: null,
    nextConnectionId: 1,
    sequence: 0,
    pageErrors: [],
    inboundHostTokenLeak: false,
    inboundRoomPasswordLeak: false,
    privateChatLeak: false,
    displayHistoryCount: 0,
    displayNonPublicEventCount: 0,
  };
  page.on("pageerror", (error) => {
    const item = redact(error?.stack ?? error?.message ?? error);
    client.pageErrors.push(item);
    report.errors.pageErrors.push({ client: name, message: item });
  });
  page.on("websocket", (socket) => {
    const connection = {
      id: client.nextConnectionId++,
      controls: [],
      packetFrames: [],
      collectionOverflow: false,
      packets: {
        sent: { audio: { frames: 0, bytes: 0 }, screen: { frames: 0, bytes: 0 }, unknown: { frames: 0, bytes: 0 } },
        received: { audio: { frames: 0, bytes: 0 }, screen: { frames: 0, bytes: 0 }, unknown: { frames: 0, bytes: 0 } },
      },
      latestSelf: null,
    };
    client.connections.push(connection);
    client.currentConnection = connection;
    socket.on("framesent", (frame) => {
      if (typeof frame.payload === "string") addControl(client, connection, frame.payload, "sent");
      else addBinary(client, connection, frame.payload, "sent");
    });
    socket.on("framereceived", (frame) => {
      if (typeof frame.payload === "string") addControl(client, connection, frame.payload, "received");
      else addBinary(client, connection, frame.payload, "received");
    });
    socket.on("socketerror", (error) => {
      report.errors.socketErrors.push({ client: name, message: redact(error) });
    });
  });
  clients[name] = client;
  return client;
}

async function installSyntheticSources(page, frequency) {
  await page.addInitScript(({ frequency }) => {
    const state = { frequency, audioCalls: 0, screenCalls: 0, audioContext: null, tracks: [] };
    Object.defineProperty(window, "__t11Synthetic", { value: state });
    const devices = navigator.mediaDevices;
    Object.defineProperty(devices, "getUserMedia", {
      configurable: true,
      value: async () => {
        state.audioCalls += 1;
        const context = new AudioContext({ sampleRate: 48_000 });
        await context.resume();
        const destination = context.createMediaStreamDestination();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = state.frequency;
        gain.gain.value = 0.22;
        oscillator.connect(gain).connect(destination);
        oscillator.start();
        state.audioContext = context;
        state.tracks.push(...destination.stream.getTracks());
        return destination.stream;
      },
    });
    Object.defineProperty(devices, "getDisplayMedia", {
      configurable: true,
      value: async () => {
        state.screenCalls += 1;
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 180;
        const drawing = canvas.getContext("2d");
        if (!drawing) throw new Error("Synthetic screen source could not create a canvas context.");
        let active = true;
        const render = () => {
          if (!active) return;
          drawing.fillStyle = "#265c8c";
          drawing.fillRect(0, 0, canvas.width, canvas.height);
          drawing.fillStyle = "#f4d35e";
          drawing.fillRect(12, 12, 48, 14);
          requestAnimationFrame(render);
        };
        render();
        const stream = canvas.captureStream(10);
        const track = stream.getVideoTracks()[0];
        if (!track) throw new Error("Synthetic screen source did not return a video track.");
        state.tracks.push(track);
        const stop = track.stop.bind(track);
        track.stop = () => { active = false; stop(); };
        return stream;
      },
    });
  }, { frequency });
}

async function launchClient(name, frequency) {
  const profile = createTrustedProfile(name);
  const browserEnv = { ...process.env, MOZ_APP_DATA: profile.appData, MOZ_LOCAL_APP_DATA: profile.localAppData };
  for (const key of Object.keys(browserEnv)) {
    if (/token|password|secret/i.test(key)) delete browserEnv[key];
  }
  const context = await firefox.launchPersistentContext(profile.profileDirectory, {
    headless,
    env: browserEnv,
    viewport: { width: 1440, height: 1050 },
    colorScheme: "light",
    firefoxUserPrefs: { "media.navigator.streams.fake": true },
  });
  context.setDefaultTimeout(8_000);
  context.setDefaultNavigationTimeout(15_000);
  contexts.push(context);
  const page = context.pages()[0] ?? await context.newPage();
  const client = attachPage(page, name);
  if (name === "host" || name === "participant") await installSyntheticSources(page, frequency);
  return { page, client };
}

function assertCollectionHealthy() {
  for (const client of Object.values(clients)) {
    for (const connection of client.connections) {
      if (connection.collectionOverflow) {
        report.errors.collectionErrors.push({ client: client.name, connectionId: connection.id, code: "bounded_trace_cap_reached" });
        throw new Error("A bounded WebSocket trace cap was reached.");
      }
    }
  }
}

async function waitFor(predicate, description, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assertCollectionHealthy();
    const value = await predicate();
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error("Timed out waiting for " + description + ".");
}

function latestControl(connection, type, predicate = () => true) {
  return [...connection.controls].reverse().find((entry) => entry.type === type && predicate(entry)) ?? null;
}

async function waitForControl(connection, predicate, description, afterSequence = 0, timeoutMs = 8_000) {
  return waitFor(
    () => connection.controls.find((entry) => entry.sequence > afterSequence && predicate(entry)) ?? null,
    description,
    timeoutMs,
  );
}

function packetCounts(connection, direction) {
  return {
    audioFrames: connection.packets[direction].audio.frames,
    audioBytes: connection.packets[direction].audio.bytes,
    screenFrames: connection.packets[direction].screen.frames,
    screenBytes: connection.packets[direction].screen.bytes,
  };
}

function serverMedia(self) {
  return {
    audio: {
      subscribed: self.media.audio.subscribed,
      bytes: self.media.audio.downlinkBytes,
      frames: self.media.audio.downlinkFrames,
    },
    screen: {
      subscribed: self.media.screen.subscribed,
      bytes: self.media.screen.downlinkBytes,
      frames: self.media.screen.downlinkFrames,
    },
  };
}

function assertNoSubscriptions(self, description) {
  assert.equal(self.media.audio.subscribed, false, description + ": server audio subscription must be false.");
  assert.equal(self.media.screen.subscribed, false, description + ": server screen subscription must be false.");
}

async function getRoomCatalogue() {
  return new Promise((resolveResponse, reject) => {
    const request = httpsGet(target.origin + "/api/rooms", { ca: caPem }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          const rooms = JSON.parse(body);
          const serialized = JSON.stringify(rooms);
          assert.equal(serialized.includes(hostToken), false, "room catalogue must not expose the host token.");
          assert.equal(serialized.includes(roomPassword), false, "room catalogue must not expose the room password.");
          resolveResponse({ status: response.statusCode, rooms });
        } catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
  });
}

async function verifyManagedRuntime() {
  const response = await getRoomCatalogue();
  assert.equal(response.status, 200, "local room catalogue should be available over trusted HTTPS.");
  const room = response.rooms.find((item) => item.id === "studio");
  assert.ok(room, "studio must exist in the local room catalogue.");
  assert.equal(room.isLocked, true, "the configured meeting-room password must lock studio.");
  assert.equal(room.hostControlsEnabled, true, "managed host controls must be enabled for this smoke.");
  report.runtime.room = { roomId: room.id, locked: room.isLocked, hostControlsEnabled: room.hostControlsEnabled };
  stage("managed-runtime-locked-room-and-host-controls", { roomId: room.id, locked: room.isLocked, hostControlsEnabled: room.hostControlsEnabled });
}

function browserUrl(search) {
  return new URL(search, target.origin).href;
}

async function enterRoomThroughGate(page, client, name, query) {
  await page.goto(browserUrl(query), { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Local room presence" }).waitFor();
  await page.getByLabel("Your display name").fill(name);
  await page.getByRole("button", { name: "Join room", exact: true }).click();
  await page.getByLabel("Meeting room password").waitFor({ state: "visible" });
  await page.locator("#meeting-room-password").fill(roomPassword);
  await page.getByRole("button", { name: "Enter room", exact: true }).click();
  await page.getByText("Connected to Meeting room", { exact: true }).waitFor();
  await page.getByTestId("participation-controls").waitFor();
  const connection = currentConnection(client);
  const roomSnapshot = await waitForControl(connection, (item) => item.type === "room.snapshot", "participant room snapshot");
  const interactionSnapshot = await waitForControl(connection, (item) => item.type === "interaction.snapshot", "participant interaction snapshot", roomSnapshot.sequence);
  const self = await waitForControl(connection, (item) => item.type === "participation.self", "participant self snapshot", interactionSnapshot.sequence);
  assert.ok(roomSnapshot.sequence < interactionSnapshot.sequence && interactionSnapshot.sequence < self.sequence, "room, interaction, then participation snapshots should arrive in order.");
  assert.equal(roomSnapshot.roomId, "studio");
  assert.equal(roomSnapshot.isLocked, true);
  assert.equal(self.roomId, "studio");
  assert.equal(self.role, "participant");
  return { connection, roomSnapshot, interactionSnapshot, self };
}

async function joinDisplay(display) {
  await display.page.goto(browserUrl("/?room=studio&view=display"), { waitUntil: "domcontentloaded" });
  await display.page.getByTestId("display-page").waitFor();
  await display.page.getByTestId("display-join").click();
  await display.page.getByLabel("Meeting room password").waitFor({ state: "visible" });
  await display.page.locator("#meeting-room-password").fill(roomPassword);
  await display.page.getByRole("button", { name: "Enter room", exact: true }).click();
  await display.page.getByRole("heading", { name: "Meeting room" }).waitFor();
  await display.page.getByTestId("display-interactions").waitFor();
  const connection = currentConnection(display.client);
  const roomSnapshot = await waitForControl(connection, (item) => item.type === "room.snapshot", "display room snapshot");
  const interactionSnapshot = await waitForControl(connection, (item) => item.type === "interaction.snapshot", "display interaction snapshot", roomSnapshot.sequence);
  assert.equal(roomSnapshot.roomId, "studio");
  assert.equal(roomSnapshot.isLocked, true);
  assert.equal(interactionSnapshot.roomId, "studio");
  assert.equal(interactionSnapshot.historyCount, 0, "display interaction snapshot must start without private history.");
  return { connection, roomSnapshot, interactionSnapshot };
}

async function startHostSources(host) {
  await host.page.getByLabel("主持密鑰").fill(hostToken);
  await host.page.getByTestId("host-claim").click();
  await host.page.getByTestId("host-state").filter({ hasText: "HOST" }).waitFor();
  const connection = currentConnection(host.client);
  const claim = await waitForControl(connection, (item) => item.type === "host.claimed", "host claim acknowledgement");
  await host.page.getByRole("button", { name: "開始麥克風" }).click();
  await host.page.getByRole("button", { name: "開始分享畫面" }).click();
  await waitFor(
    () => packetCounts(connection, "sent").audioFrames > 0 && packetCounts(connection, "sent").screenFrames > 0,
    "host synthetic audio and screen source packets",
    15_000,
  );
  hostSourcesStarted = true;
  stage("host-claimed-and-synthetic-audio-screen-active", {
    claimSequence: claim.sequence,
    sourceSent: packetCounts(connection, "sent"),
    audioCalls: await host.page.evaluate(() => window.__t11Synthetic.audioCalls),
    screenCalls: await host.page.evaluate(() => window.__t11Synthetic.screenCalls),
  });
}

async function waitForDisplayRender(display) {
  await display.page.waitForFunction(() => {
    const panel = document.querySelector('[data-testid="screen-panel"]');
    return Number(panel?.getAttribute("data-rendered-frames")) > 2;
  }, undefined, { timeout: 20_000 });
  const visual = await display.page.getByTestId("screen-preview").evaluate((canvas) => {
    const context = canvas.getContext("2d");
    if (!context || canvas.width < 1 || canvas.height < 1) return { width: canvas.width, height: canvas.height, uniqueColors: 0 };
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const samples = new Set();
    const stepX = Math.max(1, Math.floor(canvas.width / 12));
    const stepY = Math.max(1, Math.floor(canvas.height / 8));
    for (let y = 0; y < canvas.height; y += stepY) {
      for (let x = 0; x < canvas.width; x += stepX) {
        const offset = (y * canvas.width + x) * 4;
        samples.add(image.data[offset] + "," + image.data[offset + 1] + "," + image.data[offset + 2]);
      }
    }
    return { width: canvas.width, height: canvas.height, uniqueColors: samples.size };
  });
  assert.ok(visual.width > 0 && visual.height > 0 && visual.uniqueColors > 1, "display canvas should contain rendered, non-uniform screen pixels.");
  const connection = currentConnection(display.client);
  assert.ok(packetCounts(connection, "received").screenFrames > 2, "display WebSocket should receive screen binary frames.");
  assert.equal(packetCounts(connection, "received").audioFrames, 0, "display must not receive audio binary frames.");
  const typesSent = connection.controls.filter((item) => item.direction === "sent").map((item) => item.type);
  assert.ok(typesSent.includes("screen.subscribe"), "display should subscribe to the shared screen.");
  assert.equal(typesSent.includes("audio.subscribe"), false, "display must not subscribe to audio.");
  assert.equal(await display.page.getByRole("button", { name: "開始麥克風" }).count(), 0);
  assert.equal(await display.page.getByRole("button", { name: "開始分享畫面" }).count(), 0);
  assert.equal(await display.page.getByTestId("host-panel").count(), 0);
  report.privacy.displayReceivedAudioBinaryFrames = packetCounts(connection, "received").audioFrames;
  stage("display-readonly-auto-rendered-real-decoded-screen-no-audio", {
    renderedFrames: Number(await display.page.getByTestId("screen-panel").getAttribute("data-rendered-frames")),
    visual,
    receivedBinaryFrames: packetCounts(connection, "received"),
    audioSubscribeSent: typesSent.includes("audio.subscribe"),
    hostPanelCount: await display.page.getByTestId("host-panel").count(),
  });
}

function baseWSURL() {
  return target.origin.replace(/^http/u, "ws");
}

function makeProbe(name) {
  return {
    name,
    socket: null,
    messages: [],
    binary: [],
    sequence: 0,
    overflow: false,
    hostTokenLeak: false,
    roomPasswordLeak: false,
  };
}

function attachProbe(probe, socket) {
  probe.socket = socket;
  probeSockets.add(socket);
  socket.on("message", (raw, isBinary) => {
    if (isBinary) {
      if (probe.binary.length >= MAX_PROBE_RECORDS) {
        probe.overflow = true;
        return;
      }
      const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      probe.binary.push({ sequence: ++probe.sequence, bytes: bytes.byteLength, magic: bytes.toString("ascii", 0, 4) });
      return;
    }
    const rawText = raw.toString();
    if (rawText.includes(hostToken)) probe.hostTokenLeak = true;
    if (rawText.includes(roomPassword)) probe.roomPasswordLeak = true;
    if (probe.messages.length >= MAX_PROBE_RECORDS) {
      probe.overflow = true;
      return;
    }
    probe.messages.push(parseControl(rawText, "received", ++probe.sequence, 1));
  });
  socket.on("error", (error) => report.errors.socketErrors.push({ client: probe.name, message: redact(error) }));
}

async function openProbe(name) {
  const probe = makeProbe(name);
  const socket = new WebSocket(baseWSURL() + "/ws", { origin: target.origin, ca: caPem });
  attachProbe(probe, socket);
  await new Promise((resolveOpen, reject) => {
    socket.once("open", resolveOpen);
    socket.once("error", reject);
  });
  return probe;
}

async function waitProbeMessage(probe, predicate, description, fromIndex = 0, timeoutMs = 5_000) {
  return waitFor(
    () => {
      if (probe.overflow) {
        report.errors.collectionErrors.push({ client: probe.name, code: "bounded_probe_cap_reached" });
        throw new Error("A bounded external probe trace cap was reached.");
      }
      return probe.messages.slice(fromIndex).find(predicate) ?? null;
    },
    probe.name + " " + description,
    timeoutMs,
  );
}

async function runDisplayWriteProbe() {
  const probe = await openProbe("display-readonly");
  const firstIndex = probe.messages.length;
  probe.socket.send(JSON.stringify({
    type: "join",
    roomId: "studio",
    displayName: "T11 Display Probe",
    role: "display",
    mode: "watch",
    password: roomPassword,
  }));
  const joined = await waitProbeMessage(probe, (item) => item.type === "room.snapshot" && item.roomId === "studio", "room join", firstIndex);
  const interaction = await waitProbeMessage(probe, (item) => item.type === "interaction.snapshot" && item.roomId === "studio", "interaction snapshot", firstIndex);
  const participation = await waitProbeMessage(probe, (item) => item.type === "participation.self" && item.roomId === "studio", "self snapshot", firstIndex);
  assert.equal(joined.isLocked, true);
  assert.equal(interaction.historyCount, 0);
  assert.equal(participation.role, "display");
  assert.equal(participation.mode, "watch");

  const attempts = [
    { label: "audio.start", payload: { type: "audio.start", codec: "opus", sampleRate: 48_000, channels: 1, bitrate: 32_000, frameDurationUs: 20_000 } },
    { label: "screen.start", payload: { type: "screen.start", codec: "vp8", width: 320, height: 180, frameRate: 10, bitrate: 500_000 } },
    { label: "interaction.submit", payload: { type: "interaction.submit", eventId: "t11-display-forbidden", kind: "chat", text: "safe probe fixture" } },
    { label: "legacy reaction", payload: { type: "reaction", reaction: "wave" } },
    { label: "host.claim with configured token", payload: { type: "host.claim", token: hostToken } },
    { label: "host.interaction.clearQueue", payload: { type: "host.interaction.clearQueue" } },
    { label: "participation.setMode", payload: { type: "participation.setMode", mode: "interaction" } },
  ];
  const outcomes = [];
  for (const attempt of attempts) {
    const fromIndex = probe.messages.length;
    probe.socket.send(JSON.stringify(attempt.payload));
    const response = await waitProbeMessage(
      probe,
      (item) => item.type === "protocol.error",
      attempt.label + " read-only rejection",
      fromIndex,
    );
    assert.equal(response.code, "display_read_only", attempt.label + " should use the explicit display_read_only protocol path.");
    outcomes.push({ operation: attempt.label, code: response.code });
  }
  for (const [label, magic] of [["audio LTA1", "LTA1"], ["screen LTS1", "LTS1"]]) {
    const fromIndex = probe.messages.length;
    const bytes = Buffer.from(magic + "\u0000\u0000\u0000\u0001\u0000\u0000\u0000\u0000", "binary");
    probe.socket.send(bytes);
    const response = await waitProbeMessage(
      probe,
      (item) => item.type === "protocol.error",
      label + " read-only rejection",
      fromIndex,
    );
    assert.equal(response.code, "display_read_only", label + " should use the explicit display_read_only protocol path.");
    outcomes.push({ operation: label + " binary", code: response.code });
  }
  assert.equal(probe.overflow, false, "external probe trace must remain within its cap.");
  assert.equal(probe.hostTokenLeak, false, "server control responses must not reveal the host token.");
  assert.equal(probe.roomPasswordLeak, false, "server control responses must not reveal the room password.");
  report.probes.push({
    name: probe.name,
    joinedRole: participation.role,
    joinedMode: participation.mode,
    roomId: participation.roomId,
    operations: outcomes,
    responseCount: probe.messages.length,
    traceCapReached: probe.overflow,
  });
  stage("external-display-write-and-media-publish-attempts-rejected", { operations: outcomes.length, allExplicitDisplayReadOnly: outcomes.every((item) => item.code === "display_read_only") });
  probe.socket.close();
  probeSockets.delete(probe.socket);
}

async function inspectParticipant(page, connection, afterSequence = 0, description = "participation inspection") {
  await page.getByTestId("participation-inspect").click();
  return waitForControl(connection, (item) => item.type === "participation.self", description, afterSequence);
}

async function provePassiveWindow({ label, participant, host, boundarySelf, modeAck = null }) {
  const connection = currentConnection(participant.client);
  assertNoSubscriptions(boundarySelf, label + " boundary");
  const rawBefore = packetCounts(connection, "received");
  const sourceConnection = currentConnection(host.client);
  const sourceBefore = packetCounts(sourceConnection, "sent");
  const startedAt = Date.now();
  await new Promise((resolveWait) => setTimeout(resolveWait, ZERO_WINDOW_TARGET_MS));
  let sourceAfter = packetCounts(sourceConnection, "sent");
  const deadline = startedAt + ZERO_WINDOW_MAX_MS;
  while ((sourceAfter.audioFrames <= sourceBefore.audioFrames || sourceAfter.screenFrames <= sourceBefore.screenFrames) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    sourceAfter = packetCounts(sourceConnection, "sent");
  }
  const endedAt = Date.now();
  assert.ok(sourceAfter.audioFrames > sourceBefore.audioFrames, label + " must include active host audio source frames.");
  assert.ok(sourceAfter.screenFrames > sourceBefore.screenFrames, label + " must include active host screen source frames.");

  const beforeInspectSequence = connection.controls.at(-1)?.sequence ?? boundarySelf.sequence;
  const inspected = await inspectParticipant(participant.page, connection, beforeInspectSequence, label + " inspected server state");
  const rawAfter = packetCounts(connection, "received");
  assert.deepEqual(rawAfter, rawBefore, label + " must have zero raw LTA1/LTS1 frames during the measured window.");
  assertNoSubscriptions(inspected, label + " inspected state");
  assert.deepEqual(serverMedia(inspected), serverMedia(boundarySelf), label + " must not increase the server enqueue counters after its boundary.");
  const startSequence = modeAck?.sequence ?? boundarySelf.sequence;
  const packetsAfterBoundary = connection.packetFrames.filter((item) =>
    item.direction === "received" && item.sequence > startSequence && item.sequence < inspected.sequence);
  assert.equal(packetsAfterBoundary.length, 0, label + " must have no raw media frame after the ACK/self boundary.");
  const witness = {
    label,
    targetWindowMs: ZERO_WINDOW_TARGET_MS,
    actualWindowMs: endedAt - startedAt,
    modeAckSequence: modeAck?.sequence ?? null,
    selfBoundarySequence: boundarySelf.sequence,
    inspectionSequence: inspected.sequence,
    hostSentBefore: sourceBefore,
    hostSentAfter: sourceAfter,
    receiverRawBefore: rawBefore,
    receiverRawAfter: rawAfter,
    serverStateBefore: serverMedia(boundarySelf),
    serverStateAfter: serverMedia(inspected),
    rawMediaFramesAfterAckOrSelf: packetsAfterBoundary.length,
  };
  report.sourceWitness.push(witness);
  stage(label, witness);
  return inspected;
}

async function waitForRenderedParticipantMedia(participant) {
  await participant.page.waitForFunction(() => {
    const audio = document.querySelector('[data-testid="audio-panel"]');
    const screen = document.querySelector('[data-testid="screen-panel"]');
    return Number(audio?.getAttribute("data-rendered-samples")) > 0 &&
      Number(screen?.getAttribute("data-rendered-frames")) > 2;
  }, undefined, { timeout: 20_000 });
  const media = await participant.page.evaluate(() => ({
    audioRenderedSamples: Number(document.querySelector('[data-testid="audio-panel"]')?.getAttribute("data-rendered-samples")),
    screenRenderedFrames: Number(document.querySelector('[data-testid="screen-panel"]')?.getAttribute("data-rendered-frames")),
    screenWidth: Number(document.querySelector('[data-testid="screen-panel"]')?.getAttribute("data-rendered-width")),
    screenHeight: Number(document.querySelector('[data-testid="screen-panel"]')?.getAttribute("data-rendered-height")),
  }));
  assert.ok(media.audioRenderedSamples > 0 && media.screenRenderedFrames > 2 && media.screenWidth > 0 && media.screenHeight > 0);
  return media;
}

async function setVolume(page, value) {
  const input = page.getByTestId("audio-volume");
  await input.evaluate((element, next) => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    descriptor?.set?.call(element, String(next));
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await page.getByTestId("audio-volume-value").filter({ hasText: String(Math.round(value * 100)) + "%" }).waitFor();
}

function assertDisplayPrivacy(display) {
  const connection = currentConnection(display.client);
  assert.equal(display.client.privateChatLeak, false, "the raw display WebSocket trace must not contain the private chat sentinel.");
  assert.equal(display.client.displayHistoryCount, 0, "display snapshot/state frames must contain empty private history.");
  assert.equal(display.client.displayNonPublicEventCount, 0, "display events must exclude chat and sticker kinds.");
  assert.equal(display.client.inboundHostTokenLeak, false, "server frames must not reveal the host token.");
  assert.equal(display.client.inboundRoomPasswordLeak, false, "server frames must not reveal the room password.");
  assert.equal(packetCounts(connection, "received").audioFrames, 0, "display must have zero audio binary frames.");
  const publishedMediaControls = connection.controls.filter((item) =>
    item.direction === "sent" && (item.type === "audio.start" || item.type === "screen.start")).length;
  assert.equal(publishedMediaControls, 0, "the display browser must not send media publishing controls.");
  return {
    displayRawPrivateChatLeak: display.client.privateChatLeak,
    displayRawHistoryCount: display.client.displayHistoryCount,
    displayNonPublicInteractionEventCount: display.client.displayNonPublicEventCount,
    displayReceivedAudioBinaryFrames: packetCounts(connection, "received").audioFrames,
    displayPublishedMediaControls: publishedMediaControls,
  };
}

async function decodeDisplayQr(display) {
  const link = await display.page.getByTestId("join-qr-link").getAttribute("href");
  assert.ok(link, "display join QR should include a public participant URL.");
  assert.equal((await display.page.getByTestId("join-qr-canvas").count()), 1);
  const pixels = await display.page.getByTestId("join-qr-canvas").evaluate((canvas) => {
    const context = canvas.getContext("2d");
    if (!context) return { width: canvas.width, height: canvas.height, data: [] };
    return { width: canvas.width, height: canvas.height, data: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data) };
  });
  assert.ok(pixels.width > 0 && pixels.height > 0 && pixels.data.length === pixels.width * pixels.height * 4, "QR canvas must contain real pixel data.");
  const decoded = jsQR(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height, { inversionAttempts: "attemptBoth" });
  assert.ok(decoded?.data, "independent QR decoder should read the rendered canvas pixels.");
  const decodedUrl = new URL(decoded.data);
  assert.equal(decodedUrl.origin, target.origin);
  assert.equal(decodedUrl.searchParams.get("room"), "studio");
  assert.equal(decodedUrl.searchParams.get("mode"), "interaction");
  assert.equal(decodedUrl.searchParams.has("view"), false);
  assert.equal(decodedUrl.searchParams.has("password"), false);
  assert.equal(decodedUrl.searchParams.has("token"), false);
  assert.equal(decoded.data.includes(hostToken), false);
  assert.equal(decoded.data.includes(roomPassword), false);
  assert.equal(link, decoded.data, "the public link should match the URL independently decoded from the QR pixels.");
  report.qr = {
    pixelDecode: "passed",
    decodedPublicJoinUrl: decodedUrl.href,
    width: pixels.width,
    height: pixels.height,
  };
  stage("display-qr-decoded-from-real-canvas-pixels", {
    decodedPublicJoinUrl: decodedUrl.href,
    width: pixels.width,
    height: pixels.height,
    hasPassword: decodedUrl.searchParams.has("password"),
    hasHostToken: decodedUrl.searchParams.has("token"),
  });
  return decodedUrl.href;
}

async function captureEvidence(display, participant) {
  const displayPath = join(outputDirectory, "display-live.png");
  await display.page.screenshot({ path: displayPath, fullPage: true, animations: "disabled" });
  report.screenshots.push("display-live.png");
  if (participant && await participant.page.getByTestId("interaction-panel").count()) {
    const participantPath = join(outputDirectory, "participant-interaction.png");
    await participant.page.getByTestId("interaction-panel").screenshot({ path: participantPath, animations: "disabled" });
    report.screenshots.push("participant-interaction.png");
  }
}

async function captureFailureEvidence() {
  const display = clients.display;
  const participant = clients.participant;
  if (display?.page && await display.page.getByTestId("display-page").count().catch(() => 0)) {
    const path = join(outputDirectory, "display-failure.png");
    try {
      await display.page.screenshot({ path, fullPage: true, animations: "disabled", timeout: 5_000 });
      report.screenshots.push("display-failure.png");
    } catch (error) { report.errors.cleanupErrors.push(redact(error?.stack ?? error)); }
  }
  if (participant?.page && await participant.page.getByTestId("interaction-panel").count().catch(() => 0)) {
    const path = join(outputDirectory, "participant-interaction-failure.png");
    try {
      await participant.page.getByTestId("interaction-panel").screenshot({ path, animations: "disabled", timeout: 5_000 });
      report.screenshots.push("participant-interaction-failure.png");
    } catch (error) { report.errors.cleanupErrors.push(redact(error?.stack ?? error)); }
  }
}

async function stopHostSources(host) {
  if (!host || hostSourcesStopped) return;
  if (!hostSourcesStarted) {
    hostSourcesStopped = true;
    return;
  }
  const connection = host.client.currentConnection;
  if (!connection) return;
  const audioStop = host.page.getByRole("button", { name: "停止麥克風", exact: true });
  const screenStop = host.page.getByRole("button", { name: "停止分享", exact: true });
  if (await audioStop.count().catch(() => 0)) await audioStop.click().catch(() => {});
  if (await screenStop.count().catch(() => 0)) await screenStop.click().catch(() => {});
  await waitFor(
    () => host.page.evaluate(() => window.__t11Synthetic?.tracks.length > 0 &&
      window.__t11Synthetic.tracks.every((track) => track.readyState === "ended")),
    "synthetic source tracks to stop",
    5_000,
  ).catch(() => {});
  const before = packetCounts(connection, "sent");
  await new Promise((resolveWait) => setTimeout(resolveWait, ZERO_WINDOW_TARGET_MS));
  const after = packetCounts(connection, "sent");
  if (hostSourcesStarted) {
    assert.deepEqual(after, before, "host media source packet counts should remain stable after both stop controls.");
  }
  hostSourcesStopped = true;
  stage("host-synthetic-source-stopped-and-counters-stable", { afterStop: after, stableForMs: ZERO_WINDOW_TARGET_MS });
}

function finalizeClientReport() {
  for (const [name, client] of Object.entries(clients)) {
    report.clients[name] = {
      connections: client.connections.map((connection) => ({
        id: connection.id,
        controls: connection.controls,
        packets: connection.packets,
        packetFrames: connection.packetFrames,
        latestParticipation: connection.latestSelf,
        collectionOverflow: connection.collectionOverflow,
      })),
      pageErrors: client.pageErrors,
      inboundHostTokenLeak: Boolean(client.inboundHostTokenLeak),
      inboundRoomPasswordLeak: Boolean(client.inboundRoomPasswordLeak),
    };
  }
  if (clients.display) {
    report.privacy.displayRawPrivateChatLeak = Boolean(clients.display.privateChatLeak);
    report.privacy.displayRawHistoryCount = clients.display.displayHistoryCount;
    report.privacy.displayNonPublicInteractionEventCount = clients.display.displayNonPublicEventCount;
  }
}

function writeReport() {
  finalizeClientReport();
  report.finishedAt = new Date().toISOString();
  report.status = failure ? "failed" : "passed";
  report.errors.failure = failure ? redact(failure?.stack ?? failure) : null;
  const safeReport = sanitize(report);
  const serialized = JSON.stringify(safeReport);
  for (const secret of secrets) {
    if (secret && serialized.includes(secret)) throw new Error("Redaction guard found an unredacted secret in the report.");
  }
  writeFileSync(join(outputDirectory, "report.json"), JSON.stringify(safeReport, null, 2) + "\n");
  writeFileSync(join(outputDirectory, "summary.txt"), [
    "Status: " + safeReport.status,
    "Started: " + safeReport.startedAt,
    "Finished: " + safeReport.finishedAt,
    "Checks: " + safeReport.checks.map((item) => item.name).join(", "),
    "Screenshots: " + (safeReport.screenshots.join(", ") || "none"),
    "Synthetic desktop evidence only; credentials and raw media payloads are not recorded.",
  ].join("\n") + "\n");
}

let host;
let participant;
let display;

try {
  await verifyManagedRuntime();
  host = await launchClient("host", 660);
  participant = await launchClient("participant", 880);
  display = await launchClient("display", 520);
  report.runtime.firefox = contexts[0]?.browser()?.version() ?? "not-reported";

  await enterRoomThroughGate(host.page, host.client, "T11 Host", "/?room=studio&mode=watch");
  await startHostSources(host);
  const participantJoin = await enterRoomThroughGate(participant.page, participant.client, "T11 Participant", "/?room=studio&mode=interaction");
  assert.equal(participantJoin.self.mode, "interaction");
  assert.equal(participantJoin.self.media.audio.subscribed, false);
  assert.equal(participantJoin.self.media.screen.subscribed, false);
  assert.equal(participantJoin.self.media.audio.downlinkBytes, 0);
  assert.equal(participantJoin.self.media.screen.downlinkBytes, 0);
  stage("direct-interaction-deep-link-joined-studio-through-normal-password-gate", {
    roomId: participantJoin.self.roomId,
    role: participantJoin.self.role,
    mode: participantJoin.self.mode,
    sameRoomSnapshotSequence: participantJoin.roomSnapshot.sequence,
    selfSnapshotSequence: participantJoin.self.sequence,
    initialServerMedia: serverMedia(participantJoin.self),
  });

  await joinDisplay(display);
  await waitForDisplayRender(display);
  report.runtime.activeSourceBeforePrivacyChecks = packetCounts(currentConnection(host.client), "sent");
  stage("display-password-gate-and-live-screen-preview");
  await runDisplayWriteProbe();

  const initialInteractionSelf = await provePassiveWindow({
    label: "initial-direct-interaction-zero-media-with-live-source",
    participant,
    host,
    boundarySelf: participantJoin.self,
  });

  const participantConnection = currentConnection(participant.client);
  const ackCountBeforeChat = participantConnection.controls.filter((item) => item.type === "interaction.ack").length;
  await participant.page.getByTestId("chat-input").fill(privateChatSentinel);
  await participant.page.getByTestId("chat-send").click();
  await waitFor(
    () => participantConnection.controls.filter((item) => item.type === "interaction.ack").length > ackCountBeforeChat,
    "private chat acknowledgement",
  );
  await participant.page.getByTestId("chat-list").locator('[data-testid="interaction-item"]').first().waitFor();
  assert.equal(await display.page.getByTestId("display-page").innerText().then((text) => text.includes(privateChatSentinel)), false);

  const ackCountBeforeSticker = participantConnection.controls.filter((item) => item.type === "interaction.ack").length;
  await participant.page.getByRole("button", { name: "送出圖案 ✨", exact: true }).click();
  await waitFor(
    () => participantConnection.controls.filter((item) => item.type === "interaction.ack").length > ackCountBeforeSticker,
    "private sticker acknowledgement",
  );
  await waitFor(
    () => participant.page.getByTestId("chat-list").locator('[data-testid="interaction-item"]').count().then((count) => count >= 2),
    "chat and sticker history on the participant page",
  );

  const feedbackBefore = participantConnection.controls.filter((item) => item.type === "interaction.ack").length;
  await participant.page.getByTestId("feedback-like").click();
  await waitFor(
    () => participantConnection.controls.filter((item) => item.type === "interaction.ack").length > feedbackBefore,
    "formal feedback acknowledgement",
  );
  await display.page.getByTestId("display-feedback-like").filter({ hasText: "1 次" }).waitFor();
  const privacyAfterPrivateContent = assertDisplayPrivacy(display);
  assert.equal(await display.page.getByTestId("display-public-queue").innerText().then((text) => text.includes(privateChatSentinel)), false);
  stage("private-chat-and-formal-feedback-sent-while-only-interaction", {
    privateChatAcknowledged: true,
    stickerAcknowledged: true,
    feedbackDisplayed: true,
    displayPrivacy: privacyAfterPrivateContent,
    serverMediaAtBoundary: serverMedia(initialInteractionSelf),
  });

  const modeWatchBefore = participantConnection.controls.at(-1)?.sequence ?? 0;
  await participant.page.getByTestId("mode-watch").click();
  const watchAck = await waitForControl(
    participantConnection,
    (item) => item.type === "participation.modeChanged" && item.mode === "watch",
    "watch mode acknowledgement",
    modeWatchBefore,
  );
  const watchSelf = await waitForControl(
    participantConnection,
    (item) => item.type === "participation.self" && item.sequence > watchAck.sequence,
    "watch mode self snapshot",
    watchAck.sequence,
  );
  assert.equal(watchSelf.mode, "watch");
  const watchIdleSelf = await provePassiveWindow({
    label: "watch-mode-does-not-autosubscribe-before-manual-start",
    participant,
    host,
    boundarySelf: watchSelf,
    modeAck: watchAck,
  });
  const participantCallsBeforeStart = await participant.page.evaluate(() => ({
    audioCalls: window.__t11Synthetic.audioCalls,
    screenCalls: window.__t11Synthetic.screenCalls,
  }));
  assert.deepEqual(participantCallsBeforeStart, { audioCalls: 0, screenCalls: 0 }, "watch mode should not open capture sources by itself.");

  await participant.page.getByRole("button", { name: "開始收聽", exact: true }).click();
  await participant.page.getByRole("button", { name: "開始觀看分享", exact: true }).click();
  const renderedParticipantMedia = await waitForRenderedParticipantMedia(participant);
  const watchInspect = await inspectParticipant(
    participant.page,
    participantConnection,
    watchIdleSelf.sequence,
    "manual watch subscriptions inspected",
  );
  assert.equal(watchInspect.mode, "watch");
  assert.equal(watchInspect.media.audio.subscribed, true);
  assert.equal(watchInspect.media.screen.subscribed, true);
  assert.ok(watchInspect.media.audio.downlinkBytes > 0 && watchInspect.media.audio.downlinkFrames > 0);
  assert.ok(watchInspect.media.screen.downlinkBytes > 0 && watchInspect.media.screen.downlinkFrames > 0);
  stage("manual-watch-controls-rendered-audio-samples-and-screen-frames", {
    rendered: renderedParticipantMedia,
    serverMedia: serverMedia(watchInspect),
    rawReceived: packetCounts(participantConnection, "received"),
  });

  await setVolume(participant.page, 0.37);
  await participant.page.getByTestId("chat-input").fill(chatDraft);
  await participant.page.getByTestId("danmaku-input").fill(danmakuDraft);
  const draftValuesBefore = {
    chat: await participant.page.getByTestId("chat-input").inputValue(),
    danmaku: await participant.page.getByTestId("danmaku-input").inputValue(),
    volume: await participant.page.getByTestId("audio-volume").inputValue(),
  };
  assert.deepEqual(draftValuesBefore, { chat: chatDraft, danmaku: danmakuDraft, volume: "0.37" });

  const modeInteractionBefore = participantConnection.controls.at(-1)?.sequence ?? 0;
  await participant.page.getByTestId("mode-interaction").click();
  const interactionAck = await waitForControl(
    participantConnection,
    (item) => item.type === "participation.modeChanged" && item.mode === "interaction",
    "interaction mode acknowledgement",
    modeInteractionBefore,
  );
  assert.equal(interactionAck.media.audioSubscribed, false);
  assert.equal(interactionAck.media.screenSubscribed, false);
  const interactionSelf = await waitForControl(
    participantConnection,
    (item) => item.type === "participation.self" && item.sequence > interactionAck.sequence,
    "interaction mode self snapshot",
    interactionAck.sequence,
  );
  assert.equal(interactionSelf.role, "participant");
  assert.equal(interactionSelf.mode, "interaction");
  assert.equal(interactionSelf.roomId, watchInspect.roomId);
  assert.equal(interactionSelf.participantId, watchInspect.participantId);
  await participant.page.waitForFunction(() => {
    const audio = document.querySelector('[data-testid="audio-panel"]');
    const screen = document.querySelector('[data-testid="screen-panel"]');
    return audio?.getAttribute("data-listener-state") === "off" &&
      screen?.getAttribute("data-receiver-state") === "off" &&
      !screen?.getAttribute("data-rendered-width") &&
      !screen?.getAttribute("data-rendered-height");
  });
  const finalInteractionSelf = await provePassiveWindow({
    label: "post-ack-interaction-mode-server-and-raw-media-zero",
    participant,
    host,
    boundarySelf: interactionSelf,
    modeAck: interactionAck,
  });

  const draftValuesAfter = {
    chat: await participant.page.getByTestId("chat-input").inputValue(),
    danmaku: await participant.page.getByTestId("danmaku-input").inputValue(),
    volume: await participant.page.getByTestId("audio-volume").inputValue(),
    roomId: finalInteractionSelf.roomId,
    participantId: finalInteractionSelf.participantId,
  };
  assert.deepEqual(draftValuesAfter, {
    chat: chatDraft,
    danmaku: danmakuDraft,
    volume: "0.37",
    roomId: watchInspect.roomId,
    participantId: watchInspect.participantId,
  });
  stage("mode-switch-preserved-room-participant-drafts-and-volume", {
    roomId: draftValuesAfter.roomId,
    participantIdentityPreserved: draftValuesAfter.participantId === watchInspect.participantId,
    chatDraftPreserved: draftValuesAfter.chat === chatDraft,
    danmakuDraftPreserved: draftValuesAfter.danmaku === danmakuDraft,
    volumePreserved: draftValuesAfter.volume === "0.37",
  });

  await participant.page.getByTestId("danmaku-input").fill(publicDanmaku);
  await participant.page.getByTestId("danmaku-send").click();
  await display.page.getByTestId("display-public-queue").getByText(publicDanmaku, { exact: true }).waitFor();
  await display.page.getByTestId("display-public-queue").waitFor();
  await participant.page.getByTestId("danmaku-input").fill(danmakuDraft);
  const privacyBeforeQr = assertDisplayPrivacy(display);
  report.privacy = { ...report.privacy, ...privacyBeforeQr };
  stage("explicit-public-danmaku-and-feedback-visible-on-readonly-display", {
    danmakuVisible: true,
    feedbackVisible: true,
    displayPrivacy: privacyBeforeQr,
  });

  const decodedQrUrl = await decodeDisplayQr(display);
  await captureEvidence(display, participant);
  stage("representative-display-and-participant-interaction-screenshots-saved", { screenshots: report.screenshots.slice(-2) });

  const returnToWatchBefore = participantConnection.controls.at(-1)?.sequence ?? 0;
  await participant.page.getByTestId("mode-watch").click();
  const returnWatchAck = await waitForControl(
    participantConnection,
    (item) => item.type === "participation.modeChanged" && item.mode === "watch",
    "return-to-watch mode acknowledgement",
    returnToWatchBefore,
  );
  const returnWatchSelf = await waitForControl(
    participantConnection,
    (item) => item.type === "participation.self" && item.sequence > returnWatchAck.sequence,
    "return-to-watch self snapshot",
    returnWatchAck.sequence,
  );
  await participant.page.waitForFunction(() => {
    const audio = document.querySelector('[data-testid="audio-panel"]');
    const screen = document.querySelector('[data-testid="screen-panel"]');
    return audio?.getAttribute("data-listener-state") === "off" &&
      screen?.getAttribute("data-receiver-state") === "off" &&
      !screen?.getAttribute("data-rendered-width") &&
      !screen?.getAttribute("data-rendered-height");
  });
  const returnedWatchMediaCalls = await participant.page.evaluate(() => ({
    audioCalls: window.__t11Synthetic.audioCalls,
    screenCalls: window.__t11Synthetic.screenCalls,
  }));
  assert.deepEqual(returnedWatchMediaCalls, { audioCalls: 0, screenCalls: 0 }, "returning to watch must not open a microphone or screen capture source.");
  const returnWatchInspect = await provePassiveWindow({
    label: "return-to-watch-keeps-receivers-off-until-manual-resume",
    participant,
    host,
    boundarySelf: returnWatchSelf,
    modeAck: returnWatchAck,
  });
  assert.equal(await participant.page.getByTestId("chat-input").inputValue(), chatDraft);
  assert.equal(await participant.page.getByTestId("danmaku-input").inputValue(), danmakuDraft);
  assert.equal(await participant.page.getByTestId("audio-volume").inputValue(), "0.37");
  stage("return-to-watch-preserved-drafts-and-volume-without-auto-media", {
    audioCalls: returnedWatchMediaCalls.audioCalls,
    screenCalls: returnedWatchMediaCalls.screenCalls,
    chatDraftPreserved: true,
    danmakuDraftPreserved: true,
    volumePreserved: true,
    serverMedia: serverMedia(returnWatchInspect),
  });

  const priorParticipantId = finalInteractionSelf.participantId;
  const oldConnectionId = participantConnection.id;
  await participant.page.goto(decodedQrUrl, { waitUntil: "domcontentloaded" });
  await participant.page.getByRole("heading", { name: "Local room presence" }).waitFor();
  await participant.page.getByLabel("Your display name").fill("T11 QR Participant");
  await participant.page.getByRole("button", { name: "Join room", exact: true }).click();
  await participant.page.getByLabel("Meeting room password").waitFor({ state: "visible" });
  await participant.page.locator("#meeting-room-password").fill(roomPassword);
  await participant.page.getByRole("button", { name: "Enter room", exact: true }).click();
  await participant.page.getByText("Connected to Meeting room", { exact: true }).waitFor();
  const qrConnection = await waitFor(
    () => participant.client.connections.find((item) => item.id > oldConnectionId) ?? null,
    "new QR participant WebSocket identity",
  );
  const qrRoomSnapshot = await waitForControl(qrConnection, (item) => item.type === "room.snapshot", "QR room snapshot");
  const qrInteractionSnapshot = await waitForControl(qrConnection, (item) => item.type === "interaction.snapshot", "QR interaction snapshot", qrRoomSnapshot.sequence);
  const qrSelf = await waitForControl(qrConnection, (item) => item.type === "participation.self", "QR participation snapshot", qrInteractionSnapshot.sequence);
  assert.equal(qrSelf.roomId, "studio");
  assert.equal(qrSelf.role, "participant");
  assert.equal(qrSelf.mode, "interaction");
  assert.notEqual(qrSelf.participantId, priorParticipantId, "the QR join should create a fresh connection-scoped participant identity.");
  assert.equal(packetCounts(qrConnection, "received").audioFrames, 0);
  assert.equal(packetCounts(qrConnection, "received").screenFrames, 0);
  assertNoSubscriptions(qrSelf, "QR deep-link interaction entry");
  stage("decoded-qr-opened-fresh-participant-through-normal-password-gate", {
    decodedRoomId: "studio",
    decodedMode: "interaction",
    displayView: false,
    role: qrSelf.role,
    mode: qrSelf.mode,
    roomId: qrSelf.roomId,
    identityChanged: qrSelf.participantId !== priorParticipantId,
    initialServerMedia: serverMedia(qrSelf),
  });
  await provePassiveWindow({
    label: "qr-interaction-entry-also-has-zero-media-with-live-source",
    participant,
    host,
    boundarySelf: qrSelf,
  });

  assertDisplayPrivacy(display);
  assertCollectionHealthy();
  await stopHostSources(host);
  const allPageErrors = Object.values(clients).flatMap((client) => client.pageErrors);
  assert.deepEqual(allPageErrors, [], "all three browser pages should finish without page errors.");
  assert.deepEqual(report.errors.socketErrors, [], "all browser WebSocket traces should finish without socket errors.");
  assert.equal(host.client.inboundHostTokenLeak, false);
  assert.equal(host.client.inboundRoomPasswordLeak, false);
  assert.equal(participant.client.inboundHostTokenLeak, false);
  assert.equal(participant.client.inboundRoomPasswordLeak, false);
  assert.equal(display.client.inboundHostTokenLeak, false);
  assert.equal(display.client.inboundRoomPasswordLeak, false);
} catch (error) {
  failure = new Error(redact(error?.stack ?? error));
  report.errors.failure = redact(failure.stack ?? failure.message);
  try { await captureFailureEvidence(); }
  catch (captureError) { report.errors.cleanupErrors.push(redact(captureError?.stack ?? captureError)); }
} finally {
  if (!hostSourcesStopped) {
    try { await stopHostSources(host); }
    catch (cleanupError) { report.errors.cleanupErrors.push(redact(cleanupError?.stack ?? cleanupError)); }
  }
  for (const socket of probeSockets) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      try { socket.close(); } catch (error) { report.errors.cleanupErrors.push(redact(error)); }
    }
  }
  await Promise.all(contexts.map((context) => context.close().catch((error) => {
    report.errors.cleanupErrors.push(redact(error?.stack ?? error));
  })));
  try { writeReport(); }
  catch (reportError) {
    if (!failure) failure = new Error(redact(reportError?.stack ?? reportError));
  }
}

if (failure) throw new Error(redact(failure?.stack ?? failure.message));
