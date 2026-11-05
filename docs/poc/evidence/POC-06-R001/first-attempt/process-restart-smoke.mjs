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
const hostToken = process.env.RESTART_TEST_HOST_TOKEN ?? "";
const startupPassword = process.env.RESTART_TEST_ROOM_PASSWORD ?? "";
const livePassword = process.env.RESTART_TEST_LIVE_PASSWORD ?? "";
const secretValues = new Set([hostToken, startupPassword, livePassword].filter(Boolean));
const scratchRoot = resolve(root, ".scratch/t18");
const outputDirectory = resolve(root, process.env.RESTART_OUTPUT_DIR ?? ".scratch/t18/acceptance");
const outputRelative = relative(scratchRoot, outputDirectory);
if (isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(`..${sep}`)) {
  throw new Error("RESTART_OUTPUT_DIR must stay inside .scratch/t18.");
}
if (process.version !== "v26.13.0") throw new Error("Use the repository-pinned Node v26.13.0 runtime for this smoke.");
if (Buffer.byteLength(hostToken, "utf8") < 32 || Buffer.byteLength(hostToken, "utf8") > 256 ||
    !startupPassword || !livePassword || new Set([hostToken, startupPassword, livePassword]).size !== 3) {
  throw new Error("Set distinct RESTART_TEST_HOST_TOKEN, RESTART_TEST_ROOM_PASSWORD, and RESTART_TEST_LIVE_PASSWORD values; the host token must be 32–256 bytes.");
}

const baseURL = process.env.RESTART_BASE_URL ?? "https://localhost:4173";
const target = new URL(baseURL);
if (target.protocol !== "https:" || !["localhost", "127.0.0.1"].includes(target.hostname) ||
    target.username || target.password || target.search || target.hash || target.pathname !== "/") {
  throw new Error("RESTART_BASE_URL must be a local trusted HTTPS application root without credentials, query, or fragment.");
}
const port = Number(target.port || "443");
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("RESTART_BASE_URL must use a valid local TCP port.");

const caCertificate = resolve(root, process.env.RESTART_CA_CERT ?? ".scratch/t01/tls/local-ca.pem");
const caPem = readFileSync(caCertificate);
const tlsCertificate = resolve(process.env.TLS_CERT_FILE ?? ".scratch/t01/tls/localhost-cert.pem");
const tlsKey = resolve(process.env.TLS_KEY_FILE ?? ".scratch/t01/tls/localhost-key.pem");
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

const WAIT_MS = 20_000;
const MEDIA_WAIT_MS = 15_000;
const RESTART_DOWN_MS = 1_000;
const PROCESS_TERM_WAIT_MS = 5_000;
const PROCESS_KILL_WAIT_MS = 2_000;
const SAMPLE_INTERVAL_MS = 400;
const SAMPLE_COUNT = 3;
const MAX_STAGES = 32;
const MAX_CONNECTIONS = 12;
const MAX_CONTROLS_PER_CONNECTION = 360;
const MAX_ERRORS = 30;
const MAX_SNAPSHOTS = 900;
const ROOMS = {
  lobby: { id: "lobby", name: "Open area", color: [224, 52, 46], frequencyHz: 523 },
  studio: { id: "studio", name: "Meeting room", color: [38, 184, 92], frequencyHz: 997 },
};
const CLIENT_NAMES = ["host", "watch", "revoked"];
const contexts = [];
const profiles = [];
const openProbeSockets = new Set();
const clients = new Map();
const startedAtMs = Date.now();
let phase = "preflight";
let activeServer = null;
let restartWindow = null;
let failure = null;
let collectionOverflow = false;
let unexpectedSocketErrors = 0;

const report = {
  schemaVersion: 1,
  purpose: "Lightweight owned-server process restart and in-memory data-loss smoke; operational rejoin is reported separately from durable restoration.",
  startedAt: new Date().toISOString(),
  finishedAt: null,
  durationMs: null,
  status: "running",
  operationalResult: "pending",
  dynamicRestoration: "not-restored; server records are process-memory only",
  productConclusion: "NO_GO_DURABILITY_UNRESOLVED",
  fullT18Pass: false,
  baseURL: target.origin,
  runtime: { node: process.version, platform: process.platform, architecture: process.arch, firefox: "not-reported", headless },
  tls: {
    caCertificate: relative(root, caCertificate),
    serverCertificate: relative(root, tlsCertificate),
    trust: "trusted CA used for HTTPS/WSS requests and imported only into isolated Firefox profiles",
    ignoreCertificateErrors: false,
    systemTrustChanged: false,
  },
  topology: {
    browsers: CLIENT_NAMES,
    isolatedFirefoxProfiles: 3,
    profilesKeptOpenAcrossRestart: true,
    ownedServerProcesses: 2,
    serverHost: "127.0.0.1",
    serverPort: port,
    syntheticSources: "host-page oscillator/AudioContext and animated canvas only; no physical microphone or display capture",
    interaction: "one synthetic feedback event; no chat text submitted or retained",
    network: "one script-owned local HTTPS/WSS server process, stopped and restarted on the same port",
  },
  startupConfiguration: {
    managedHostControls: true,
    studioInitiallyLocked: true,
    sameConfigurationAcrossProcesses: true,
    hostToken: "provided in process memory; value not recorded",
    startupRoomPassword: "provided in process memory; value not recorded",
    liveRoomPassword: "provided in process memory; value not recorded",
  },
  processRuns: [],
  phases: {},
  interactions: { feedbackSubmitted: false, eventIds: [], beforeFeedbackCount: null, afterRestartFeedbackCount: null, chatLossTested: false },
  grants: { grantedParticipantId: null, grantObserved: false, revokeObserved: false, oldGrantCountAfterRevoke: null, postRestartGrantCount: null },
  resumeProofs: { valuesRetained: false, clients: [] },
  manualRejoin: { oldParticipantIds: {}, newParticipantIds: {}, newIdsDiffer: false, hostClaimedAgain: false, publisherPermissionAfterRevoke: false, oldPublishAutoStarts: 0, passwordGate: null, syntheticControllerResetByNavigation: true, newSourceRequests: null, recoveredClockIds: {}, sourceGenerations: {} },
  probes: [],
  media: { beforeRestart: null, afterManualRejoin: null, renderedSamples: [], oldSourcesEnded: false, newClocksDiffer: false },
  playbackGestures: [],
  screenshots: [],
  serverLogs: { rawLogsRetained: false, childStdoutAndStderr: "ignored; no server log payload retained" },
  privacy: {
    rawControlPayloadsRetained: false,
    rawMediaPayloadsRetained: false,
    browserStorageDumped: false,
    chatTextSubmitted: false,
    chatTextRetained: false,
    resumeTokensRetained: false,
    configuredSecretsInReport: false,
    finalSecretScanPassed: false,
  },
  limits: {
    restart: "the owned child process receives SIGTERM and has a bounded wait; SIGKILL is used only if that same child remains alive",
    recovery: "manual normal UI rejoin creates new server-issued identities; this is operational rebuild, not restoration of old state",
    persistence: "room members, host claim/grants, live room password, feedback/history, and runtime counters are process-memory; this smoke does not accept their loss",
    chat: "chat text is not submitted in this run; chat-loss behavior is classified from the process-memory implementation only",
    generation: "source generation may restart at an earlier number; clock IDs and actual rendered media are compared instead",
    devices: "no phone, physical microphone, human listening, physical display capture, weak-network shaping, capacity, endurance, Cloud Run, or deployment result",
  },
  checks: [],
  connections: [],
  snapshots: [],
  errors: { pageErrors: [], socketErrors: [], collectionErrors: [], cleanupErrors: [], failure: null },
};

function elapsedMs() { return Date.now() - startedAtMs; }

function redact(value) {
  let output = String(value ?? "");
  for (const secret of secretValues) if (secret) output = output.split(secret).join("[redacted]");
  output = output.replace(/("(?:token|password|resumeToken)"\s*:\s*")[^"]*(")/giu, "$1[redacted]$2");
  output = output.replace(/\b(?:Bearer\s+)?[A-Za-z0-9_-]{48,}\b/gu, "[redacted-token]");
  return output.slice(0, 320);
}

function addBounded(array, value, label, cap = MAX_ERRORS) {
  if (array.length >= cap) {
    collectionOverflow = true;
    if (!report.errors.collectionErrors.some((item) => item.collection === label && item.code === "cap_reached") &&
        report.errors.collectionErrors.length < MAX_ERRORS) {
      report.errors.collectionErrors.push({ collection: label, code: "cap_reached", cap });
    }
    return false;
  }
  array.push(value);
  return true;
}

function stage(name, details = {}) {
  if (report.checks.length >= MAX_STAGES) throw new Error("The bounded T18 stage cap was reached.");
  const item = { name, at: new Date().toISOString(), elapsedMs: elapsedMs(), ...details };
  report.checks.push(item);
  console.log("[T18] " + name + (Object.keys(details).length ? " " + JSON.stringify(details) : ""));
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
    item.role = message.role === "participant" || message.role === "display" ? message.role : "unknown";
    item.mode = message.mode === "watch" || message.mode === "interaction" ? message.mode : "unknown";
    if (item.tokenPresent) secretValues.add(message.token);
  } else if (type === "session.resume") {
    item.tokenPresent = typeof message.token === "string" && message.token.length > 0;
    item.passwordProvided = typeof message.password === "string" && message.password.length > 0;
  } else if (type === "session.resumed") {
    item.participantId = safeId(message.participantId);
    item.role = message.role === "participant" || message.role === "display" ? message.role : "unknown";
    item.mode = message.mode === "watch" || message.mode === "interaction" ? message.mode : "unknown";
  } else if (type === "room.snapshot") {
    item.locked = Boolean(message.room?.isLocked);
    item.hostControlsEnabled = Boolean(message.room?.hostControlsEnabled);
    item.publishAllowed = Boolean(message.room?.publishAllowed);
    item.memberIds = Array.isArray(message.members) ? message.members.map((member) => safeId(member?.id)).filter(Boolean).slice(0, 12) : [];
    item.memberCount = item.memberIds.length;
    item.lastSeq = Number.isInteger(message.lastSeq) ? message.lastSeq : null;
  } else if (type === "space.snapshot") {
    item.participantId = safeId(message.participantId);
    item.currentRoomId = safeRoom(message.currentRoomId);
    item.seq = Number.isInteger(message.seq) ? message.seq : null;
    item.rooms = Array.isArray(message.rooms) ? message.rooms.filter((room) => safeRoom(room?.id)).map((room) => ({
      id: room.id,
      playerIds: Array.isArray(room.players) ? room.players.map((player) => ({ id: safeId(player?.id), x: numeric(player?.x), y: numeric(player?.y) })).filter((player) => player.id).slice(0, 12) : [],
    })).slice(0, 4) : [];
  } else if (type === "participation.self") {
    item.participantId = safeId(message.participantId);
    item.role = message.role === "participant" || message.role === "display" ? message.role : "unknown";
    item.mode = message.mode === "watch" || message.mode === "interaction" ? message.mode : "unknown";
    item.audioSubscribed = Boolean(message.media?.audio?.subscribed);
    item.screenSubscribed = Boolean(message.media?.screen?.subscribed);
  } else if (type === "interaction.snapshot" || type === "interaction.state") {
    item.historyCount = Array.isArray(message.history) ? message.history.length : 0;
    item.historyIds = Array.isArray(message.history) ? message.history.map((event) => safeId(event?.id ?? event?.eventId)).filter(Boolean).slice(0, 50) : [];
    item.publicQueueCount = Array.isArray(message.publicQueue) ? message.publicQueue.length : numeric(message.queueCount) ?? 0;
    item.feedbackCounts = {};
    for (const key of ["like", "want-listen", "useful"]) {
      const value = message.feedbackStats?.[key];
      if (value && Number.isFinite(value.count)) item.feedbackCounts[key] = value.count;
    }
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
  } else if (type === "host.claimed") {
    item.hostClaimed = true;
    item.publisherGrantIds = Array.isArray(message.publisherGrants) ? message.publisherGrants.map(safeId).filter(Boolean).slice(0, 12) : [];
  } else if (type === "host.publisherGrants") {
    item.publisherGrantIds = Array.isArray(message.participantIds) ? message.participantIds.map(safeId).filter(Boolean).slice(0, 12) : [];
  } else if (type === "host.publishPermission") {
    item.enabled = message.enabled === true;
    item.allowed = message.allowed === true;
  } else if (type === "host.actionResult") {
    item.action = typeof message.action === "string" && /^[A-Za-z][A-Za-z0-9]{0,50}$/u.test(message.action) ? message.action : "other";
    for (const key of ["allowed", "isLocked", "grantsCleared", "removed", "paused"]) if (typeof message[key] === "boolean") item[key] = message[key];
    if (Number.isFinite(message.queueCount)) item.queueCount = message.queueCount;
  } else if (type === "audio.stream" || type === "screen.stream") {
    item.generation = Number.isInteger(message.generation) ? message.generation : null;
    item.clockId = safeId(message.clockId);
    item.config = type === "audio.stream"
      ? { codec: message.config?.codec === "opus" ? "opus" : "other", sampleRate: numeric(message.config?.sampleRate), channels: numeric(message.config?.channels) }
      : { codec: message.codec === "vp8" ? "vp8" : "other", width: numeric(message.width), height: numeric(message.height), frameRate: numeric(message.frameRate) };
  } else if (/^(audio|screen)\.(started|stopped|streamEnded|error|subscribed|unsubscribed|subscribe|unsubscribe|start)$/u.test(type)) {
    item.generation = Number.isInteger(message.generation) ? message.generation : null;
    item.clockId = safeId(message.clockId);
    if (typeof message.code === "string") item.code = safeCode(message.code);
    if (typeof message.reason === "string") item.reason = safeCode(message.reason);
  } else if (type === "protocol.error" || type === "host.error") {
    item.code = safeCode(message.code);
  }
  return item;
}

function observeFrame(client, connection, direction, frame) {
  const payload = typeof frame === "string" || Buffer.isBuffer(frame) || frame instanceof Uint8Array ? frame : frame?.payload;
  if (typeof payload !== "string") {
    if (Buffer.isBuffer(payload) || payload instanceof Uint8Array) {
      const bytes = Buffer.from(payload);
      const magic = bytes.toString("ascii", 0, Math.min(4, bytes.length));
      const channel = magic === "LTA1" ? "audio" : magic === "LTS1" ? "screen" : "other";
      connection.media[direction][channel] += 1;
    }
    return;
  }
  let message;
  try { message = JSON.parse(payload); } catch { return; }
  const summary = summarizeControl(message, direction, connection);
  if (!summary) return;
  if (!addBounded(connection.controls, summary, client.name + "-controls-" + connection.index, MAX_CONTROLS_PER_CONNECTION)) client.collectionOverflow = true;
  if (!addBounded(report.snapshots, { client: client.name, ...summary }, "snapshots", MAX_SNAPSHOTS)) client.collectionOverflow = true;
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
      openedAt: new Date().toISOString(),
      openedAtElapsedMs: elapsedMs(),
      closedAt: null,
      controlSequence: 0,
      sequence: 0,
      controls: [],
      media: { sent: { audio: 0, screen: 0, other: 0 }, received: { audio: 0, screen: 0, other: 0 } },
      socket,
    };
    client.connections.push(connection);
    client.activeConnection = connection;
    socket.on("framesent", (frame) => observeFrame(client, connection, "sent", frame));
    socket.on("framereceived", (frame) => observeFrame(client, connection, "received", frame));
    socket.on("close", () => { connection.closedAt = new Date().toISOString(); });
    socket.on("socketerror", () => {
      client.socketErrorCount += 1;
      const atElapsedMs = elapsedMs();
      const withinRestartWindow = Boolean(restartWindow && atElapsedMs >= restartWindow.startedAtElapsedMs &&
        (restartWindow.endedAtElapsedMs === null || atElapsedMs <= restartWindow.endedAtElapsedMs));
      const restartPhase = ["server_stopping", "server_down", "server_starting", "resume_rejected"].includes(phase);
      const expected = withinRestartWindow && restartPhase;
      addBounded(report.errors.socketErrors, {
        client: client.name,
        connectionIndex: connection.index,
        connectionOpenedAt: connection.openedAt,
        at: new Date().toISOString(),
        atElapsedMs,
        restartWindowStartElapsedMs: restartWindow?.startedAtElapsedMs ?? null,
        restartWindowEndElapsedMs: restartWindow?.endedAtElapsedMs ?? null,
        phase,
        classification: expected ? "expected-owned-server-restart-window" : "unexpected",
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

function countAllControls(client, direction, type, fromElapsedMs = 0) {
  return allControls(client, direction, type).filter((item) => item.elapsedMs >= fromElapsedMs).length;
}

async function waitControl(client, direction, type, predicate = () => true, timeoutMs = WAIT_MS, afterElapsedMs = 0) {
  return waitFor(() => controls(client, direction, type).findLast((item) => item.elapsedMs >= afterElapsedMs && predicate(item)),
    client.name + " " + direction + " " + type, timeoutMs);
}

function latestControl(client, direction, type, predicate = () => true) {
  return controls(client, direction, type).findLast(predicate) ?? null;
}

function latestInteractionSnapshot(client) {
  return [latestControl(client, "received", "interaction.snapshot"), latestControl(client, "received", "interaction.state")]
    .filter(Boolean)
    .sort((left, right) => left.elapsedMs - right.elapsedMs)
    .at(-1) ?? null;
}

function clientIdentity(client) {
  const issued = latestControl(client, "received", "session.issued");
  const self = latestControl(client, "received", "participation.self");
  return {
    participantId: issued?.participantId ?? self?.participantId ?? null,
    role: self?.role ?? issued?.role ?? "unknown",
    mode: self?.mode ?? issued?.mode ?? "unknown",
    roomId: latestControl(client, "received", "room.snapshot")?.roomId ?? null,
  };
}

function phaseSnapshot(client) {
  const room = latestControl(client, "received", "room.snapshot");
  const space = latestControl(client, "received", "space.snapshot");
  const participation = latestControl(client, "received", "participation.self");
  const interaction = latestInteractionSnapshot(client);
  const host = latestControl(client, "received", "host.claimed");
  const grants = latestControl(client, "received", "host.publisherGrants");
  const permission = latestControl(client, "received", "host.publishPermission");
  const studioPlayers = space?.rooms.find((candidate) => candidate.id === "studio")?.playerIds ?? [];
  return {
    identity: clientIdentity(client),
    room: room ? { roomId: room.roomId, locked: room.locked, hostControlsEnabled: room.hostControlsEnabled, publishAllowed: room.publishAllowed, snapshotMemberIds: room.memberIds, memberIds: studioPlayers.map((player) => player.id), memberCount: studioPlayers.length, lastSeq: room.lastSeq } : null,
    positions: space?.rooms ?? [],
    spaceSeq: space?.seq ?? null,
    participation: participation ? { role: participation.role, mode: participation.mode, audioSubscribed: participation.audioSubscribed, screenSubscribed: participation.screenSubscribed } : null,
    hostClaimed: Boolean(host?.hostClaimed),
    grantIds: grants?.publisherGrantIds ?? host?.publisherGrantIds ?? [],
    publisherPermission: permission ? { enabled: permission.enabled, allowed: permission.allowed } : null,
    interaction: interaction ? { historyCount: interaction.historyCount, historyIds: interaction.historyIds, publicQueueCount: interaction.publicQueueCount, feedbackCounts: interaction.feedbackCounts } : null,
  };
}

async function assertPortFree() {
  const checkBind = (host, allowUnavailable = false) => new Promise((resolvePromise, reject) => {
    const probe = createServer();
    probe.once("error", (error) => {
      if (error?.code === "EADDRINUSE") reject(new Error("Refusing to start: local port " + port + " is already occupied on " + host + ". This script never stops an existing server."));
      else if (allowUnavailable && ["EADDRNOTAVAIL", "EAFNOSUPPORT"].includes(error?.code)) resolvePromise();
      else reject(error);
    });
    probe.listen({ host, port, exclusive: true }, () => probe.close((error) => error ? reject(error) : resolvePromise()));
  });
  await checkBind("127.0.0.1");
  if (target.hostname === "localhost") await checkBind("::1", true);
  const existing = await requestJson("/api/health", 900).catch(() => null);
  if (existing?.statusCode === 200 && existing.body?.status === "ok") {
    throw new Error("Refusing to start: a trusted HTTPS application already responds on this port. This script never stops an existing server.");
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
        try { parsed = JSON.parse(body); } catch { /* non-JSON local response */ }
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
  });
  return env;
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
    startupHealthy: false,
    startupConfigSameAsFirst: true,
  };
  report.processRuns.push(run);
  const exited = new Promise((resolvePromise) => child.once("exit", (code, signal) => resolvePromise({ code, signal })));
  child.once("error", () => { run.spawnError = true; });
  activeServer = { child, run, exited };
  if (!run.pid) throw new Error("Owned server child did not expose a PID; no process was signaled.");

  await waitFor(async () => {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("The owned server child exited before the trusted health check passed.");
    try {
      const response = await requestJson("/api/health", 1_500);
      if (response.statusCode === 200 && response.body?.status === "ok" && response.body?.persistence === "process-memory") return response.body;
    } catch { /* expected while the owned listener is starting */ }
    return false;
  }, label + " trusted HTTPS health", 12_000, 150).then((health) => {
    run.readyAt = new Date().toISOString();
    run.startupHealthy = true;
    run.persistence = health.persistence;
  });
  const rooms = await requestJson("/api/rooms");
  assert.equal(rooms.statusCode, 200, "Trusted /api/rooms request should succeed.");
  const studio = Array.isArray(rooms.body) ? rooms.body.find((room) => room.id === "studio") : null;
  assert.ok(studio && studio.isLocked && studio.hostControlsEnabled, "Owned server should start with the same locked managed studio configuration.");
  run.staticStudioConfiguration = { locked: true, hostControlsEnabled: true };
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
    if (key.startsWith("RESTART_TEST_") || ["RESTART_TEST_HOST_TOKEN", "RESTART_TEST_ROOM_PASSWORD", "RESTART_TEST_LIVE_PASSWORD", "HOST_CONTROL_TOKEN", "MEETING_ROOM_PASSWORD", "TLS_CERT_FILE", "TLS_KEY_FILE"].includes(key)) delete env[key];
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
  const client = { name, context, page, connections: [], activeConnection: null, socketErrorCount: 0, collectionOverflow: false };
  clients.set(name, client);
  installPageObservers(client);
  return client;
}

async function installSyntheticMedia(page) {
  await page.addInitScript(({ frequency, color }) => {
    const state = { audioRequests: 0, screenRequests: 0, sources: [], audioContexts: [] };
    Object.defineProperty(window, "__t18Synthetic", { value: state, configurable: false });
    const devices = navigator.mediaDevices;
    const trackSource = (kind, track, stopDrawing = null) => {
      const source = { kind, track, stopCalls: 0 };
      const stop = track.stop.bind(track);
      track.stop = () => {
        if (track.readyState !== "ended") source.stopCalls += 1;
        stopDrawing?.();
        stop();
      };
      state.sources.push(source);
    };
    Object.defineProperty(devices, "getUserMedia", { configurable: true, value: async () => {
      state.audioRequests += 1;
      const context = new AudioContext({ sampleRate: 48_000 });
      await context.resume();
      const destination = context.createMediaStreamDestination();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency + state.audioRequests * 17;
      gain.gain.value = 0.22;
      oscillator.connect(gain).connect(destination);
      oscillator.start();
      state.audioContexts.push(context);
      const track = destination.stream.getAudioTracks()[0];
      if (!track) throw new Error("Synthetic AudioContext produced no track.");
      trackSource("audio", track);
      return destination.stream;
    } });
    Object.defineProperty(devices, "getDisplayMedia", { configurable: true, value: async () => {
      state.screenRequests += 1;
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 180;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Synthetic video canvas could not be created.");
      let active = true;
      let frame = 0;
      const draw = () => {
        if (!active) return;
        const pulse = frame++ % 2 === 0 ? 0 : 12;
        context.fillStyle = `rgb(${Math.min(255, color[0] + pulse)},${Math.min(255, color[1] + pulse)},${Math.min(255, color[2] + pulse)})`;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#ffffff";
        context.fillRect(12 + (frame % 80), 12, 48, 12);
        requestAnimationFrame(draw);
      };
      draw();
      const stream = canvas.captureStream(10);
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error("Synthetic canvas produced no video track.");
      trackSource("screen", track, () => { active = false; });
      return stream;
    } });
  }, { frequency: ROOMS.studio.frequencyHz, color: ROOMS.studio.color });
}

async function joinRoom(client, displayName, passwordForFirstAttempt = startupPassword) {
  const page = client.page;
  const joinStartedAt = elapsedMs();
  await page.goto(target.origin + "/?room=studio", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Local room presence" }).waitFor();
  await page.getByLabel("Your display name").fill(displayName);
  const priorConnectionCount = client.connections.length;
  await page.getByRole("button", { name: "Join room", exact: true }).click();
  await waitFor(() => client.connections.length > priorConnectionCount, client.name + " entry WebSocket");
  const entryConnection = client.activeConnection;
  await page.getByLabel("Meeting room password").waitFor({ state: "visible" });
  const entryErrorsBefore = controls(client, "received", "protocol.error").length;
  await page.locator("#meeting-room-password").fill(passwordForFirstAttempt);
  await page.getByRole("button", { name: "Enter room", exact: true }).click();
  if (passwordForFirstAttempt === livePassword) {
    await waitFor(() => controls(client, "received", "protocol.error", entryConnection).slice(entryErrorsBefore).some((item) => item.code === "room_password_incorrect"), client.name + " rejected former live password B");
    assert.equal(controls(client, "received", "room.snapshot", entryConnection).length, 0, "Wrong B password must not create a room member.");
    await page.locator("#meeting-room-password").fill(startupPassword);
    await page.getByRole("button", { name: "Enter room", exact: true }).click();
    client.passwordGateAfterRestart = { previousLivePasswordBRejected: true, rejectionCode: "room_password_incorrect", startupPasswordAAccepted: true };
  }
  await page.getByText("Connected to Meeting room", { exact: true }).waitFor();
  await page.locator('[data-testid="participation-controls"]').waitFor();
  await waitControl(client, "received", "room.snapshot", (item) => item.roomId === "studio", WAIT_MS, joinStartedAt);
  await waitControl(client, "received", "participation.self", (item) => item.participantId);
  await waitControl(client, "received", "interaction.snapshot");
  const identity = clientIdentity(client);
  assert.ok(identity.participantId, client.name + " should have a server-issued participant ID.");
  assert.equal(identity.roomId, "studio");
  assert.equal(identity.role, "participant");
  return identity;
}

async function claimHost(client) {
  const connection = client.activeConnection;
  const claimedBefore = controls(client, "received", "host.claimed").length;
  await client.page.getByTestId("host-control-token").fill(hostToken);
  await client.page.getByTestId("host-claim").click();
  await waitFor(() => controls(client, "received", "host.claimed").length > claimedBefore, "host claim acknowledgment");
  await client.page.getByTestId("host-state").filter({ hasText: "HOST" }).waitFor();
  assert.ok(connection, "Host should have an observed WebSocket connection.");
}

async function setLiveRoomPassword(host) {
  const before = controls(host, "received", "host.actionResult").length;
  await host.page.getByTestId("host-meeting-password").fill(livePassword);
  await host.page.getByTestId("host-lock-room").click();
  const result = await waitFor(() => controls(host, "received", "host.actionResult").slice(before).find((item) => item.action === "setMeetingRoomPassword"), "live room password change");
  assert.equal(result.isLocked, true);
  await host.page.getByTestId("host-meeting-password").fill("");
  return result;
}

async function setPublisherGrant(host, participant, participantId, action) {
  const row = host.page.locator(`[data-testid="host-panel"] .host-member-row[data-participant-id="${participantId}"]`);
  await row.waitFor();
  const before = controls(host, "received", "host.actionResult").length;
  const permissionBefore = controls(participant, "received", "host.publishPermission").length;
  await row.getByTestId(action === "grant" ? "host-grant-publisher" : "host-revoke-publisher").click();
  const expectedAction = action === "grant" ? "grantPublisher" : "revokePublisher";
  const result = await waitFor(() => controls(host, "received", "host.actionResult").slice(before).find((item) => item.action === expectedAction), action + " publisher permission result");
  const permission = await waitFor(() => controls(participant, "received", "host.publishPermission").slice(permissionBefore).at(-1), action + " participant permission update");
  assert.equal(permission.allowed, action === "grant");
  return { result, permission };
}

async function startPublishing(host) {
  const audioBefore = controls(host, "received", "audio.started").length;
  const screenBefore = controls(host, "received", "screen.started").length;
  await host.page.getByRole("button", { name: "開始麥克風", exact: true }).click();
  await waitFor(() => controls(host, "received", "audio.started").length > audioBefore, "host audio.start accepted");
  await host.page.getByRole("button", { name: "開始分享畫面", exact: true }).click();
  await waitFor(() => controls(host, "received", "screen.started").length > screenBefore, "host screen.start accepted");
}

async function startReceiving(watch) {
  const audioBefore = controls(watch, "received", "audio.subscribed").length;
  const screenBefore = controls(watch, "received", "screen.subscribed").length;
  await watch.page.getByTestId("audio-start-listening").click();
  await watch.page.getByTestId("screen-start-watching").click();
  await waitFor(() => controls(watch, "received", "audio.subscribed").length > audioBefore, "watch audio subscription acknowledgment");
  await waitFor(() => controls(watch, "received", "screen.subscribed").length > screenBefore, "watch screen subscription acknowledgment");
}

async function readSyntheticState(client) {
  return client.page.evaluate(() => {
    const state = window.__t18Synthetic;
    if (!state) return null;
    return {
      audioRequests: state.audioRequests,
      screenRequests: state.screenRequests,
      sources: state.sources.map(({ kind, track, stopCalls }) => ({ kind, readyState: track.readyState, stopCalls })),
      audioContextStates: state.audioContexts.map((context) => context.state),
    };
  });
}

async function mediaSnapshot(client) {
  return client.page.evaluate(() => {
    const audio = document.querySelector('[data-testid="audio-panel"]');
    const screen = document.querySelector('[data-testid="screen-panel"]');
    const canvas = screen?.querySelector('[data-testid="screen-preview"]');
    const pixel = canvas instanceof HTMLCanvasElement && canvas.width && canvas.height
      ? [...canvas.getContext("2d").getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data]
      : null;
    return {
      audio: audio ? {
        renderedSamples: Number(audio.getAttribute("data-rendered-samples") ?? 0),
        decodedFrames: Number(audio.getAttribute("data-decoded-frames") ?? 0),
        receivedPackets: Number(audio.getAttribute("data-received-packets") ?? 0),
        renderRms: Number(audio.getAttribute("data-render-rms") ?? 0),
        listenerState: audio.getAttribute("data-listener-state"),
        playbackClockId: audio.getAttribute("data-audio-playback-clock-id"),
      } : null,
      screen: screen ? {
        renderedFrames: Number(screen.getAttribute("data-rendered-frames") ?? 0),
        decodedFrames: Number(screen.getAttribute("data-decoded-frames") ?? 0),
        receivedFrames: Number(screen.getAttribute("data-received-frames") ?? 0),
        width: Number(screen.getAttribute("data-rendered-width") ?? 0),
        height: Number(screen.getAttribute("data-rendered-height") ?? 0),
        syncClockId: screen.getAttribute("data-sync-clock-id"),
        pixel,
      } : null,
    };
  });
}

function colorDifference(actual, expected) {
  if (!Array.isArray(actual) || actual.length < 3) return Infinity;
  return Math.max(...expected.map((channel, index) => Math.abs(channel - actual[index])));
}

async function ensurePlaybackGesture(client) {
  const button = client.page.getByTestId("audio-continue-listening");
  if (!(await button.isVisible().catch(() => false))) return;
  const before = await mediaSnapshot(client);
  try {
    await button.click({ timeout: 1_000 });
    report.playbackGestures.push({ client: client.name, atElapsedMs: elapsedMs(), result: "clicked-normal-continue", before: before.audio });
  } catch (error) {
    const after = await mediaSnapshot(client);
    report.playbackGestures.push({ client: client.name, atElapsedMs: elapsedMs(), result: "continue-control-disappeared-or-click-timed-out", before: before.audio, after: after.audio });
    if (!(after.audio?.listenerState === "ready" && after.audio.renderedSamples > 0 && after.audio.renderRms > 0.0001)) throw error;
    // The caller still requires a positive sample and frame delta from its supplied baseline.
  }
}

async function waitForRenderedMedia(client, expectedClockIds = null, baseline = null) {
  await ensurePlaybackGesture(client);
  await client.page.waitForFunction((prior) => {
    const audio = document.querySelector('[data-testid="audio-panel"]');
    const screen = document.querySelector('[data-testid="screen-panel"]');
    const canvas = screen?.querySelector('[data-testid="screen-preview"]');
    return audio && screen && Number(audio.getAttribute("data-rendered-samples") ?? 0) > (prior?.audio?.renderedSamples ?? 0) &&
      Number(audio.getAttribute("data-received-packets") ?? 0) > 0 && Number(audio.getAttribute("data-render-rms") ?? 0) > 0.0001 &&
      Number(screen.getAttribute("data-rendered-frames") ?? 0) >= Math.max(3, (prior?.screen?.renderedFrames ?? 0) + 1) &&
      Number(screen.getAttribute("data-received-frames") ?? 0) > 0 && canvas?.width > 0 && canvas?.height > 0;
  }, baseline, { timeout: MEDIA_WAIT_MS });
  const snapshot = await mediaSnapshot(client);
  assert.ok(snapshot.audio.renderedSamples > (baseline?.audio?.renderedSamples ?? 0), "AudioWorklet output samples must advance.");
  assert.ok(snapshot.screen.renderedFrames >= Math.max(3, (baseline?.screen?.renderedFrames ?? 0) + 1), "VP8 decoded frames must render.");
  assert.ok(colorDifference(snapshot.screen.pixel, ROOMS.studio.color) <= 45, "Rendered canvas should show the synthetic studio color.");
  if (expectedClockIds) {
    assert.equal(snapshot.audio.playbackClockId, expectedClockIds.audio);
    assert.equal(snapshot.screen.syncClockId, expectedClockIds.screen);
  }
  return snapshot;
}

async function sampleRenderedMedia(client, label, baseline) {
  const samples = [];
  let previous = baseline;
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    await delay(SAMPLE_INTERVAL_MS);
    const current = await mediaSnapshot(client);
    const sample = {
      label,
      index: index + 1,
      audioRenderedSamples: current.audio?.renderedSamples ?? 0,
      screenRenderedFrames: current.screen?.renderedFrames ?? 0,
      audioAdvanced: (current.audio?.renderedSamples ?? 0) > (previous.audio?.renderedSamples ?? 0),
      screenAdvanced: (current.screen?.renderedFrames ?? 0) > (previous.screen?.renderedFrames ?? 0),
    };
    assert.ok(sample.audioAdvanced && sample.screenAdvanced, label + " actual audio and screen render counters should advance in every sample.");
    addBounded(report.media.renderedSamples, sample, "media-render-samples", 12);
    samples.push(sample);
    previous = current;
  }
  return { final: previous, samples };
}

async function sendFeedback(watch) {
  const before = controls(watch, "received", "interaction.ack").length;
  await watch.page.getByTestId("feedback-like").click();
  const ack = await waitFor(() => controls(watch, "received", "interaction.ack").slice(before).find((item) => item.eventId || item.interactionId), "synthetic feedback acknowledgment");
  assert.ok(ack.eventId || ack.interactionId, "Feedback acknowledgment should expose a server event identifier.");
  report.interactions.feedbackSubmitted = true;
  if (ack.eventId) addBounded(report.interactions.eventIds, ack.eventId, "feedback-event-ids", 8);
  else if (ack.interactionId) addBounded(report.interactions.eventIds, ack.interactionId, "feedback-event-ids", 8);
  return ack;
}

async function saveScreenshot(client, fileName, label) {
  const path = join(runDirectory, fileName);
  await client.page.screenshot({ path, fullPage: true, animations: "disabled", timeout: 8_000 });
  report.screenshots.push({ label, file: fileName, client: client.name });
}

async function assertHealthAndStaticRooms(label) {
  const health = await requestJson("/api/health");
  assert.equal(health.statusCode, 200);
  assert.equal(health.body?.status, "ok");
  assert.equal(health.body?.persistence, "process-memory");
  const rooms = await requestJson("/api/rooms");
  const ids = Array.isArray(rooms.body) ? rooms.body.map((room) => room.id) : [];
  assert.deepEqual(ids, ["lobby", "studio"], "The fixed public room catalogue should rebuild after process restart.");
  const studio = rooms.body.find((room) => room.id === "studio");
  assert.equal(studio.isLocked, true);
  assert.equal(studio.hostControlsEnabled, true);
  stage(label + "-trusted-health-and-fixed-room-catalogue", { persistence: health.body.persistence, roomIds: ids, studioLocked: studio.isLocked, hostControlsEnabled: studio.hostControlsEnabled });
}

async function probePublishDenied(participant) {
  assert.equal(await participant.page.getByRole("button", { name: "開始麥克風", exact: true }).isDisabled(), true, "Revoked/fresh participant publishing UI should be disabled.");
  assert.equal(await participant.page.getByRole("button", { name: "開始分享畫面", exact: true }).isDisabled(), true, "Revoked/fresh participant screen publishing UI should be disabled.");
  const openProbe = async () => {
    const probe = new WebSocket(new URL("/ws", target.origin), { ca: caPem, rejectUnauthorized: true, origin: target.origin });
    openProbeSockets.add(probe);
    const received = [];
    probe.on("message", (payload) => {
      if (typeof payload !== "string" && !Buffer.isBuffer(payload)) return;
      try {
        const message = JSON.parse(String(payload));
        if (message && typeof message.type === "string") received.push({ type: message.type, code: safeCode(message.code), roomId: safeRoom(message.roomId ?? message.room?.id) });
      } catch { /* raw probe payloads are never retained */ }
    });
    probe.on("error", () => {});
    await new Promise((resolvePromise, reject) => {
      probe.once("open", resolvePromise);
      probe.once("error", reject);
    });
    return { probe, received };
  };
  const closeProbe = async (probe) => {
    try {
      if (probe.readyState !== WebSocket.CLOSED) {
        const closed = new Promise((resolvePromise) => probe.once("close", resolvePromise));
        probe.close(1000, "T18 authorization probe complete");
        await Promise.race([closed, delay(1_500)]);
        if (probe.readyState !== WebSocket.CLOSED) probe.terminate();
      }
    } finally {
      openProbeSockets.delete(probe);
    }
  };
  let forgedRole;
  let publishDenial;
  try {
    const forged = await openProbe();
    forged.probe.send(JSON.stringify({ type: "join", roomId: "studio", displayName: "T18 forged role probe", role: "host", mode: "watch", resumable: false, password: startupPassword }));
    await waitFor(() => forged.received.some((item) => item.type === "protocol.error" && item.code === "invalid_join"), "forged host role rejected by normal join validation");
    assert.equal(forged.received.some((item) => item.type === "room.snapshot"), false, "Forged host role must not create a member.");
    forgedRole = { attemptedRole: "host", rejected: true, rejectionCode: "invalid_join", roomSnapshotReceived: false };
    await closeProbe(forged.probe);

    const valid = await openProbe();
    valid.probe.send(JSON.stringify({ type: "join", roomId: "studio", displayName: "T18 publish denial probe", role: "participant", mode: "watch", resumable: false, password: startupPassword }));
    await waitFor(() => valid.received.some((item) => item.type === "room.snapshot"), "normal participant protocol probe join");
    valid.probe.send(JSON.stringify({ type: "audio.start" }));
    valid.probe.send(JSON.stringify({ type: "screen.start" }));
    await waitFor(() => valid.received.some((item) => item.type === "audio.error" && item.code === "publish_not_authorized") &&
      valid.received.some((item) => item.type === "screen.error" && item.code === "publish_not_authorized"), "protocol probe server-side publish denial");
    publishDenial = { joinedAs: "participant", audioDenied: true, screenDenied: true, errorCode: "publish_not_authorized", roomSnapshotReceived: true };
    await closeProbe(valid.probe);
  } finally {
    for (const probe of [...openProbeSockets]) await closeProbe(probe);
  }
  const summary = { forgedRole, publishDenial, protocolProbeConnections: 2 };
  report.probes.push(summary);
  return summary;
}

async function waitForInvalidResume(client, restartStartMs) {
  const oldIdentity = report.phases.beforeRestart?.[client.name]?.identity?.participantId;
  if (!allControls(client, "received", "protocol.error").some((item) => item.code === "resume_invalid" && item.elapsedMs >= restartStartMs)) {
    await waitFor(() => allControls(client, "received", "protocol.error").some((item) => item.code === "resume_invalid" && item.elapsedMs >= restartStartMs),
      client.name + " old process proof rejected as resume_invalid", 30_000);
  }
  await client.page.getByText("Saved session expired or unavailable. Join the room again.", { exact: false }).waitFor();
  const invalid = allControls(client, "received", "protocol.error").findLast((item) => item.code === "resume_invalid" && item.elapsedMs >= restartStartMs);
  const resumeSent = allControls(client, "sent", "session.resume").some((item) => item.elapsedMs >= restartStartMs && item.tokenPresent);
  assert.equal(resumeSent, true, client.name + " should retry the actual old session proof.");
  assert.equal(allControls(client, "received", "session.resumed").some((item) => item.elapsedMs >= restartStartMs), false, client.name + " must not resume an old identity.");
  report.resumeProofs.clients.push({ client: client.name, oldParticipantId: oldIdentity, resumeAttempted: true, tokenValueRetained: false, errorCode: invalid.code, autoAnonymousJoinCount: countAllControls(client, "sent", "join", restartStartMs), autoHostClaimCount: countAllControls(client, "sent", "host.claim", restartStartMs), autoAudioStartCount: countAllControls(client, "sent", "audio.start", restartStartMs), autoScreenStartCount: countAllControls(client, "sent", "screen.start", restartStartMs) });
}

async function manualRejoin(client, name, passwordForFirstAttempt) {
  const before = client.connections.length;
  const identity = await joinRoom(client, name, passwordForFirstAttempt);
  assert.ok(client.connections.length >= before + 1);
  return identity;
}

async function finalReport() {
  report.finishedAt = new Date().toISOString();
  report.durationMs = elapsedMs();
  report.status = failure ? "failed" : "passed";
  report.operationalResult = failure ? "failed" : "passed: owned-process restart, stale-proof rejection, and manual operational rejoin observed";
  report.errors.failure = failure ? redact(failure?.message ?? failure) : null;
  if (collectionOverflow) {
    report.status = "failed";
    report.operationalResult = "failed: bounded evidence collection overflow";
    report.errors.failure ??= "A bounded evidence collection reached its cap.";
  }
  if (report.errors.pageErrors.length || report.errors.cleanupErrors.length || unexpectedSocketErrors > 0) {
    report.status = "failed";
    report.operationalResult = "failed: page, cleanup, or unexpected socket error observed";
    report.errors.failure ??= "Page, cleanup, or unexpected socket errors were observed.";
  }
  report.connections = [...clients.values()].map((client) => ({
    client: client.name,
    connections: client.connections.map(({ index, openedAt, openedAtElapsedMs, closedAt, media, controls: entries }) => ({ index, openedAt, openedAtElapsedMs, closedAt, media, controls: entries })),
  }));
  report.privacy.configuredSecretsInReport = [...secretValues].some((secret) => secret && JSON.stringify(report).includes(secret));
  if (report.privacy.configuredSecretsInReport) {
    report.status = "failed";
    report.operationalResult = "failed: final secret scan found a configured value";
    report.errors.failure = "A configured secret appeared in the report and was redacted before saving.";
  }
  report.privacy.finalSecretScanPassed = !report.privacy.configuredSecretsInReport;
  let serialized = JSON.stringify(report, null, 2) + "\n";
  for (const secret of secretValues) if (secret) serialized = serialized.split(secret).join("[redacted]");
  const reportPath = join(runDirectory, "report.json");
  writeFileSync(reportPath, serialized, { mode: 0o600 });
  writeFileSync(join(runDirectory, "README.md"), [
    "# T18 process restart smoke",
    "",
    "Operational result: " + report.operationalResult,
    "Dynamic restoration: " + report.dynamicRestoration,
    "Product conclusion: " + report.productConclusion,
    "",
    "Three isolated Firefox profiles stayed open across two script-owned server processes. The old bearer proofs were retried against a new process and required explicit normal UI join to obtain new participant IDs. The report retains only allowlisted control metadata, UUIDs, counters, approved error codes, and rendered-media observations; it contains no resume token, password, chat text, or raw media.",
    "",
    "A successful manual rejoin is operational rebuild evidence. Process-memory members, grants, live password, feedback/history, and counters were not restored; their loss is not accepted as product behavior. This is not a full T18/POC-06 pass, Cloud Run result, or deployment result.",
    "",
    "Screenshots: " + report.screenshots.map((item) => item.file).join(", "),
    "Failure: " + (report.errors.failure ?? "none"),
    "",
  ].join("\n"), { mode: 0o600 });
  console.log("[T18] " + report.status + " operational=" + report.operationalResult + " report=" + reportPath);
}

try {
  assert.ok(caPem.includes(Buffer.from("BEGIN CERTIFICATE")), "Trusted CA file should contain a PEM certificate.");
  phase = "preflight";
  await assertPortFree();
  const [host, watch, revoked] = await Promise.all(CLIENT_NAMES.map(launchClient));
  report.runtime.firefox = host.context.browser()?.version() ?? "not-reported";
  await installSyntheticMedia(host.page);

  phase = "initial_server";
  await launchOwnedServer("initial");
  await assertHealthAndStaticRooms("initial-server");

  phase = "normal_join";
  const initialIdentities = {};
  for (const [client, displayName] of [[host, "T18 host"], [watch, "T18 watch"], [revoked, "T18 revoked participant"]]) {
    initialIdentities[client.name] = await joinRoom(client, displayName, startupPassword);
    assert.equal(latestControl(client, "received", "room.snapshot")?.locked, true);
  }
  report.phases.beforeRestart = Object.fromEntries([...clients].map(([name, client]) => [name, phaseSnapshot(client)]));
  report.manualRejoin.oldParticipantIds = Object.fromEntries(Object.entries(initialIdentities).map(([name, identity]) => [name, identity.participantId]));
  assert.equal(report.phases.beforeRestart.host.room.memberIds.length, 3);
  stage("three-firefox-clients-joined-startup-locked-studio", { memberCount: 3, participantIdsRecorded: true, startupPasswordValueRecorded: false });

  phase = "initial_setup";
  await claimHost(host);
  report.grants.grantedParticipantId = initialIdentities.revoked.participantId;
  const grant = await setPublisherGrant(host, revoked, initialIdentities.revoked.participantId, "grant");
  report.grants.grantObserved = grant.permission.allowed;
  const revoke = await setPublisherGrant(host, revoked, initialIdentities.revoked.participantId, "revoke");
  report.grants.revokeObserved = !revoke.permission.allowed;
  report.grants.oldGrantCountAfterRevoke = latestControl(host, "received", "host.publisherGrants")?.publisherGrantIds?.length ?? 0;
  assert.equal(report.grants.oldGrantCountAfterRevoke, 0, "The revoked publisher grant must be absent before restart.");
  assert.equal(latestControl(revoked, "received", "host.publishPermission")?.allowed, false);
  await startPublishing(host);
  await startReceiving(watch);
  const oldAudioSource = await waitControl(watch, "received", "audio.stream", (item) => item.clockId);
  const oldScreenSource = await waitControl(watch, "received", "screen.stream", (item) => item.clockId);
  const oldClockIds = { audio: oldAudioSource.clockId, screen: oldScreenSource.clockId };
  const firstWatchRender = await waitForRenderedMedia(watch, oldClockIds);
  await sendFeedback(watch);
  await waitFor(() => (latestInteractionSnapshot(watch)?.feedbackCounts?.like ?? 0) >= 1, "feedback counter update");
  report.interactions.beforeFeedbackCount = latestInteractionSnapshot(watch)?.feedbackCounts?.like ?? 0;
  const livePasswordResult = await setLiveRoomPassword(host);
  assert.equal(livePasswordResult.isLocked, true);
  const initialSamples = await sampleRenderedMedia(watch, "before-restart", firstWatchRender);
  report.media.beforeRestart = { audioClockId: oldClockIds.audio, screenClockId: oldClockIds.screen, audioGeneration: oldAudioSource.generation, screenGeneration: oldScreenSource.generation, renderedSamples: initialSamples.final.audio.renderedSamples, renderedFrames: initialSamples.final.screen.renderedFrames, samples: initialSamples.samples };
  report.phases.beforeRestart = Object.fromEntries([...clients].map(([name, client]) => [name, phaseSnapshot(client)]));
  assert.ok(report.phases.beforeRestart.host.hostClaimed);
  assert.equal(report.phases.beforeRestart.host.interaction.historyCount, 0, "Feedback is counted separately from chat history.");
  assert.equal(report.phases.beforeRestart.host.interaction.feedbackCounts.like, 1);
  assert.equal(report.phases.beforeRestart.host.grantIds.length, 0);
  await saveScreenshot(watch, "before-restart-media-active.png", "before-restart-media-active");
  stage("host-grant-revoke-live-password-feedback-and-media-observed", { grantObserved: report.grants.grantObserved, revokeObserved: report.grants.revokeObserved, feedbackEventIdRecorded: report.interactions.eventIds.length === 1, startupPasswordUnchangedInProcessEnvironment: true, activeAudioAndScreenRenderSamples: SAMPLE_COUNT });

  const restartStartMs = elapsedMs();
  restartWindow = { startedAtElapsedMs: restartStartMs, endedAtElapsedMs: null };
  phase = "server_stopping";
  const oldSourceStateBeforeStop = await readSyntheticState(host);
  assert.ok(oldSourceStateBeforeStop?.sources.some((source) => source.kind === "audio" && source.readyState === "live"));
  assert.ok(oldSourceStateBeforeStop?.sources.some((source) => source.kind === "screen" && source.readyState === "live"));
  await stopOwnedServer("T18 controlled process restart with active host sources and watch rendering");
  const downtimeStartMs = elapsedMs();
  phase = "server_down";
  await saveScreenshot(watch, "server-down-client-state.png", "server-down-client-state");
  await delay(Math.max(0, RESTART_DOWN_MS - (elapsedMs() - downtimeStartMs)));
  assert.equal(await requestJson("/api/health", 500).then(() => true).catch(() => false), false, "HTTPS health must be unavailable during the bounded process downtime.");
  const oldSourceStateAfterStop = await readSyntheticState(host);
  report.media.oldSourcesEnded = Boolean(oldSourceStateAfterStop?.sources.length && oldSourceStateAfterStop.sources.every((source) => source.readyState === "ended"));
  assert.equal(report.media.oldSourcesEnded, true, "Host media tracks from the old process must end after the actual process stop.");
  report.processRuns[0].oldHostTracksEnded = report.media.oldSourcesEnded;
  stage("owned-process-stopped-while-sources-active", { pid: report.processRuns[0].pid, stopMode: report.processRuns[0].stopMode, oldHostTracksEnded: report.media.oldSourcesEnded, downWindowMsAtLeast: RESTART_DOWN_MS });

  phase = "server_starting";
  await launchOwnedServer("restarted");
  await assertHealthAndStaticRooms("restarted-server");
  phase = "resume_rejected";
  for (const client of clients.values()) await waitForInvalidResume(client, restartStartMs);
  restartWindow.endedAtElapsedMs = elapsedMs();
  report.phases.restartConnectionWindow = { startedAtElapsedMs: restartWindow.startedAtElapsedMs, endedAtElapsedMs: restartWindow.endedAtElapsedMs, completedAt: new Date().toISOString() };
  assert.equal(report.resumeProofs.clients.every((item) => item.errorCode === "resume_invalid"), true);
  for (const client of clients.values()) {
    const sinceRestart = (type) => countAllControls(client, "sent", type, restartStartMs);
    assert.equal(sinceRestart("join"), 0, client.name + " must not auto-join anonymously after the old proof is rejected.");
    assert.equal(sinceRestart("host.claim"), 0, client.name + " must not auto-claim host after restart.");
    assert.equal(sinceRestart("audio.start"), 0, client.name + " must not auto-restart audio publication.");
    assert.equal(sinceRestart("screen.start"), 0, client.name + " must not auto-restart screen publication.");
    assert.equal(sinceRestart("audio.subscribe"), 0, client.name + " must not auto-subscribe after the old proof is rejected.");
    assert.equal(sinceRestart("screen.subscribe"), 0, client.name + " must not auto-subscribe after the old proof is rejected.");
  }
  report.phases.afterRestartBeforeManualRejoin = Object.fromEntries([...clients].map(([name, client]) => [name, {
    identity: report.phases.beforeRestart[name].identity,
    statusTextObserved: true,
    resumeInvalid: true,
    automaticJoinCount: report.resumeProofs.clients.find((item) => item.client === name)?.autoAnonymousJoinCount ?? 0,
    automaticHostClaimCount: report.resumeProofs.clients.find((item) => item.client === name)?.autoHostClaimCount ?? 0,
    automaticAudioStartCount: report.resumeProofs.clients.find((item) => item.client === name)?.autoAudioStartCount ?? 0,
    automaticScreenStartCount: report.resumeProofs.clients.find((item) => item.client === name)?.autoScreenStartCount ?? 0,
  }]));
  phase = "manual_rejoin";
  const downHealth = await requestJson("/api/health");
  assert.equal(downHealth.body?.persistence, "process-memory");

  phase = "manual_rejoin";
  const newHost = await manualRejoin(host, "T18 host after restart", livePassword);
  report.manualRejoin.passwordGate = host.passwordGateAfterRestart;
  report.manualRejoin.newParticipantIds.host = newHost.participantId;
  const emptyRoomAfterFirstJoin = phaseSnapshot(host);
  assert.equal(emptyRoomAfterFirstJoin.room.memberCount, 1, "First explicit post-restart join should see an empty studio except for itself.");
  assert.deepEqual(emptyRoomAfterFirstJoin.room.memberIds, [newHost.participantId]);
  assert.equal(emptyRoomAfterFirstJoin.interaction.historyCount, 0, "No new server history should be present before a new chat submission.");
  assert.equal(emptyRoomAfterFirstJoin.interaction.feedbackCounts.like ?? 0, 0);
  assert.equal(emptyRoomAfterFirstJoin.interaction.feedbackCounts["want-listen"] ?? 0, 0);
  assert.equal(emptyRoomAfterFirstJoin.interaction.feedbackCounts.useful ?? 0, 0);
  assert.equal(emptyRoomAfterFirstJoin.room.locked, true, "Startup lock should be reconstructed from startup configuration.");
  report.interactions.afterRestartFeedbackCount = emptyRoomAfterFirstJoin.interaction.feedbackCounts.like ?? 0;
  assert.equal(report.interactions.afterRestartFeedbackCount, 0, "Fresh server feedback statistics should be zero.");
  report.phases.firstManualJoinAfterRestart = emptyRoomAfterFirstJoin;
  assert.equal(initialIdentities.host.participantId === newHost.participantId, false);

  const newWatch = await manualRejoin(watch, "T18 watch after restart", startupPassword);
  const newRevoked = await manualRejoin(revoked, "T18 revoked rejoin", startupPassword);
  report.manualRejoin.newParticipantIds.watch = newWatch.participantId;
  report.manualRejoin.newParticipantIds.revoked = newRevoked.participantId;
  report.manualRejoin.newIdsDiffer = Object.entries(initialIdentities).every(([name, identity]) => report.manualRejoin.newParticipantIds[name] !== identity.participantId);
  assert.equal(report.manualRejoin.newIdsDiffer, true, "Every manual rejoin should receive a new server participant ID.");
  const recoveredSnapshot = phaseSnapshot(host);
  report.phases.afterManualRejoin = Object.fromEntries([...clients].map(([name, client]) => [name, phaseSnapshot(client)]));
  report.grants.postRestartGrantCount = report.phases.afterManualRejoin.host.grantIds.length;
  assert.equal(report.grants.postRestartGrantCount, 0, "The restarted host claim should have no prior publisher grants.");
  assert.equal(latestControl(revoked, "received", "host.publishPermission")?.allowed, false, "The rejoined revoked participant should not be a publisher.");
  report.manualRejoin.publisherPermissionAfterRevoke = latestControl(revoked, "received", "host.publishPermission")?.allowed === false;
  assert.equal(recoveredSnapshot.room.locked, true);
  await claimHost(host);
  report.manualRejoin.hostClaimedAgain = true;
  const freshClaim = latestControl(host, "received", "host.claimed");
  assert.equal(freshClaim.publisherGrantIds.length, 0);
  const hostPasswordFill = host.page.getByTestId("host-meeting-password");
  if (await hostPasswordFill.isVisible().catch(() => false)) await hostPasswordFill.fill("");
  await saveScreenshot(watch, "after-manual-rejoin-before-republish.png", "after-manual-rejoin-before-republish");
  stage("manual-normal-join-used-new-identities-and-startup-password", { newIdsDiffer: report.manualRejoin.newIdsDiffer, firstJoinMemberCount: emptyRoomAfterFirstJoin.room.memberCount, firstJoinHistoryCount: emptyRoomAfterFirstJoin.interaction.historyCount, firstJoinStudioLocked: emptyRoomAfterFirstJoin.room.locked, hostClaimedAgain: report.manualRejoin.hostClaimedAgain, oldGrantCount: report.grants.postRestartGrantCount });

  phase = "publish_authorization_probe";
  const permission = latestControl(revoked, "received", "host.publishPermission");
  assert.equal(permission?.allowed, false);
  const probe = await probePublishDenied(revoked);
  assert.equal(probe.audioDenied && probe.screenDenied, true);
  report.manualRejoin.publisherPermissionAfterRevoke = true;

  phase = "manual_media_restart";
  await startPublishing(host);
  await startReceiving(watch);
  const newAudioSource = await waitControl(watch, "received", "audio.stream", (item) => item.clockId && item.clockId !== oldClockIds.audio, MEDIA_WAIT_MS);
  const newScreenSource = await waitControl(watch, "received", "screen.stream", (item) => item.clockId && item.clockId !== oldClockIds.screen, MEDIA_WAIT_MS);
  const newSyntheticState = await readSyntheticState(host);
  report.manualRejoin.newSourceRequests = { audio: newSyntheticState?.audioRequests ?? 0, screen: newSyntheticState?.screenRequests ?? 0, allTracksLive: Boolean(newSyntheticState?.sources.length && newSyntheticState.sources.every((source) => source.readyState === "live")) };
  assert.deepEqual({ audio: report.manualRejoin.newSourceRequests.audio, screen: report.manualRejoin.newSourceRequests.screen }, { audio: 1, screen: 1 }, "Manual post-navigation source restart should capture one new synthetic audio and screen source.");
  report.manualRejoin.recoveredClockIds = { audio: newAudioSource.clockId, screen: newScreenSource.clockId };
  report.manualRejoin.sourceGenerations = { before: { audio: oldAudioSource.generation, screen: oldScreenSource.generation }, after: { audio: newAudioSource.generation, screen: newScreenSource.generation } };
  report.media.newClocksDiffer = newAudioSource.clockId !== oldClockIds.audio && newScreenSource.clockId !== oldClockIds.screen;
  assert.equal(report.media.newClocksDiffer, true, "Manually restarted sources must use new source clock IDs.");
  const firstRecoveredRender = await waitForRenderedMedia(watch, { audio: newAudioSource.clockId, screen: newScreenSource.clockId });
  const recoveredSamples = await sampleRenderedMedia(watch, "after-manual-rejoin", firstRecoveredRender);
  report.media.afterManualRejoin = { audioClockId: newAudioSource.clockId, screenClockId: newScreenSource.clockId, audioGeneration: newAudioSource.generation, screenGeneration: newScreenSource.generation, renderedSamples: recoveredSamples.final.audio.renderedSamples, renderedFrames: recoveredSamples.final.screen.renderedFrames, samples: recoveredSamples.samples };
  assert.equal(latestControl(revoked, "received", "host.publishPermission")?.allowed, false);
  assert.equal(controls(revoked, "sent", "audio.start").length, 0, "Revoked participant must never start a source in this run.");
  await saveScreenshot(watch, "after-manual-rejoin-media-rendering.png", "after-manual-rejoin-media-rendering");
  report.phases.afterManualRejoin = Object.fromEntries([...clients].map(([name, client]) => [name, phaseSnapshot(client)]));
  stage("manual-host-reclaim-new-sources-and-watch-render", { newClockIds: true, audioSamples: report.media.afterManualRejoin.renderedSamples, videoFrames: report.media.afterManualRejoin.renderedFrames, sampleCount: SAMPLE_COUNT, revokedPermissionDenied: true });

  phase = "complete";
  const downWindowMs = Date.parse(report.processRuns[1].startedAt) - Date.parse(report.processRuns[0].endedAt);
  report.phases.processRestart = { oldPid: report.processRuns[0].pid, newPid: report.processRuns[1].pid, oldPidDifferentFromNewPid: report.processRuns[0].pid !== report.processRuns[1].pid, oldStopMode: report.processRuns[0].stopMode, oldSignalSent: report.processRuns[0].signalSent, downWindowMs, resumeAndManualRecoveryElapsedMs: elapsedMs() - restartStartMs, browserProfilesSameAcrossRestart: true };
  assert.notEqual(report.processRuns[0].pid, report.processRuns[1].pid, "Restart must use a new server process PID.");
  assert.equal(report.processRuns[0].oldHostTracksEnded, true);
  assert.equal(report.manualRejoin.newIdsDiffer, true);
  assert.equal(report.media.newClocksDiffer, true);
  stage("operational-rebuild-pass-with-durable-restoration-explicitly-unresolved", { operationalPass: true, dynamicStateRestored: false, productNoGo: true });
} catch (error) {
  failure = error;
  console.error("[T18] failure: " + redact(error?.message ?? error));
} finally {
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
    console.error("[T18] report write failure: " + redact(error?.message ?? error));
    process.exitCode = 1;
  }
}

if (report.status !== "passed") process.exitCode = 1;
