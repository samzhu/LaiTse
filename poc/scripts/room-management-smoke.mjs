import { enterRepositoryRootForLegacyScript, repositoryRoot, pocRoot } from "./lib/project-paths.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

enterRepositoryRootForLegacyScript();

const root = repositoryRoot;
const scratchRoot = resolve(root, ".scratch/rm01");
const runStamp = new Date().toISOString().replaceAll(/[^0-9TZ]/gu, "-");
const requestedOutput = process.env.RM01_OUTPUT_DIR;
const outputDirectory = requestedOutput
  ? resolve(root, requestedOutput)
  : join(scratchRoot, "browser", `rm01-${runStamp}-${randomBytes(3).toString("hex")}`);
const outputRelative = relative(scratchRoot, outputDirectory);
if (outputDirectory === scratchRoot || isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(`..${sep}`)) {
  throw new Error("RM01_OUTPUT_DIR must stay below .scratch/rm01.");
}
if (existsSync(outputDirectory)) {
  throw new Error("This RM01 output directory already exists; choose a new run directory.");
}
if (process.version !== "v26.13.0") {
  throw new Error("Use the repository-pinned Node v26.13.0 runtime for this smoke.");
}

const baseURL = process.env.RM01_BASE_URL ?? "https://localhost:4173/";
const target = new URL(baseURL);
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
if (target.protocol !== "https:" || !loopbackHosts.has(target.hostname) || target.username || target.password || target.search || target.hash || target.pathname !== "/") {
  throw new Error("RM01_BASE_URL must be a local trusted HTTPS application root without credentials, query, or fragment.");
}

const caCertificate = resolve(root, ".scratch/t01/tls/local-ca.pem");
const certificateUtility = "certutil";
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, ".tools/playwright-browsers");
const { firefox } = await import("playwright");

const NORMAL_TIMEOUT_MS = 10_000;
const RECONNECT_TIMEOUT_MS = 15_000;
const CONTROL_RECORD_CAP = 240;
const CONNECTION_CAP = 6;
const SCREENSHOT_CAP = 2;
const DUPLICATE_NAME = "Mira";
const INITIAL_PASSWORD = "rm01-entry-example";
const REMOTE_PASSWORD = "rm01-remote-example";
const RELOCK_PASSWORD = "rm01-relock-example";
const PROBE_PASSWORD = "rm01-probe-example";
const WRONG_PASSWORD = "rm01-wrong-example";
const SECRET_VALUES = [INITIAL_PASSWORD, REMOTE_PASSWORD, RELOCK_PASSWORD, PROBE_PASSWORD, WRONG_PASSWORD];
const clients = new Map();
const contexts = [];
const runtimeFolders = new Set();
const startedAtMs = Date.now();
let failure = null;

const report = {
  schemaVersion: 1,
  purpose: "Short trusted-HTTPS Firefox smoke for anonymous meeting-room locking, transfer, offline handover, and empty-room unlock.",
  startedAt: new Date().toISOString(),
  finishedAt: null,
  durationMs: null,
  status: "running",
  baseURL: target.origin,
  outputDirectory: relative(root, outputDirectory),
  runtime: { node: process.version, firefox: null, platform: process.platform, architecture: process.arch, headless: true },
  tls: {
    applicationTransport: "trusted local HTTPS/WSS",
    isolatedProfiles: 4,
    importedLocalCA: relative(root, caCertificate),
    ignoreHTTPSErrors: false,
    systemTrustChanged: false,
  },
  topology: {
    contexts: 4,
    sameDisplayNameContexts: ["initial-owner", "same-name-member"],
    flow: ["join", "lock", "same-name denial", "wrong then correct entry", "manual transfer", "owner changes target room from lobby", "offline random eligible handover", "empty candidate unlock", "fresh member relocks"],
  },
  cases: [],
  controls: [],
  screenshots: [],
  privacy: {
    rawControlFramesRetained: false,
    passwordValuesRetained: false,
    sessionTokensRetained: false,
    passwordVerifiersRetained: false,
    browserEnvironmentSecretFiltered: true,
    secretsUsedOnlyInMemory: true,
  },
  limits: {
    candidateSelection: "The selected successor is checked against the live server member roster; this small sample makes no fairness claim.",
    maliciousProtocol: "Three denial probes use the same joined browser socket; normal UI remains the primary interaction path.",
    media: "No synthetic or physical voice/media path is exercised by this room-control smoke.",
    persistenceAndCloud: "Not evaluated here; root owns server, build, database, and integration evidence.",
    realUsersAndCapacity: "Not tested; four isolated local Firefox contexts are a short functional sample.",
  },
  errors: { pageErrors: 0, cappedCollections: [], failure: null },
};

function elapsedMs() {
  return Date.now() - startedAtMs;
}

function safeText(value) {
  let text = String(value ?? "");
  for (const secret of SECRET_VALUES) text = text.split(secret).join("[redacted]");
  return text
    .replace(/(?:password|token|secret|credential|verifier)\s*[:=]\s*[^\s,;]+/giu, "[redacted]")
    .slice(0, 240);
}

function boundedPush(array, value, cap, label) {
  if (array.length < cap) {
    array.push(value);
    return true;
  }
  if (!report.errors.cappedCollections.some((item) => item.label === label)) {
    if (report.errors.cappedCollections.length < 8) report.errors.cappedCollections.push({ label, cap });
  }
  return false;
}

function stage(name, details = {}) {
  const entry = { name, atMs: elapsedMs(), ...details };
  if (report.cases.length >= 24) throw new Error("The bounded RM01 case cap was reached.");
  report.cases.push({ ...entry, status: "passed" });
  console.log(`[RM01] ${name}`);
}

function summarizeControl(message, direction, connectionIndex) {
  if (!message || typeof message !== "object" || Array.isArray(message) || typeof message.type !== "string") return null;
  const type = message.type.slice(0, 64);
  const interesting = type.startsWith("room.management.") || [
    "join", "room.switch", "session.issued", "session.resumed", "session.leave", "session.left", "room.snapshot", "space.snapshot", "protocol.error",
  ].includes(type);
  if (!interesting) return null;

  const entry = { direction, connectionIndex, atMs: elapsedMs(), type };
  if (type === "join" || type === "room.switch") {
    if (typeof message.roomId === "string") entry.roomId = message.roomId;
    entry.passwordProvided = typeof message.password === "string";
  } else if (type === "session.issued" || type === "session.resumed") {
    if (typeof message.participantId === "string") entry.participantId = message.participantId;
    if (typeof message.roomId === "string") entry.roomId = message.roomId;
  } else if (type === "session.left") {
    entry.accepted = true;
  } else if (type === "room.snapshot") {
    entry.roomId = message.room?.id ?? message.roomId ?? null;
    entry.isLocked = message.room?.isLocked === true;
    entry.memberIds = Array.isArray(message.members) ? message.members.filter((member) => typeof member?.id === "string").map((member) => member.id).slice(0, 16) : [];
  } else if (type === "space.snapshot") {
    if (typeof message.participantId === "string") entry.participantId = message.participantId;
    if (typeof message.currentRoomId === "string") entry.currentRoomId = message.currentRoomId;
  } else if (type === "protocol.error" || type === "room.management.error") {
    if (typeof message.code === "string") entry.code = message.code.slice(0, 80);
    if (typeof message.roomId === "string") entry.roomId = message.roomId;
  } else if (type === "room.management.state") {
    entry.roomId = message.roomId ?? null;
    entry.isLocked = message.isLocked === true;
    entry.lockKind = ["none", "legacy", "anonymous"].includes(message.lockKind) ? message.lockKind : "unknown";
    entry.canLock = message.canLock === true;
    entry.isOwner = message.isOwner === true;
    if (typeof message.ownerParticipantId === "string") entry.ownerParticipantId = message.ownerParticipantId;
    if (Array.isArray(message.members)) entry.memberIds = message.members.filter((member) => typeof member?.id === "string").map((member) => member.id).slice(0, 16);
  } else if (type === "room.management.result") {
    entry.action = typeof message.action === "string" ? message.action.slice(0, 40) : "unknown";
    entry.isLocked = message.isLocked === true;
    if (typeof message.participantId === "string") entry.participantId = message.participantId;
  } else if (type.startsWith("room.management.")) {
    if (typeof message.action === "string") entry.action = message.action.slice(0, 40);
    if (typeof message.participantId === "string") entry.participantId = message.participantId;
    entry.passwordProvided = typeof message.password === "string";
  }
  return entry;
}

function recordFrame(client, connection, direction, payload) {
  if (typeof payload !== "string") return;
  let message;
  try { message = JSON.parse(payload); }
  catch { return; }
  const summary = summarizeControl(message, direction, connection.index);
  if (!summary) return;
  if (!boundedPush(client.wire.events, summary, CONTROL_RECORD_CAP, `${client.name}-controls`)) return;

  if (direction === "received") {
    if (summary.type === "session.issued" || summary.type === "session.resumed") client.participantId = summary.participantId ?? client.participantId;
    if (summary.type === "room.snapshot") client.wire.roomSnapshots.push(summary);
    if (summary.type === "space.snapshot") client.wire.spaceSnapshots.push(summary);
    if (summary.type === "room.management.state") client.wire.managementStates.push(summary);
  }
}

function browserEnvironment(profile) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/(?:TOKEN|PASSWORD|SECRET|CREDENTIAL|API[_-]?KEY|DATABASE_URL|PGPASSWORD|COOKIE|AUTH|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|REFRESH[_-]?TOKEN)/iu.test(key)) delete env[key];
  }
  env.MOZ_APP_DATA = profile.appData;
  env.MOZ_LOCAL_APP_DATA = profile.localAppData;
  return env;
}

function createTrustedProfile(name) {
  const folder = join(outputDirectory, `${name}-runtime`);
  runtimeFolders.add(folder);
  rmSync(folder, { recursive: true, force: true });
  const profileDirectory = join(folder, "profile");
  mkdirSync(profileDirectory, { recursive: true, mode: 0o700 });
  execFileSync(certificateUtility, ["-N", "-d", `sql:${profileDirectory}`, "--empty-password"], { stdio: "pipe" });
  execFileSync(certificateUtility, ["-A", "-d", `sql:${profileDirectory}`, "-n", "LaiTse RM01 local CA", "-t", "C,,", "-i", caCertificate], { stdio: "pipe" });
  const appData = join(folder, "app-data");
  const localAppData = join(folder, "local-app-data");
  mkdirSync(appData, { recursive: true, mode: 0o700 });
  mkdirSync(localAppData, { recursive: true, mode: 0o700 });
  return { folder, profileDirectory, appData, localAppData };
}

function newConnection(client) {
  if (client.wire.connections.length >= CONNECTION_CAP) {
    boundedPush(report.errors.cappedCollections, { label: `${client.name}-connections`, cap: CONNECTION_CAP }, 8, `${client.name}-connections`);
    return null;
  }
  const connection = { index: client.wire.connections.length + 1, serverRoute: null };
  client.wire.connections.push(connection);
  client.wire.activeConnection = connection;
  return connection;
}

function installWebSocketRoute(client) {
  return client.page.routeWebSocket(/\/ws(?:\?|$)/u, (route) => {
    const connection = newConnection(client);
    if (!connection) {
      void route.close({ code: 1013, reason: "RM01 bounded connection cap" }).catch(() => {});
      return;
    }
    const serverRoute = route.connectToServer();
    connection.serverRoute = serverRoute;
    route.onMessage((payload) => {
      recordFrame(client, connection, "sent", payload);
      try { serverRoute.send(payload); } catch { /* A closed controlled-reconnect route is expected. */ }
    });
    serverRoute.onMessage((payload) => {
      recordFrame(client, connection, "received", payload);
      try { route.send(payload); } catch { /* A closing page no longer needs this frame. */ }
    });
  });
}

async function launchClient(key, name) {
  const profile = createTrustedProfile(key);
  const context = await firefox.launchPersistentContext(profile.profileDirectory, {
    headless: true,
    env: browserEnvironment(profile),
    viewport: { width: 1360, height: 1000 },
    colorScheme: "light",
    ignoreHTTPSErrors: false,
    firefoxUserPrefs: { "security.enterprise_roots.enabled": false },
  });
  contexts.push(context);
  const page = context.pages()[0] ?? await context.newPage();
  const client = {
    key,
    name,
    page,
    context,
    participantId: null,
    wire: { events: [], connections: [], activeConnection: null, roomSnapshots: [], spaceSnapshots: [], managementStates: [] },
  };
  page.on("pageerror", () => { report.errors.pageErrors += 1; });
  await installWebSocketRoute(client);
  clients.set(key, client);
  return client;
}

function controls(client, type, direction = "received") {
  return client.wire.events.filter((entry) => entry.type === type && entry.direction === direction);
}

async function waitFor(predicate, label, timeoutMs = NORMAL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch { /* Retry the bounded observation until it appears or the deadline expires. */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 40));
  }
  throw new Error(`${label} was not observed within ${timeoutMs} ms.`);
}

async function waitForControl(client, type, { direction = "received", after = 0, predicate = () => true, timeoutMs = NORMAL_TIMEOUT_MS } = {}) {
  return waitFor(() => controls(client, type, direction).slice(after).find(predicate) ?? null, `${client.name} ${direction} ${type}`, timeoutMs);
}

function latestRoomSnapshot(client, roomId = "studio") {
  return [...client.wire.roomSnapshots].reverse().find((entry) => entry.roomId === roomId) ?? null;
}

function latestSpaceSnapshot(client) {
  return client.wire.spaceSnapshots.at(-1) ?? null;
}

function latestManagementState(client, roomId = "studio") {
  return [...client.wire.managementStates].reverse().find((entry) => entry.roomId === roomId) ?? null;
}

async function waitForManagementState(client, predicate, label) {
  return waitFor(() => {
    const states = client.wire.managementStates.filter((entry) => entry.roomId === "studio");
    const latest = states.at(-1);
    return latest && predicate(latest) ? latest : null;
  }, `${client.name} room management state: ${label}`);
}

async function waitForManagementStateAfter(client, afterCount, predicate, label) {
  return waitFor(() => {
    const states = client.wire.managementStates.filter((entry) => entry.roomId === "studio").slice(afterCount);
    const latest = states.at(-1);
    return latest && predicate(latest) ? latest : null;
  }, `${client.name} room management state: ${label}`);
}

async function joinPage(client, displayName, roomId = "studio") {
  await client.page.goto(`${target.origin}/?room=${encodeURIComponent(roomId)}&mode=interaction`, { waitUntil: "domcontentloaded" });
  await client.page.getByRole("heading", { name: "Local room presence" }).waitFor();
  await client.page.getByLabel("Your display name").fill(displayName);
  const issuedBefore = controls(client, "session.issued").length;
  const protocolErrorBefore = controls(client, "protocol.error").length;
  await client.page.getByRole("button", { name: "Join room" }).click();
  return { issuedBefore, protocolErrorBefore };
}

async function joinUnlocked(client, displayName, roomId = "studio") {
  const { issuedBefore, protocolErrorBefore } = await joinPage(client, displayName, roomId);
  const issued = await waitFor(() => controls(client, "session.issued").slice(issuedBefore).find((entry) => entry.roomId === roomId) ?? null, `${client.name} initial join`, NORMAL_TIMEOUT_MS)
    .catch(async () => {
      await waitForControl(client, "protocol.error", { after: protocolErrorBefore, predicate: (entry) => entry.code === "room_password_required" });
      throw new Error(`${client.name} was unexpectedly blocked from an unlocked room.`);
    });
  await waitFor(() => latestRoomSnapshot(client, roomId), `${client.name} ${roomId} room snapshot`);
  await client.page.locator('[data-testid="control-connection-status"]').filter({ hasText: "Connected" }).waitFor();
  await waitForManagementState(client, (entry) => entry.roomId === "studio", "initial state");
  return issued.participantId;
}

async function joinLocked(client, displayName, { wrongFirst = false } = {}) {
  const { issuedBefore, protocolErrorBefore } = await joinPage(client, displayName, "studio");
  const required = await waitForControl(client, "protocol.error", { after: protocolErrorBefore, predicate: (entry) => entry.code === "room_password_required" });
  await client.page.getByRole("dialog").waitFor({ state: "visible" });
  assert.equal(controls(client, "session.issued").length, issuedBefore, `${client.name} must not join before supplying the room password.`);

  let wrong = null;
  if (wrongFirst) {
    const wrongBefore = controls(client, "protocol.error").length;
    await client.page.getByLabel("Meeting room password").fill(WRONG_PASSWORD);
    await client.page.getByRole("button", { name: "Enter room" }).click();
    wrong = await waitForControl(client, "protocol.error", { after: wrongBefore, predicate: (entry) => entry.code === "room_password_incorrect" });
    await client.page.getByRole("alert").waitFor({ state: "visible" });
    assert.equal(controls(client, "session.issued").length, issuedBefore, `${client.name} must stay outside after a wrong password.`);
  }

  const correctBefore = controls(client, "session.issued").length;
  await client.page.getByLabel("Meeting room password").fill(INITIAL_PASSWORD);
  await client.page.getByRole("button", { name: "Enter room" }).click();
  const issued = await waitForControl(client, "session.issued", { after: correctBefore, predicate: (entry) => entry.roomId === "studio" });
  await waitFor(() => latestRoomSnapshot(client, "studio"), `${client.name} correct-password room snapshot`);
  await client.page.getByRole("dialog").waitFor({ state: "hidden" });
  await client.page.locator('[data-testid="control-connection-status"]').filter({ hasText: "Connected" }).waitFor();
  await waitForManagementState(client, (entry) => entry.roomId === "studio", "post-entry state");
  return { participantId: issued.participantId, requiredCode: required.code, wrongCode: wrong?.code ?? null };
}

async function setRoomPassword(client, password, action) {
  if (action === "lock") await client.page.getByTestId("room-management-begin-lock").click();
  const input = client.page.getByTestId("room-management-password");
  await input.waitFor({ state: "visible" });
  await input.fill(password);
  const stateBefore = client.wire.managementStates.filter((entry) => entry.roomId === "studio").length;
  const resultBefore = controls(client, "room.management.result").length;
  const buttonTestId = action === "lock" ? "room-management-lock" : "room-management-change-password";
  await client.page.getByTestId(buttonTestId).click();
  const result = await waitForControl(client, "room.management.result", { after: resultBefore, predicate: (entry) => entry.action === action });
  await waitForManagementStateAfter(client, stateBefore, (entry) => entry.isOwner && entry.isLocked && entry.ownerParticipantId === client.participantId, `${action} acknowledged`);
  const currentValue = await input.inputValue().catch(() => "");
  if (currentValue && await input.isVisible().catch(() => false)) await input.fill("");
  return result;
}

async function switchRoom(client, roomId) {
  if (latestSpaceSnapshot(client)?.currentRoomId === roomId) return roomId;
  const beforeSpaceCount = client.wire.spaceSnapshots.length;
  await client.page.locator(`[data-room-choice="${roomId}"]`).click();
  await waitFor(() => client.wire.spaceSnapshots.slice(beforeSpaceCount).find((entry) => entry.currentRoomId === roomId) ?? null, `${client.name} switches to ${roomId}`);
  await waitFor(() => latestRoomSnapshot(client, roomId), `${client.name} ${roomId} room snapshot`);
  return roomId;
}

async function deniedProtocolAction(client, actionName, message) {
  const errorsBefore = controls(client, "room.management.error").length;
  const route = client.wire.activeConnection?.serverRoute;
  assert.ok(route, `${client.name} should have an active joined WebSocket route for the denial probe.`);
  route.send(JSON.stringify(message));
  const error = await waitForControl(client, "room.management.error", { after: errorsBefore });
  stage(`same-name member denied ${actionName}`, { code: error.code });
  return error;
}

async function saveSafeScreenshot(client, label) {
  if (report.screenshots.length >= SCREENSHOT_CAP) return;
  const passwordInputs = client.page.locator('input[type="password"]');
  const count = await passwordInputs.count();
  for (let index = 0; index < count; index += 1) {
    const input = passwordInputs.nth(index);
    const value = await input.inputValue().catch(() => "");
    if (value) return;
  }
  const screenshotsDirectory = join(outputDirectory, "screenshots");
  mkdirSync(screenshotsDirectory, { recursive: true, mode: 0o700 });
  const path = join(screenshotsDirectory, `${label}.png`);
  await client.page.screenshot({ path, fullPage: false, animations: "disabled" });
  report.screenshots.push({ file: relative(root, path), context: client.name, passwordFieldsEmpty: true });
}

async function waitForSuccessor(candidates) {
  return waitFor(() => {
    for (const candidate of candidates) {
      const state = latestManagementState(candidate);
      if (state?.isOwner && state.ownerParticipantId === candidate.participantId) return { client: candidate, state };
    }
    return null;
  }, "eligible studio participant successor", RECONNECT_TIMEOUT_MS);
}

async function closeCurrentSocket(client) {
  const connection = client.wire.activeConnection;
  assert.ok(connection?.serverRoute, `${client.name} should have an active route before controlled disconnect.`);
  const resumeCount = controls(client, "session.resumed").length;
  await connection.serverRoute.close({ code: 4000, reason: "RM01 controlled participant disconnect" });
  await waitForControl(client, "session.resumed", { after: resumeCount, timeoutMs: RECONNECT_TIMEOUT_MS });
  await client.page.locator('[data-testid="control-connection-status"]').filter({ hasText: "Connected" }).waitFor({ timeout: RECONNECT_TIMEOUT_MS });
}

async function runSmoke() {
  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  const A = await launchClient("initial-owner", "RM01 initial owner");
  const B = await launchClient("same-name-member", "RM01 same-name member");
  const C = await launchClient("late-member", "RM01 late member / transfer target");
  const D = await launchClient("second-late-member", "RM01 second late member");
  report.runtime.firefox = A.context.browser()?.version() ?? "not-reported";

  await joinUnlocked(A, DUPLICATE_NAME);
  await joinUnlocked(B, DUPLICATE_NAME);
  assert.ok(A.participantId && B.participantId && A.participantId !== B.participantId, "Same display names must map to distinct server participant IDs.");
  await waitForManagementState(A, (entry) => entry.canLock && !entry.isLocked, "initial owner can lock");
  await waitForManagementState(B, (entry) => !entry.isOwner && !entry.isLocked, "same-name member is not owner");
  assert.equal(latestManagementState(B)?.memberIds, undefined, "A non-owner must not receive the owner's private member roster.");
  stage("same display name received distinct server participant IDs", { ownerParticipantId: A.participantId, peerParticipantId: B.participantId });

  await setRoomPassword(A, INITIAL_PASSWORD, "lock");
  await waitForManagementState(B, (entry) => entry.isLocked && !entry.isOwner, "management state broadcasts locked state to peers");
  assert.equal(latestManagementState(A)?.ownerParticipantId, A.participantId, "The participant who locked the room should own it.");
  assert.equal(latestManagementState(B)?.isOwner, false, "A same-name peer must not inherit room ownership.");
  assert.equal(latestManagementState(B)?.memberIds, undefined, "A same-name non-owner must not receive the owner's private transfer roster.");
  await saveSafeScreenshot(A, "locked-owner");
  stage("lock created one anonymous manager", { ownerParticipantId: A.participantId, isLocked: true });

  const CEntry = await joinLocked(C, "Cedar", { wrongFirst: true });
  assert.equal(C.participantId, CEntry.participantId);
  stage("wrong room password denied entry; correct password joined", { requiredCode: CEntry.requiredCode, wrongCode: CEntry.wrongCode, participantId: C.participantId });
  const DEntry = await joinLocked(D, "Delta");
  assert.ok(DEntry.participantId, "The second late member should join through the room gate.");

  await waitForManagementState(A, (entry) => entry.memberIds?.includes(C.participantId) && entry.memberIds.includes(D.participantId), "owner roster includes late members");
  assert.equal(latestManagementState(B)?.memberIds, undefined, "Ordinary members must not receive the manager-only transfer roster.");
  await deniedProtocolAction(B, "password change", { type: "room.management.changePassword", password: PROBE_PASSWORD });
  await deniedProtocolAction(B, "unlock", { type: "room.management.unlock" });
  await deniedProtocolAction(B, "transfer", { type: "room.management.transfer", participantId: C.participantId });
  assert.equal(latestManagementState(A)?.ownerParticipantId, A.participantId, "Unauthorized probes must leave the current owner unchanged.");
  assert.equal(latestManagementState(A)?.isLocked, true, "Unauthorized probes must leave the meeting room locked.");
  for (const testId of ["room-management-change-password", "room-management-unlock", "room-management-transfer"]) {
    assert.equal(await B.page.getByTestId(testId).count(), 0, `The same-name non-owner must not see ${testId}.`);
  }
  assert.equal(latestManagementState(B)?.memberIds, undefined, "A same-name non-owner must not receive the current owner's transfer roster.");

  const transferButton = A.page.locator(`[data-testid="room-management-member"][data-participant-id="${C.participantId}"]`).getByTestId("room-management-transfer");
  await transferButton.waitFor({ state: "visible" });
  const oldOwnerStateBeforeTransfer = A.wire.managementStates.filter((entry) => entry.roomId === "studio").length;
  const recipientStateBeforeTransfer = C.wire.managementStates.filter((entry) => entry.roomId === "studio").length;
  const transferResultCount = controls(A, "room.management.result").length;
  await transferButton.click();
  const transferResult = await waitForControl(A, "room.management.result", { after: transferResultCount, predicate: (entry) => entry.action === "transfer" });
  await waitForManagementStateAfter(A, oldOwnerStateBeforeTransfer, (entry) => !entry.isOwner, "old manager loses ownership after transfer");
  await waitForManagementStateAfter(C, recipientStateBeforeTransfer, (entry) => entry.isOwner && entry.ownerParticipantId === C.participantId, "transfer recipient owns the room");
  assert.equal(latestManagementState(A)?.isLocked, true, "Transfer must keep the room locked.");
  stage("manual transfer selected an online studio member", { fromParticipantId: A.participantId, toParticipantId: C.participantId });

  await switchRoom(A, "lobby");
  assert.equal(latestManagementState(A)?.isOwner, false, "The former owner must not regain control after changing rooms.");
  assert.equal(await A.page.getByTestId("room-management-unlock").count(), 0, "The former owner must not see unlock control.");
  assert.equal(await A.page.getByTestId("room-management-change-password").count(), 0, "The former owner must not see password-change control.");
  assert.equal(await A.page.getByTestId("room-management-transfer").count(), 0, "The former owner must not see transfer controls.");
  await switchRoom(C, "lobby");
  await waitForManagementState(C, (entry) => entry.isOwner && entry.ownerParticipantId === C.participantId, "ownership persists in lobby");
  assert.ok(await C.page.getByTestId("room-management-change-password").isVisible(), "The lobby owner should be able to manage the studio room from the lobby.");
  await setRoomPassword(C, REMOTE_PASSWORD, "changePassword");
  stage("owner kept studio management after switching to lobby", { ownerParticipantId: C.participantId, currentRoomId: latestSpaceSnapshot(C)?.currentRoomId, targetRoomId: "studio" });

  assert.equal(latestSpaceSnapshot(A)?.currentRoomId, "lobby", "The original owner should remain outside the locked room after losing control.");
  const ownerStateBeforeDisconnect = await waitForManagementState(C, (entry) =>
    entry.isOwner &&
    entry.ownerParticipantId === C.participantId &&
    entry.memberIds?.length === 2 &&
    entry.memberIds.includes(B.participantId) &&
    entry.memberIds.includes(D.participantId),
  "only the two studio participants remain eligible");
  assert.ok(ownerStateBeforeDisconnect?.isOwner && ownerStateBeforeDisconnect.ownerParticipantId === C.participantId, "The lobby owner must still hold studio management before going offline.");
  const eligibleIds = (ownerStateBeforeDisconnect.memberIds ?? []).filter((id) => id === B.participantId || id === D.participantId);
  assert.equal(eligibleIds.length, 2, "The server-provided studio roster should contain both online eligible members.");
  await closeCurrentSocket(C);
  const successor = await waitForSuccessor([B, D]);
  assert.ok(eligibleIds.includes(successor.client.participantId), "The selected successor must be one of the server-reported online studio members.");
  stage("offline manager handed control to an eligible studio member", {
    eligibleParticipantIds: eligibleIds,
    selectedParticipantId: successor.client.participantId,
    fairnessAssessed: false,
  });
  await waitForManagementState(C, (entry) => !entry.isOwner, "disconnected former owner reconnects without reclaiming");
  assert.equal(latestManagementState(C)?.isLocked, true, "The successor should keep the room locked after the former owner reconnects.");
  stage("former manager reconnected without reclaiming ownership", { formerManagerParticipantId: C.participantId, currentOwnerParticipantId: successor.client.participantId });

  const otherStudioMember = successor.client === B ? D : B;
  await switchRoom(otherStudioMember, "lobby");
  await switchRoom(successor.client, "lobby");
  const emptyRoomState = await waitForManagementState(successor.client, (entry) => entry.isOwner && entry.ownerParticipantId === successor.client.participantId && entry.memberIds?.length === 0, "owner is outside an empty target room");
  assert.equal(emptyRoomState.isLocked, true, "Changing rooms alone must preserve ownership and the lock.");
  assert.equal(latestSpaceSnapshot(successor.client)?.currentRoomId, "lobby", "The manager should remain outside the studio while the empty studio stays locked.");
  stage("empty studio stayed locked while its manager remained online in lobby", { ownerParticipantId: successor.client.participantId, roomMemberCount: 0, isLocked: true });
  await closeCurrentSocket(successor.client);
  const clearedState = await waitForManagementState(successor.client, (entry) => !entry.isLocked && entry.lockKind === "none" && !entry.isOwner, "disconnect with no studio candidates unlocks and clears manager");
  assert.equal(clearedState.ownerParticipantId, undefined);
  stage("offline manager with no target-room candidates left the room unlocked", { priorOwnerParticipantId: successor.client.participantId, roomMemberCount: 0, isLocked: false, lockKind: clearedState.lockKind });

  const oldIdentity = C.participantId;
  const leaveCount = controls(C, "session.leave", "sent").length;
  await C.page.getByTestId("control-leave").click();
  // Explicit leave sends the control then closes the socket, so its ACK may not
  // reach this page. Check the sent control and completed local leave instead.
  await waitForControl(C, "session.leave", { direction: "sent", after: leaveCount });
  await waitFor(() => C.page.getByLabel("Your display name").isEnabled(), "explicit leave enables a fresh join");
  await C.page.locator('[data-room-choice="studio"]').click();
  await C.page.getByLabel("Your display name").fill("Rejoiner");
  const freshManagementStateBefore = C.wire.managementStates.filter((entry) => entry.roomId === "studio").length;
  const freshIssuedBefore = controls(C, "session.issued").length;
  await C.page.getByRole("button", { name: "Join room" }).click();
  const freshIssued = await waitForControl(C, "session.issued", { after: freshIssuedBefore, predicate: (entry) => entry.roomId === "studio" });
  assert.notEqual(freshIssued.participantId, oldIdentity, "A fresh join should receive a new server participant ID.");
  await waitForManagementStateAfter(C, freshManagementStateBefore, (entry) => !entry.isLocked && entry.canLock && !entry.isOwner, "new anonymous member can lock the cleared room");
  await setRoomPassword(C, RELOCK_PASSWORD, "lock");
  assert.equal(latestManagementState(C)?.ownerParticipantId, freshIssued.participantId, "The newly joined member should become the new manager.");
  await saveSafeScreenshot(C, "fresh-member-relocked");
  stage("newly joined member relocked the room and became its manager", { participantId: freshIssued.participantId, isLocked: true });

  assert.equal(report.errors.cappedCollections.length, 0, "Control summaries should fit inside the bounded capture cap.");
  assert.equal(report.errors.pageErrors, 0, "Firefox pages should not report uncaught page errors.");
}

async function writeReport() {
  report.finishedAt = new Date().toISOString();
  report.durationMs = elapsedMs();
  report.status = failure ? "failed" : "passed";
  report.errors.failure = failure ? { name: safeText(failure?.name ?? "Error"), message: safeText(failure?.message ?? failure) } : null;
  report.controls = [...clients.values()].map((client) => ({
    context: client.name,
    participantId: client.participantId,
    connectionCount: client.wire.connections.length,
    messages: client.wire.events,
  }));
  writeFileSync(join(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(outputDirectory, "README.md"), [
    "# POC-RM-01 browser smoke",
    "",
    `Status: ${report.status}`,
    `Started: ${report.startedAt}`,
    `Finished: ${report.finishedAt}`,
    `Contexts: four isolated Firefox profiles over trusted local HTTPS/WSS at ${report.baseURL}`,
    "",
    "The smoke uses the normal room join dialog and management UI. Three additional denial messages are sent over the same joined participant WebSocket to confirm server-side rejection. Passwords, tokens, verifiers, raw control frames, and page error text are not retained.",
    "",
    "This is a short local browser control smoke. It does not evaluate voice, persistence, database restart recovery, deployment, capacity, fairness of random selection, or product readiness.",
    "",
    failure ? `Failure: ${safeText(failure?.message ?? failure)}` : "Failure: none",
    "",
  ].join("\n"), { mode: 0o600 });
}

try {
  await runSmoke();
} catch (error) {
  failure = error;
  console.error(`[RM01] failure ${safeText(error?.message ?? error)}`);
} finally {
  for (const context of contexts) {
    try { await context.close(); } catch { /* Best-effort close of this run's own isolated context. */ }
  }
  for (const folder of runtimeFolders) {
    try { rmSync(folder, { recursive: true, force: true }); } catch { /* Profiles are private to this run and may already be absent. */ }
  }
  try { await writeReport(); }
  catch (error) {
    console.error(`[RM01] could not save report: ${safeText(error?.message ?? error)}`);
    if (!failure) failure = error;
  }
}

if (failure) process.exitCode = 1;
