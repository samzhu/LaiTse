import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep, isAbsolute } from "node:path";

const root = process.cwd();
const scratchRoot = resolve(root, ".scratch/space-policy");
const outputDirectory = resolve(root, process.env.SPACE_POLICY_OUTPUT_DIR ?? ".scratch/space-policy/desktop-smoke");
const outputRelative = relative(scratchRoot, outputDirectory);
if (isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(`..${sep}`)) {
  throw new Error("SPACE_POLICY_OUTPUT_DIR must stay inside .scratch/space-policy.");
}

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, ".tools/playwright-browsers");
const { firefox } = await import("playwright");
const caCertificate = resolve(process.env.SPACE_POLICY_CA_CERT ?? ".scratch/t01/tls/local-ca.pem");
readFileSync(caCertificate);
const baseURL = process.env.SPACE_POLICY_BASE_URL ?? `https://localhost:${process.env.PORT ?? "4173"}`;
const target = new URL(baseURL);
const certificateUtility = process.env.CERTUTIL_BIN ?? "certutil";
const headless = process.env.HEADLESS !== "0";
const MAX_PACKET_RECORDS = 2_000;
const MAX_CONTROL_RECORDS = 600;
const MESSAGE_TIMEOUT_MS = 5_000;
const MOVE_SETTLE_MS = 160;

mkdirSync(outputDirectory, { recursive: true });
const report = {
  schemaVersion: 1,
  purpose: "Short three-Firefox space policy smoke: open-area proximity audio, receiver and publisher movement, then meeting-room whole-room audio.",
  startedAt: new Date().toISOString(),
  status: "running",
  baseURL: target.origin,
  topology: { browserProcesses: 3, clients: ["publisher", "near", "far"], network: "one local application over trusted HTTPS/WSS" },
  runtime: { node: process.version, platform: process.platform, architecture: process.arch, firefox: "not-reported" },
  tls: { caCertificate, trust: "local CA imported into isolated Firefox profiles only", ignoreCertificateErrors: false, systemTrustChanged: false },
  syntheticSource: "The publisher page replaces getUserMedia() with a generated oscillator routed to MediaStreamDestination. No hardware microphone is used.",
  settings: { openAreaRadiusGridUnits: 6, meaning: "provisional demonstration setting only; not a product decision", boundary: "inclusive Euclidean distance in authoritative grid units" },
  clients: {},
  phases: [],
  snapshots: [],
  packetSourceMappings: [],
  screenshots: [],
  errors: { pageErrors: [], socketErrors: [], failure: null },
  limits: {
    controlsPerClient: MAX_CONTROL_RECORDS,
    packetHashesPerDirectionAndClient: MAX_PACKET_RECORDS,
    packetHashTruncation: "run fails if a collection reaches its cap; only opaque source-match hashes and headers are recorded, never media payload bytes",
    humanHearing: "not-tested",
    physicalMicrophone: "not-tested",
    mobile: "not-tested",
    authenticationAndPrivateEntry: "not-tested; connection UUID is not a verified person identity",
    doorsAndPasswords: "not-tested; intentionally outside this slice",
    endToEndLatency: "not-measured",
  },
};

const contexts = [];
const clients = {};
let failure;

function recordStage(name, details = {}) {
  const item = { name, at: new Date().toISOString(), ...details };
  report.phases.push(item);
  console.log(`[SPACE-POLICY] ${name}${Object.keys(details).length ? ` ${JSON.stringify(details)}` : ""}`);
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

function attachTransport(page, name) {
  const transport = {
    name,
    sockets: 0,
    controls: [],
    droppedControls: 0,
    packets: { sent: [], received: [] },
    droppedPackets: { sent: 0, received: 0 },
    latestSpaceSnapshot: null,
    spaceSnapshots: 0,
    pageErrors: [],
    socketErrors: [],
  };
  page.on("pageerror", (error) => {
    const item = { at: new Date().toISOString(), message: error.message };
    transport.pageErrors.push(item);
    report.errors.pageErrors.push({ client: name, ...item });
  });
  page.on("websocket", (socket) => {
    transport.sockets += 1;
    const recordControl = (payload, direction) => {
      if (typeof payload !== "string") return;
      let message;
      try { message = JSON.parse(payload); }
      catch { message = { type: "unparsed-control" }; }
      const record = { at: Date.now(), direction, type: message?.type ?? "unknown" };
      for (const key of ["seq", "currentRoomId", "generation", "reason", "code"]) {
        if (typeof message?.[key] === "string" || Number.isInteger(message?.[key])) record[key] = message[key];
      }
      if (message?.type === "room.snapshot") record.room = { ...message.room };
      if (message?.type === "space.snapshot") {
        transport.spaceSnapshots += 1;
        transport.latestSpaceSnapshot = message;
        const activeRoom = message.rooms?.find((room) => room.id === message.currentRoomId);
        record.space = {
          currentRoomId: message.currentRoomId,
          seq: message.seq,
          rooms: (message.rooms ?? []).map(({ id, kind, audioPolicy, audioRadiusGridUnits }) => ({ id, kind, audioPolicy, audioRadiusGridUnits })),
          players: (activeRoom?.players ?? []).map(({ id, displayName, roomId, x, y }) => ({ id, displayName, roomId, x, y })),
        };
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
    socket.on("framesent", (frame) => {
      if (typeof frame.payload === "string") recordControl(frame.payload, "sent");
      else recordPacket(frame.payload, "sent");
    });
    socket.on("framereceived", (frame) => {
      if (typeof frame.payload === "string") recordControl(frame.payload, "received");
      else recordPacket(frame.payload, "received");
    });
    socket.on("socketerror", (error) => {
      const item = String(error);
      transport.socketErrors.push(item);
      report.errors.socketErrors.push({ client: name, message: item });
    });
  });
  clients[name] = { page, transport };
  return clients[name];
}

async function launchClient(name) {
  const profile = createTrustedProfile(name);
  const context = await firefox.launchPersistentContext(profile.profileDirectory, {
    headless,
    env: { ...process.env, MOZ_APP_DATA: profile.appData, MOZ_LOCAL_APP_DATA: profile.localAppData },
    viewport: { width: 1440, height: 1050 },
    colorScheme: "light",
    firefoxUserPrefs: { "media.navigator.streams.fake": true },
  });
  context.setDefaultTimeout(8_000);
  contexts.push(context);
  const page = context.pages()[0] ?? await context.newPage();
  const client = attachTransport(page, name);
  await page.addInitScript(({ frequency }) => {
    Object.defineProperty(window, "__spacePolicySynthetic", { value: { frequency, context: null, tracks: [] } });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const state = window.__spacePolicySynthetic;
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
  }, { frequency: 587 });
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

function namedPlayer(client, displayName) {
  return latestPlayers(client).find((player) => player.displayName === displayName);
}

async function joinRoom(client, displayName, roomId) {
  const { page, transport } = client;
  await page.goto(target.origin, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Your display name").fill(displayName);
  await page.locator(`[data-room-choice="${roomId}"]`).click();
  await page.getByRole("button", { name: "Join room" }).click();
  const expectedName = roomId === "lobby" ? "Open area" : "Meeting room";
  await page.getByText(`Connected to ${expectedName}`, { exact: true }).waitFor();
  await page.locator('[data-testid="audio-panel"]').waitFor();
  await waitUntil(() => transport.latestSpaceSnapshot?.currentRoomId === roomId, `${displayName} space snapshot`);
}

async function moveViaUi(client, displayName, direction, expectedX, expectedRoomId) {
  const { page, transport } = client;
  const previousSeq = transport.latestSpaceSnapshot?.seq ?? 0;
  const label = direction === "right" ? "Move right" : "Move left";
  await page.getByRole("button", { name: label }).click();
  const snapshot = await waitUntil(() => {
    const latest = transport.latestSpaceSnapshot;
    return latest && latest.seq > previousSeq && latest.currentRoomId === expectedRoomId && namedPlayer(client, displayName)?.x === expectedX
      ? latest
      : null;
  }, `${displayName} authoritative ${direction} movement`);
  await new Promise((resolveWait) => setTimeout(resolveWait, MOVE_SETTLE_MS));
  return { seq: snapshot.seq, player: namedPlayer(client, displayName) };
}

function controlCount(client, type) {
  return client.transport.controls.filter((control) => control.direction === "received" && control.type === type).length;
}

async function waitForControl(client, type, previousCount, predicate = () => true) {
  return await waitUntil(() => {
    const matches = client.transport.controls.filter((control) => control.direction === "received" && control.type === type).slice(previousCount);
    return matches.findLast(predicate) ?? null;
  }, `${client.transport.name} ${type}`);
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

async function switchRoom(client, roomId) {
  const { page, transport } = client;
  const previousSeq = transport.latestSpaceSnapshot?.seq ?? 0;
  await page.locator(`[data-room-choice="${roomId}"]`).click();
  const name = roomId === "lobby" ? "Open area" : "Meeting room";
  await page.getByText(`Connected to ${name}`, { exact: true }).waitFor();
  await waitUntil(() => {
    const snapshot = transport.latestSpaceSnapshot;
    return snapshot && snapshot.seq > previousSeq && snapshot.currentRoomId === roomId ? snapshot : null;
  }, `${client.transport.name} switched room snapshot`);
}

function writeReport() {
  report.finishedAt = new Date().toISOString();
  report.status = failure ? "failed" : "passed";
  report.errors.failure = failure ? String(failure?.stack ?? failure) : null;
  for (const [name, client] of Object.entries(clients)) {
    report.clients[name] = {
      sockets: client.transport.sockets,
      latestSpaceSnapshot: client.transport.latestSpaceSnapshot
        ? (() => {
            const snapshot = client.transport.latestSpaceSnapshot;
            const room = snapshot.rooms.find((candidate) => candidate.id === snapshot.currentRoomId);
            return {
              seq: snapshot.seq,
              currentRoomId: snapshot.currentRoomId,
              roomKind: room?.kind,
              audioPolicy: room?.audioPolicy,
              audioRadiusGridUnits: room?.audioRadiusGridUnits,
              players: room?.players.map(({ displayName, x, y }) => ({ displayName, x, y })) ?? [],
              otherRoomMemberCount: snapshot.rooms.find((candidate) => candidate.id !== snapshot.currentRoomId)?.players.length ?? -1,
            };
          })()
        : null,
      controls: client.transport.controls,
      droppedControls: client.transport.droppedControls,
      packets: client.transport.packets,
      droppedPackets: client.transport.droppedPackets,
      pageErrors: client.transport.pageErrors,
      socketErrors: client.transport.socketErrors,
    };
  }
  writeFileSync(join(outputDirectory, "space-policy-report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

try {
  const publisher = await launchClient("publisher");
  const near = await launchClient("near");
  const far = await launchClient("far");
  report.runtime.firefox = contexts[0]?.browser()?.version() ?? "not-reported";
  await joinRoom(publisher, "Policy speaker", "lobby");
  await joinRoom(near, "Near listener", "lobby");
  await joinRoom(far, "Far listener", "lobby");
  await far.page.locator('[data-room-choice="lobby"] .space-room-choice-detail').waitFor();
  assert.match(await far.page.locator('[data-room-choice="lobby"] .space-room-choice-detail').innerText(), /proximity voice.*demo range 6 grid units/u);
  assert.match(await far.page.locator('[data-room-choice="studio"] .space-room-choice-detail').innerText(), /everyone inside can hear/u);

  const initialFar = namedPlayer(far, "Far listener");
  const initialPublisher = namedPlayer(far, "Policy speaker");
  assert.deepEqual([initialPublisher.x, initialPublisher.y, initialFar.x, initialFar.y], [2, 2, 8, 2]);
  await moveViaUi(far, "Far listener", "right", 9, "lobby");
  await moveViaUi(far, "Far listener", "right", 10, "lobby");
  const farAtEleven = await moveViaUi(far, "Far listener", "right", 11, "lobby");
  report.snapshots.push({ phase: "open-area-out-of-range", client: "far", seq: farAtEleven.seq, players: latestPlayers(far).map(({ displayName, x, y }) => ({ displayName, x, y })) });

  await Promise.all([enableListening(near), enableListening(far)]);
  const nearStreamBeforePublish = controlCount(near, "audio.stream");
  const farUnavailableBeforePublish = controlCount(far, "audio.unavailable");
  const started = await startPublishing(publisher);
  const nearStream = await waitForControl(near, "audio.stream", nearStreamBeforePublish);
  const farUnavailable = await waitForControl(far, "audio.unavailable", farUnavailableBeforePublish);
  assert.equal(nearStream.generation, started.generation);
  assert.equal(farUnavailable.reason, "out_of_range");
  const nearOpenRender = await waitForRenderedAudio(near);
  await near.page.screenshot({ path: join(outputDirectory, "open-area-near.png"), fullPage: true });
  report.screenshots.push("open-area-near.png");
  const farOpenPackets = far.transport.packets.received.length;
  const farOpenAudio = await far.page.locator('[data-testid="audio-panel"]').evaluate((panel) => ({
    receivedPackets: Number(panel.getAttribute("data-received-packets")),
    listenerStatus: panel.querySelector('[data-audio-status="listener"]')?.textContent,
  }));
  assert.equal(farOpenAudio.receivedPackets, 0);
  assert.match(farOpenAudio.listenerStatus, /範圍/u);
  await new Promise((resolveWait) => setTimeout(resolveWait, 350));
  assert.equal(far.transport.packets.received.length, farOpenPackets, "far open-area listener must receive no raw audio packet");
  recordStage("open-area-near-renders-far-is-silent", { publisherGeneration: started.generation, near: nearOpenRender, farReceivedPackets: farOpenAudio.receivedPackets, farRawPackets: farOpenPackets });

  const farStreamCount = controlCount(far, "audio.stream");
  await moveViaUi(far, "Far listener", "left", 10, "lobby");
  await moveViaUi(far, "Far listener", "left", 9, "lobby");
  const boundary = await moveViaUi(far, "Far listener", "left", 8, "lobby");
  const farEntered = await waitForControl(far, "audio.stream", farStreamCount);
  assert.equal(farEntered.generation, started.generation);
  const farOpenRender = await waitForRenderedAudio(far);
  report.snapshots.push({ phase: "open-area-at-inclusive-boundary", client: "far", seq: boundary.seq, players: latestPlayers(far).map(({ displayName, x, y }) => ({ displayName, x, y })) });

  const endedCount = controlCount(far, "audio.streamEnded");
  const out = await moveViaUi(far, "Far listener", "right", 9, "lobby");
  const ended = await waitForControl(far, "audio.streamEnded", endedCount, (control) => control.reason === "out_of_range");
  assert.equal(ended.generation, started.generation);
  await far.page.waitForFunction(() => {
    const panel = document.querySelector('[data-testid="audio-panel"]');
    return panel?.getAttribute("data-queued-samples") === "0" && panel.getAttribute("data-render-rms") === "0" &&
      panel.getAttribute("data-receiver-generation") === "" && panel.getAttribute("data-audio-playback-clock-id") === "" &&
      panel.querySelector('[data-audio-status="listener"]')?.textContent.includes("範圍");
  }, undefined, { timeout: 2_000 });
  const clearedState = await far.page.locator('[data-testid="audio-panel"]').evaluate((panel) => ({
    queuedSamples: Number(panel.getAttribute("data-queued-samples")),
    renderRms: Number(panel.getAttribute("data-render-rms")),
    receiverGeneration: panel.getAttribute("data-receiver-generation"),
    playbackClockId: panel.getAttribute("data-audio-playback-clock-id"),
  }));
  assert.deepEqual(clearedState, { queuedSamples: 0, renderRms: 0, receiverGeneration: "", playbackClockId: "" });
  const packetsAfterOut = far.transport.packets.received.length;
  await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  assert.equal(far.transport.packets.received.length, packetsAfterOut, "no raw packet may follow the out-of-range boundary ACK window");
  report.snapshots.push({ phase: "open-area-out-after-listening", client: "far", seq: out.seq, ...clearedState, noNewPacketWindowMs: 300 });
  recordStage("open-area-reentry-and-clear", { nearRender: nearOpenRender, farRender: farOpenRender, endedReason: ended.reason, farRawPacketsAfterBoundary: packetsAfterOut });

  const farReentryCount = controlCount(far, "audio.stream");
  await moveViaUi(far, "Far listener", "left", 8, "lobby");
  await waitForControl(far, "audio.stream", farReentryCount);
  const publisherEndedCount = controlCount(far, "audio.streamEnded");
  await moveViaUi(publisher, "Policy speaker", "left", 1, "lobby");
  const receiverEndedOnPublisherMove = await waitForControl(far, "audio.streamEnded", publisherEndedCount, (control) => control.reason === "out_of_range");
  assert.equal(receiverEndedOnPublisherMove.generation, started.generation);
  const publisherRestoredCount = controlCount(far, "audio.stream");
  await moveViaUi(publisher, "Policy speaker", "right", 2, "lobby");
  await waitForControl(far, "audio.stream", publisherRestoredCount);
  recordStage("publisher-movement-reconciles-distance", { receiverEndedReason: receiverEndedOnPublisherMove.reason, restoredSameGeneration: true });

  await switchRoom(publisher, "studio");
  await switchRoom(near, "studio");
  await switchRoom(far, "studio");
  await moveViaUi(far, "Far listener", "right", 9, "studio");
  await moveViaUi(far, "Far listener", "right", 10, "studio");
  const meetingFar = await moveViaUi(far, "Far listener", "right", 11, "studio");
  const meetingSnapshot = far.transport.latestSpaceSnapshot;
  assert.equal(meetingSnapshot.rooms.find((room) => room.id === "studio").audioPolicy, "room");
  assert.equal(meetingSnapshot.rooms.find((room) => room.id === "lobby").players.length, 0);
  report.snapshots.push({ phase: "meeting-room-distant-member", client: "far", seq: meetingFar.seq, players: latestPlayers(far).map(({ displayName, x, y }) => ({ displayName, x, y })) });

  await Promise.all([enableListening(near), enableListening(far)]);
  const nearMeetingStreamCount = controlCount(near, "audio.stream");
  const farMeetingStreamCount = controlCount(far, "audio.stream");
  const meetingStarted = await startPublishing(publisher);
  const [nearMeetingStream, farMeetingStream] = await Promise.all([
    waitForControl(near, "audio.stream", nearMeetingStreamCount),
    waitForControl(far, "audio.stream", farMeetingStreamCount),
  ]);
  assert.equal(nearMeetingStream.generation, meetingStarted.generation);
  assert.equal(farMeetingStream.generation, meetingStarted.generation);
  const [nearMeetingRender, farMeetingRender] = await Promise.all([waitForRenderedAudio(near), waitForRenderedAudio(far)]);
  assert.ok(farMeetingRender.receivedPackets > 0 && farMeetingRender.renderedSamples > 0 && farMeetingRender.renderRms > 0.0001);
  recordStage("meeting-room-distant-member-renders", { publisherGeneration: meetingStarted.generation, near: nearMeetingRender, far: farMeetingRender });

  await far.page.screenshot({ path: join(outputDirectory, "meeting-room-distant.png"), fullPage: true });
  report.screenshots.push("meeting-room-distant.png");

  const publisherStopCount = controlCount(publisher, "audio.stopped");
  const nearEndCount = controlCount(near, "audio.streamEnded");
  const farEndCount = controlCount(far, "audio.streamEnded");
  await publisher.page.getByRole("button", { name: "停止麥克風", exact: true }).click();
  await Promise.all([
    waitForControl(publisher, "audio.stopped", publisherStopCount),
    waitForControl(near, "audio.streamEnded", nearEndCount),
    waitForControl(far, "audio.streamEnded", farEndCount),
  ]);
  const stoppedPacketCounts = Object.fromEntries(Object.entries(clients).map(([name, client]) => [name, {
    sent: client.transport.packets.sent.length,
    received: client.transport.packets.received.length,
  }]));
  await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  for (const [name, client] of Object.entries(clients)) {
    assert.equal(client.transport.packets.sent.length, stoppedPacketCounts[name].sent);
    assert.equal(client.transport.packets.received.length, stoppedPacketCounts[name].received);
  }
  recordStage("publisher-stopped-and-traces-settled", { stoppedPacketCounts, stableWindowMs: 300 });

  const publisherHashes = new Set(publisher.transport.packets.sent.map((packet) => packet.sha256));
  for (const name of ["near", "far"]) {
    const received = clients[name].transport.packets.received;
    const unmatched = received.filter((packet) => !publisherHashes.has(packet.sha256));
    assert.deepEqual(unmatched, [], `${name} browser audio frames should match publisher-sent opaque frame hashes`);
    report.packetSourceMappings.push({ receiver: name, receivedPacketHashes: received.length, unmatchedSourceHashes: unmatched.length, source: "publisher page's synthetic oscillator; frame payloads not retained" });
  }

  for (const [name, client] of Object.entries(clients)) {
    assert.equal(client.transport.droppedControls, 0, `${name} control trace must not be truncated`);
    assert.deepEqual(client.transport.droppedPackets, { sent: 0, received: 0 }, `${name} packet hash trace must not be truncated`);
    assert.deepEqual(client.transport.pageErrors, [], `${name} page should have no uncaught errors`);
    assert.deepEqual(client.transport.socketErrors, [], `${name} socket should have no errors`);
  }
  report.limits.rawPacketHashTruncation = "not-truncated";
  recordStage("bounded-traces-and-errors-checked");
} catch (error) {
  failure = error;
} finally {
  if (failure) {
    for (const [name, client] of Object.entries(clients)) {
      try {
        if (await client.page.locator('[data-testid="audio-panel"]').count()) {
          const fileName = `${name}-failure.png`;
          await client.page.locator('[data-testid="audio-panel"]').screenshot({ path: join(outputDirectory, fileName) });
          report.screenshots.push(fileName);
        }
      } catch { /* Continue cleanup when a page already closed. */ }
    }
  }
  for (const context of contexts) {
    try { await context.close(); } catch { /* Continue cleanup for remaining isolated profiles. */ }
  }
  writeReport();
}

if (failure) throw failure;
console.log(`Space policy smoke passed; evidence saved under ${relative(root, outputDirectory)}.`);
