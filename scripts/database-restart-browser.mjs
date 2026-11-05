import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { get as httpsGet } from "node:https";
import WebSocket from "ws";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hostToken = process.env.PG_BROWSER_HOST_TOKEN ?? "";
const startupPassword = process.env.PG_BROWSER_STARTUP_PASSWORD ?? "";
const livePassword = process.env.PG_BROWSER_LIVE_PASSWORD ?? "";
const databaseVariable = process.env.PG_BROWSER_DATABASE_URL ? "PG_BROWSER_DATABASE_URL" : "DATABASE_URL";
const databaseUrl = process.env.PG_BROWSER_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const secretValues = new Set([hostToken, startupPassword, livePassword, databaseUrl].filter(Boolean));
const scratchRoot = resolve(root, ".scratch/postgres");
const outputDirectory = resolve(root, process.env.PG_BROWSER_OUTPUT_DIR ?? ".scratch/postgres/acceptance");
const outputRelative = relative(scratchRoot, outputDirectory);
if (isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(".." + sep)) {
  throw new Error("PG_BROWSER_OUTPUT_DIR must stay inside .scratch/postgres.");
}
if (process.version !== "v26.13.0") throw new Error("Use the repository-pinned Node v26.13.0 runtime for this smoke.");
if (Buffer.byteLength(hostToken, "utf8") < 32 || Buffer.byteLength(hostToken, "utf8") > 256 ||
    !startupPassword || !livePassword || new Set([hostToken, startupPassword, livePassword]).size !== 3) {
  throw new Error("Set distinct PG_BROWSER_HOST_TOKEN, PG_BROWSER_STARTUP_PASSWORD, and PG_BROWSER_LIVE_PASSWORD values; the host token must be 32–256 bytes.");
}
if (!databaseUrl) throw new Error("Set PG_BROWSER_DATABASE_URL or DATABASE_URL for the PostgreSQL-backed child process.");
let parsedDatabaseUrl;
try { parsedDatabaseUrl = new URL(databaseUrl); } catch { throw new Error("The PostgreSQL database URL is not a valid URL."); }
if (!(["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol)) || !parsedDatabaseUrl.hostname) {
  throw new Error("PG_BROWSER_DATABASE_URL or DATABASE_URL must use a PostgreSQL URL.");
}
for (const secret of [parsedDatabaseUrl.username, parsedDatabaseUrl.password]) {
  if (secret) {
    try { secretValues.add(decodeURIComponent(secret)); } catch { secretValues.add(secret); }
  }
}

const baseURL = process.env.PG_BROWSER_BASE_URL ?? "https://localhost:4173";
const target = new URL(baseURL);
if (target.protocol !== "https:" || !["localhost", "127.0.0.1"].includes(target.hostname) ||
    target.username || target.password || target.search || target.hash || target.pathname !== "/") {
  throw new Error("PG_BROWSER_BASE_URL must be a local trusted HTTPS application root without credentials, query, or fragment.");
}
const port = Number(target.port || "443");
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PG_BROWSER_BASE_URL must use a valid local TCP port.");

const caCertificate = resolve(root, process.env.PG_BROWSER_CA_CERT ?? ".scratch/t01/tls/local-ca.pem");
const caPem = readFileSync(caCertificate);
const tlsCertificate = resolve(root, process.env.TLS_CERT_FILE ?? ".scratch/t01/tls/localhost-cert.pem");
const tlsKey = resolve(root, process.env.TLS_KEY_FILE ?? ".scratch/t01/tls/localhost-key.pem");
readFileSync(tlsCertificate);
readFileSync(tlsKey);
const certificateUtility = process.env.CERTUTIL_BIN ?? "certutil";
const headless = process.env.HEADLESS !== "0";
const runId = new Date().toISOString().replaceAll(":", "-") + "-" + randomUUID().slice(0, 8);
const runDirectory = join(outputDirectory, "run-" + runId);
const serverEntry = resolve(root, "dist/server/index.js");
if (!existsSync(serverEntry)) throw new Error("Build dist/server/index.js before running this owned-process smoke.");
mkdirSync(runDirectory, { recursive: true, mode: 0o700 });

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, ".tools/playwright-browsers");
const { firefox } = await import("playwright");

const WAIT_MS = 15_000;
const RESTART_DOWN_MS = 1_000;
const PROCESS_TERM_WAIT_MS = 5_000;
const PROCESS_KILL_WAIT_MS = 2_000;
const MAX_CONNECTIONS = 16;
const MAX_CONTROLS_PER_CONNECTION = 240;
const MAX_STAGE_COUNT = 24;
const MAX_ERROR_COUNT = 24;
const MAX_INTERACTION_IDS = 12;
const CLIENT_NAMES = ["host", "guest"];
const contexts = [];
const profiles = [];
const probes = new Set();
const clients = new Map();
const startedAtMs = Date.now();
let phase = "preflight";
let activeServer = null;
let restartWindow = null;
let failure = null;
let collectionOverflow = false;
let unexpectedSocketErrors = 0;
let syntheticChatText = null;

const report = {
  schemaVersion: 1,
  purpose: "Lightweight trusted-Firefox PostgreSQL persistence slice across a real owned application process restart.",
  startedAt: new Date().toISOString(),
  finishedAt: null,
  durationMs: null,
  status: "running",
  dataSlicePass: false,
  operationalPass: false,
  fullPOCPass: false,
  productReady: false,
  conclusion: "pending",
  baseURL: target.origin,
  runtime: { node: process.version, platform: process.platform, architecture: process.arch, firefox: "not-reported", headless },
  tls: {
    caCertificate: relative(root, caCertificate),
    serverCertificate: relative(root, tlsCertificate),
    trust: "trusted CA imported only into isolated Firefox profiles",
    ignoreCertificateErrors: false,
    systemTrustChanged: false,
  },
  database: {
    urlProvided: true,
    sourceVariable: databaseVariable,
    childReceivedDatabaseUrlInEnvironment: true,
    cliArgumentsContainCredentials: false,
    urlOrCredentialValueRecorded: false,
  },
  topology: {
    browsers: CLIENT_NAMES,
    isolatedFirefoxProfiles: 2,
    profilesKeptOpenAcrossRestart: true,
    ownedServerProcesses: 2,
    serverHost: "127.0.0.1",
    serverPort: port,
    room: "studio",
    interaction: "one synthetic chat and one feedback event through the normal browser UI; chat text is never retained",
    media: "not exercised in this data persistence slice",
    probes: "two separate raw WSS normal-join probes for startup-A rejection and live-B acceptance",
  },
  startupConfiguration: {
    sameEnvironmentForBothProcesses: true,
    initialMeetingRoomPasswordIsStartupA: true,
    hostToken: "provided in process memory; value not recorded",
    startupPassword: "provided in process memory; value not recorded",
    livePassword: "provided in process memory; value not recorded",
  },
  processRuns: [],
  checks: [],
  phases: {},
  sessions: { beforeRestart: {}, afterResume: {}, sameParticipantIds: false, oldProofsPresentInBrowserMemory: true },
  interactions: {
    syntheticChatSubmitted: false,
    chatTextRecorded: false,
    chatEventId: null,
    chatInteractionId: null,
    feedbackSubmitted: false,
    feedbackEventId: null,
    beforeRestart: {},
    afterResume: {},
    sameChatEventVisible: false,
    feedbackVisibleAtTTL: false,
  },
  gate: {
    livePasswordChangedToB: false,
    resumeFirstRequiredPasswordB: {},
    startupARejected: false,
    liveBAccepted: false,
    rawWssProbeCount: 0,
  },
  hostControl: { claimedBeforeRestart: false, automaticClaimsAfterRestart: 0, manuallyClaimedAfterResume: false, manualActionRoundTrip: false },
  movement: { tested: false, before: null, after: null },
  screenshots: [],
  connections: [],
  errors: { pageErrors: [], socketErrors: [], collectionErrors: [], cleanupErrors: [], failure: null },
  privacy: {
    rawControlPayloadsRetained: false,
    rawMediaPayloadsRetained: false,
    rawChatTextRetained: false,
    browserStorageDumped: false,
    resumeTokensRetained: false,
    databaseUrlRecorded: false,
    configuredSecretsInReport: false,
    finalSecretScanPassed: false,
  },
  limits: {
    restart: "the owned child receives SIGTERM, with bounded SIGKILL fallback only for that same child",
    persistence: "only this room/session/interaction/gate slice is assessed; full product readiness and complete POC-06 remain false",
    browser: "two isolated real Firefox profiles remain open and keep their original session proofs in local browser storage",
    media: "no media source, publish, subscription, codec, quality, weak-network, or endurance behavior is tested here",
    probes: "two short normal-protocol WSS joins; not a multi-browser or load test",
  },
};

function elapsedMs() { return Date.now() - startedAtMs; }

function redact(value) {
  let output = String(value ?? "");
  for (const secret of secretValues) if (secret) output = output.split(secret).join("[redacted]");
  output = output.replace(/("(?:token|password|resumeToken|databaseUrl)"\s*:\s*")[^"]*(")/giu, "$1[redacted]$2");
  output = output.replace(/\b(?:Bearer\s+)?[A-Za-z0-9_-]{48,}\b/gu, "[redacted-token]");
  return output.slice(0, 320);
}

function addBounded(array, value, label, cap = MAX_ERROR_COUNT) {
  if (array.length >= cap) {
    collectionOverflow = true;
    if (!report.errors.collectionErrors.some((item) => item.collection === label && item.code === "cap_reached") &&
        report.errors.collectionErrors.length < MAX_ERROR_COUNT) {
      report.errors.collectionErrors.push({ collection: label, code: "cap_reached", cap });
    }
    return false;
  }
  array.push(value);
  return true;
}

function stage(name, details = {}) {
  if (report.checks.length >= MAX_STAGE_COUNT) throw new Error("The bounded acceptance stage cap was reached.");
  report.checks.push({ name, at: new Date().toISOString(), elapsedMs: elapsedMs(), ...details });
}

function delay(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }

async function waitFor(predicate, label, timeoutMs = WAIT_MS, intervalMs = 25) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await delay(intervalMs);
  }
  throw new Error("Timed out waiting for " + label + " after " + timeoutMs + " ms.");
}

function safeId(value) { return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : null; }
function safeRoom(value) { return value === "studio" || value === "lobby" ? value : null; }
function safeCode(value) { return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(value) ? value : "unknown"; }
function numeric(value) { return Number.isFinite(Number(value)) ? Number(value) : null; }

function summarizeControl(message, direction, connection) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const type = typeof message.type === "string" ? message.type.slice(0, 64) : "unknown";
  const item = { direction, connectionIndex: connection.index, sequence: ++connection.sequence, elapsedMs: elapsedMs(), type };
  const roomId = safeRoom(message.roomId ?? message.room?.id);
  if (roomId) item.roomId = roomId;
  if (type === "join") {
    item.passwordProvided = typeof message.password === "string" && message.password.length > 0;
    item.resumable = message.resumable === true;
  } else if (type === "session.issued") {
    item.tokenPresent = typeof message.token === "string" && message.token.length > 0;
    item.participantId = safeId(message.participantId);
  } else if (type === "session.resume") {
    item.tokenPresent = typeof message.token === "string" && message.token.length > 0;
    item.passwordProvided = typeof message.password === "string" && message.password.length > 0;
  } else if (type === "session.resumed" || type === "participation.self") {
    item.participantId = safeId(message.participantId);
    item.role = message.role === "participant" || message.role === "display" ? message.role : "unknown";
    item.mode = message.mode === "watch" || message.mode === "interaction" ? message.mode : "unknown";
  } else if (type === "room.snapshot") {
    item.locked = Boolean(message.room?.isLocked);
    item.hostControlsEnabled = Boolean(message.room?.hostControlsEnabled);
    item.memberIds = Array.isArray(message.members) ? message.members.map((member) => safeId(member?.id)).filter(Boolean).slice(0, 8) : [];
    item.memberCount = item.memberIds.length;
  } else if (type === "space.snapshot") {
    item.participantId = safeId(message.participantId);
    item.currentRoomId = safeRoom(message.currentRoomId);
    item.seq = Number.isInteger(message.seq) ? message.seq : null;
    item.rooms = Array.isArray(message.rooms) ? message.rooms.filter((room) => safeRoom(room?.id)).map((room) => ({
      id: room.id,
      players: Array.isArray(room.players) ? room.players.map((player) => ({ id: safeId(player?.id), x: numeric(player?.x), y: numeric(player?.y) })).filter((player) => player.id).slice(0, 8) : [],
    })).slice(0, 2) : [];
  } else if (type === "interaction.snapshot" || type === "interaction.state") {
    item.historyCount = Array.isArray(message.history) ? message.history.length : 0;
    item.historyIds = Array.isArray(message.history) ? message.history.map((event) => safeId(event?.id ?? event?.eventId)).filter(Boolean).slice(-MAX_INTERACTION_IDS) : [];
    item.publicQueueCount = Array.isArray(message.publicQueue) ? message.publicQueue.length : numeric(message.queueCount) ?? 0;
    item.feedbackCounts = Object.fromEntries(["like", "want-listen", "useful"].map((key) => [key, numeric(message.feedbackStats?.[key]?.count) ?? 0]));
    item.presentationPaused = Boolean(message.presentation?.paused);
  } else if (type === "interaction.submit") {
    item.kind = ["feedback", "chat", "sticker", "danmaku"].includes(message.kind) ? message.kind : "other";
    item.eventId = safeId(message.eventId);
    item.feedback = ["like", "want-listen", "useful"].includes(message.feedback) ? message.feedback : undefined;
  } else if (type === "interaction.ack") {
    item.eventId = safeId(message.eventId);
    item.interactionId = safeId(message.interactionId ?? message.id);
    item.duplicate = message.duplicate === true;
  } else if (type === "interaction.event") {
    item.eventId = safeId(message.event?.eventId);
    item.interactionId = safeId(message.event?.id);
    item.kind = ["feedback", "chat", "sticker", "danmaku"].includes(message.event?.kind) ? message.event.kind : "other";
    item.feedbackCounts = Object.fromEntries(["like", "want-listen", "useful"].map((key) => [key, numeric(message.state?.feedbackStats?.[key]?.count) ?? 0]));
  } else if (type === "host.claim") {
    item.tokenPresent = typeof message.token === "string" && message.token.length > 0;
  } else if (type === "host.claimed") {
    item.hostClaimed = true;
    item.publisherGrantCount = Array.isArray(message.publisherGrants) ? message.publisherGrants.length : null;
  } else if (type === "host.actionResult") {
    item.action = typeof message.action === "string" && /^[A-Za-z][A-Za-z0-9.]{0,63}$/u.test(message.action) ? message.action : "other";
    for (const key of ["allowed", "isLocked", "paused", "enabled"]) if (typeof message[key] === "boolean") item[key] = message[key];
  } else if (type === "protocol.error" || type === "host.error") {
    item.code = safeCode(message.code);
  } else if (type === "space.move") {
    item.direction = ["up", "down", "left", "right"].includes(message.direction) ? message.direction : "unknown";
  }
  return item;
}

function observeFrame(client, connection, direction, frame) {
  const payload = typeof frame === "string" || Buffer.isBuffer(frame) || frame instanceof Uint8Array ? frame : frame?.payload;
  if (typeof payload !== "string") return;
  let message;
  try { message = JSON.parse(payload); } catch { return; }
  const summary = summarizeControl(message, direction, connection);
  if (summary && !addBounded(connection.controls, summary, client.name + "-controls-" + connection.index, MAX_CONTROLS_PER_CONNECTION)) {
    client.collectionOverflow = true;
  }
}

function currentIdentity(client) {
  const self = latestControl(client, "received", "participation.self");
  const resumed = latestControl(client, "received", "session.resumed");
  const issued = latestControl(client, "received", "session.issued");
  return {
    participantId: self?.participantId ?? resumed?.participantId ?? issued?.participantId ?? null,
    roomId: self?.roomId ?? resumed?.roomId ?? issued?.roomId ?? null,
    role: self?.role ?? resumed?.role ?? issued?.role ?? "unknown",
    mode: self?.mode ?? resumed?.mode ?? issued?.mode ?? "unknown",
    proofPresent: Boolean(issued?.tokenPresent || allControls(client, "received", "session.resumed").length),
  };
}

function installPageObservers(client) {
  client.page.on("websocket", (socket) => {
    if (client.connections.length >= MAX_CONNECTIONS) {
      client.collectionOverflow = true;
      addBounded(report.errors.collectionErrors, { client: client.name, code: "connection_cap_reached" }, "connection-cap-errors");
      return;
    }
    const connection = {
      index: client.connections.length + 1,
      serverPidAtOpen: activeServer?.run.pid ?? null,
      openedAt: new Date().toISOString(),
      openedAtElapsedMs: elapsedMs(),
      closedAt: null,
      sequence: 0,
      controls: [],
      socket,
    };
    client.connections.push(connection);
    client.activeConnection = connection;
    socket.on("framesent", (frame) => observeFrame(client, connection, "sent", frame));
    socket.on("framereceived", (frame) => observeFrame(client, connection, "received", frame));
    socket.on("close", () => { connection.closedAt = new Date().toISOString(); });
    socket.on("socketerror", () => {
      const atElapsedMs = elapsedMs();
      const expected = Boolean(restartWindow && atElapsedMs >= restartWindow.startedAtElapsedMs &&
        (restartWindow.endedAtElapsedMs === null || atElapsedMs <= restartWindow.endedAtElapsedMs) &&
        ["server_stopping", "server_down", "server_starting", "resume_gate", "resuming"].includes(phase));
      addBounded(report.errors.socketErrors, {
        client: client.name,
        connectionIndex: connection.index,
        serverPidAtOpen: connection.serverPidAtOpen,
        at: new Date().toISOString(),
        atElapsedMs,
        phase,
        classification: expected ? "expected-owned-server-restart-window" : "unexpected",
        currentIdentity: currentIdentity(client),
      }, "socket-errors");
      if (!expected) unexpectedSocketErrors += 1;
    });
  });
  client.page.on("pageerror", (error) => {
    addBounded(report.errors.pageErrors, { client: client.name, message: redact(error?.message ?? "page error") }, "page-errors");
  });
}

function controls(client, direction, type, connection = client.activeConnection) {
  return connection ? connection.controls.filter((item) => item.direction === direction && item.type === type) : [];
}

function allControls(client, direction, type) {
  return client.connections.flatMap((connection) => connection.controls.filter((item) => item.direction === direction && item.type === type));
}

async function waitAllControl(client, direction, type, predicate = () => true, label = type, timeoutMs = WAIT_MS, afterElapsedMs = 0) {
  return waitFor(() => allControls(client, direction, type).findLast((item) => item.elapsedMs >= afterElapsedMs && predicate(item)),
    client.name + " " + label, timeoutMs);
}

function latestControl(client, direction, type, predicate = () => true) {
  return client.connections.flatMap((connection) => connection.controls.filter((item) => item.direction === direction && item.type === type))
    .findLast(predicate) ?? null;
}

function latestCurrentConnectionControl(client, direction, type, predicate = () => true) {
  return controls(client, direction, type).findLast(predicate) ?? null;
}

function latestInteractionControl(client, connection = client.activeConnection) {
  if (!connection) return null;
  const base = [
    ...connection.controls.filter((item) => item.direction === "received" && item.type === "interaction.snapshot"),
    ...connection.controls.filter((item) => item.direction === "received" && item.type === "interaction.state"),
  ].sort((left, right) => left.sequence - right.sequence).at(-1) ?? null;
  const event = connection.controls.findLast((item) => item.direction === "received" && item.type === "interaction.event");
  if (!event || (base && event.sequence <= base.sequence)) return base;
  const historyIds = [...(base?.historyIds ?? [])];
  if (event.kind && event.kind !== "feedback" && event.interactionId && !historyIds.includes(event.interactionId)) historyIds.push(event.interactionId);
  return {
    ...(base ?? { historyCount: 0, publicQueueCount: 0, feedbackCounts: {} }),
    elapsedMs: event.elapsedMs,
    sequence: event.sequence,
    historyCount: (base?.historyCount ?? 0) + (event.kind && event.kind !== "feedback" && !base?.historyIds?.includes(event.interactionId) ? 1 : 0),
    historyIds: historyIds.slice(-MAX_INTERACTION_IDS),
    feedbackCounts: event.feedbackCounts ?? base?.feedbackCounts ?? {},
    eventKind: event.kind ?? "unknown",
    eventId: event.interactionId ?? null,
  };
}

async function assertPortFree() {
  const checkBind = (host, allowUnavailable = false) => new Promise((resolvePromise, reject) => {
    const probe = createServer();
    probe.once("error", (error) => {
      if (error?.code === "EADDRINUSE") reject(new Error("Refusing to start: local port " + port + " is already occupied on " + host + ". This script never stops an existing service."));
      else if (allowUnavailable && ["EADDRNOTAVAIL", "EAFNOSUPPORT"].includes(error?.code)) resolvePromise();
      else reject(error);
    });
    probe.listen({ host, port, exclusive: true }, () => probe.close((error) => error ? reject(error) : resolvePromise()));
  });
  await checkBind("127.0.0.1");
  if (target.hostname === "localhost") await checkBind("::1", true);
  const existing = await requestJson("/api/health", 900).catch(() => null);
  if (existing?.statusCode === 200 && existing.body?.status === "ok") {
    throw new Error("Refusing to start: a trusted HTTPS application already responds on this port. This script never stops an existing service.");
  }
}

function requestJson(pathname, timeoutMs = 2_000) {
  return new Promise((resolvePromise, reject) => {
    const request = httpsGet(new URL(pathname, target.origin), { ca: caPem, rejectUnauthorized: true }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; if (body.length > 32_768) request.destroy(new Error("Local health response exceeded its bounded size.")); });
      response.on("end", () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch { /* non-JSON response */ }
        resolvePromise({ statusCode: response.statusCode, body: parsed });
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("Trusted local HTTPS request timed out.")));
    request.on("error", reject);
  });
}

function serverEnvironment() {
  const env = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "SYSTEMROOT", "WINDIR"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  Object.assign(env, {
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    HOST_CONTROL_TOKEN: hostToken,
    MEETING_ROOM_PASSWORD: startupPassword,
    TLS_CERT_FILE: tlsCertificate,
    TLS_KEY_FILE: tlsKey,
    DATABASE_URL: databaseUrl,
  });
  return env;
}

async function assertHealthAndRooms(label, expectedPersistence = "postgresql") {
  const health = await requestJson("/api/health");
  assert.equal(health.statusCode, 200);
  assert.equal(health.body?.status, "ok");
  assert.equal(health.body?.persistence, expectedPersistence, "The app health endpoint should accurately identify PostgreSQL persistence.");
  const rooms = await requestJson("/api/rooms");
  assert.equal(rooms.statusCode, 200);
  assert.ok(Array.isArray(rooms.body));
  assert.deepEqual(rooms.body.map((room) => room.id), ["lobby", "studio"]);
  const studio = rooms.body.find((room) => room.id === "studio");
  assert.ok(studio?.isLocked && studio.hostControlsEnabled, "The managed studio should remain locked after each server startup.");
  const evidence = { persistence: health.body.persistence, roomIds: rooms.body.map((room) => room.id), studioLocked: studio.isLocked, hostControlsEnabled: studio.hostControlsEnabled };
  if (label === "initial") evidence.startupPasswordSource = "A";
  report.processRuns.at(-1).startupHealthy = true;
  report.processRuns.at(-1).persistence = health.body.persistence;
  report.processRuns.at(-1).staticRoomConfiguration = { roomIds: evidence.roomIds, studioLocked: true, hostControlsEnabled: true };
  stage(label + "-trusted-health-and-static-rooms", evidence);
  return evidence;
}

async function launchOwnedServer(label) {
  await assertPortFree();
  const child = spawn(process.execPath, [serverEntry], { cwd: root, env: serverEnvironment(), stdio: "ignore", windowsHide: true });
  const run = {
    label,
    pid: child.pid ?? null,
    startedAt: new Date().toISOString(),
    readyAt: null,
    endedAt: null,
    stopMode: null,
    signalSent: null,
    exitCode: null,
    exitSignal: null,
    ownedChild: true,
    sameStartupConfiguration: true,
    databaseUrlPassedInEnvironment: true,
    databaseUrlRecorded: false,
  };
  report.processRuns.push(run);
  const exited = new Promise((resolvePromise) => child.once("exit", (code, signal) => resolvePromise({ code, signal })));
  child.once("error", () => { run.spawnError = true; });
  activeServer = { child, run, exited };
  if (!run.pid) throw new Error("Owned server child did not expose a PID; no process was signaled.");
  const health = await waitFor(async () => {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("The owned server child exited before the trusted health check passed.");
    try {
      const response = await requestJson("/api/health", 1_500);
      if (response.statusCode === 200 && response.body?.status === "ok" && response.body?.persistence === "postgresql") return response.body;
    } catch { /* expected while the owned listener is starting */ }
    return false;
  }, label + " PostgreSQL health", 15_000, 150);
  run.readyAt = new Date().toISOString();
  run.persistence = health.persistence;
  return activeServer;
}

async function stopOwnedServer(reason) {
  const owned = activeServer;
  if (!owned) return null;
  const { child, run, exited } = owned;
  if (child.exitCode !== null || child.signalCode !== null) {
    const exit = await exited;
    run.stopMode = "already-exited";
    run.exitCode = exit.code;
    run.exitSignal = exit.signal;
    run.endedAt = new Date().toISOString();
    activeServer = null;
    return run;
  }
  run.stopRequestedAt = new Date().toISOString();
  run.stopReason = reason;
  phase = "server_stopping";
  run.signalSent = "SIGTERM";
  run.stopMode = "SIGTERM";
  child.kill("SIGTERM");
  let exit = await Promise.race([exited, delay(PROCESS_TERM_WAIT_MS).then(() => null)]);
  if (!exit) {
    run.stopMode = "SIGKILL-fallback";
    run.signalSent = "SIGTERM then SIGKILL";
    child.kill("SIGKILL");
    exit = await Promise.race([exited, delay(PROCESS_KILL_WAIT_MS).then(() => null)]);
  }
  run.endedAt = new Date().toISOString();
  if (exit) {
    run.exitCode = exit.code;
    run.exitSignal = exit.signal;
    run.exitedWithinBound = true;
  } else {
    run.exitedWithinBound = false;
    addBounded(report.errors.cleanupErrors, { processPid: run.pid, code: "owned_child_exit_timeout" }, "cleanup-errors");
    throw new Error("The script-owned server child did not exit within the bounded SIGTERM/SIGKILL wait.");
  }
  activeServer = null;
  return run;
}

function createTrustedProfile(name) {
  const folder = join(runDirectory, "runtime-" + name);
  const profileDirectory = join(folder, "profile");
  mkdirSync(profileDirectory, { recursive: true, mode: 0o700 });
  execFileSync(certificateUtility, ["-N", "-d", "sql:" + profileDirectory, "--empty-password"], { stdio: "pipe" });
  execFileSync(certificateUtility, ["-A", "-d", "sql:" + profileDirectory, "-n", "LaiTse local development CA", "-t", "C,,", "-i", caCertificate], { stdio: "pipe" });
  const appData = join(folder, "app-data");
  const localAppData = join(folder, "local-app-data");
  mkdirSync(appData, { recursive: true, mode: 0o700 });
  mkdirSync(localAppData, { recursive: true, mode: 0o700 });
  const profile = { folder, profileDirectory, appData, localAppData };
  profiles.push(profile);
  return profile;
}

function browserEnvironment(profile) {
  const env = { ...process.env, MOZ_APP_DATA: profile.appData, MOZ_LOCAL_APP_DATA: profile.localAppData };
  for (const key of Object.keys(env)) {
    if (key.startsWith("PG_BROWSER_") || key.startsWith("RESTART_TEST_") ||
        ["DATABASE_URL", "HOST_CONTROL_TOKEN", "MEETING_ROOM_PASSWORD", "TLS_CERT_FILE", "TLS_KEY_FILE"].includes(key)) delete env[key];
  }
  return env;
}

async function launchClient(name) {
  const profile = createTrustedProfile(name);
  const context = await firefox.launchPersistentContext(profile.profileDirectory, {
    headless,
    env: browserEnvironment(profile),
    viewport: { width: 1440, height: 1050 },
    colorScheme: "light",
    firefoxUserPrefs: { "security.enterprise_roots.enabled": false },
  });
  context.setDefaultTimeout(8_000);
  contexts.push(context);
  const page = context.pages()[0] ?? await context.newPage();
  const client = { name, context, page, connections: [], activeConnection: null, collectionOverflow: false, navigationCount: 0 };
  clients.set(name, client);
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame() && frame.url().startsWith(target.origin)) client.navigationCount += 1;
  });
  await page.addInitScript(() => { globalThis.__pgRestartDocumentIdentity = crypto.randomUUID(); });
  installPageObservers(client);
  return client;
}

async function openRoom(client, displayName) {
  const page = client.page;
  await page.goto(target.origin + "/?room=studio", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Local room presence" }).waitFor();
  await page.getByLabel("Your display name").fill(displayName);
  const joinedAt = elapsedMs();
  const connectionCount = client.connections.length;
  await page.getByRole("button", { name: "Join room", exact: true }).click();
  await waitFor(() => client.connections.length > connectionCount, client.name + " entry WebSocket");
  await waitAllControl(client, "received", "protocol.error", (item) => item.code === "room_password_required", client.name + " startup room gate", WAIT_MS, joinedAt);
  await page.getByLabel("Meeting room password").waitFor({ state: "visible" });
  await page.locator("#meeting-room-password").fill(startupPassword);
  await page.getByRole("button", { name: "Enter room", exact: true }).click();
  await page.getByText("Connected to Meeting room", { exact: true }).waitFor();
  await page.locator('[data-testid="participation-controls"]').waitFor();
  await waitAllControl(client, "received", "room.snapshot", (item) => item.roomId === "studio", "startup-A room snapshot", WAIT_MS, joinedAt);
  await waitAllControl(client, "received", "participation.self", (item) => Boolean(item.participantId), "participation identity", WAIT_MS, joinedAt);
  await waitAllControl(client, "received", "interaction.snapshot", () => true, "initial interaction snapshot", WAIT_MS, joinedAt);
  const identity = currentIdentity(client);
  assert.ok(identity.participantId, client.name + " should have a server-issued participant ID.");
  assert.equal(identity.roomId, "studio");
  assert.equal(identity.role, "participant");
  return identity;
}

async function claimHost(client, label) {
  const before = allControls(client, "received", "host.claimed").length;
  const tokenInput = client.page.getByTestId("host-control-token");
  await tokenInput.fill(hostToken);
  await client.page.getByTestId("host-claim").click();
  await waitFor(() => allControls(client, "received", "host.claimed").length > before, label + " host claim acknowledgment");
  await client.page.getByTestId("host-state").filter({ hasText: "HOST" }).waitFor();
  report.hostControl.claimedBeforeRestart = report.hostControl.claimedBeforeRestart || label === "initial";
  return latestControl(client, "received", "host.claimed");
}

async function changeLivePassword(host) {
  const before = allControls(host, "received", "host.actionResult").length;
  await host.page.getByTestId("host-meeting-password").fill(livePassword);
  await host.page.getByTestId("host-lock-room").click();
  const result = await waitFor(() => allControls(host, "received", "host.actionResult").slice(before).find((item) => item.action === "setMeetingRoomPassword"), "live room password B change");
  assert.equal(result.isLocked, true);
  assert.equal(await host.page.getByTestId("host-meeting-password").inputValue(), "", "The live password input should be cleared after save.");
  report.gate.livePasswordChangedToB = true;
  return result;
}

async function sendFeedback(guest) {
  const before = allControls(guest, "received", "interaction.ack").length;
  await guest.page.getByTestId("feedback-like").click();
  const ack = await waitFor(() => allControls(guest, "received", "interaction.ack").slice(before).find((item) => item.eventId || item.interactionId), "feedback acknowledgment");
  assert.ok(ack.eventId || ack.interactionId);
  await guest.page.waitForFunction(() => {
    const text = document.querySelector('[data-testid="feedback-like"] .interaction-feedback-count')?.textContent ?? "";
    return Number(/^\s*(\d+)/u.exec(text)?.[1] ?? 0) >= 1;
  });
  report.interactions.feedbackSubmitted = true;
  report.interactions.feedbackEventId = ack.eventId ?? ack.interactionId;
}

async function sendChat(guest, host) {
  syntheticChatText = "PG persistence smoke " + randomUUID();
  secretValues.add(syntheticChatText);
  const before = allControls(guest, "received", "interaction.ack").length;
  await guest.page.getByTestId("chat-input").fill(syntheticChatText);
  await guest.page.getByTestId("chat-send").click();
  const ack = await waitFor(() => allControls(guest, "received", "interaction.ack").slice(before).find((item) => item.eventId || item.interactionId), "chat acknowledgment");
  report.interactions.chatEventId = ack.eventId ?? null;
  report.interactions.chatInteractionId = ack.interactionId ?? null;
  assert.ok(report.interactions.chatEventId && report.interactions.chatInteractionId, "The chat should have client event and server interaction identifiers.");
  await waitFor(async () => (await domInteractionState(guest.page)).items.some((item) => item.id === report.interactions.chatInteractionId), "chat appears in guest DOM");
  await waitFor(async () => (await domInteractionState(host.page)).items.some((item) => item.id === report.interactions.chatInteractionId), "chat appears in host DOM");
  assert.equal(await guest.page.getByTestId("chat-input").inputValue(), "", "The chat compose field should be clear after submit.");
  report.interactions.syntheticChatSubmitted = true;
}

async function domInteractionState(page) {
  return page.evaluate(() => {
    const items = [...document.querySelectorAll('li[data-testid="interaction-item"]')].map((element) => {
      const kindElement = element.querySelector(".interaction-kind-mark");
      const kindClass = [...(kindElement?.classList ?? [])].find((name) => name.startsWith("interaction-kind-") && name !== "interaction-kind-mark") ?? "";
      return { id: element.getAttribute("data-interaction-id"), kind: kindClass.replace("interaction-kind-", "") };
    });
    const feedback = document.querySelector('[data-testid="feedback-like"] .interaction-feedback-count')?.textContent ?? "";
    const paused = document.querySelector('[data-testid="presentation-state"]')?.classList.contains("is-paused") ?? false;
    return { items, historyCount: items.length, feedbackCount: Number(/^\s*(\d+)/u.exec(feedback)?.[1] ?? 0), presentationPaused: paused };
  });
}

async function saveScreenshot(client, fileName, label) {
  for (const input of await client.page.locator('input[type="password"]').all()) {
    assert.equal(await input.inputValue(), "", "Password inputs must be blank before screenshot capture.");
  }
  await client.page.screenshot({
    path: join(runDirectory, fileName),
    fullPage: true,
    animations: "disabled",
    timeout: 8_000,
    mask: [client.page.locator('[data-testid="interaction-item"] .interaction-history-copy')],
    maskColor: "#d3d3d3",
  });
  report.screenshots.push({ label, file: fileName, client: client.name, chatTextMasked: true, passwordInputsBlank: true });
}

async function resumeWithCurrentGate(client, expectedParticipantId, restartStartedAt) {
  phase = "resume_gate";
  const required = await waitAllControl(client, "received", "protocol.error", (item) => item.code === "room_password_required", client.name + " room_password_required on saved-session resume", WAIT_MS, restartStartedAt);
  report.gate.resumeFirstRequiredPasswordB[client.name] = { errorCode: required.code, requiredPassword: true, valueRecorded: false };
  await client.page.getByLabel("Meeting room password").waitFor({ state: "visible" });
  await client.page.locator("#meeting-room-password").fill(livePassword);
  const retryStartedAt = elapsedMs();
  await client.page.getByRole("button", { name: "Enter room", exact: true }).click();
  phase = "resuming";
  const resume = await waitAllControl(client, "sent", "session.resume", (item) => item.passwordProvided && item.elapsedMs >= retryStartedAt, client.name + " session.resume with B", WAIT_MS, retryStartedAt);
  assert.equal(resume.tokenPresent, true, "The original session proof should remain present in the browser client.");
  const restored = await waitAllControl(client, "received", "session.resumed", (item) => item.participantId === expectedParticipantId, client.name + " same participant ID restored from PostgreSQL", WAIT_MS, retryStartedAt);
  assert.equal(restored.roomId, "studio");
  const freshRoom = await waitFor(() => client.activeConnection && controls(client, "received", "room.snapshot", client.activeConnection).find((item) => item.roomId === "studio"), client.name + " fresh room snapshot");
  assert.equal(freshRoom.locked, true, client.name + " should resume into the persisted locked studio.");
  await waitFor(() => latestCurrentConnectionControl(client, "received", "participation.self", (item) => item.participantId === expectedParticipantId), client.name + " fresh self identity");
  await waitFor(() => controls(client, "received", "interaction.snapshot", client.activeConnection).length > 0, client.name + " fresh interaction snapshot");
  await client.page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(await client.page.getByTestId("host-state").innerText(), "MANAGED", "The old host claim must not survive the session resume.");
  const sinceRestart = (type) => allControls(client, "sent", type).filter((item) => item.elapsedMs >= restartStartedAt).length;
  assert.equal(sinceRestart("join"), 0, client.name + " must not auto-join anonymously.");
  assert.equal(sinceRestart("host.claim"), 0, client.name + " must not auto-claim host.");
  assert.equal(sinceRestart("audio.start") + sinceRestart("screen.start"), 0, client.name + " must not auto-start publishing.");
  assert.equal(sinceRestart("audio.subscribe") + sinceRestart("screen.subscribe"), 0, client.name + " must not auto-subscribe media.");
  return { restored, freshRoom, freshSelf: latestCurrentConnectionControl(client, "received", "participation.self") };
}

async function openRawProbe() {
  const socket = new WebSocket(new URL("/ws", target.origin), { ca: caPem, rejectUnauthorized: true, origin: target.origin });
  probes.add(socket);
  const received = [];
  socket.on("message", (payload) => {
    if (typeof payload !== "string" && !Buffer.isBuffer(payload)) return;
    try {
      const message = JSON.parse(String(payload));
      if (message && typeof message.type === "string") {
        if (received.length >= 24) {
          collectionOverflow = true;
          addBounded(report.errors.collectionErrors, { collection: "raw-wss-probe-controls", code: "cap_reached", cap: 24 }, "probe-control-cap-errors");
          return;
        }
        received.push({ type: message.type.slice(0, 64), code: safeCode(message.code), roomId: safeRoom(message.roomId ?? message.room?.id) });
      }
    } catch { /* raw control payloads are discarded */ }
  });
  socket.on("error", () => {});
  await new Promise((resolvePromise, reject) => {
    socket.once("open", resolvePromise);
    socket.once("error", reject);
  });
  return { socket, received };
}

async function closeRawProbe(socket) {
  try {
    if (socket.readyState !== WebSocket.CLOSED) {
      const closed = new Promise((resolvePromise) => socket.once("close", resolvePromise));
      socket.close(1000, "PG browser gate probe complete");
      await Promise.race([closed, delay(1_500)]);
      if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
    }
  } finally {
    probes.delete(socket);
  }
}

async function probePassword(label, password, expectAccepted) {
  const { socket, received } = await openRawProbe();
  try {
    socket.send(JSON.stringify({ type: "join", roomId: "studio", displayName: "PG gate " + label, role: "participant", mode: "watch", resumable: false, password }));
    let evidence;
    if (expectAccepted) {
      await waitFor(() => received.some((item) => item.type === "room.snapshot" && item.roomId === "studio"), "live-B raw WSS room entry");
      evidence = { label, joinAccepted: true, roomSnapshotReceived: true, rejectionCode: null, passwordValueRecorded: false };
    } else {
      await waitFor(() => received.some((item) => item.type === "protocol.error"), "startup-A raw WSS rejection");
      const rejection = received.findLast((item) => item.type === "protocol.error");
      assert.equal(rejection.code, "room_password_incorrect", "Startup password A should fail against the persisted live password B.");
      assert.equal(received.some((item) => item.type === "room.snapshot"), false, "Rejected startup password A must not create a room membership.");
      evidence = { label, joinAccepted: false, roomSnapshotReceived: false, rejectionCode: rejection.code, passwordValueRecorded: false };
    }
    report.gate.rawWssProbeCount += 1;
    return evidence;
  } finally {
    await closeRawProbe(socket);
  }
}

async function claimAndOperateAfterResume(host, restartStartedAt) {
  const beforeClaimed = allControls(host, "received", "host.claimed").length;
  await host.page.getByTestId("host-control-token").fill(hostToken);
  await host.page.getByTestId("host-claim").click();
  await waitFor(() => allControls(host, "received", "host.claimed").length > beforeClaimed, "manual post-resume host claim");
  await host.page.getByTestId("host-state").filter({ hasText: "HOST" }).waitFor();
  report.hostControl.automaticClaimsAfterRestart = allControls(host, "received", "host.claimed").filter((item) => item.elapsedMs >= restartStartedAt).length - 1;
  assert.equal(report.hostControl.automaticClaimsAfterRestart, 0, "Only the explicit manual reclaim may claim host after restart.");
  report.hostControl.manuallyClaimedAfterResume = true;
  const pauseBefore = allControls(host, "received", "host.actionResult").length;
  await host.page.getByTestId("interaction-pause").click();
  const paused = await waitFor(() => allControls(host, "received", "host.actionResult").slice(pauseBefore).find((item) => item.action === "interaction.setPaused" && item.paused === true), "manual host pause action");
  const resumeBefore = allControls(host, "received", "host.actionResult").length;
  await host.page.getByTestId("interaction-pause").click();
  const unpaused = await waitFor(() => allControls(host, "received", "host.actionResult").slice(resumeBefore).find((item) => item.action === "interaction.setPaused" && item.paused === false), "manual host unpause action");
  assert.ok(paused && unpaused);
  report.hostControl.manualActionRoundTrip = true;
  await host.page.getByTestId("host-management-status").waitFor();
}

async function finalReport() {
  report.finishedAt = new Date().toISOString();
  report.durationMs = elapsedMs();
  report.errors.failure = failure ? redact(failure?.message ?? failure) : null;
  if (collectionOverflow) {
    failure ??= new Error("A bounded evidence collection reached its cap.");
    report.errors.failure = redact(failure.message);
  }
  if (report.errors.pageErrors.length || report.errors.cleanupErrors.length || unexpectedSocketErrors > 0) {
    failure ??= new Error("Page, cleanup, or unexpected socket errors were observed.");
    report.errors.failure = redact(failure.message);
  }
  report.connections = [...clients.values()].map((client) => ({
    client: client.name,
    finalIdentity: currentIdentity(client),
    connections: client.connections.map(({ index, serverPidAtOpen, openedAt, openedAtElapsedMs, closedAt, controls: entries }) => ({
      index, serverPidAtOpen, openedAt, openedAtElapsedMs, closedAt, controls: entries,
    })),
  }));
  const beforeIds = report.sessions.beforeRestart;
  const afterIds = report.sessions.afterResume;
  report.sessions.sameParticipantIds = CLIENT_NAMES.every((name) => beforeIds[name]?.participantId && beforeIds[name].participantId === afterIds[name]?.participantId);
  report.operationalPass = !failure && report.processRuns.length === 2 && report.processRuns[0].pid !== report.processRuns[1].pid && report.sessions.sameParticipantIds;
  report.dataSlicePass = report.operationalPass && report.interactions.sameChatEventVisible && report.interactions.feedbackVisibleAtTTL &&
    report.gate.startupARejected && report.gate.liveBAccepted && report.hostControl.manualActionRoundTrip;
  report.status = report.dataSlicePass ? "passed" : "failed";
  report.conclusion = report.dataSlicePass
    ? "PostgreSQL data slice passed: same sessions, interaction records, and live gate survived an owned process restart. Full POC and product readiness remain unproven."
    : "PostgreSQL data slice failed or incomplete; full POC and product readiness remain unproven.";
  report.privacy.configuredSecretsInReport = [...secretValues].some((secret) => secret && JSON.stringify(report).includes(secret));
  if (report.privacy.configuredSecretsInReport) {
    report.status = "failed";
    report.dataSlicePass = false;
    report.operationalPass = false;
    report.privacy.configuredSecretsInReport = true;
    report.errors.failure = "A configured secret appeared in the report and was redacted before saving.";
  }
  report.privacy.finalSecretScanPassed = !report.privacy.configuredSecretsInReport;
  let serialized = JSON.stringify(report, null, 2) + "\n";
  for (const secret of secretValues) if (secret) serialized = serialized.split(secret).join("[redacted]");
  const reportPath = join(runDirectory, "report.json");
  writeFileSync(reportPath, serialized, { mode: 0o600 });
  writeFileSync(join(runDirectory, "README.md"), [
    "# PostgreSQL browser restart smoke",
    "",
    "Data slice: " + report.status,
    "Operational process/session result: " + (report.operationalPass ? "passed" : "failed or incomplete"),
    "Full POC pass: false",
    "Product ready: false",
    "",
    "Two isolated trusted Firefox profiles kept their original pages and session proofs open across two script-owned application processes. The report stores only allowlisted control metadata, session and interaction IDs, counts, gate outcomes, and process PIDs. It contains no database URL, passwords, resume tokens, chat text, or raw control/media payloads. Screenshot chat text is masked.",
    "",
    "This is a small PostgreSQL persistence data slice. It does not test media, quality, scale, mobile, weak networks, endurance, cloud deployment, or full POC/product readiness.",
    "",
    "Screenshots: " + report.screenshots.map((item) => item.file).join(", "),
    "Failure: " + (report.errors.failure ?? "none"),
    "",
  ].join("\n"), { mode: 0o600 });
  console.log("[PG-BROWSER] " + report.status + " operational=" + report.operationalPass + " fullPOC=false report=" + reportPath);
}

try {
  assert.ok(caPem.includes(Buffer.from("BEGIN CERTIFICATE")), "Trusted CA file should contain a PEM certificate.");
  phase = "preflight";
  await assertPortFree();
  const [host, guest] = await Promise.all(CLIENT_NAMES.map(launchClient));
  report.runtime.firefox = host.context.browser()?.version() ?? "not-reported";

  phase = "initial_server";
  await launchOwnedServer("initial");
  await assertHealthAndRooms("initial");

  phase = "normal_join";
  for (const [client, displayName] of [[host, "PG browser host"], [guest, "PG browser guest"]]) {
    report.sessions.beforeRestart[client.name] = await openRoom(client, displayName);
    assert.equal(latestControl(client, "received", "room.snapshot")?.locked, true);
  }
  stage("host-and-guest-joined-startup-A-gated-studio", { participantIdsRecorded: true, passwordValueRecorded: false });

  phase = "host_claim";
  await claimHost(host, "initial");
  await sendFeedback(guest);
  await sendChat(guest, host);
  await waitFor(() => (latestInteractionControl(host)?.feedbackCounts?.like ?? 0) >= 1, "host current interaction state with feedback");
  await waitFor(() => (latestInteractionControl(guest)?.historyIds ?? []).includes(report.interactions.chatInteractionId), "guest current interaction snapshot with chat id");
  report.interactions.beforeRestart = {
    host: await domInteractionState(host.page),
    guest: await domInteractionState(guest.page),
    hostInteractionSnapshot: latestInteractionControl(host),
    guestInteractionSnapshot: latestInteractionControl(guest),
  };
  assert.ok(report.interactions.beforeRestart.host.items.some((item) => item.id === report.interactions.chatInteractionId));
  assert.ok(report.interactions.beforeRestart.guest.items.some((item) => item.id === report.interactions.chatInteractionId));
  assert.equal(report.interactions.beforeRestart.guest.feedbackCount, 1);
  assert.equal(report.interactions.chatTextRecorded, false);

  phase = "live_gate_B";
  await changeLivePassword(host);
  const beforeIdentity = Object.fromEntries(CLIENT_NAMES.map((name) => [name, currentIdentity(clients.get(name))]));
  report.sessions.beforeRestart = beforeIdentity;
  report.sessions.beforeRestartState = Object.fromEntries(CLIENT_NAMES.map((name) => [name, {
    identity: currentIdentity(clients.get(name)),
    interaction: report.interactions.beforeRestart[name],
    hostClaimed: name === "host" && latestControl(host, "received", "host.claimed")?.hostClaimed === true,
  }]));
  await saveScreenshot(guest, "before-restart-interactions.png", "before-restart-chat-and-feedback-visible");
  await saveScreenshot(host, "before-restart-host-live-B.png", "before-restart-live-B-host-claimed");
  stage("chat-feedback-and-live-B-visible-before-restart", {
    chatIdentifiersRecorded: true,
    chatTextRetained: false,
    feedbackCount: report.interactions.beforeRestart.guest.feedbackCount,
    hostClaimed: true,
    livePasswordBSet: true,
  });

  phase = "restart_begin";
  const restartStartedAt = elapsedMs();
  restartWindow = { startedAtElapsedMs: restartStartedAt, endedAtElapsedMs: null };
  report.phases.restartStartedAt = new Date().toISOString();
  report.phases.browserPagesRemainOpen = true;
  report.phases.browserNavigationCountBeforeRestart = Object.fromEntries(CLIENT_NAMES.map((name) => [name, clients.get(name).navigationCount]));
  report.phases.documentsBeforeRestart = Object.fromEntries(await Promise.all(CLIENT_NAMES.map(async (name) => [name, await clients.get(name).page.evaluate(() => ({ id: globalThis.__pgRestartDocumentIdentity, timeOrigin: performance.timeOrigin }))])));
  const oldPid = activeServer?.run.pid ?? null;
  await stopOwnedServer("PG-BROWSER controlled SIGTERM restart with both Firefox session pages open");
  const downStartedAt = elapsedMs();
  phase = "server_down";
  await delay(Math.max(0, RESTART_DOWN_MS - (elapsedMs() - downStartedAt)));
  assert.equal(await requestJson("/api/health", 500).then(() => true).catch(() => false), false, "Trusted HTTPS health should be unavailable during the owned-process down window.");
  stage("owned-process-stopped-with-original-firefox-pages-open", { pid: oldPid, stopMode: report.processRuns[0].stopMode, downWindowMsAtLeast: RESTART_DOWN_MS });

  phase = "server_starting";
  await launchOwnedServer("restarted");
  await assertHealthAndRooms("restarted");
  phase = "resume_gate";
  const restoredResults = await Promise.all(CLIENT_NAMES.map((name) => resumeWithCurrentGate(clients.get(name), beforeIdentity[name].participantId, restartStartedAt)));
  restartWindow.endedAtElapsedMs = elapsedMs();
  report.phases.resumeWindow = { startedAtElapsedMs: restartWindow.startedAtElapsedMs, endedAtElapsedMs: restartWindow.endedAtElapsedMs };
  report.sessions.afterResume = Object.fromEntries(CLIENT_NAMES.map((name) => [name, currentIdentity(clients.get(name))]));
  report.phases.browserNavigationCountAfterResume = Object.fromEntries(CLIENT_NAMES.map((name) => [name, clients.get(name).navigationCount]));
  report.phases.documentsAfterResume = Object.fromEntries(await Promise.all(CLIENT_NAMES.map(async (name) => [name, await clients.get(name).page.evaluate(() => ({ id: globalThis.__pgRestartDocumentIdentity, timeOrigin: performance.timeOrigin }))])));
  assert.deepEqual(report.phases.documentsAfterResume, report.phases.documentsBeforeRestart, "Original document identity and performance.timeOrigin must survive; frame URL events also include history.replaceState.");
  assert.ok(Object.values(report.phases.documentsAfterResume).every((state) => state.id && Number.isFinite(state.timeOrigin)));
  assert.equal(report.sessions.afterResume.host.participantId, beforeIdentity.host.participantId);
  assert.equal(report.sessions.afterResume.guest.participantId, beforeIdentity.guest.participantId);
  assert.equal(restoredResults.length, 2);
  report.hostControl.automaticClaimsAfterRestart = allControls(host, "received", "host.claimed").filter((item) => item.elapsedMs >= restartStartedAt).length;
  assert.equal(report.hostControl.automaticClaimsAfterRestart, 0);

  for (const client of clients.values()) {
    const state = await domInteractionState(client.page);
    const interactionControl = latestCurrentConnectionControl(client, "received", "interaction.snapshot");
    const stateControl = latestCurrentConnectionControl(client, "received", "interaction.state");
    const control = stateControl && (!interactionControl || stateControl.elapsedMs > interactionControl.elapsedMs) ? stateControl : interactionControl;
    const phaseState = {
      identity: currentIdentity(client),
      room: latestCurrentConnectionControl(client, "received", "room.snapshot"),
      participation: latestCurrentConnectionControl(client, "received", "participation.self"),
      interaction: control ? { historyCount: control.historyCount, historyIds: control.historyIds, feedbackCounts: control.feedbackCounts } : null,
      dom: state,
      hostClaimed: client.name === "host" && await client.page.getByTestId("host-state").innerText() === "HOST",
    };
    report.phases.afterResume = report.phases.afterResume ?? {};
    report.phases.afterResume[client.name] = phaseState;
    report.interactions.afterResume[client.name] = state;
    assert.ok(state.items.some((item) => item.id === report.interactions.chatInteractionId), client.name + " should still render the same chat item ID after restart.");
    assert.equal(state.feedbackCount, report.interactions.beforeRestart[client.name].feedbackCount, client.name + " feedback count should remain visible inside the live feedback TTL.");
  }
  report.interactions.sameChatEventVisible = true;
  report.interactions.feedbackVisibleAtTTL = true;
  await saveScreenshot(guest, "after-resume-chat-and-feedback.png", "after-resume-same-chat-and-feedback-visible");
  await saveScreenshot(host, "after-resume-before-manual-host-claim.png", "after-resume-host-not-automatically-claimed");
  stage("same-session-ids-chat-and-feedback-restored-with-B-gate", {
    sameParticipantIds: true,
    oldProofsPresentInBrowserMemory: true,
    requiredPasswordBOnResume: true,
    sameChatInteractionIdVisible: true,
    feedbackCountRestored: true,
    hostAutoClaimCount: 0,
    publisherAndSubscriptionControlsNotExercised: true,
  });

  phase = "password_probes";
  const startupRejected = await probePassword("startup-A", startupPassword, false);
  report.gate.startupARejected = true;
  report.gate.startupProbe = startupRejected;
  const liveAccepted = await probePassword("live-B", livePassword, true);
  report.gate.liveBAccepted = true;
  report.gate.liveProbe = liveAccepted;
  stage("separate-raw-WSS-probes-confirm-startup-A-rejected-and-live-B-accepted", { probeCount: report.gate.rawWssProbeCount, startupARejected: true, liveBAccepted: true });

  phase = "manual_host_reclaim";
  await claimAndOperateAfterResume(host, restartStartedAt);
  await saveScreenshot(host, "after-manual-host-reclaim.png", "after-manual-host-reclaim-action-works");
  stage("manual-host-reclaim-and-action-round-trip", { automaticClaimsAfterRestart: 0, manualClaimed: true, actionRoundTrip: true });

  phase = "complete";
  report.phases.processRestart = {
    oldPid: report.processRuns[0].pid,
    newPid: report.processRuns[1].pid,
    oldPidDifferentFromNewPid: report.processRuns[0].pid !== report.processRuns[1].pid,
    oldStopMode: report.processRuns[0].stopMode,
    oldSignalSent: report.processRuns[0].signalSent,
    downtimeMs: Date.parse(report.processRuns[1].startedAt) - Date.parse(report.processRuns[0].endedAt),
    browserPagesStayedOpen: true,
    frameUrlEventsAfterResume: report.phases.browserNavigationCountAfterResume,
    sameDocumentsVerified: true,
  };
  assert.notEqual(report.processRuns[0].pid, report.processRuns[1].pid);
  assert.equal(report.processRuns[0].stopMode, "SIGTERM");
  assert.equal(unexpectedSocketErrors, 0);
  assert.equal(report.gate.rawWssProbeCount, 2);
  stage("postgresql-persistence-data-slice-complete-full-POC-remains-false", { dataSlicePass: true, fullPOCPass: false, productReady: false });
} catch (error) {
  failure = error;
  console.error("[PG-BROWSER] failure: " + redact(error?.message ?? error));
} finally {
  for (const probe of [...probes]) {
    try { await closeRawProbe(probe); }
    catch (error) { addBounded(report.errors.cleanupErrors, { code: "raw_probe_close_failed", message: redact(error?.message ?? error) }, "cleanup-errors"); }
  }
  for (const context of contexts.reverse()) {
    try { await context.close(); }
    catch (error) { addBounded(report.errors.cleanupErrors, { code: "firefox_context_close_failed", message: redact(error?.message ?? error) }, "cleanup-errors"); }
  }
  try { if (activeServer) await stopOwnedServer("final cleanup of this script-owned child"); }
  catch (error) { addBounded(report.errors.cleanupErrors, { code: "owned_server_cleanup_failed", message: redact(error?.message ?? error) }, "cleanup-errors"); }
  for (const profile of profiles) {
    try { rmSync(profile.folder, { recursive: true, force: true }); }
    catch (error) { addBounded(report.errors.cleanupErrors, { code: "profile_cleanup_failed", message: redact(error?.message ?? error) }, "cleanup-errors"); }
  }
  try { await finalReport(); }
  catch (error) {
    console.error("[PG-BROWSER] report write failure: " + redact(error?.message ?? error));
    process.exitCode = 1;
  }
}

if (report.status !== "passed") process.exitCode = 1;
