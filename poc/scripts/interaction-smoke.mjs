import { enterRepositoryRootForLegacyScript, repositoryRoot, pocRoot } from "./lib/project-paths.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import WebSocket from "ws";

enterRepositoryRootForLegacyScript();

const root = repositoryRoot;
const hostToken = process.env.INTERACTION_TEST_HOST_TOKEN ?? "";
if (Buffer.byteLength(hostToken, "utf8") < 32 || Buffer.byteLength(hostToken, "utf8") > 256) {
  throw new Error("INTERACTION_TEST_HOST_TOKEN must match the server's 32–256 byte host token.");
}

const scratchRoot = resolve(root, ".scratch/t10");
const outputDirectory = resolve(root, process.env.INTERACTION_OUTPUT_DIR ?? ".scratch/t10/acceptance");
const outputRelative = relative(scratchRoot, outputDirectory);
if (isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(`..${sep}`)) {
  throw new Error("INTERACTION_OUTPUT_DIR must stay inside .scratch/t10.");
}

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, ".tools/playwright-browsers");
const { firefox } = await import("playwright");
const caCertificate = resolve(process.env.INTERACTION_CA_CERT ?? process.env.CA_CERT ?? ".scratch/t01/tls/local-ca.pem");
const caPem = readFileSync(caCertificate);
const baseURL = process.env.INTERACTION_BASE_URL ?? `https://localhost:${process.env.PORT ?? "4173"}`;
const target = new URL(baseURL);
if (target.username || target.password || target.search || target.hash) throw new Error("INTERACTION_BASE_URL must not contain credentials, query parameters, or fragments.");
const certificateUtility = process.env.CERTUTIL_BIN ?? "certutil";
const headless = process.env.HEADLESS !== "0";
const contexts = [];
const probeSockets = new Set();
const clients = {};
const report = {
  schemaVersion: 1,
  purpose: "Short T10 room interaction check: official feedback, chat, fixed stickers, explicit public danmaku, host display controls, bounded expiry, and room isolation.",
  startedAt: new Date().toISOString(),
  status: "running",
  baseURL: target.origin,
  runtime: { node: process.version, platform: process.platform, architecture: process.arch, firefox: "not-reported" },
  tls: { caCertificate, trust: "local CA imported only into isolated Firefox profiles and trusted by Node WebSocket probes", ignoreCertificateErrors: false, systemTrustChanged: false },
  clients: {},
  probes: [],
  checks: [],
  screenshots: [],
  limits: {
    chatCodePoints: 300,
    danmakuCodePoints: 60,
    chatHistoryItems: 50,
    chatHistoryTtlMs: 300_000,
    publicQueueItems: 20,
    publicTtlMs: 8_000,
    feedbackWindowMs: 60_000,
    feedbackItems: 512,
    dedupItems: 2_048,
    dedupTtlMs: 600_000,
    interactionRatePerSecond: 10,
    feedbackRatePerSecond: 1,
    note: "Small local POC fixture limits; not product settings. No 100-event latency sample or p95 claim was run.",
  },
  credentials: { hostToken: "not-recorded", meetingRoomPassword: "not-used" },
  errors: { pageErrors: [], socketErrors: [], collectionErrors: [], failure: null },
};
let failure;
mkdirSync(outputDirectory, { recursive: true });

function stage(name, details = {}) {
  report.checks.push({ name, at: new Date().toISOString(), ...details });
  console.log(`[T10] ${name}${Object.keys(details).length ? ` ${JSON.stringify(details)}` : ""}`);
}

function redact(value) {
  return String(value ?? "").split(hostToken).join("[redacted]");
}

function runCertutil(args) { execFileSync(certificateUtility, args, { stdio: "pipe" }); }

function createTrustedProfile(name) {
  const folder = join(outputDirectory, name);
  const profileDirectory = join(folder, "profile");
  rmSync(profileDirectory, { recursive: true, force: true });
  mkdirSync(profileDirectory, { recursive: true });
  runCertutil(["-N", "-d", `sql:${profileDirectory}`, "--empty-password"]);
  runCertutil(["-A", "-d", `sql:${profileDirectory}`, "-n", "LaiTse local development CA", "-t", "C,,", "-i", caCertificate]);
  const appData = join(folder, "app-data");
  const localAppData = join(folder, "local-app-data");
  mkdirSync(appData, { recursive: true });
  mkdirSync(localAppData, { recursive: true });
  return { profileDirectory, appData, localAppData };
}

function safeMessage(raw, direction) {
  let message;
  try { message = JSON.parse(raw); } catch { return { direction, type: "unparsed-control" }; }
  const record = { direction, type: typeof message?.type === "string" ? message.type : "unknown" };
  for (const key of ["roomId", "eventId", "interactionId", "code", "action", "kind", "duplicate", "paused", "enabled", "queueCount", "clearedCount", "removed"]) {
    if (typeof message?.[key] === "string" || typeof message?.[key] === "boolean" || typeof message?.[key] === "number") record[key] = message[key];
  }
  if (message.type === "room.snapshot") {
    record.roomId = message.room?.id ?? "";
    record.participantIds = Array.isArray(message.members) ? message.members.map((member) => member.id) : [];
    record.lastSeq = message.lastSeq;
  }
  if (message.type === "space.snapshot") {
    record.roomId = message.currentRoomId;
    record.participantId = message.participantId;
  }
  if (message.type === "interaction.snapshot" || message.type === "interaction.state") {
    record.roomId = message.roomId;
    record.historyCount = Array.isArray(message.history) ? message.history.length : 0;
    record.queueCount = message.queueCount;
    record.presentation = message.presentation;
    record.feedbackStats = message.feedbackStats;
    record.serverNow = message.serverNow;
  }
  if (message.type === "interaction.event") {
    record.roomId = message.roomId;
    record.kind = message.event?.kind;
    record.eventId = message.event?.eventId;
    record.interactionId = message.event?.id;
    record.participantId = message.event?.participantId;
    record.queueCount = message.state?.queueCount;
  }
  if (message.type === "interaction.ack") record.acknowledged = true;
  return record;
}

function attachPage(page, name) {
  const client = { name, roomId: "", participantId: "", frames: [], errors: [], interactionIds: [], acknowledgements: [], controlErrors: [] };
  page.on("pageerror", (error) => {
    const item = redact(error.stack ?? error.message);
    client.errors.push(item);
    report.errors.pageErrors.push({ client: name, message: item });
  });
  page.on("websocket", (socket) => {
    socket.on("framesent", (frame) => recordFrame(client, frame, "sent"));
    socket.on("framereceived", (frame) => recordFrame(client, frame, "received"));
    socket.on("socketerror", (error) => report.errors.socketErrors.push({ client: name, message: redact(error) }));
  });
  clients[name] = { page, client };
  return client;
}

function recordFrame(client, frame, direction) {
  if (typeof frame.payload !== "string") return;
  const record = safeMessage(frame.payload, direction);
  if (client.frames.length >= 2_000) {
    report.errors.collectionErrors.push({ client: client.name, code: "frame_collection_cap_exceeded", cap: 2_000 });
    return;
  }
  client.frames.push(record);
  if (direction === "received" && record.type === "room.snapshot") {
    client.roomId = record.roomId;
  }
  if (direction === "received" && record.type === "space.snapshot") {
    client.roomId = record.roomId;
    client.participantId = record.participantId;
  }
  if (direction === "received" && record.type === "interaction.ack") client.acknowledgements.push(record);
  if (direction === "received" && record.type === "interaction.event" && record.interactionId) client.interactionIds.push(record.interactionId);
  if (direction === "received" && (record.type === "interaction.error" || record.type === "protocol.error" || record.type === "host.error")) client.controlErrors.push(record);
}

async function launchClient(name) {
  const profile = createTrustedProfile(name);
  const browserEnv = { ...process.env, MOZ_APP_DATA: profile.appData, MOZ_LOCAL_APP_DATA: profile.localAppData };
  for (const key of Object.keys(browserEnv)) {
    if (key === "HOST_CONTROL_TOKEN" || key.includes("TOKEN") || key.includes("PASSWORD") || key.includes("SECRET")) delete browserEnv[key];
  }
  const context = await firefox.launchPersistentContext(profile.profileDirectory, {
    headless,
    env: browserEnv,
    viewport: { width: 1360, height: 1000 },
    colorScheme: "light",
  });
  context.setDefaultTimeout(8_000);
  contexts.push(context);
  const page = context.pages()[0] ?? await context.newPage();
  const client = attachPage(page, name);
  return { page, client };
}

async function waitFor(predicate, description, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 30));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function waitForFrame(client, type, predicate = () => true, afterIndex = 0, timeoutMs = 8_000) {
  return waitFor(() => client.frames.find((frame, index) => index >= afterIndex && frame.direction === "received" && frame.type === type && predicate(frame)) ?? null, `${client.name} ${type}`, timeoutMs);
}

function publicItem(page, text) {
  return page.getByTestId("public-stage").locator('[data-testid="public-danmaku"]').filter({ hasText: text });
}

async function joinPage(page, name, roomId) {
  await page.goto(target.origin, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Local room presence" }).waitFor();
  await page.locator(`[data-room-choice="${roomId}"]`).click();
  await page.getByLabel("Your display name").fill(name);
  await page.getByRole("button", { name: "Join room" }).click();
  await page.getByText(`Connected to ${roomId === "studio" ? "Meeting room" : "Open area"}`, { exact: true }).waitFor();
  await page.getByTestId("interaction-panel").waitFor();
  await page.getByTestId("interaction-room").filter({ hasText: roomId }).waitFor();
}

function openProbeSocket() {
  const socket = new WebSocket(`${target.origin.replace(/^http/, "ws")}/ws`, { origin: target.origin, ca: caPem });
  probeSockets.add(socket);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Interaction WebSocket probe did not open.")), 5_000);
    socket.once("open", () => { clearTimeout(timer); resolve(socket); });
    socket.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

function probeNext(socket, predicate, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off("message", onMessage); reject(new Error("Interaction probe response timed out.")); }, timeoutMs);
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

async function joinProbe(socket, roomId, displayName) {
  const room = probeNext(socket, (message) => message.type === "room.snapshot");
  const interactions = probeNext(socket, (message) => message.type === "interaction.snapshot");
  socket.send(JSON.stringify({ type: "join", roomId, displayName }));
  const [roomSnapshot, interactionSnapshot] = await Promise.all([room, interactions]);
  assert.equal(interactionSnapshot.roomId, roomId);
  return { roomSnapshot, interactionSnapshot };
}

async function screenshotAll(label) {
  for (const [name, { page }] of Object.entries(clients)) {
    const file = join(outputDirectory, `${label}-${name}.png`);
    try {
      await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
      report.screenshots.push(file);
    } catch (error) {
      report.errors.collectionErrors.push({ client: name, code: "screenshot_failed", message: redact(error) });
    }
  }
}

async function screenshotInteractionPanel(page, label) {
  const file = join(outputDirectory, `${label}-interaction-panel.png`);
  await page.getByTestId("interaction-panel").screenshot({ path: file, animations: "disabled" });
  report.screenshots.push(file);
}

try {
  const host = await launchClient("studio-host");
  const guest = await launchClient("studio-guest");
  const lobby = await launchClient("lobby-observer");
  await Promise.all([
    joinPage(host.page, "T10 host", "studio"),
    joinPage(guest.page, "T10 guest", "studio"),
    joinPage(lobby.page, "T10 lobby", "lobby"),
  ]);
  report.runtime.firefox = await host.page.evaluate(() => navigator.userAgent);
  for (const [name, client] of Object.entries(clients)) {
    report.clients[name] = { roomId: client.client.roomId, participantId: client.client.participantId, frames: client.client.frames, acknowledgements: client.client.acknowledgements, controlErrors: client.client.controlErrors };
    const roomSnapshotIndex = client.client.frames.findIndex((frame) => frame.direction === "received" && frame.type === "room.snapshot");
    const interactionSnapshotIndex = client.client.frames.findIndex((frame) => frame.direction === "received" && frame.type === "interaction.snapshot");
    assert.ok(roomSnapshotIndex >= 0 && interactionSnapshotIndex > roomSnapshotIndex, `${name} interaction snapshot must follow its room snapshot`);
  }
  stage("joined two studio pages and one isolated lobby page", {
    clients: Object.fromEntries(Object.entries(clients).map(([name, item]) => [name, { roomId: item.client.roomId, participantId: item.client.participantId }])),
  });

  await host.page.getByTestId("host-control-token").fill(hostToken);
  await host.page.getByTestId("host-claim").click();
  await host.page.getByTestId("host-state").filter({ hasText: "HOST" }).waitFor();
  stage("host claimed controls through the existing T09 panel");

  for (const [feedback, testId] of [["like", "feedback-like"], ["want-listen", "feedback-want-listen"], ["useful", "feedback-useful"]]) {
    const before = guest.client.acknowledgements.length;
    await guest.page.getByTestId(testId).click();
    await waitFor(() => guest.client.acknowledgements.slice(before).some((item) => item.eventId), `${feedback} acknowledgement`);
    await waitFor(() => {
      const stat = host.page.getByTestId(testId).locator(".interaction-feedback-count");
      return stat.textContent().then((value) => Number.parseInt(value ?? "0", 10) >= 1);
    }, `${feedback} count`);
    stage(`sent official feedback ${feedback}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_050));
  }

  const chatText = "T10 fixture chat stays in the room list.";
  await guest.page.getByTestId("chat-input").fill(chatText);
  await guest.page.getByTestId("chat-send").click();
  await host.page.getByTestId("chat-list").getByText(chatText, { exact: true }).waitFor();
  await lobby.page.getByTestId("chat-list").getByText(chatText, { exact: true }).waitFor({ state: "detached" });
  stage("sent plain text chat to the studio history only");

  await guest.page.getByTestId("sticker-✨").click();
  await host.page.getByTestId("chat-list").locator('[data-testid="interaction-item"]').filter({ hasText: "✨" }).waitFor();
  stage("sent a fixed sticker to the studio chat list");

  const firstDanmaku = "T10 public fixture one.";
  await guest.page.getByTestId("danmaku-input").fill(firstDanmaku);
  await guest.page.getByTestId("danmaku-send").click();
  await publicItem(host.page, firstDanmaku).waitFor();
  assert.equal(await publicItem(lobby.page, firstDanmaku).count(), 0);
  await screenshotInteractionPanel(host.page, "public-stage-visible");
  stage("explicit danmaku projected in the studio only");

  await host.page.getByTestId("interaction-pause").click();
  await host.page.getByTestId("public-stage-paused").waitFor();
  const pausedDanmaku = "T10 queued while paused.";
  await guest.page.getByTestId("danmaku-input").fill(pausedDanmaku);
  await guest.page.getByTestId("danmaku-send").click();
  await host.page.getByTestId("public-stage-paused").filter({ hasText: /待播 [1-9]\d* 則/u }).waitFor();
  assert.equal(await publicItem(host.page, pausedDanmaku).count(), 0);
  stage("pause hid the public layer while the server accepted and queued new danmaku");
  await host.page.getByTestId("interaction-pause").click();
  await publicItem(host.page, pausedDanmaku).waitFor();

  const removable = "T10 remove fixture.";
  await guest.page.getByTestId("danmaku-input").fill(removable);
  await guest.page.getByTestId("danmaku-send").click();
  const removableRow = host.page.getByTestId("chat-list").locator('[data-testid="interaction-item"]').filter({ hasText: removable });
  await removableRow.getByTestId("interaction-remove").click();
  await host.page.getByTestId("chat-list").getByText(removable, { exact: true }).waitFor({ state: "detached" });
  await publicItem(host.page, removable).waitFor({ state: "detached" });
  stage("host removed one item from both history and public queue");

  const clearFixture = "T10 clear queue fixture.";
  await guest.page.getByTestId("danmaku-input").fill(clearFixture);
  await guest.page.getByTestId("danmaku-send").click();
  await publicItem(host.page, clearFixture).waitFor();
  await host.page.getByTestId("interaction-clear").click();
  await host.page.getByTestId("public-stage-empty").waitFor();
  await host.page.getByTestId("chat-list").getByText(clearFixture, { exact: true }).waitFor();
  stage("host cleared the public queue without deleting the chat history");

  await host.page.getByTestId("interaction-block").click();
  await host.page.getByTestId("danmaku-acceptance").filter({ hasText: "已禁止新增彈幕" }).waitFor();
  assert.equal(await guest.page.getByTestId("danmaku-send").isDisabled(), true);
  await guest.page.getByTestId("chat-input").fill("T10 chat remains available while public posting is blocked.");
  await guest.page.getByTestId("chat-send").click();
  await host.page.getByTestId("chat-list").getByText("T10 chat remains available while public posting is blocked.", { exact: true }).waitFor();
  stage("blocking public posting left ordinary chat available");

  const probe = await openProbeSocket();
  const probeJoin = await joinProbe(probe, "studio", "T10 external probe");
  const unauthorized = probeNext(probe, (message) => message.type === "host.error");
  probe.send(JSON.stringify({ type: "host.interaction.clearQueue" }));
  assert.equal((await unauthorized).code, "host_unauthorized");
  report.probes.push({ name: "unauthorized-host-control", roomId: "studio", result: "host_unauthorized", participantId: probeJoin.roomSnapshot.members.at(-1)?.id });

  const malformed = probeNext(probe, (message) => message.type === "interaction.error");
  probe.send(JSON.stringify({ type: "interaction.submit", eventId: "forged-room", kind: "chat", text: "T10 safe fixture", roomId: "lobby" }));
  assert.equal((await malformed).code, "invalid_interaction");
  report.probes.push({ name: "forged-room-field", roomId: "studio", result: "invalid_interaction" });

  const duplicatePayload = { type: "interaction.submit", eventId: "dedup-probe", kind: "chat", text: "T10 fixed dedup fixture" };
  const firstAck = probeNext(probe, (message) => message.type === "interaction.ack" && message.eventId === "dedup-probe");
  probe.send(JSON.stringify(duplicatePayload));
  assert.equal((await firstAck).duplicate, false);
  const duplicateAck = probeNext(probe, (message) => message.type === "interaction.ack" && message.eventId === "dedup-probe");
  probe.send(JSON.stringify(duplicatePayload));
  assert.equal((await duplicateAck).duplicate, true);
  const collision = probeNext(probe, (message) => message.type === "interaction.error" && message.eventId === "dedup-probe");
  probe.send(JSON.stringify({ ...duplicatePayload, text: "T10 changed fixture" }));
  assert.equal((await collision).code, "interaction_event_id_conflict");
  report.probes.push({ name: "sender-event-id-dedup", roomId: "studio", eventId: "dedup-probe", results: ["accepted", "duplicate-ack-only", "changed-payload-rejected"] });
  probe.close();
  probeSockets.delete(probe);

  const rateProbe = await openProbeSocket();
  await joinProbe(rateProbe, "studio", "T10 rate probe");
  const rateMessages = [];
  const onRateMessage = (raw, isBinary) => {
    if (!isBinary) {
      const message = JSON.parse(raw.toString());
      if (message.type === "interaction.ack" || message.type === "interaction.error") rateMessages.push(message);
    }
  };
  rateProbe.on("message", onRateMessage);
  for (let index = 0; index < 11; index += 1) {
    rateProbe.send(JSON.stringify({ type: "interaction.submit", eventId: `rate-${index}`, kind: "chat", text: `T10 rate fixture ${index}` }));
  }
  await waitFor(() => rateMessages.length >= 11, "11 rate probe outcomes");
  rateProbe.off("message", onRateMessage);
  const rateLimitedCount = rateMessages.filter((message) => message.type === "interaction.error" && message.code === "interaction_rate_limited").length;
  const acceptedCount = rateMessages.filter((message) => message.type === "interaction.ack" && !message.duplicate).length;
  assert.equal(acceptedCount, 10);
  assert.equal(rateLimitedCount, 1);
  report.probes.push({ name: "interaction-rate-limit", roomId: "studio", sent: 11, accepted: acceptedCount, rejected: rateLimitedCount, rejectionCode: "interaction_rate_limited" });
  rateProbe.close();
  probeSockets.delete(rateProbe);
  stage("external WebSocket probes verified host authorization, strict fields, duplicate ACK, collision, and rate limit");

  for (const name of ["studio-host", "studio-guest"]) {
    const events = clients[name].client.frames.filter((frame) => frame.direction === "received" && frame.type === "interaction.event" && frame.eventId === "dedup-probe");
    assert.equal(events.length, 1, `${name} must receive one copy of dedup-probe`);
  }
  const lobbyInteractionEvents = lobby.client.frames.filter((frame) => frame.direction === "received" && frame.type === "interaction.event" && frame.roomId === "lobby");
  assert.deepEqual(lobbyInteractionEvents, [], "lobby must receive no interaction events while in the lobby");
  report.probes.push({
    name: "continuous-room-isolation-and-dedup-trace",
    roomId: "studio",
    dedupProbeReceivedOnceBy: ["studio-host", "studio-guest"],
    lobbyInteractionEventCount: lobbyInteractionEvents.length,
    lobbyRoomAtIsolationCheck: lobby.client.roomId,
    checkedAt: new Date().toISOString(),
  });

  await host.page.getByTestId("interaction-block").click();
  await host.page.getByTestId("danmaku-acceptance").filter({ hasText: "允許新增彈幕" }).waitFor();
  const expiryText = "T10 expiry fixture.";
  await guest.page.getByTestId("danmaku-input").fill(expiryText);
  await guest.page.getByTestId("danmaku-send").click();
  await publicItem(host.page, expiryText).waitFor();
  await publicItem(host.page, expiryText).waitFor({ state: "detached", timeout: 12_000 });
  stage("public danmaku expired from the live projection", { publicTtlMs: report.limits.publicTtlMs });

  const oldRoomText = "T10 lobby state before switching rooms.";
  await lobby.page.getByTestId("chat-input").fill(oldRoomText);
  await lobby.page.getByTestId("chat-send").click();
  await lobby.page.getByTestId("chat-list").getByText(oldRoomText, { exact: true }).waitFor();
  await lobby.page.locator('[data-room-choice="studio"]').click();
  await lobby.page.getByTestId("interaction-room").filter({ hasText: "studio" }).waitFor();
  assert.equal(await lobby.page.getByTestId("chat-list").getByText(oldRoomText, { exact: true }).count(), 0);
  report.probes.push({ name: "switch-clears-previous-room-ui", fromRoom: "lobby", toRoom: "studio", oldRoomItemVisibleAfterSwitch: false });
  await lobby.page.getByRole("button", { name: "Leave", exact: true }).click();
  await lobby.page.getByTestId("interaction-panel").waitFor({ state: "detached" });
  report.probes.push({ name: "leave-clears-interaction-ui", lastRoom: "studio", panelPresentAfterLeave: false });
  stage("room switch and leave cleared the previous interaction view");

  const finalErrors = Object.values(clients).flatMap(({ client }) => client.errors);
  assert.deepEqual(finalErrors, []);
  assert.deepEqual(report.errors.socketErrors, []);
  assert.deepEqual(report.errors.collectionErrors, []);
  stage("all browser pages and WebSocket instrumentation finished without errors");
  await screenshotAll("final");
  assert.deepEqual(report.errors.collectionErrors, []);
  report.status = "pass";
} catch (error) {
  failure = error;
  report.errors.failure = redact(error?.stack ?? error);
  report.status = "fail";
  await screenshotAll("failure");
} finally {
  for (const socket of probeSockets) {
    try { socket.close(); } catch {}
  }
  for (const context of contexts) {
    try { await context.close(); } catch {}
  }
  report.finishedAt = new Date().toISOString();
  for (const [name, { client }] of Object.entries(clients)) {
    report.clients[name] = {
      roomId: client.roomId,
      participantId: client.participantId,
      frames: client.frames,
      acknowledgements: client.acknowledgements,
      controlErrors: client.controlErrors,
      pageErrors: client.errors,
    };
  }
  writeFileSync(join(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

console.log(JSON.stringify({ status: report.status, report: join(outputDirectory, "report.json"), checks: report.checks.map((check) => check.name), screenshots: report.screenshots }));
if (failure) process.exitCode = 1;
