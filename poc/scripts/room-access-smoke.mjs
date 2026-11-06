import { enterRepositoryRootForLegacyScript, repositoryRoot, pocRoot } from "./lib/project-paths.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { get as httpsGet } from "node:https";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import WebSocket from "ws";

enterRepositoryRootForLegacyScript();

const root = repositoryRoot;
const expectedLockedValue = process.env.ROOM_ACCESS_EXPECT_LOCKED;
if (expectedLockedValue !== "0" && expectedLockedValue !== "1") {
  throw new Error("Set ROOM_ACCESS_EXPECT_LOCKED to 0 or 1 for the current server startup.");
}
const expectedLocked = expectedLockedValue === "1";
const testPassword = process.env.ROOM_ACCESS_TEST_PASSWORD ?? "";
if (expectedLocked && !testPassword) throw new Error("Locked smoke requires ROOM_ACCESS_TEST_PASSWORD.");
const wrongPassword = testPassword === "not-the-room-password" ? "different-wrong-password" : "not-the-room-password";
const scratchRoot = resolve(root, ".scratch/room-access");
const defaultDirectory = expectedLocked ? ".scratch/room-access/locked" : ".scratch/room-access/unlocked";
const outputDirectory = resolve(root, process.env.ROOM_ACCESS_OUTPUT_DIR ?? defaultDirectory);
const outputRelative = relative(scratchRoot, outputDirectory);
if (isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(`..${sep}`)) {
  throw new Error("ROOM_ACCESS_OUTPUT_DIR must stay inside .scratch/room-access.");
}

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, ".tools/playwright-browsers");
const { firefox } = await import("playwright");
const caCertificate = resolve(process.env.ROOM_ACCESS_CA_CERT ?? ".scratch/t01/tls/local-ca.pem");
const caCertificatePem = readFileSync(caCertificate);
const baseURL = process.env.ROOM_ACCESS_BASE_URL ?? `https://localhost:${process.env.PORT ?? "4173"}`;
const target = new URL(baseURL);
const certificateUtility = process.env.CERTUTIL_BIN ?? "certutil";
const headless = process.env.HEADLESS !== "0";
const MAX_CONTROL_RECORDS = 800;
const MAX_PACKET_RECORDS = 2_000;
const MESSAGE_TIMEOUT_MS = 5_000;
const STABLE_TRACE_MS = 300;
const contexts = [];
const clients = {};
const report = {
  schemaVersion: 1,
  purpose: "Short room door and password POC under one startup lock configuration, with synthetic desktop audio after authorized entry.",
  startedAt: new Date().toISOString(),
  status: "running",
  baseURL: target.origin,
  configuration: { expectedLocked, publicCatalogueMatched: false, passwordIncludedInEvidence: false },
  runtime: { node: process.version, platform: process.platform, architecture: process.arch, firefox: "not-reported", renderers: {} },
  tls: { caCertificate, trust: "local CA explicitly trusted by Node requests and imported into isolated Firefox profiles", ignoreCertificateErrors: false, systemTrustChanged: false },
  syntheticSource: "Publisher getUserMedia is replaced before app load with an AudioContext oscillator routed to MediaStreamDestination; no hardware microphone is used.",
  settings: { lockedDoorRequiresPassword: expectedLocked, maxControlRecordsPerClient: MAX_CONTROL_RECORDS, maxAudioPacketHashesPerDirection: MAX_PACKET_RECORDS },
  clients: {},
  phases: [],
  snapshots: [],
  externalProbes: [],
  screenshots: [],
  errors: { pageErrors: [], socketErrors: [], failure: null },
  limits: {
    passwordValue: "not-recorded",
    passwordVerifier: "not-recorded",
    audioPayloads: "not-recorded; bounded opaque LTA1 packet hashes only",
    audioPacketHashTruncation: "run fails if a collection reaches its cap",
    mobile: "not-tested",
    physicalMicrophone: "not-tested",
    humanHearing: "not-tested",
    identitiesAndHostRoles: "not-tested; the POC has no verified account or room-management role",
    liveLockChanges: "not-tested; lock configuration takes effect at server startup",
  },
};
let failure;

mkdirSync(outputDirectory, { recursive: true });

function redactError(error) {
  let message = error instanceof Error ? error.stack ?? error.message : String(error);
  for (const secret of [testPassword, wrongPassword]) {
    if (secret) message = message.split(secret).join("[redacted]");
  }
  return message;
}

function stage(name, details = {}) {
  report.phases.push({ name, at: new Date().toISOString(), ...details });
  console.log(`[ROOM-ACCESS] ${name}${Object.keys(details).length ? ` ${JSON.stringify(details)}` : ""}`);
}

function runCertutil(args) {
  execFileSync(certificateUtility, args, { stdio: "pipe" });
}

function createTrustedProfile(name) {
  const profileDirectory = join(outputDirectory, name, "profile");
  rmSync(profileDirectory, { recursive: true, force: true });
  mkdirSync(profileDirectory, { recursive: true });
  runCertutil(["-N", "-d", `sql:${profileDirectory}`, "--empty-password"]);
  runCertutil(["-A", "-d", `sql:${profileDirectory}`, "-n", "LaiTse local development CA", "-t", "C,,", "-i", caCertificate]);
  const appData = join(outputDirectory, name, "app-data");
  const localAppData = join(outputDirectory, name, "local-app-data");
  mkdirSync(appData, { recursive: true });
  mkdirSync(localAppData, { recursive: true });
  return { profileDirectory, appData, localAppData };
}

function bytesFromPayload(payload) {
  if (Buffer.isBuffer(payload)) return payload;
  if (payload instanceof Uint8Array) return Buffer.from(payload);
  if (typeof payload === "string") return Buffer.from(payload, "binary");
  return null;
}

function safeControlRecord(payload, direction) {
  let message;
  try { message = JSON.parse(payload); } catch { return { at: Date.now(), direction, type: "unparsed-control" }; }
  const record = { at: Date.now(), direction, type: typeof message?.type === "string" ? message.type : "unknown" };
  if (message?.type === "join" || message?.type === "room.switch") {
    if (typeof message.roomId === "string") record.roomId = message.roomId;
    record.hasPassword = Object.hasOwn(message, "password");
  }
  if (message?.type === "room.snapshot" && typeof message.room?.id === "string") record.roomId = message.room.id;
  if (message?.type === "space.snapshot" && typeof message.currentRoomId === "string") record.roomId = message.currentRoomId;
  if (message?.type === "control.event" && typeof message.event?.roomId === "string") record.roomId = message.event.roomId;
  return record;
}

function attachTransport(page, name) {
  const transport = {
    name,
    sockets: 0,
    controls: [],
    droppedControls: 0,
    protocolErrors: [],
    packets: { sent: [], received: [] },
    droppedPackets: { sent: 0, received: 0 },
    latestSpaceSnapshot: null,
    pageErrors: [],
    socketErrors: [],
  };
  page.on("pageerror", (error) => {
    const item = { at: new Date().toISOString(), message: redactError(error) };
    transport.pageErrors.push(item);
    report.errors.pageErrors.push({ client: name, ...item });
  });
  page.on("websocket", (socket) => {
    transport.sockets += 1;
    const recordControl = (payload, direction) => {
      if (typeof payload !== "string") return;
      const record = safeControlRecord(payload, direction);
      if (record.type === "space.snapshot") transport.latestSpaceSnapshot = JSON.parse(payload);
      if (record.type === "protocol.error") {
        const message = JSON.parse(payload);
        transport.protocolErrors.push({ at: new Date().toISOString(), code: typeof message.code === "string" ? message.code : "unknown" });
      }
      if (transport.controls.length < MAX_CONTROL_RECORDS) transport.controls.push(record);
      else transport.droppedControls += 1;
    };
    const recordPacket = (payload, direction) => {
      const bytes = bytesFromPayload(payload);
      if (!bytes || bytes.byteLength < 12 || bytes.toString("ascii", 0, 4) !== "LTA1") return;
      const packets = transport.packets[direction];
      if (packets.length >= MAX_PACKET_RECORDS) {
        transport.droppedPackets[direction] += 1;
        return;
      }
      packets.push({
        at: Date.now(),
        magic: "LTA1",
        generation: bytes.readUInt32BE(4),
        sequence: bytes.readUInt32BE(8),
        bytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    };
    socket.on("framesent", (frame) => typeof frame.payload === "string" ? recordControl(frame.payload, "sent") : recordPacket(frame.payload, "sent"));
    socket.on("framereceived", (frame) => typeof frame.payload === "string" ? recordControl(frame.payload, "received") : recordPacket(frame.payload, "received"));
    socket.on("socketerror", (error) => {
      const message = redactError(error);
      transport.socketErrors.push(message);
      report.errors.socketErrors.push({ client: name, message });
    });
  });
  clients[name] = { page, transport };
  return clients[name];
}

async function launchClient(name, { syntheticAudio = false } = {}) {
  const profile = createTrustedProfile(name);
  const browserEnv = { ...process.env, MOZ_APP_DATA: profile.appData, MOZ_LOCAL_APP_DATA: profile.localAppData };
  delete browserEnv.MEETING_ROOM_PASSWORD;
  delete browserEnv.ROOM_ACCESS_TEST_PASSWORD;
  const context = await firefox.launchPersistentContext(profile.profileDirectory, {
    headless,
    env: browserEnv,
    viewport: { width: 1440, height: 1050 },
    colorScheme: "light",
    firefoxUserPrefs: { "media.navigator.streams.fake": true },
  });
  context.setDefaultTimeout(8_000);
  contexts.push(context);
  const page = context.pages()[0] ?? await context.newPage();
  const client = attachTransport(page, name);
  if (syntheticAudio) {
    await page.addInitScript(({ frequency }) => {
      Object.defineProperty(window, "__roomAccessSynthetic", { value: { frequency, context: null, tracks: [] } });
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => {
          const state = window.__roomAccessSynthetic;
          const audioContext = new AudioContext({ sampleRate: 48_000 });
          await audioContext.resume();
          const destination = audioContext.createMediaStreamDestination();
          const oscillator = audioContext.createOscillator();
          const gain = audioContext.createGain();
          oscillator.frequency.value = state.frequency;
          gain.gain.value = 0.22;
          oscillator.connect(gain).connect(destination);
          oscillator.start();
          state.context = audioContext;
          state.tracks.push(...destination.stream.getTracks());
          return destination.stream;
        },
      });
    }, { frequency: 440 });
  }
  return client;
}

async function waitUntil(predicate, description, timeoutMs = MESSAGE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function latestPlayers(client) {
  const snapshot = client.transport.latestSpaceSnapshot;
  const room = snapshot?.rooms?.find((candidate) => candidate.id === snapshot.currentRoomId);
  return room?.players ?? [];
}

function controlCount(client, type, direction = "received") {
  return client.transport.controls.filter((control) => control.direction === direction && control.type === type).length;
}

async function waitForControl(client, type, previousCount, predicate = () => true) {
  return await waitUntil(() => {
    const matches = client.transport.controls.filter((control) => control.direction === "received" && control.type === type).slice(previousCount);
    return matches.findLast(predicate) ?? null;
  }, `${client.transport.name} ${type}`);
}

async function joinRoom(client, displayName, roomId) {
  const { page, transport } = client;
  await page.goto(target.origin, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Your display name").fill(displayName);
  await page.locator(`[data-room-choice="${roomId}"]`).click();
  await page.getByRole("button", { name: "Join room" }).click();
  if (roomId === "studio" && expectedLocked) {
    await page.getByTestId("meeting-room-password").waitFor({ state: "visible" });
    await fillPassword(client, testPassword);
    await page.getByRole("button", { name: "Enter room", exact: true }).click();
  }
  const expectedName = roomId === "lobby" ? "Open area" : "Meeting room";
  await page.getByText(`Connected to ${expectedName}`, { exact: true }).waitFor();
  await page.locator('[data-testid="audio-panel"]').waitFor();
  await waitUntil(() => transport.latestSpaceSnapshot?.currentRoomId === roomId, `${displayName} space snapshot`);
  await page.waitForFunction(() => {
    const badge = document.querySelector('[data-testid="space-render-status"]');
    return badge?.getAttribute("data-renderer") && badge.getAttribute("data-phaser-version");
  }, undefined, { timeout: MESSAGE_TIMEOUT_MS });
  return await page.locator('[data-testid="space-render-status"]').getAttribute("data-renderer");
}

async function fillPassword(client, value) {
  try {
    await client.page.getByTestId("meeting-room-password").fill(value);
  } catch {
    throw new Error("Password input interaction failed; details redacted.");
  }
}

async function clickSceneDoor(client) {
  const canvas = client.page.locator('[data-testid="t07-phaser-canvas"]');
  const beforeScroll = await canvas.boundingBox();
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  stage("scene-door-click-geometry", { beforeScroll, visibleCanvas: bounds });
  assert.ok(bounds, "the Phaser scene canvas must have a visible bounding box");
  await client.page.mouse.click(bounds.x + bounds.width * (520 / 1040), bounds.y + bounds.height * (205 / 414));
}

async function clickHtmlDoor(client) {
  await client.page.locator("[data-door-entry]").click();
}

async function enableListening(client) {
  const count = controlCount(client, "audio.subscribed");
  const acknowledgement = waitForControl(client, "audio.subscribed", count);
  await client.page.getByRole("button", { name: "開始收聽" }).click();
  await acknowledgement;
  await client.page.waitForFunction(() => document.querySelector('[data-testid="audio-panel"]')?.getAttribute("data-listener-state") === "ready", undefined, { timeout: 8_000 });
}

async function startPublishing(client) {
  const count = controlCount(client, "audio.started");
  const acknowledgement = waitForControl(client, "audio.started", count);
  await client.page.getByRole("button", { name: "開始麥克風" }).click();
  const started = await acknowledgement;
  await client.page.waitForFunction(() => document.querySelector('[data-testid="audio-panel"]')?.getAttribute("data-publisher-state") === "broadcasting", undefined, { timeout: 8_000 });
  return started;
}

async function waitForRenderedAudio(client) {
  await client.page.waitForFunction(() => {
    const panel = document.querySelector('[data-testid="audio-panel"]');
    return panel && Number(panel.getAttribute("data-received-packets")) > 0 &&
      Number(panel.getAttribute("data-decoded-frames")) > 0 &&
      Number(panel.getAttribute("data-rendered-samples")) > 0 &&
      Number(panel.getAttribute("data-render-rms")) > 0.0001;
  }, undefined, { timeout: 8_000 });
  return await client.page.locator('[data-testid="audio-panel"]').evaluate((panel) => ({
    listenerState: panel.getAttribute("data-listener-state"),
    receivedPackets: Number(panel.getAttribute("data-received-packets")),
    decodedFrames: Number(panel.getAttribute("data-decoded-frames")),
    renderedSamples: Number(panel.getAttribute("data-rendered-samples")),
    queuedSamples: Number(panel.getAttribute("data-queued-samples")),
    renderRms: Number(panel.getAttribute("data-render-rms")),
  }));
}

function nextExternalJson(socket, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("External WebSocket probe timed out."));
    }, MESSAGE_TIMEOUT_MS);
    const onMessage = (raw, isBinary) => {
      if (isBinary) return;
      const message = JSON.parse(raw.toString());
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

async function connectExternal() {
  const socket = new WebSocket(`${target.protocol === "https:" ? "wss:" : "ws:"}//${target.host}/ws`, { origin: target.origin, ca: caCertificatePem });
  socket.trace = [];
  socket.mediaCounters = { audioFramesReceived: 0, screenFramesReceived: 0, otherBinaryFramesReceived: 0, roomSnapshots: 0, spaceSnapshots: 0, controlEvents: 0, audioControls: 0, screenControls: 0 };
  socket.on("message", (raw, isBinary) => {
    if (isBinary) {
      const magic = Buffer.from(raw).toString("ascii", 0, 4);
      if (magic === "LTA1") socket.mediaCounters.audioFramesReceived += 1;
      else if (magic === "LTS1") socket.mediaCounters.screenFramesReceived += 1;
      else socket.mediaCounters.otherBinaryFramesReceived += 1;
      return;
    }
    const message = JSON.parse(raw.toString());
    const type = typeof message?.type === "string" ? message.type : "unknown";
    const record = { type, ...(typeof message.code === "string" ? { code: message.code } : {}) };
    if (type === "room.snapshot") {
      socket.mediaCounters.roomSnapshots += 1;
      record.roomId = message.room?.id;
    }
    if (type === "space.snapshot") {
      socket.mediaCounters.spaceSnapshots += 1;
      record.roomId = message.currentRoomId;
    }
    if (type === "control.event") {
      socket.mediaCounters.controlEvents += 1;
      record.roomId = message.event?.roomId;
    }
    if (type.startsWith("audio.")) socket.mediaCounters.audioControls += 1;
    if (type.startsWith("screen.")) socket.mediaCounters.screenControls += 1;
    socket.trace.push(record);
  });
  await new Promise((resolveOpen, reject) => {
    const timer = setTimeout(() => reject(new Error("External WebSocket did not open.")), MESSAGE_TIMEOUT_MS);
    socket.once("open", () => { clearTimeout(timer); resolveOpen(); });
    socket.once("error", reject);
  });
  return socket;
}

function makeAudioFrame() {
  const frame = Buffer.alloc(27);
  frame.write("LTA1", 0, "ascii");
  frame.writeUInt32BE(1, 4);
  frame.writeUInt32BE(0, 8);
  frame.writeDoubleBE(0, 12);
  frame.writeUInt32BE(20_000, 20);
  Buffer.from([0xf8, 0xff, 0xfe]).copy(frame, 24);
  return frame;
}

function makeScreenFrame() {
  const frame = Buffer.alloc(25);
  frame.write("LTS1", 0, "ascii");
  frame.writeUInt32BE(1, 4);
  frame.writeUInt32BE(0, 8);
  frame.writeDoubleBE(1_000, 12);
  frame[20] = 0;
  frame[24] = 0;
  return frame;
}

async function runExternalGateProbes() {
  if (!expectedLocked) return;
  const socket = await connectExternal();
  try {
    const activePublisherFrames = clients.publisher.transport.packets.sent.length;
    assert.ok(activePublisherFrames > 0, "a synthetic meeting-room publisher must be active during denied subscription probes");
    const missing = nextExternalJson(socket, (message) => message.type === "protocol.error");
    socket.send(JSON.stringify({ type: "join", roomId: "studio", displayName: "External visitor" }));
    const missingResult = await missing;
    assert.equal(missingResult.code, "room_password_required");

    const wrong = nextExternalJson(socket, (message) => message.type === "protocol.error");
    socket.send(JSON.stringify({ type: "join", roomId: "studio", displayName: "External visitor", password: wrongPassword }));
    const wrongResult = await wrong;
    assert.equal(wrongResult.code, "room_password_incorrect");

    const audioDenied = nextExternalJson(socket, (message) => message.type === "protocol.error");
    socket.send(JSON.stringify({ type: "audio.subscribe" }));
    assert.equal((await audioDenied).code, "media_not_joined");
    const screenDenied = nextExternalJson(socket, (message) => message.type === "protocol.error");
    socket.send(JSON.stringify({ type: "screen.subscribe" }));
    assert.equal((await screenDenied).code, "media_not_joined");
    const audioPacketDenied = nextExternalJson(socket, (message) => message.type === "protocol.error");
    socket.send(makeAudioFrame());
    assert.equal((await audioPacketDenied).code, "media_not_joined");
    const screenPacketDenied = nextExternalJson(socket, (message) => message.type === "protocol.error");
    socket.send(makeScreenFrame());
    assert.equal((await screenPacketDenied).code, "media_not_joined");
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    assert.deepEqual(socket.trace.filter((message) => ["room.snapshot", "space.snapshot", "control.event"].includes(message.type)), []);
    assert.deepEqual(socket.mediaCounters, { audioFramesReceived: 0, screenFramesReceived: 0, otherBinaryFramesReceived: 0, roomSnapshots: 0, spaceSnapshots: 0, controlEvents: 0, audioControls: 0, screenControls: 0 });
    report.externalProbes.push({
      type: "missing-password",
      code: missingResult.code,
      roomSnapshots: 0,
      meetingEvents: 0,
      audioBytesSentToProbe: 0,
      screenBytesSentToProbe: 0,
    });
    report.externalProbes.push({
      type: "wrong-password",
      code: wrongResult.code,
      audioSubscribeCode: "media_not_joined",
      screenSubscribeCode: "media_not_joined",
      audioPacketRejected: true,
      screenPacketRejected: true,
      activeMeetingPublisherFramesBeforeProbe: activePublisherFrames,
      roomSnapshots: 0,
      meetingEvents: 0,
      audioBytesSentToProbe: 0,
      screenBytesSentToProbe: 0,
      counters: socket.mediaCounters,
    });

    const forged = await connectExternal();
    try {
      const invalid = nextExternalJson(forged, (message) => message.type === "protocol.error");
      forged.send(JSON.stringify({
        type: "join",
        roomId: "studio",
        displayName: "Forged visitor",
        password: testPassword,
        isLocked: false,
        role: "host",
        participantId: "forged-id",
      }));
      assert.equal((await invalid).code, "invalid_join");
      report.externalProbes.push({ type: "forged-lock-role-identity", code: "invalid_join", roomSnapshots: 0, meetingEvents: 0 });
    } finally {
      forged.close();
    }

    stage("external-locked-gate-probes", { missingRejected: true, wrongRejected: true, audioBytesToVisitor: 0, screenBytesToVisitor: 0, forgedFieldsRejected: true });
  } finally {
    socket.close();
  }
}

async function readDiagnostics() {
  return await trustedGetJson("/api/media-diagnostics");
}

function trustedGetJson(path) {
  return new Promise((resolveJson, reject) => {
    const request = httpsGet(new URL(path, target.origin), { ca: caCertificatePem }, (response) => {
      const chunks = [];
      let totalBytes = 0;
      response.on("data", (chunk) => {
        totalBytes += chunk.byteLength;
        if (totalBytes > 256 * 1_024) request.destroy(new Error("Trusted local API response exceeded the smoke bound."));
        else chunks.push(chunk);
      });
      response.on("end", () => {
        if (response.statusCode !== 200) return reject(new Error("Trusted local API returned an unexpected status."));
        try { resolveJson(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new Error("Trusted local API returned invalid JSON.")); }
      });
    });
    request.setTimeout(MESSAGE_TIMEOUT_MS, () => request.destroy(new Error("Trusted local API request timed out.")));
    request.once("error", reject);
  });
}

function restrictedRoomCounters(value) {
  const room = value.rooms.find((candidate) => candidate.roomId === "studio");
  return {
    roomSnapshotsSent: room.control.roomSnapshotsSent,
    spaceSnapshotsSent: room.control.spaceSnapshotsSent,
    eventsSent: room.control.eventsSent,
    audioControlsSent: room.audio.controlMessagesSent,
    audioFramesSent: room.audio.binaryFramesSent,
    screenControlsSent: room.screen.controlMessagesSent,
    screenFramesSent: room.screen.binaryFramesSent,
  };
}

function gateDeliveryCounters(value) {
  const { spaceSnapshotsSent: _filteredSnapshots, ...gateCounters } = value;
  return gateCounters;
}

function writeReport() {
  report.finishedAt = new Date().toISOString();
  report.status = failure ? "failed" : "passed";
  report.errors.failure = failure ? redactError(failure) : null;
  for (const [name, client] of Object.entries(clients)) {
    const snapshot = client.transport.latestSpaceSnapshot;
    const activeRoom = snapshot?.rooms?.find((room) => room.id === snapshot.currentRoomId);
    report.clients[name] = {
      sockets: client.transport.sockets,
      latestSnapshot: snapshot ? {
        seq: snapshot.seq,
        currentRoomId: snapshot.currentRoomId,
        isLocked: activeRoom?.isLocked ?? null,
        players: activeRoom?.players?.map(({ displayName, x, y }) => ({ displayName, x, y })) ?? [],
        otherRoomMemberCount: snapshot.rooms.find((room) => room.id !== snapshot.currentRoomId)?.players.length ?? -1,
      } : null,
      controls: client.transport.controls,
      droppedControls: client.transport.droppedControls,
      protocolErrors: client.transport.protocolErrors,
      packets: client.transport.packets,
      droppedPackets: client.transport.droppedPackets,
      pageErrors: client.transport.pageErrors,
      socketErrors: client.transport.socketErrors,
    };
  }
  const serialized = JSON.stringify(report);
  if ((testPassword && serialized.includes(testPassword)) || serialized.includes(wrongPassword)) {
    throw new Error("Evidence report unexpectedly contains password input data.");
  }
  writeFileSync(join(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

try {
  const catalogue = await trustedGetJson("/api/rooms");
  const studio = catalogue.find((room) => room.id === "studio");
  assert.equal(studio?.isLocked, expectedLocked, "server startup lock state must match this smoke mode");
  report.configuration.publicCatalogueMatched = true;

  const publisher = await launchClient("publisher", { syntheticAudio: true });
  const visitor = await launchClient("visitor");
  report.runtime.firefox = contexts[0]?.browser()?.version() ?? "not-reported";
  const publisherRenderer = await joinRoom(publisher, "Door publisher", "studio");
  const visitorRenderer = await joinRoom(visitor, "Door visitor", "lobby");
  report.runtime.renderers = { publisher: publisherRenderer, visitor: visitorRenderer };
  assert.ok(["WebGL", "Canvas"].includes(publisherRenderer));
  assert.ok(["WebGL", "Canvas"].includes(visitorRenderer));
  await startPublishing(publisher);
  await waitUntil(() => publisher.transport.packets.sent.length > 0, "synthetic publisher audio packet");
  const publisherFramesBeforeDoor = publisher.transport.packets.sent.length;
  stage("meeting-audio-publisher-active-before-door-probes", { sourceFramesObserved: publisherFramesBeforeDoor, source: "synthetic oscillator" });
  const diagnosticsBeforeExternal = expectedLocked ? restrictedRoomCounters(await readDiagnostics()) : null;
  await runExternalGateProbes();
  if (expectedLocked) {
    const diagnosticsAfterExternal = restrictedRoomCounters(await readDiagnostics());
    assert.deepEqual(gateDeliveryCounters(diagnosticsAfterExternal), gateDeliveryCounters(diagnosticsBeforeExternal), "rejected external access must not create meeting-room delivery events or media controls");
    assert.ok(publisher.transport.packets.sent.length > publisherFramesBeforeDoor, "the synthetic publisher continues sending while denied visitors receive no bytes");
    report.snapshots.push({ phase: "external-denials-meeting-room-counters", before: diagnosticsBeforeExternal, after: diagnosticsAfterExternal, filteredSpaceSnapshotsMayIncludeOtherRoomActivity: true });
  }

  if (expectedLocked) {
    const before = visitor.transport.latestSpaceSnapshot;
    const beforePlayer = latestPlayers(visitor).find((player) => player.displayName === "Door visitor");
    assert.equal(before?.currentRoomId, "lobby");
    assert.ok(beforePlayer);
    assert.equal(visitor.transport.packets.received.length, 0, "the visitor has received no meeting audio before attempting the door");
    await clickSceneDoor(visitor);
    await visitor.page.getByTestId("meeting-room-password").waitFor({ state: "visible" });
    await fillPassword(visitor, wrongPassword);
    const deniedPacketCount = visitor.transport.packets.received.length;
    await visitor.page.getByRole("button", { name: "Enter room", exact: true }).click();
    await visitor.page.getByText(/password is incorrect/u).waitFor();
    const cleared = await visitor.page.getByTestId("meeting-room-password").inputValue();
    assert.equal(cleared, "", "wrong password text should be cleared from the visible input");
    const afterWrong = visitor.transport.latestSpaceSnapshot;
    const afterWrongPlayer = latestPlayers(visitor).find((player) => player.displayName === "Door visitor");
    assert.equal(afterWrong?.currentRoomId, "lobby");
    assert.deepEqual([afterWrongPlayer?.x, afterWrongPlayer?.y], [beforePlayer.x, beforePlayer.y]);
    assert.equal(afterWrong?.rooms.find((room) => room.id === "studio")?.players.length, 0);
    assert.equal(visitor.transport.packets.received.length, deniedPacketCount, "the lobby browser must receive no meeting audio packets before admission");
    await visitor.page.screenshot({ path: join(outputDirectory, "locked-door-rejected.png"), fullPage: true });
    report.screenshots.push("locked-door-rejected.png");
    report.snapshots.push({ phase: "wrong-password-kept-original-room", roomId: afterWrong?.currentRoomId, position: afterWrongPlayer ? { x: afterWrongPlayer.x, y: afterWrongPlayer.y } : null, meetingMemberCount: 0, passwordFieldCleared: true });
    stage("wrong-password-kept-original-room", { roomId: afterWrong?.currentRoomId, passwordFieldCleared: true, mediaPacketsBeforeAndAfterDenial: deniedPacketCount });

    await fillPassword(visitor, testPassword);
    await visitor.page.getByRole("button", { name: "Enter room", exact: true }).click();
    await visitor.page.getByText("Connected to Meeting room", { exact: true }).waitFor();
    await waitUntil(() => visitor.transport.latestSpaceSnapshot?.currentRoomId === "studio", "correct password room snapshot");
    assert.equal(visitor.transport.latestSpaceSnapshot.rooms.find((room) => room.id === "studio")?.isLocked, true);
    stage("correct-password-entered-meeting-room", { roomId: "studio", isLocked: true });
  } else {
    await clickSceneDoor(visitor);
    await visitor.page.getByText("Connected to Meeting room", { exact: true }).waitFor();
    await waitUntil(() => visitor.transport.latestSpaceSnapshot?.currentRoomId === "studio", "unlocked door room snapshot");
    assert.equal(await visitor.page.getByTestId("meeting-room-password").count(), 0);
    stage("unlocked-door-entered-without-password", { roomId: "studio", passwordDialogShown: false });
    await clickSceneDoor(visitor);
    await visitor.page.getByText("Connected to Open area", { exact: true }).waitFor();
    await waitUntil(() => visitor.transport.latestSpaceSnapshot?.currentRoomId === "lobby", "unlocked door exit snapshot");
    stage("unlocked-door-exit", { roomId: "lobby" });
    await clickHtmlDoor(visitor);
    await visitor.page.getByText("Connected to Meeting room", { exact: true }).waitFor();
    await waitUntil(() => visitor.transport.latestSpaceSnapshot?.currentRoomId === "studio", "HTML door entry snapshot");
    report.snapshots.push({ phase: "html-door-entry", roomId: "studio", isLocked: false });
  }

  const visitorJoinState = visitor.transport.latestSpaceSnapshot;
  const visitorPlayer = latestPlayers(visitor).find((player) => player.displayName === "Door visitor");
  report.snapshots.push({ phase: "authorized-door-entry", roomId: visitorJoinState?.currentRoomId, position: visitorPlayer ? { x: visitorPlayer.x, y: visitorPlayer.y } : null, isLocked: expectedLocked });
  assert.equal(visitorJoinState?.currentRoomId, "studio");

  await enableListening(visitor);
  const renderedAudio = await waitForRenderedAudio(visitor);
  assert.ok(renderedAudio.receivedPackets > 0 && renderedAudio.renderedSamples > 0 && renderedAudio.renderRms > 0.0001);
  await visitor.page.screenshot({ path: join(outputDirectory, "meeting-room-audio-rendered.png"), fullPage: true });
  report.screenshots.push("meeting-room-audio-rendered.png");
  stage("authorized-meeting-audio-rendered", { publisherStarted: true, receiver: renderedAudio });

  const publisherStopCount = controlCount(publisher, "audio.stopped");
  const visitorEndCount = controlCount(visitor, "audio.streamEnded");
  await publisher.page.getByRole("button", { name: "停止麥克風", exact: true }).click();
  await waitForControl(publisher, "audio.stopped", publisherStopCount);
  await waitForControl(visitor, "audio.streamEnded", visitorEndCount);
  const countsAtStop = Object.fromEntries(Object.entries(clients).map(([name, client]) => [name, {
    sent: client.transport.packets.sent.length,
    received: client.transport.packets.received.length,
  }]));
  await new Promise((resolveWait) => setTimeout(resolveWait, STABLE_TRACE_MS));
  for (const [name, client] of Object.entries(clients)) {
    assert.equal(client.transport.packets.sent.length, countsAtStop[name].sent, `${name} sent trace must settle after stop`);
    assert.equal(client.transport.packets.received.length, countsAtStop[name].received, `${name} received trace must settle after stop`);
  }
  const publisherHashes = new Set(publisher.transport.packets.sent.map((packet) => packet.sha256));
  const received = visitor.transport.packets.received;
  const unmatched = received.filter((packet) => !publisherHashes.has(packet.sha256));
  assert.deepEqual(unmatched, [], "visitor Opus frames should match publisher-sent opaque frame hashes");
  assert.ok(publisher.transport.packets.sent.length > publisherFramesBeforeDoor);
  report.packetSourceMappings = [{ receiver: "visitor", sentFrames: publisher.transport.packets.sent.length, receivedFrames: received.length, unmatchedSourceHashes: unmatched.length, source: "publisher page synthetic oscillator; payload bytes not retained" }];
  report.limits.audioPacketHashTruncation = "not-truncated";
  report.snapshots.push({ phase: "publisher-stop-stable-trace", stopAcknowledged: true, streamEnded: true, stableWindowMs: STABLE_TRACE_MS, packetCounts: countsAtStop, sourceHashAudit: "passed-before-browser-close" });
  stage("publisher-stopped-and-source-hashes-audited", { stableWindowMs: STABLE_TRACE_MS, sentFrames: publisher.transport.packets.sent.length, receivedFrames: received.length, unmatchedSourceHashes: unmatched.length });

  for (const [name, client] of Object.entries(clients)) {
    assert.equal(client.transport.droppedControls, 0, `${name} controls must not be truncated`);
    assert.deepEqual(client.transport.droppedPackets, { sent: 0, received: 0 }, `${name} packet hashes must not be truncated`);
    assert.deepEqual(client.transport.pageErrors, [], `${name} page must have no uncaught errors`);
    assert.deepEqual(client.transport.socketErrors, [], `${name} WebSocket must have no errors`);
  }
  report.limits.controlTraceTruncation = "not-truncated";
  stage("bounded-traces-and-errors-checked");
} catch (error) {
  failure = new Error(redactError(error));
} finally {
  for (const context of contexts) {
    try { await context.close(); } catch { /* Continue closing remaining isolated profiles. */ }
  }
  writeReport();
}

if (failure) throw failure;
console.log(`Room access smoke passed; evidence saved under ${relative(root, outputDirectory)}.`);
