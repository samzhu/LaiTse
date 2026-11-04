import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import { get as httpsGet } from "node:https";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import WebSocket from "ws";

const require = createRequire(import.meta.url);
const root = process.cwd();
const hostToken = process.env.RECONNECT_TEST_HOST_TOKEN ?? "";
const roomPassword = process.env.RECONNECT_TEST_ROOM_PASSWORD ?? "";
if (Buffer.byteLength(hostToken, "utf8") < 32 || Buffer.byteLength(hostToken, "utf8") > 256) {
  throw new Error("RECONNECT_TEST_HOST_TOKEN must be a 32–256 byte host token.");
}
if (!roomPassword || roomPassword === hostToken) {
  throw new Error("RECONNECT_TEST_ROOM_PASSWORD must be set and differ from the host token.");
}

const nextRoomPassword = randomBytes(32).toString("base64url");
assert.notEqual(nextRoomPassword, hostToken);
assert.notEqual(nextRoomPassword, roomPassword);

const scratchRoot = resolve(root, ".scratch/t12");
const outputDirectory = resolve(root, process.env.RECONNECT_OUTPUT_DIR ?? ".scratch/t12/acceptance");
const outputRelative = relative(scratchRoot, outputDirectory);
if (isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(`..${sep}`)) {
  throw new Error("RECONNECT_OUTPUT_DIR must stay inside .scratch/t12.");
}

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, ".tools/playwright-browsers");
const { firefox } = await import("playwright");
const caCertificate = resolve(process.env.RECONNECT_CA_CERT ?? ".scratch/t01/tls/local-ca.pem");
const caPem = readFileSync(caCertificate);
const baseURL = process.env.RECONNECT_BASE_URL ?? "https://localhost:4173";
const target = new URL(baseURL);
if (target.protocol !== "https:" || target.username || target.password || target.search || target.hash) {
  throw new Error("RECONNECT_BASE_URL must be a trusted HTTPS URL without credentials, query, or fragment.");
}
if (target.pathname !== "/") throw new Error("RECONNECT_BASE_URL must point at the application root.");

const certificateUtility = process.env.CERTUTIL_BIN ?? "certutil";
const headless = process.env.HEADLESS !== "0";
const includeDisplay = process.env.RECONNECT_INCLUDE_DISPLAY !== "0";
const reconnectingTimeoutMs = 12_000;
const normalStepTimeoutMs = 8_000;
const MAX_STAGES = 70;
const MAX_BROWSER_CONNECTIONS = 20;
const MAX_BROWSER_CONTROL_RECORDS = 1_400;
const MAX_PROBE_MESSAGES = 700;
const MAX_ERRORS = 50;
const contexts = [];
const browserClients = new Map();
const probeSockets = new Set();
const profileFolders = new Set();
const transientSecrets = new Set([hostToken, roomPassword, nextRoomPassword]);
const startedAtMs = Date.now();
let failure = null;

const report = {
  schemaVersion: 1,
  purpose: "Short local Firefox control-session reconnect acceptance; no media recovery claim.",
  startedAt: new Date().toISOString(),
  status: "running",
  baseURL: target.origin,
  runtime: { node: process.version, platform: process.platform, architecture: process.arch, firefox: "not-reported" },
  tls: {
    caCertificate,
    trust: "local CA imported only into isolated Firefox profiles and supplied to WSS probes",
    ignoreCertificateErrors: false,
    systemTrustChanged: false,
  },
  topology: {
    isolatedFirefoxProfiles: includeDisplay ? 3 : 2,
    browsers: includeDisplay ? ["host", "participant", "display"] : ["host", "participant"],
    controlledDisconnect: "test-only Playwright WebSocket route close code 4000; not physical network loss",
  },
  credentials: {
    hostToken: "not-recorded",
    roomPasswords: "not-recorded",
    resumeToken: "not-recorded; only presence booleans and same-participant comparison",
  },
  checks: [],
  reconnects: [],
  probes: [],
  screenshots: [],
  privacy: {
    rawControlPayloadsRetained: false,
    browserStorageDumped: false,
    secretsInRetainedTrace: false,
    serverSecretEchoObserved: false,
    sessionIssuedTokenStoredAsBooleanOnly: true,
  },
  limits: {
    physicalNetworkInterruption: "not-tested; disconnects are controlled application WebSocket closes",
    mediaDecodeSubscriptionOrPublishRecovery: "not-tested; T13 scope",
    physicalMicrophoneOrDisplayCapture: "not-tested",
    mobileDevicesAndCameraQRScan: "not-tested",
    accountsAndDurableIdentity: "not-tested; identity is a server-issued local POC participant ID",
    capacityLongRunAndLatency: "not-tested; no 100-event, p95, or endurance claim",
    cloudDeployment: "not-tested; local POC only",
  },
  errors: { pageErrors: [], socketErrors: [], collectionErrors: [], cleanupErrors: [], failure: null },
};

mkdirSync(outputDirectory, { recursive: true });

function redact(value) {
  let output = String(value ?? "");
  for (const secret of transientSecrets) {
    if (secret) output = output.split(secret).join("[redacted]");
  }
  return output.slice(0, 360);
}

function pushBounded(array, item, label, cap = MAX_ERRORS) {
  if (array.length >= cap) {
    if (!report.errors.collectionErrors.some((entry) => entry.code === "bounded_collection_cap_reached" && entry.collection === label)) {
      if (report.errors.collectionErrors.length < MAX_ERRORS) {
        report.errors.collectionErrors.push({ collection: label, code: "bounded_collection_cap_reached", cap });
      }
    }
    return false;
  }
  array.push(item);
  return true;
}

function stage(name, details = {}) {
  if (report.checks.length >= MAX_STAGES) {
    throw new Error("The bounded smoke stage cap was reached.");
  }
  const item = { name, at: new Date().toISOString(), ...details };
  report.checks.push(item);
  console.log(`[T12] ${name}${Object.keys(details).length ? ` ${JSON.stringify(details)}` : ""}`);
}

function safeControlSummary(message, direction, connectionIndex, sequence) {
  const type = typeof message?.type === "string" ? message.type : "unknown";
  const item = { direction, connectionIndex, sequence, type };
  const stringFields = ["roomId", "currentRoomId", "participantId", "role", "mode", "code", "action", "reason"];
  for (const key of stringFields) {
    if (typeof message?.[key] === "string" && message[key].length <= 100) item[key] = message[key];
  }
  if (type === "join") {
    item.passwordProvided = typeof message.password === "string";
    item.resumable = message.resumable === true;
  } else if (type === "session.resume") {
    item.tokenPresent = typeof message.token === "string" && message.token.length > 0;
    item.passwordProvided = typeof message.password === "string";
  } else if (type === "session.leave") {
    item.tokenPresent = typeof message.token === "string" && message.token.length > 0;
  } else if (type === "session.issued") {
    item.tokenPresent = typeof message.token === "string" && message.token.length > 0;
  } else if (type === "session.resumed") {
    item.participantIdPresent = typeof message.participantId === "string";
  } else if (type === "room.snapshot") {
    item.roomId = message.room?.id ?? message.roomId ?? null;
    item.isLocked = Boolean(message.room?.isLocked);
    item.publishAllowed = Boolean(message.room?.publishAllowed);
    item.memberCount = Array.isArray(message.members) ? message.members.length : 0;
  } else if (type === "space.snapshot") {
    item.currentRoomId = message.currentRoomId ?? null;
    item.participantId = typeof message.participantId === "string" ? message.participantId : null;
  } else if (type === "participation.self") {
    item.role = message.role;
    item.mode = message.mode;
    item.audioSubscribed = Boolean(message.media?.audio?.subscribed);
    item.screenSubscribed = Boolean(message.media?.screen?.subscribed);
  } else if (type === "interaction.snapshot" || type === "interaction.state") {
    item.publicQueueCount = Array.isArray(message.publicQueue) ? message.publicQueue.length : 0;
    item.historyCount = Array.isArray(message.history) ? message.history.length : 0;
  } else if (type === "interaction.submit") {
    item.eventIdPresent = typeof message.eventId === "string";
    item.kind = typeof message.kind === "string" ? message.kind : "unknown";
  } else if (type === "interaction.ack") {
    item.eventIdPresent = typeof message.eventId === "string";
    item.duplicate = Boolean(message.duplicate);
  } else if (type === "interaction.event") {
    item.eventIdPresent = typeof message.event?.eventId === "string";
    item.kind = typeof message.event?.kind === "string" ? message.event.kind : "unknown";
  } else if (type === "host.actionResult") {
    for (const key of ["isLocked", "allowed", "grantsCleared", "removed"]) {
      if (typeof message[key] === "boolean") item[key] = message[key];
    }
  } else if (type === "host.claimed") {
    item.publisherGrantCount = Array.isArray(message.publisherGrants) ? message.publisherGrants.length : 0;
  } else if (type === "host.publisherGrants") {
    item.publisherGrantCount = Array.isArray(message.participantIds) ? message.participantIds.length : 0;
  }
  return item;
}

function parseControl(text) {
  if (typeof text !== "string") return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function messageText(payload) {
  if (typeof payload === "string") return payload;
  if (Buffer.isBuffer(payload)) return payload.toString("utf8");
  if (payload instanceof Uint8Array) return Buffer.from(payload).toString("utf8");
  return "";
}

function containsSecret(text) {
  for (const secret of transientSecrets) if (secret && text.includes(secret)) return true;
  return false;
}

function containsConfiguredCredential(text) {
  return [hostToken, roomPassword, nextRoomPassword].some((secret) => secret && text.includes(secret));
}

function observeBrowserFrame(client, connection, direction, payload) {
  const text = messageText(payload);
  if (!text) {
    const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    if (bytes.length > 0) connection.binaryFrames += 1;
    return;
  }
  const message = parseControl(text);
  if (!message) return;
  if (direction === "received" && containsConfiguredCredential(text)) {
    report.privacy.serverSecretEchoObserved = true;
  }
  if (direction === "received" && message.type === "session.issued" && typeof message.token === "string") {
    transientSecrets.add(message.token);
    client.resumeTokenIssued = true;
  } else if (direction === "received" && containsSecret(text)) {
    report.privacy.serverSecretEchoObserved = true;
  }
  if (direction === "sent" && message.type === "session.resume" && typeof message.token === "string") {
    client.resumeTokenSent = true;
  }
  const summary = safeControlSummary(message, direction, connection.index, ++connection.sequence);
  if (!pushBounded(connection.controls, summary, `${client.name}-control-trace`, MAX_BROWSER_CONTROL_RECORDS)) {
    client.collectionOverflow = true;
  }
}

function connectRoutedSocket(client, route, connection, pendingMessages = []) {
  const serverRoute = route.connectToServer();
  connection.serverRoute = serverRoute;
  client.wire.activeConnection = connection;
  route.onMessage((payload) => {
    observeBrowserFrame(client, connection, "sent", payload);
    serverRoute.send(payload);
  });
  serverRoute.onMessage((payload) => {
    observeBrowserFrame(client, connection, "received", payload);
    route.send(payload);
  });
  for (const payload of pendingMessages) {
    observeBrowserFrame(client, connection, "sent", payload);
    serverRoute.send(payload);
  }
  pendingMessages.length = 0;
  if (client.wire.heldRoute?.connection === connection) client.wire.heldRoute.pendingBytes = 0;
  return connection;
}

async function installWebSocketRoute(client) {
  await client.page.routeWebSocket(/\/ws(?:\?|$)/u, (route) => {
    const connection = {
      index: ++client.wire.nextConnectionIndex,
      controls: [],
      binaryFrames: 0,
      sequence: 0,
      serverRoute: null,
    };
    if (client.wire.connections.length >= MAX_BROWSER_CONNECTIONS) {
      client.collectionOverflow = true;
      pushBounded(report.errors.collectionErrors, { client: client.name, code: "browser_connection_cap_reached" }, "collection-errors");
      void route.close({ code: 1013, reason: "T12 smoke connection cap" }).catch(() => {});
      return;
    }
    client.wire.connections.push(connection);
    if (client.wire.blockNextConnection) {
      client.wire.blockNextConnection = false;
      if (client.wire.heldRoute) {
        client.collectionOverflow = true;
        pushBounded(report.errors.collectionErrors, {
          client: client.name,
          code: "more_than_one_connection_held",
        }, "collection-errors");
        return;
      }
      const held = { route, connection, pendingMessages: [], pendingBytes: 0 };
      client.wire.heldRoute = held;
      route.onMessage((payload) => {
        const bytes = Buffer.byteLength(payload);
        held.pendingBytes += bytes;
        if (held.pendingMessages.length >= 10 || held.pendingBytes > 64 * 1024) {
          client.collectionOverflow = true;
          pushBounded(report.errors.collectionErrors, { client: client.name, code: "held_websocket_buffer_cap_reached" }, "collection-errors");
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
  const result = require("node:child_process").execFileSync(certificateUtility, args, { stdio: "pipe" });
  return result;
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

async function launchClient(name) {
  const profile = createTrustedProfile(name);
  const browserEnv = { ...process.env, MOZ_APP_DATA: profile.appData, MOZ_LOCAL_APP_DATA: profile.localAppData };
  for (const key of [
    "RECONNECT_TEST_HOST_TOKEN", "RECONNECT_TEST_ROOM_PASSWORD", "HOST_CONTROL_TOKEN",
    "HOST_CONTROL_TEST_TOKEN", "HOST_CONTROL_TEST_PASSWORD", "MEETING_ROOM_PASSWORD",
  ]) delete browserEnv[key];
  const context = await firefox.launchPersistentContext(profile.profileDirectory, {
    headless,
    env: browserEnv,
    viewport: { width: 1360, height: 1000 },
    colorScheme: "light",
    firefoxUserPrefs: { "security.enterprise_roots.enabled": false },
  });
  context.setDefaultTimeout(normalStepTimeoutMs);
  contexts.push(context);
  const page = context.pages()[0] ?? await context.newPage();
  const client = {
    name,
    page,
    profile,
    wire: { connections: [], activeConnection: null, heldRoute: null, blockNextConnection: false, nextConnectionIndex: 0 },
    collectionOverflow: false,
    resumeTokenIssued: false,
    resumeTokenSent: false,
    pageErrorCount: 0,
    socketErrorCount: 0,
  };
  page.on("pageerror", (error) => {
    client.pageErrorCount += 1;
    if (report.errors.pageErrors.length < MAX_ERRORS) {
      pushBounded(report.errors.pageErrors, { client: name, message: redact(error?.message ?? "page error") }, "page-errors");
    }
  });
  await installWebSocketRoute(client);
  browserClients.set(name, client);
  return client;
}

function waitFor(predicate, description, timeoutMs = normalStepTimeoutMs) {
  const started = Date.now();
  return new Promise((resolveWait, rejectWait) => {
    const tick = () => {
      let value;
      try { value = predicate(); } catch (error) { rejectWait(error); return; }
      if (value) { resolveWait(value); return; }
      if (Date.now() - started >= timeoutMs) {
        rejectWait(new Error(`Timed out waiting for ${description}.`));
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}

function allBrowserControls(client) {
  return client.wire.connections.flatMap((connection) => connection.controls);
}

function receivedControls(client, type) {
  return allBrowserControls(client).filter((item) => item.direction === "received" && item.type === type);
}

function sentControls(client, type) {
  return allBrowserControls(client).filter((item) => item.direction === "sent" && item.type === type);
}

function latestReceived(client, type, afterSequence = -1) {
  return receivedControls(client, type).findLast((item) => item.sequence > afterSequence) ?? null;
}

async function waitBrowserControl(client, type, countBefore = 0, timeoutMs = normalStepTimeoutMs) {
  return waitFor(() => receivedControls(client, type)[countBefore] ?? null, `${client.name} received ${type}`, timeoutMs);
}

function browserURL(search = "") {
  return new URL(search, target.origin).href;
}

async function enterParticipant(client, displayName, password) {
  await client.page.goto(browserURL("/?room=studio"), { waitUntil: "domcontentloaded" });
  await client.page.getByRole("heading", { name: "Local room presence" }).waitFor();
  await client.page.getByLabel("Your display name").fill(displayName);
  await client.page.getByRole("button", { name: "Join room", exact: true }).click();
  await client.page.getByLabel("Meeting room password").waitFor({ state: "visible" });
  await client.page.locator("#meeting-room-password").fill(password);
  await client.page.getByRole("button", { name: "Enter room", exact: true }).click();
  await client.page.getByText("Connected to Meeting room", { exact: true }).waitFor();
  await client.page.getByTestId("participation-controls").waitFor();
  const room = await waitBrowserControl(client, "room.snapshot");
  const self = await waitBrowserControl(client, "participation.self");
  const issued = await waitBrowserControl(client, "session.issued");
  const space = await waitBrowserControl(client, "space.snapshot");
  assert.equal(room.roomId, "studio");
  assert.equal(room.isLocked, true);
  assert.ok(issued.tokenPresent, `${client.name} should receive an opaque resumable session token.`);
  assert.ok(room.participantId || self.participantId || space.participantId, "initial room snapshots should identify the joined member.");
  return {
    participantId: self.participantId ?? space.participantId ?? room.participantId,
    roomId: space.currentRoomId,
    role: self.role,
    mode: self.mode,
  };
}

async function enterHost(client) {
  const identity = await enterParticipant(client, "T12 host", roomPassword);
  await client.page.getByTestId("host-panel").waitFor();
  await client.page.getByTestId("host-control-token").fill(hostToken);
  await client.page.getByTestId("host-claim").click();
  await client.page.getByTestId("host-state").filter({ hasText: "HOST" }).waitFor();
  await waitFor(() => receivedControls(client, "host.claimed").length > 0, "host claim acknowledgement");
  return identity;
}

async function enterDisplay(client, password) {
  await client.page.goto(browserURL("/?view=display&room=studio"), { waitUntil: "domcontentloaded" });
  await client.page.getByTestId("display-page").waitFor();
  await client.page.getByTestId("display-join").click();
  await client.page.getByLabel("Meeting room password").waitFor({ state: "visible" });
  await client.page.locator("#meeting-room-password").fill(password);
  await client.page.getByRole("button", { name: "Enter room", exact: true }).click();
  await client.page.getByTestId("display-leave").waitFor();
  await client.page.getByText("唯讀展示已連線", { exact: false }).waitFor();
  const issued = await waitBrowserControl(client, "session.issued");
  const room = await waitBrowserControl(client, "room.snapshot");
  const self = await waitBrowserControl(client, "participation.self");
  assert.ok(issued.tokenPresent);
  assert.equal(room.roomId, "studio");
  assert.equal(self.role, "display");
  assert.equal(self.mode, "watch");
  await waitFor(() => sentControls(client, "screen.subscribe").length > 0, "initial display auto-watch subscription control");
  return { participantId: self.participantId, roomId: room.roomId, role: self.role, mode: self.mode };
}

async function readRoomCatalogue() {
  const response = await new Promise((resolveResponse, rejectResponse) => {
    const request = httpsGet(`${target.origin}/api/rooms`, { ca: caPem }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try { resolveResponse({ status: res.statusCode, rooms: JSON.parse(body) }); }
        catch { rejectResponse(new Error("The local room catalogue did not return JSON.")); }
      });
    });
    request.setTimeout(5_000, () => request.destroy(new Error("The local HTTPS catalogue timed out.")));
    request.on("error", rejectResponse);
  });
  assert.equal(response.status, 200);
  const studio = response.rooms.find((room) => room.id === "studio");
  assert.ok(studio, "studio must exist in the local room catalogue.");
  assert.equal(studio.isLocked, true, "T12 smoke requires the meeting room password gate.");
  assert.equal(studio.hostControlsEnabled, true, "T12 smoke requires managed host controls.");
  const serialized = JSON.stringify(response.rooms);
  assert.equal(serialized.includes(hostToken), false, "room catalogue must not expose the host token.");
  assert.equal(serialized.includes(roomPassword), false, "room catalogue must not expose the room password.");
  assert.equal(serialized.includes(nextRoomPassword), false, "room catalogue must not expose the replacement room password.");
  stage("trusted-https-room-catalogue-confirms-normal-gate", { roomId: studio.id, locked: studio.isLocked, hostControlsEnabled: studio.hostControlsEnabled });
}

async function waitReconnectRoute(client) {
  return waitFor(() => client.wire.heldRoute, `${client.name} blocked reconnect WebSocket`, reconnectingTimeoutMs);
}

async function controlledReconnect(client, { screenshotPrefix = null, expectedIdentity, expectedRoomId, expectHostReset = false, expectDisplayNoAutoSubscribe = false } = {}) {
  const current = client.wire.activeConnection;
  assert.ok(current?.serverRoute, `${client.name} should have an active routed WebSocket before disconnect.`);
  client.wire.blockNextConnection = true;
  const typeCountBefore = receivedControls(client, "session.resumed").length;
  const sentResumeBefore = sentControls(client, "session.resume").length;
  const screenSubscribeBefore = sentControls(client, "screen.subscribe").length;
  await current.serverRoute.close({ code: 4000, reason: "T12 controlled application disconnect" });
  await waitReconnectRoute(client);

  const statusTestId = client.name === "display" ? "display-status" : "control-connection-status";
  const status = client.page.getByTestId(statusTestId);
  await status.waitFor({ state: "visible" });
  const reconnectText = (await status.textContent()) ?? "";
  assert.match(reconnectText, /reconnect|retry|disconnected|連線中|重連|恢復|重試/iu, `${client.name} should show a connection recovery state.`);
  const resumeState = client.page.getByTestId(client.name === "display" ? "display-status" : "control-resume-state");
  assert.ok(await resumeState.count() > 0, `${client.name} recovery status test ID should be present.`);
  if (screenshotPrefix) {
    const fileName = `${screenshotPrefix}-reconnecting.png`;
    await client.page.screenshot({ path: join(outputDirectory, fileName), fullPage: true, animations: "disabled" });
    report.screenshots.push(fileName);
  }

  const held = client.wire.heldRoute;
  assert.ok(held, `${client.name} reconnect should be held only by the smoke WebSocket wrapper.`);
  connectRoutedSocket(client, held.route, held.connection, held.pendingMessages);
  client.wire.heldRoute = null;
  await waitFor(() => receivedControls(client, "session.resumed").length > typeCountBefore, `${client.name} session.resumed after controlled close`, 15_000);
  const resumed = receivedControls(client, "session.resumed").at(-1);
  const newConnection = client.wire.activeConnection;
  assert.ok(newConnection);
  assert.equal(resumed.connectionIndex, newConnection.index, `${client.name} session.resumed must arrive on the new socket.`);
  assert.equal(resumed.participantId, expectedIdentity, `${client.name} must resume the same server identity.`);
  assert.equal(resumed.roomId, expectedRoomId, `${client.name} must resume the current server room.`);
  assert.equal(resumed.role, client.name === "display" ? "display" : "participant");
  assert.equal(resumed.mode, "watch");
  await waitFor(() => {
    const snapshots = receivedControls(client, "space.snapshot");
    return snapshots.some((item) => item.connectionIndex === newConnection.index && item.currentRoomId === expectedRoomId && item.participantId === expectedIdentity);
  }, `${client.name} authoritative space snapshot after resume`, 15_000);

  if (expectHostReset) {
    await client.page.getByTestId("host-state").filter({ hasText: "MANAGED" }).waitFor();
    assert.equal(sentControls(client, "host.claim").length, 1, "host must not automatically reclaim the previous host permission.");
  }
  if (expectDisplayNoAutoSubscribe) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
    assert.equal(sentControls(client, "screen.subscribe").length, screenSubscribeBefore, "display must not auto-subscribe media after control resume.");
  }

  assert.ok(newConnection, `${client.name} should have a new active WebSocket after recovery.`);
  const resumeSentAfter = sentControls(client, "session.resume").length;
  assert.ok(resumeSentAfter > sentResumeBefore, `${client.name} should authenticate resume with its stored opaque token.`);
  assert.equal(client.resumeTokenIssued, true);
  assert.equal(client.resumeTokenSent, true);

  if (screenshotPrefix) {
    const fileName = `${screenshotPrefix}-recovered.png`;
    await client.page.screenshot({ path: join(outputDirectory, fileName), fullPage: true, animations: "disabled" });
    report.screenshots.push(fileName);
  }
  const result = {
    client: client.name,
    sameParticipant: true,
    roomId: expectedRoomId,
    resumeTokenIssued: client.resumeTokenIssued,
    resumeTokenPresented: client.resumeTokenSent,
    reconnectStateWasVisible: true,
    controlledCloseCode: 4000,
    physicalNetworkClaim: false,
  };
  report.reconnects.push(result);
  stage(`${client.name}-controlled-disconnect-resumed-same-identity`, result);
  return resumed;
}

async function reloadAndVerify(client, expectedIdentity, expectedRoomId) {
  const leaveCountBefore = sentControls(client, "session.leave").length;
  const resumeCountBefore = sentControls(client, "session.resume").length;
  const resumedCountBefore = receivedControls(client, "session.resumed").length;
  const connectionIndexBefore = client.wire.nextConnectionIndex;
  await client.page.reload({ waitUntil: "domcontentloaded" });
  const resumed = await waitFor(
    () => receivedControls(client, "session.resumed").slice(resumedCountBefore).find((item) => item.connectionIndex > connectionIndexBefore) ?? null,
    `${client.name} reload auto-resume`,
    15_000,
  );
  assert.equal(resumed.participantId, expectedIdentity);
  assert.equal(resumed.roomId, expectedRoomId);
  assert.equal(resumed.role, "participant");
  assert.equal(resumed.mode, "watch");
  const snapshot = await waitFor(
    () => receivedControls(client, "space.snapshot").find((item) => item.connectionIndex === resumed.connectionIndex && item.participantId === expectedIdentity && item.currentRoomId === expectedRoomId) ?? null,
    `${client.name} authoritative room snapshot on reload socket`,
    15_000,
  );
  assert.equal(snapshot.connectionIndex, resumed.connectionIndex);
  assert.equal(sentControls(client, "session.leave").length, leaveCountBefore, "page reload must not send explicit session.leave.");
  assert.ok(sentControls(client, "session.resume").length > resumeCountBefore, "page reload should present the same-tab resume token.");
  const connectedText = expectedRoomId === "studio" ? "Connected to Meeting room" : "Connected to Open area";
  await client.page.getByText(connectedText, { exact: true }).waitFor();
  stage("participant-reload-restored-server-identity-and-room", { sameParticipant: true, roomId: expectedRoomId, explicitLeaveSent: false });
}

async function switchRoomInBrowser(client, roomId, password = undefined) {
  const choice = client.page.locator(`[data-room-choice="${roomId}"]`);
  await choice.waitFor({ state: "visible" });
  await choice.click();
  if (password !== undefined) {
    await client.page.getByLabel("Meeting room password").waitFor({ state: "visible" });
    await client.page.locator("#meeting-room-password").fill(password);
    await client.page.getByRole("button", { name: "Enter room", exact: true }).click();
  }
  const expected = roomId === "studio" ? "Connected to Meeting room" : "Connected to Open area";
  await client.page.getByText(expected, { exact: true }).waitFor();
  await waitFor(() => latestReceived(client, "space.snapshot")?.currentRoomId === roomId, `server room switch to ${roomId}`);
  assert.equal(latestReceived(client, "room.snapshot")?.roomId, roomId);
}

async function reclaimsHost(client) {
  await client.page.getByTestId("host-state").filter({ hasText: "MANAGED" }).waitFor();
  await client.page.getByTestId("host-control-token").fill(hostToken);
  await client.page.getByTestId("host-claim").click();
  await client.page.getByTestId("host-state").filter({ hasText: "HOST" }).waitFor();
  stage("host-reclaimed-only-after-normal-user-action", { hostControlWasRestoredAutomatically: false });
}

async function changeRoomPassword(client, password) {
  const before = receivedControls(client, "host.actionResult").length;
  await client.page.getByTestId("host-meeting-password").fill(password);
  await client.page.getByTestId("host-lock-room").click();
  await waitFor(() => receivedControls(client, "host.actionResult").slice(before).some((item) => item.action === "setMeetingRoomPassword" && item.isLocked), "server acknowledgement of room gate revision");
  await client.page.getByTestId("host-management-status").filter({ hasText: "已上鎖" }).waitFor();
  stage("host-changed-room-gate-revision-through-normal-control", { roomId: "studio", locked: true, passwordRetained: false });
}

async function resumeAfterGateRevision(client, expectedIdentity, oldPassword, newPassword) {
  const beforeResumed = receivedControls(client, "session.resumed").length;
  const beforePasswordError = receivedControls(client, "protocol.error").length;
  const current = client.wire.activeConnection;
  client.wire.blockNextConnection = true;
  await current.serverRoute.close({ code: 4000, reason: "T12 controlled application disconnect for gate revision" });
  await waitReconnectRoute(client);
  connectRoutedSocket(client, client.wire.heldRoute.route, client.wire.heldRoute.connection, client.wire.heldRoute.pendingMessages);
  client.wire.heldRoute = null;
  await waitFor(() => receivedControls(client, "protocol.error").length > beforePasswordError, "server requests current room password after gate revision", 15_000);
  const gateError = receivedControls(client, "protocol.error").slice(beforePasswordError).find((item) => item.code?.startsWith("room_password_"));
  assert.ok(gateError, "changed gate revision should require a normal password response.");
  await client.page.getByTestId("meeting-room-password").waitFor({ state: "visible" });
  await client.page.locator("#meeting-room-password").fill(oldPassword);
  const beforeOldPassword = receivedControls(client, "protocol.error").length;
  await client.page.getByRole("button", { name: "Enter room", exact: true }).click();
  await waitFor(() => receivedControls(client, "protocol.error").length > beforeOldPassword, "old room password rejected after gate revision");
  const rejectedOldPassword = receivedControls(client, "protocol.error").slice(beforeOldPassword).some((item) => item.code?.startsWith("room_password_"));
  assert.ok(rejectedOldPassword, "the previous room password should not authorize the changed gate.");
  await client.page.getByTestId("meeting-room-password").waitFor({ state: "visible" });
  await client.page.locator("#meeting-room-password").fill(newPassword);
  await client.page.getByRole("button", { name: "Enter room", exact: true }).click();
  await waitFor(() => receivedControls(client, "session.resumed").length > beforeResumed, "new password resumes the original session", 15_000);
  const resumed = receivedControls(client, "session.resumed").at(-1);
  assert.equal(resumed.connectionIndex, client.wire.activeConnection?.index, "password-authenticated resume must arrive on the current socket.");
  assert.equal(resumed.participantId, expectedIdentity);
  assert.equal(resumed.roomId, "studio");
  await client.page.getByText("Connected to Meeting room", { exact: true }).waitFor();
  stage("gate-revision-rejected-old-password-and-resumed-same-identity-with-current-password", {
    roomId: "studio",
    requiredCurrentPassword: true,
    previousPasswordRejected: true,
    sameParticipant: true,
    passwordValuesRetained: false,
  });
}

function baseWSURL() {
  return target.origin.replace(/^http/u, "ws");
}

function safeProbeSummary(message) {
  return safeControlSummary(message, "received", 0, 0);
}

function makeProbe(name) {
  return { name, socket: null, messages: [], token: null, sequence: 0, overflow: false };
}

function attachProbe(probe, socket) {
  probe.socket = socket;
  probeSockets.add(socket);
  socket.on("message", (raw, isBinary) => {
    if (isBinary) {
      if (!pushBounded(probe.messages, { type: "binary", binary: true }, `${probe.name}-probe-messages`, MAX_PROBE_MESSAGES)) probe.overflow = true;
      return;
    }
    const text = raw.toString();
    const message = parseControl(text);
    if (!message) {
      if (!pushBounded(probe.messages, { type: "unparsed" }, `${probe.name}-probe-messages`, MAX_PROBE_MESSAGES)) probe.overflow = true;
      return;
    }
    if (containsConfiguredCredential(text)) report.privacy.serverSecretEchoObserved = true;
    if (message.type === "session.issued" && typeof message.token === "string") {
      probe.token = message.token;
      transientSecrets.add(message.token);
    } else if (containsSecret(text)) {
      report.privacy.serverSecretEchoObserved = true;
    }
    const summary = safeProbeSummary(message);
    summary.sequence = ++probe.sequence;
    if (message.type === "interaction.event") {
      summary.ephemeralEventId = message.event?.eventId ?? null;
    }
    if (message.type === "interaction.ack") {
      summary.ephemeralEventId = message.eventId ?? null;
    }
    if (message.type === "interaction.snapshot" || message.type === "interaction.state") {
      summary.ephemeralPublicEventIds = Array.isArray(message.publicQueue)
        ? message.publicQueue.map((event) => event.eventId).filter((value) => typeof value === "string")
        : [];
    }
    if (!pushBounded(probe.messages, summary, `${probe.name}-probe-messages`, MAX_PROBE_MESSAGES)) probe.overflow = true;
  });
  socket.on("error", (error) => {
    if (report.errors.socketErrors.length < MAX_ERRORS) {
      pushBounded(report.errors.socketErrors, { client: probe.name, message: redact(error?.message ?? "WSS probe error") }, "socket-errors");
    }
  });
}

async function openProbe(name) {
  const probe = makeProbe(name);
  const socket = new WebSocket(`${baseWSURL()}/ws`, { origin: target.origin, ca: caPem, maxPayload: 2 * 1024 * 1024 });
  attachProbe(probe, socket);
  await new Promise((resolveOpen, rejectOpen) => {
    const timer = setTimeout(() => rejectOpen(new Error(`${name} WSS probe did not open in time.`)), 6_000);
    socket.once("open", () => { clearTimeout(timer); resolveOpen(); });
    socket.once("error", (error) => { clearTimeout(timer); rejectOpen(error); });
  });
  return probe;
}

function waitProbe(probe, predicate, description, from = 0, timeoutMs = 6_000) {
  return waitFor(() => {
    if (probe.overflow) throw new Error(`${probe.name} reached its bounded message cap.`);
    return probe.messages.slice(from).find((message) => predicate(message)) ?? null;
  }, `${probe.name} ${description}`, timeoutMs);
}

function sendProbe(probe, message) {
  if (probe.socket?.readyState !== WebSocket.OPEN) throw new Error(`${probe.name} probe is not open.`);
  probe.socket.send(JSON.stringify(message));
}

async function joinProbe(probe, { resumable = false, role = "participant", mode = "interaction", password = roomPassword } = {}) {
  const from = probe.messages.length;
  sendProbe(probe, {
    type: "join",
    roomId: "studio",
    displayName: resumable ? "T12 dedup probe" : "T12 event observer",
    role,
    mode,
    resumable,
    password,
  });
  const room = await waitProbe(probe, (item) => item.type === "room.snapshot" && item.roomId === "studio", "locked-room join snapshot", from);
  const self = await waitProbe(probe, (item) => item.type === "participation.self" && item.roomId === "studio", "role and mode snapshot", from);
  assert.equal(room.isLocked, true);
  assert.equal(self.role, role);
  assert.equal(self.mode, mode);
  if (resumable) {
    const issued = await waitProbe(probe, (item) => item.type === "session.issued" && item.tokenPresent, "opaque session issuance", from);
    assert.ok(issued.participantId);
    assert.ok(probe.token);
  }
  return { participantId: self.participantId, role: self.role, mode: self.mode };
}

async function waitProbeClosed(probe) {
  if (probe.socket.readyState === WebSocket.CLOSED) return;
  await new Promise((resolveClose, rejectClose) => {
    const timer = setTimeout(() => rejectClose(new Error(`${probe.name} probe close did not finish.`)), 5_000);
    probe.socket.once("close", () => { clearTimeout(timer); resolveClose(); });
    probe.socket.close(4000, "T12 smoke probe reconnect");
  });
}

async function resumeProbe(probe, token, password = undefined) {
  const from = probe.messages.length;
  sendProbe(probe, { type: "session.resume", token, ...(password === undefined ? {} : { password }) });
  const resumed = await waitProbe(probe, (item) => item.type === "session.resumed", "session resume acknowledgement", from);
  const room = await waitProbe(probe, (item) => item.type === "room.snapshot" && item.roomId === "studio", "authoritative room snapshot", from);
  const interaction = await waitProbe(probe, (item) => item.type === "interaction.snapshot", "authoritative interaction snapshot", from);
  return { resumed, room, interaction };
}

async function runDuplicateAndExpiryProbe(currentRoomPassword) {
  const observer = await openProbe("observer");
  const observerIdentity = await joinProbe(observer, { resumable: false, role: "participant", mode: "interaction", password: currentRoomPassword });
  const sender = await openProbe("event-owner");
  const senderIdentity = await joinProbe(sender, { resumable: true, role: "participant", mode: "interaction", password: currentRoomPassword });
  const eventId = `t12-dedup-${randomUUID()}`;
  const firstEventIndex = observer.messages.length;
  const firstAckIndex = sender.messages.length;
  sendProbe(sender, { type: "interaction.submit", eventId, kind: "danmaku", text: "T12 short public expiry check" });
  const firstAck = await waitProbe(sender, (item) => item.type === "interaction.ack" && item.ephemeralEventId === eventId, "initial accepted event ACK", firstAckIndex);
  assert.equal(firstAck.duplicate, false);
  await waitProbe(observer, (item) => item.type === "interaction.event" && item.ephemeralEventId === eventId, "first public event projection", firstEventIndex);
  const firstAcceptedAt = Date.now();

  const token = sender.token;
  assert.ok(token, "resumable probe must keep the opaque bearer in volatile memory for the resume request.");
  await waitProbeClosed(sender);
  const resumedProbe = await openProbe("event-owner-resumed");
  const duplicate = await resumeProbe(resumedProbe, token);
  assert.equal(duplicate.resumed.participantId, senderIdentity.participantId);
  assert.equal(duplicate.resumed.roomId, "studio");
  const beforeDuplicateEvents = observer.messages.filter((item) => item.type === "interaction.event" && item.ephemeralEventId === eventId).length;
  const duplicateAckIndex = resumedProbe.messages.length;
  sendProbe(resumedProbe, { type: "interaction.submit", eventId, kind: "danmaku", text: "T12 short public expiry check" });
  const duplicateAck = await waitProbe(resumedProbe, (item) => item.type === "interaction.ack" && item.ephemeralEventId === eventId, "same-ID duplicate ACK", duplicateAckIndex);
  assert.equal(duplicateAck.duplicate, true, "accepted event ID should be idempotent across session resume.");
  await new Promise((resolveWait) => setTimeout(resolveWait, 350));
  const afterDuplicateEvents = observer.messages.filter((item) => item.type === "interaction.event" && item.ephemeralEventId === eventId).length;
  assert.equal(afterDuplicateEvents, beforeDuplicateEvents, "duplicate ACK must not project a second public event.");

  await new Promise((resolveWait) => setTimeout(resolveWait, 8_250));
  await waitProbeClosed(resumedProbe);
  const expiryProbe = await openProbe("event-owner-after-public-expiry");
  const expiredResume = await resumeProbe(expiryProbe, token);
  assert.equal(expiredResume.resumed.participantId, senderIdentity.participantId);
  assert.equal(expiredResume.interaction.publicQueueCount, 0, "expired public event must not be requeued in the authoritative snapshot.");
  const replayCount = expiryProbe.messages.filter((item) => item.type === "interaction.event" && item.ephemeralEventId === eventId).length;
  assert.equal(replayCount, 0, "expired public event must not replay to the resumed control session.");
  assert.equal(observerIdentity.role, "participant");

  const result = {
    sameParticipantAfterResume: true,
    initialAcceptedDuplicate: false,
    duplicateAcknowledged: true,
    duplicateProjectionCount: afterDuplicateEvents - beforeDuplicateEvents,
    waitedBeyondPublicTtlMs: Date.now() - firstAcceptedAt,
    publicSnapshotCountAfterExpiry: expiredResume.interaction.publicQueueCount,
    expiredReplayCount: replayCount,
    eventIdRetained: false,
    resumeTokenRetained: false,
  };
  report.probes.push(result);
  stage("event-id-dedup-survives-resume-and-public-ttl-expires-without-replay", result);

  for (const probe of [observer, sender, resumedProbe, expiryProbe]) {
    assert.equal(probe.overflow, false, `${probe.name} bounded control trace must remain below its cap.`);
    if (probe.token) {
      transientSecrets.delete(probe.token);
      probe.token = null;
    }
    if (probe.socket.readyState === WebSocket.OPEN || probe.socket.readyState === WebSocket.CONNECTING) {
      await closeProbe(probe);
    }
  }
}

async function closeProbe(probe) {
  const socket = probe.socket;
  probeSockets.delete(socket);
  if (socket.readyState === WebSocket.CLOSED) return;
  await new Promise((resolveClose) => {
    const timer = setTimeout(resolveClose, 1_500);
    socket.once("close", () => { clearTimeout(timer); resolveClose(); });
    try { socket.close(1000, "T12 smoke cleanup"); } catch { clearTimeout(timer); resolveClose(); }
  });
}

async function proveParticipantCanUseControl(client) {
  const before = receivedControls(client, "interaction.ack").length;
  await client.page.getByTestId("feedback-useful").click();
  await waitFor(() => receivedControls(client, "interaction.ack").length > before, "allowed feedback control after recovery");
  const ack = receivedControls(client, "interaction.ack").at(-1);
  assert.equal(ack.duplicate, false);
  await client.page.getByTestId("interaction-status").waitFor().catch(() => {});
  stage("participant-can-use-allowed-control-after-recovery", { control: "feedback", acknowledged: true });
}

async function proveGrantAndHostReset(host, participant, participantIdentity) {
  const row = host.page.locator(`[data-participant-id="${participantIdentity}"]`);
  await row.getByTestId("host-grant-publisher").click();
  await host.page.getByTestId("host-management-status").filter({ hasText: "已授予" }).waitFor();
  await row.getByTestId("host-revoke-publisher").waitFor();
  stage("host-granted-publisher-before-resume-check", { grantWasActive: true, participantIdentityRecorded: true });

  const participantReset = await controlledReconnect(participant, {
    screenshotPrefix: "participant",
    expectedIdentity: participantIdentity,
    expectedRoomId: "studio",
  });
  assert.equal(participantReset.participantId, participantIdentity);
  await row.getByTestId("host-grant-publisher").waitFor({ state: "visible" });
  assert.equal(await row.getByTestId("host-revoke-publisher").count(), 0, "a previous grant must not survive participant resume.");
  const resumedRoom = latestReceived(participant, "room.snapshot");
  assert.equal(resumedRoom.publishAllowed, false, "server's resumed snapshot must reflect the latest ungranted permission.");
  stage("resume-restores-current-permission-without-old-publisher-grant", { roomId: "studio", publishAllowed: false, oldGrantRevived: false });
}

async function proveExplicitLeaveStopsResume(client) {
  const resumeBefore = sentControls(client, "session.resume").length;
  const leaveBefore = sentControls(client, "session.leave").length;
  await client.page.getByRole("button", { name: "Leave", exact: true }).click();
  await waitFor(() => sentControls(client, "session.leave").length > leaveBefore, "explicit session.leave from participant UI");
  await client.page.getByText("Not connected", { exact: true }).waitFor();
  const resumeAfterLeave = sentControls(client, "session.resume").length;
  await new Promise((resolveWait) => setTimeout(resolveWait, 1_300));
  assert.equal(sentControls(client, "session.resume").length, resumeAfterLeave, "explicit leave must stop automatic retry.");
  await client.page.reload({ waitUntil: "domcontentloaded" });
  await client.page.getByRole("heading", { name: "Local room presence" }).waitFor();
  await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  assert.equal(sentControls(client, "session.resume").length, resumeAfterLeave, "explicit leave must clear the same-tab token across reload.");
  assert.ok(sentControls(client, "session.leave").length > leaveBefore);
  assert.ok(resumeBefore >= 1);
  stage("explicit-leave-invalidates-session-and-prevents-reconnect-after-reload", { leaveSent: true, tokenPresentAfterReload: false, automaticResumeAfterLeave: false });
}

async function closeResources() {
  for (const probeSocket of [...probeSockets]) {
    if (probeSocket.readyState === WebSocket.CLOSED) {
      probeSockets.delete(probeSocket);
      continue;
    }
    await new Promise((resolveClose) => {
      const timer = setTimeout(resolveClose, 1_000);
      probeSocket.once("close", () => { clearTimeout(timer); resolveClose(); });
      try { probeSocket.close(1000, "T12 cleanup"); } catch { clearTimeout(timer); resolveClose(); }
    });
    probeSockets.delete(probeSocket);
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

async function writeReport() {
  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - startedAtMs;
  report.status = failure ? "failed" : "passed";
  report.privacy.secretsInRetainedTrace = false;
  report.errors.failure = failure ? redact(failure.message ?? failure) : null;
  if (report.errors.collectionErrors.length > 0) {
    report.status = "failed";
  }
  if (report.privacy.serverSecretEchoObserved) report.status = "failed";
  const json = JSON.stringify(report, null, 2) + "\n";
  writeFileSync(join(outputDirectory, "control-reconnect-report.json"), json, { encoding: "utf8", mode: 0o600 });
}

async function main() {
  await readRoomCatalogue();
  const host = await launchClient("host");
  const participant = await launchClient("participant");
  const display = includeDisplay ? await launchClient("display") : null;
  const hostIdentity = await enterHost(host);
  const participantIdentity = await enterParticipant(participant, "T12 participant", roomPassword);
  assert.ok(hostIdentity.participantId);
  assert.equal(participantIdentity.roomId, "studio");
  assert.equal(participantIdentity.role, "participant");
  report.runtime.firefox = await participant.page.evaluate(() => navigator.userAgent);
  stage("normal-host-and-password-gated-participant-joined", { hostRoom: "studio", participantRoom: "studio", lockedRoomPasswordUsed: true });

  if (display) {
    await enterDisplay(display, roomPassword);
    report.topology.displayRoleIncluded = true;
  }

  await proveGrantAndHostReset(host, participant, participantIdentity.participantId);
  await proveParticipantCanUseControl(participant);

  await switchRoomInBrowser(participant, "lobby");
  await reloadAndVerify(participant, participantIdentity.participantId, "lobby");
  await switchRoomInBrowser(participant, "studio", roomPassword);
  stage("server-room-switch-to-locked-room-used-normal-password-ui", { participantIdentityStable: true, roomId: "studio", passwordRetained: false });

  const hostResumed = await controlledReconnect(host, {
    expectedIdentity: hostIdentity.participantId,
    expectedRoomId: "studio",
    expectHostReset: true,
  });
  assert.equal(hostResumed.participantId, hostIdentity.participantId);
  await reclaimsHost(host);

  if (display) {
    const displayIdentity = latestReceived(display, "participation.self")?.participantId;
    assert.ok(displayIdentity);
    await controlledReconnect(display, {
      expectedIdentity: displayIdentity,
      expectedRoomId: "studio",
      expectDisplayNoAutoSubscribe: true,
    });
  }

  await changeRoomPassword(host, nextRoomPassword);
  await resumeAfterGateRevision(participant, participantIdentity.participantId, roomPassword, nextRoomPassword);
  await runDuplicateAndExpiryProbe(nextRoomPassword);
  await proveExplicitLeaveStopsResume(participant);
  await changeRoomPassword(host, roomPassword);
  stage("startup-test-password-restored-after-successful-flow", { restored: true, passwordRetained: false });

  for (const client of browserClients.values()) {
    assert.equal(client.collectionOverflow, false, `${client.name} bounded WebSocket trace must not overflow.`);
    assert.ok(client.resumeTokenIssued, `${client.name} must receive session.issued.`);
    if (client.name !== "participant" || sentControls(client, "session.resume").length > 0) {
      assert.equal(client.resumeTokenSent, true, `${client.name} must present the resume token when reconnecting.`);
    }
  }
  assert.equal(report.errors.pageErrors.length, 0, "Firefox pages must not report uncaught page errors.");
  assert.equal(report.errors.socketErrors.length, 0, "the browser and external control sockets must not report socket errors.");
  assert.equal(report.privacy.serverSecretEchoObserved, false, "server control frames must not echo a room or host secret.");
  assert.equal(report.errors.collectionErrors.length, 0, "no bounded collector may overflow or truncate evidence.");
  stage("bounded-secret-safe-control-traces-and-final-assertions", {
    clientCount: browserClients.size,
    totalControlRecords: [...browserClients.values()].reduce((sum, client) => sum + allBrowserControls(client).length, 0),
    traceCapsReached: false,
    secretsRetained: false,
  });
}

try {
  await main();
} catch (error) {
  failure = error;
  if (report.errors.failure === null) report.errors.failure = redact(error?.message ?? error);
  console.error(`[T12] failed ${redact(error?.message ?? "smoke failed")}`);
} finally {
  await closeResources();
  if (!failure && report.errors.cleanupErrors.length > 0) failure = new Error("One or more isolated Firefox profiles or sockets did not clean up cleanly.");
  if (!failure && report.errors.collectionErrors.length > 0) failure = new Error("A bounded smoke evidence collection cap was reached.");
  if (!failure && report.privacy.serverSecretEchoObserved) failure = new Error("A server control frame echoed a configured secret or opaque session token.");
  if (!failure && (report.errors.pageErrors.length > 0 || report.errors.socketErrors.length > 0)) failure = new Error("A browser or control socket reported an error.");
  try { await writeReport(); }
  catch (error) {
    console.error(`[T12] report write failed ${redact(error?.message ?? "write failed")}`);
    if (!failure) failure = error;
  }
}

if (failure) process.exitCode = 1;
else console.log(`[T12] report ${join(outputDirectory, "control-reconnect-report.json")}`);
