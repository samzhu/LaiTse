import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { LocalTcpFaultProxy } from "./local-tcp-fault-proxy.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratchRoot = resolve(root, ".scratch/final01");
const outputRoot = join(scratchRoot, "network");
const harnessRoot = join(scratchRoot, "network-harness");
const runId = `${Date.now()}-${process.pid}-${randomUUID()}`;
const profileRoot = join(harnessRoot, "profiles", `run-${runId}`);
const requestedOutput = process.env.FINAL01_OUTPUT_DIR;
const outputDirectory = requestedOutput ? resolve(root, requestedOutput) : join(outputRoot, `run-${runId}`);
const outputRelative = relative(outputRoot, outputDirectory);
if (outputDirectory === outputRoot || isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(`..${sep}`)) {
  throw new Error("FINAL01_OUTPUT_DIR must stay below .scratch/final01/network.");
}
if (existsSync(outputDirectory)) throw new Error("The requested final01 network output directory already exists.");

const appURL = process.env.FINAL01_APP_URL ?? "";
if (!appURL) throw new Error("FINAL01_APP_URL must name the root-managed private application origin.");
const appTarget = new URL(appURL);
if (appTarget.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(appTarget.hostname) ||
    appTarget.username || appTarget.password || appTarget.search || appTarget.hash || appTarget.pathname !== "/" || appTarget.port === "4174") {
  throw new Error("FINAL01_APP_URL must be a private loopback HTTP app root and must not use the human-reserved port 4174.");
}
const upstreamHost = appTarget.hostname.replace(/^\[|\]$/gu, "");
const upstreamPort = Number(appTarget.port || 80);

const EXPECTED_PING_INTERVAL_MS = Number(process.env.FINAL01_EXPECTED_PING_INTERVAL_MS ?? 250);
const EXPECTED_PONG_TIMEOUT_MS = Number(process.env.FINAL01_EXPECTED_PONG_TIMEOUT_MS ?? 1_500);
const TRANSFER_TIMEOUT_MS = Math.max(8_000, EXPECTED_PING_INTERVAL_MS + EXPECTED_PONG_TIMEOUT_MS + 6_000);
const RECONNECT_TIMEOUT_MS = 20_000;
const DEFAULT_TIMEOUT_MS = 12_000;
const MEDIA_TIMEOUT_MS = 18_000;
const POLL_MS = 50;
const MAX_STAGES = 24;
const MAX_CONTROL_EVENTS = 180;
const MAX_MANAGEMENT_STATES = 48;
const MAX_PAGE_ERRORS = 12;
const MAX_QUEUE_BYTES = 512 * 1_024;
const MAX_QUEUE_CHUNKS = 256;
const AUDIO_FREQUENCIES_HZ = { A: 523, B: 761 };
const SCREEN_RGB = [44, 133, 196];
const ROOM_PASSWORD = randomBytes(24).toString("base64url");
const SECRETS = new Set([ROOM_PASSWORD]);
const SOAK_MS = Number(process.env.FINAL01_SOAK_MS ?? 0);
const PROXY_DELAY_MS = Number(process.env.FINAL01_PROXY_DELAY_MS ?? 0);
const PROXY_BYTES_PER_SECOND = Number(process.env.FINAL01_PROXY_BYTES_PER_SECOND ?? 0);
if (!Number.isSafeInteger(EXPECTED_PING_INTERVAL_MS) || EXPECTED_PING_INTERVAL_MS < 100 || EXPECTED_PING_INTERVAL_MS > 5_000 ||
    !Number.isSafeInteger(EXPECTED_PONG_TIMEOUT_MS) || EXPECTED_PONG_TIMEOUT_MS < 500 || EXPECTED_PONG_TIMEOUT_MS > 60_000) {
  throw new Error("Expected liveness timing env values are outside the supported smoke range.");
}
if (!Number.isSafeInteger(SOAK_MS) || SOAK_MS < 0 || SOAK_MS > 300_000) {
  throw new Error("FINAL01_SOAK_MS must be an integer from 0 through 300000.");
}
if (!Number.isSafeInteger(PROXY_DELAY_MS) || PROXY_DELAY_MS < 0 || PROXY_DELAY_MS > 100 ||
    !Number.isSafeInteger(PROXY_BYTES_PER_SECOND) || PROXY_BYTES_PER_SECOND < 0 ||
    (PROXY_BYTES_PER_SECOND > 0 && (PROXY_BYTES_PER_SECOND < 256 * 1_024 || PROXY_BYTES_PER_SECOND > 2 * 1_024 * 1_024))) {
  throw new Error("Use only a small local proxy delay (0–100 ms) and an optional rate from 256 KiB/s through 2 MiB/s.");
}

const BROWSERS = {
  chrome: { label: "Google Chrome", executable: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
  edge: { label: "Microsoft Edge", executable: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
};
for (const browser of Object.values(BROWSERS)) {
  if (!existsSync(browser.executable)) throw new Error(`${browser.label} executable was not found at its installed application path.`);
}
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, ".tools/playwright-browsers");
const { chromium } = await import("playwright");

const CLIENTS = [
  { key: "A", name: "Final01-A", browser: "chrome", proxied: true },
  { key: "B", name: "Final01-B", browser: "edge", proxied: false },
  { key: "C", name: "Final01-C", browser: "chrome", proxied: false },
];
const contexts = [];
const clients = new Map();
const startedAtMs = Date.now();
const headless = process.env.FINAL01_HEADLESS !== "0";
const proxy = new LocalTcpFaultProxy({
  upstreamHost,
  upstreamPort,
  delayMs: PROXY_DELAY_MS,
  bytesPerSecond: PROXY_BYTES_PER_SECOND,
  maxQueuedBytes: MAX_QUEUE_BYTES,
  maxQueuedChunks: MAX_QUEUE_CHUNKS,
});
let failure = null;

const report = {
  schemaVersion: 1,
  purpose: "Short local Chrome/Edge synthetic audio, screen decode, TCP blackhole, liveness handover, and proof-based participant resume smoke.",
  startedAt: new Date().toISOString(),
  finishedAt: null,
  durationMs: null,
  status: "running",
  outputDirectory: relative(root, outputDirectory),
  application: {
    origin: appTarget.origin,
    configuredByRoot: true,
    expectedConnectionLiveness: {
      pingIntervalMs: EXPECTED_PING_INTERVAL_MS,
      pongTimeoutMs: EXPECTED_PONG_TIMEOUT_MS,
      note: "Expected values supplied by the root-managed createApp test seam; the harness observes resulting peer state, not the timer internals.",
    },
  },
  runtime: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    os: process.platform === "darwin" ? runVersion("/usr/bin/sw_vers", ["-productVersion"]) : `${os.type()} ${os.release()}`,
    headless,
    browsers: Object.fromEntries(Object.entries(BROWSERS).map(([key, browser]) => [key, {
      name: browser.label,
      executableVersion: runVersion(browser.executable, ["--version"]),
      playwrightVersion: "not-launched",
    }])),
  },
  topology: {
    room: "studio",
    participants: Object.fromEntries(CLIENTS.map(({ key, name, browser: browserName, proxied }) => [key, { name, browser: browserName, proxiedThroughOwnedLoopbackProxy: proxied }])),
    proxyBoundary: "A alone uses an ephemeral 127.0.0.1 listener. It forwards raw TCP to the separate private app. B and C connect directly to that private app.",
    initialMedia: "A and B publish distinct synthetic Opus audio; A publishes a synthetic canvas screen; C uses native browser WebCodecs decode and AudioWorklet PCM output for both sources and decodes/renders the screen.",
    realPeopleOrDevices: false,
  },
  syntheticSources: {
    audio: "getUserMedia is replaced only in each isolated test page with oscillator-backed MediaStreamDestination tracks.",
    audioFrequencyHz: AUDIO_FREQUENCIES_HZ,
    screen: "A getDisplayMedia call is replaced only in A's page with an animated canvas captureStream.",
    screenColorRgb: SCREEN_RGB,
    nativePermissionPickerUsed: false,
    physicalMicrophoneSelected: false,
    physicalDisplaySelected: false,
    systemNetworkSettingsChanged: false,
    systemFakePermissionFlags: false,
    mediaPayloadsStored: false,
  },
  proxy: {
    implementation: "local raw TCP forwarder; no WebSocket frame rewriting",
    listenerHost: "127.0.0.1",
    delayMs: PROXY_DELAY_MS,
    bytesPerSecond: PROXY_BYTES_PER_SECOND,
    maxQueuedBytesPerDirection: MAX_QUEUE_BYTES,
    maxQueuedChunksPerDirection: MAX_QUEUE_CHUNKS,
    overflowBehavior: "destroy the affected pair when the bounded delay/rate queue exceeds its cap; never discard arbitrary bytes and keep the stream active",
    blackholeBehavior: "discard all bytes both ways for A's WebSocket pair, suppress the upstream close/FIN while blackholed, then destroy old pairs before fresh TCP reconnects are forwarded",
    snapshots: [],
  },
  checks: [],
  mediaSnapshots: [],
  privacy: {
    rawControlFramesRetained: false,
    rawMediaPayloadsRetained: false,
    passwordValuesRetained: false,
    sessionProofsOrTokensRetained: false,
    participantIdentifiersRetained: false,
    browserStorageDumped: false,
    metadataBounded: true,
  },
  limits: {
    physicalNetwork: "not-tested; this is a local TCP proxy on one computer, not Wi-Fi, WAN, cellular, Cloud Run, or a packet-loss model",
    syntheticMedia: "not-tested with physical microphones, OS screen picker, human listeners, or multiple physical devices",
    humanAudioVideoSync: "not-measured; source timestamp offsets, if shown by the app, are not human-observed synchronization or calibrated p95 latency",
    longDurationAndQuality: SOAK_MS > 0 ? `optional local post-recovery soak ${SOAK_MS} ms; not a 65-minute or quality claim` : "not-tested; no soak requested",
    capacityAndCloud: "not-tested; no capacity, cloud deployment, or Cloud Run claim",
  },
  errors: { pageErrors: [], cleanupErrors: [], failure: null },
  cleanup: { contextsClosed: 0, profilesRemoved: false, proxyClosed: false },
};

function runVersion(executable, args) {
  try {
    return execFileSync(executable, args, { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "pipe"] })
      .trim().replace(/[\r\n\t ]+/gu, " ").slice(0, 160);
  } catch {
    return "version-query-failed";
  }
}

function elapsedMs() {
  return Date.now() - startedAtMs;
}

function stage(name, details = {}) {
  if (report.checks.length >= MAX_STAGES) throw new Error("The bounded final01 network smoke stage limit was reached.");
  report.checks.push({ name, atMs: elapsedMs(), ...details });
  console.log(`[FINAL01-NET] ${name}`);
}

function boundedError(error) {
  let value = String(error?.message ?? error);
  for (const secret of SECRETS) if (secret) value = value.split(secret).join("[redacted]");
  return value.replace(/[\r\n\t]+/gu, " ").slice(0, 280);
}

async function waitFor(predicate, label, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, POLL_MS));
  }
  throw new Error(`${label} was not observed within ${timeoutMs} ms${lastError ? ` (${boundedError(lastError)})` : ""}.`);
}

function pushBounded(array, value, cap, label) {
  if (array.length < cap) {
    array.push(value);
    return true;
  }
  throw new Error(`${label} exceeded its bounded observation cap (${cap}).`);
}

function observeControl(client, direction, payload) {
  if (typeof payload !== "string") return;
  let message;
  try { message = JSON.parse(payload); } catch { return; }
  if (!message || typeof message !== "object" || Array.isArray(message) || typeof message.type !== "string") return;
  const type = message.type;
  if (type === "session.issued") {
    client.controlCounts.issued += 1;
    if (direction === "received" && typeof message.participantId === "string") pushBounded(client.issuedIds, message.participantId, 8, `${client.name} issued IDs`);
  } else if (type === "session.resumed") {
    client.controlCounts.resumed += 1;
    if (direction === "received" && typeof message.participantId === "string") pushBounded(client.resumedIds, message.participantId, 8, `${client.name} resumed IDs`);
  } else if (type === "room.management.state" && direction === "received" && message.roomId === "studio") {
    const state = {
      roomId: "studio",
      isLocked: message.isLocked === true,
      canLock: message.canLock === true,
      lockKind: ["none", "legacy", "anonymous"].includes(message.lockKind) ? message.lockKind : "unknown",
      isOwner: message.isOwner === true,
      ownerId: typeof message.ownerParticipantId === "string" ? message.ownerParticipantId : null,
      memberIds: Array.isArray(message.members)
        ? message.members.filter((member) => typeof member?.id === "string").map((member) => member.id).slice(0, 12)
        : null,
    };
    pushBounded(client.managementStates, state, MAX_MANAGEMENT_STATES, `${client.name} room management states`);
  } else if (["room.management.result", "room.management.error", "protocol.error"].includes(type)) {
    client.controlCounts[type] = (client.controlCounts[type] ?? 0) + 1;
  }
  client.controlCounts.observed += 1;
  if (client.controlCounts.observed > MAX_CONTROL_EVENTS) throw new Error(`${client.name} exceeded the bounded control observation cap.`);
}

function installSocketObserver(client) {
  client.page.on("websocket", (socket) => {
    if (!socket.url().includes("/ws")) return;
    client.websocketCount += 1;
    socket.on("framereceived", (event) => observeControl(client, "received", typeof event === "string" ? event : event?.payload));
    socket.on("framesent", (event) => observeControl(client, "sent", typeof event === "string" ? event : event?.payload));
    socket.on("close", () => { client.websocketCloseCount += 1; });
  });
}

async function installSyntheticMedia(page, key) {
  await page.addInitScript(({ frequency, color }) => {
    const state = { contexts: [], tracks: [], oscillators: [], animationFrameId: null, stopAll: null };
    Object.defineProperty(window, "__final01SyntheticMedia", { value: state, configurable: false });
    const devices = navigator.mediaDevices;
    Object.defineProperty(devices, "getUserMedia", {
      configurable: true,
      value: async () => {
        if (state.contexts.length >= 4) throw new Error("Final01 synthetic audio context cap reached.");
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
        for (const track of destination.stream.getTracks()) {
          state.tracks.push(track);
          const originalStop = track.stop.bind(track);
          track.stop = () => {
            try { originalStop(); } finally {
              try { oscillator.stop(); } catch { /* Already stopped. */ }
              void context.close().catch(() => {});
            }
          };
        }
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
        if (!drawing) throw new Error("Final01 synthetic canvas context is unavailable.");
        let active = true;
        let phase = 0;
        const draw = () => {
          if (!active) return;
          drawing.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
          drawing.fillRect(0, 0, canvas.width, canvas.height);
          drawing.fillStyle = "#fff";
          drawing.fillRect(12 + (phase % 230), 14, 42, 12);
          phase += 4;
          state.animationFrameId = requestAnimationFrame(draw);
        };
        draw();
        const stream = canvas.captureStream(10);
        const track = stream.getVideoTracks()[0];
        if (!track) throw new Error("Final01 synthetic canvas did not create a video track.");
        state.tracks.push(track);
        const originalStop = track.stop.bind(track);
        track.stop = () => {
          active = false;
          if (state.animationFrameId !== null) cancelAnimationFrame(state.animationFrameId);
          state.animationFrameId = null;
          originalStop();
        };
        return stream;
      },
    });
    state.stopAll = async () => {
      if (state.animationFrameId !== null) cancelAnimationFrame(state.animationFrameId);
      state.animationFrameId = null;
      for (const track of state.tracks) {
        try { track.stop(); } catch { /* Best-effort local synthetic cleanup. */ }
      }
      for (const oscillator of state.oscillators) {
        try { oscillator.stop(); } catch { /* Already stopped. */ }
      }
      await Promise.all(state.contexts.map((context) => context.close().catch(() => {})));
    };
  }, { frequency: AUDIO_FREQUENCIES_HZ[key] ?? AUDIO_FREQUENCIES_HZ.A, color: SCREEN_RGB });
}

async function launchClient(definition, proxiedURL) {
  const profileDirectory = join(profileRoot, definition.key);
  mkdirSync(profileDirectory, { recursive: true, mode: 0o700 });
  const browser = BROWSERS[definition.browser];
  const context = await chromium.launchPersistentContext(profileDirectory, {
    executablePath: browser.executable,
    headless,
    viewport: { width: 1360, height: 1000 },
    colorScheme: "light",
  });
  context.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
  const page = context.pages()[0] ?? await context.newPage();
  const client = {
    ...definition,
    baseURL: definition.proxied ? proxiedURL : appTarget.origin,
    profileDirectory,
    context,
    page,
    issuedIds: [],
    resumedIds: [],
    managementStates: [],
    websocketCount: 0,
    websocketCloseCount: 0,
    pageErrorCount: 0,
    controlCounts: { issued: 0, resumed: 0, observed: 0 },
  };
  contexts.push(context);
  clients.set(definition.key, client);
  page.on("pageerror", () => {
    if (report.errors.pageErrors.length < MAX_PAGE_ERRORS) report.errors.pageErrors.push({ client: client.name, atMs: elapsedMs() });
  });
  installSocketObserver(client);
  await installSyntheticMedia(page, definition.key);
  report.runtime.browsers[definition.browser].playwrightVersion = context.browser()?.version() ?? "not-reported";
  return client;
}

function latestManagement(client) {
  return client.managementStates.at(-1) ?? null;
}

function audioRows(audio) {
  return Array.isArray(audio?.sources) ? audio.sources.filter((source) => source.active && Number.isInteger(source.generation)) : [];
}

async function readAudio(client) {
  return client.page.locator('[data-testid="audio-panel"]').evaluate((panel) => {
    const number = (name) => Number(panel.getAttribute(name) ?? 0);
    let raw = [];
    try { raw = JSON.parse(panel.getAttribute("data-audio-streams") ?? "[]"); } catch { raw = []; }
    return {
      roomId: panel.getAttribute("data-room-id"),
      publisherState: panel.getAttribute("data-publisher-state"),
      publisherGeneration: Number.isInteger(Number(panel.getAttribute("data-publisher-generation"))) && panel.getAttribute("data-publisher-generation") !== ""
        ? Number(panel.getAttribute("data-publisher-generation"))
        : null,
      receiverSubscribed: panel.getAttribute("data-receiver-subscribed") === "true",
      listenerState: panel.getAttribute("data-listener-state"),
      sentPackets: number("data-sent-packets"),
      receivedPackets: number("data-received-packets"),
      decodedFrames: number("data-decoded-frames"),
      renderedSamples: number("data-rendered-samples"),
      renderRms: number("data-render-rms"),
      localDecodeDrops: number("data-audio-decode-queue-dropped-packets"),
      sources: Array.isArray(raw) ? raw.slice(0, 12).map((source) => ({
        generation: Number.isInteger(source?.generation) ? source.generation : null,
        active: source?.active === true,
        receivedPackets: Number(source?.receivedPackets ?? 0),
        decodedFrames: Number(source?.decodedFrames ?? 0),
        renderedPcmSamples: Number(source?.renderedPcmSamples ?? 0),
        renderRms: Number(source?.renderRms ?? 0),
        localDecodeDrops: Number(source?.decodeQueueDroppedPackets ?? 0),
        errorPresent: typeof source?.error === "string" && source.error.length > 0,
      })) : [],
    };
  });
}

async function readScreen(client) {
  return client.page.locator('[data-testid="screen-panel"]').evaluate((panel) => {
    const number = (name) => Number(panel.getAttribute(name) ?? 0);
    return {
      publisherState: panel.getAttribute("data-publisher-state"),
      receiverState: panel.getAttribute("data-receiver-state"),
      receiverSubscribed: panel.getAttribute("data-receiver-subscribed") === "true",
      receivedFrames: number("data-received-frames"),
      decodedFrames: number("data-decoded-frames"),
      renderedFrames: number("data-rendered-frames"),
      width: number("data-rendered-width"),
      height: number("data-rendered-height"),
    };
  });
}

async function joinRoom(client) {
  await client.page.goto(`${client.baseURL}/?room=studio&mode=watch`, { waitUntil: "domcontentloaded" });
  await client.page.getByRole("heading", { name: "Local room presence" }).waitFor();
  await client.page.getByLabel("Your display name").fill(client.name);
  await client.page.getByRole("button", { name: "Join room" }).click();
  await waitFor(() => client.issuedIds.length > 0, `${client.name} issues a session proof`);
  await client.page.waitForFunction(() => {
    const status = document.querySelector('[data-testid="control-connection-status"]');
    return /Connected to/u.test(status?.textContent ?? "");
  }, undefined, { timeout: DEFAULT_TIMEOUT_MS });
  await waitFor(() => latestManagement(client)?.roomId === "studio", `${client.name} receives studio management state`);
  const state = latestManagement(client);
  assert.ok(client.issuedIds[0], `${client.name} must receive a participant ID.`);
  return { participantId: client.issuedIds[0], state };
}

async function lockRoom(client) {
  const state = latestManagement(client);
  assert.ok(state?.canLock === true && state.isLocked === false, "The private final01 fixture must start with an unlocked anonymously managed studio room.");
  await client.page.getByTestId("room-management-begin-lock").click();
  const password = client.page.getByTestId("room-management-password");
  await password.waitFor({ state: "visible" });
  await password.fill(ROOM_PASSWORD);
  await client.page.getByTestId("room-management-lock").click();
  await waitFor(() => {
    const latest = latestManagement(client);
    return latest?.isOwner && latest.ownerId === client.issuedIds[0] && latest.isLocked ? latest : null;
  }, "A becomes the anonymous studio manager after locking", DEFAULT_TIMEOUT_MS);
  await waitFor(async () => (await password.inputValue().catch(() => "")) === "", "A's room password field clears");
}

async function startPublisher(client) {
  const before = await readAudio(client);
  await client.page.locator('[data-testid="audio-start-publishing"]').click();
  return await waitFor(async () => {
    const audio = await readAudio(client);
    return audio.publisherState === "broadcasting" && audio.sentPackets >= 5 && Number.isInteger(audio.publisherGeneration) &&
      audio.publisherGeneration !== before.publisherGeneration ? audio : null;
  }, `${client.name} publishes a synthetic Opus source`, MEDIA_TIMEOUT_MS);
}

async function startListening(client) {
  await client.page.locator('[data-testid="audio-start-listening"]').click();
  return await waitFor(async () => {
    const audio = await readAudio(client);
    return audio.receiverSubscribed && ["ready", "suspended"].includes(audio.listenerState) ? audio : null;
  }, `${client.name} subscribes to room audio`, MEDIA_TIMEOUT_MS);
}

async function startScreen(client) {
  await client.page.getByRole("button", { name: "開始分享畫面" }).click();
  await waitFor(async () => (await readScreen(client)).publisherState === "sharing", `${client.name} starts the synthetic canvas source`, MEDIA_TIMEOUT_MS);
}

async function waitForDecodedSources(client, expectedGenerations, label) {
  const expected = [...expectedGenerations].sort((a, b) => a - b);
  return await waitFor(async () => {
    const audio = await readAudio(client);
    const rows = audioRows(audio).sort((a, b) => a.generation - b.generation);
    const generations = rows.map((row) => row.generation).sort((a, b) => a - b);
    if (JSON.stringify(generations) !== JSON.stringify(expected)) return null;
    if (!rows.every((row) => row.receivedPackets > 0 && row.decodedFrames > 0 && row.renderedPcmSamples > 0 && row.renderRms > 0 && !row.errorPresent)) return null;
    return { ...audio, activeSources: rows };
  }, `${client.name} decodes/renders ${label} through WebCodecs and AudioWorklet PCM`, MEDIA_TIMEOUT_MS);
}

async function waitForScreen(client, label = "screen decode/render") {
  return await waitFor(async () => {
    const screen = await readScreen(client);
    return screen.receiverSubscribed && screen.receivedFrames > 0 && screen.decodedFrames > 0 && screen.renderedFrames >= 3 && screen.width > 0 && screen.height > 0
      ? screen
      : null;
  }, `${client.name} ${label}`, MEDIA_TIMEOUT_MS);
}

async function waitForOwner(peers, predicate, label, timeoutMs = TRANSFER_TIMEOUT_MS) {
  return await waitFor(() => {
    for (const client of peers) {
      const state = latestManagement(client);
      if (state && predicate(state, client)) return { client, state };
    }
    return null;
  }, label, timeoutMs);
}

async function handleResumeGate(client, password, resumedCountBefore) {
  const deadline = Date.now() + RECONNECT_TIMEOUT_MS;
  let passwordWasRequested = false;
  while (Date.now() < deadline && client.resumedIds.length <= resumedCountBefore) {
    const dialog = client.page.getByRole("dialog");
    if (await dialog.isVisible().catch(() => false)) {
      passwordWasRequested = true;
      const field = client.page.getByLabel("Meeting room password");
      await field.fill(password);
      await client.page.getByRole("button", { name: "Enter room" }).click();
      break;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, POLL_MS));
  }
  await waitFor(() => client.resumedIds.length > resumedCountBefore, `${client.name} resumes its same participant session`, RECONNECT_TIMEOUT_MS);
  return passwordWasRequested;
}

function summarizeMedia(client, audio, screen = null) {
  return {
    client: client.key,
    publisherState: audio?.publisherState ?? null,
    publisherGeneration: audio?.publisherGeneration ?? null,
    sentPackets: audio?.sentPackets ?? null,
    activeSourceCount: audioRows(audio).length,
    sources: audioRows(audio).slice(0, 4).map((source) => ({
      generation: source.generation,
      receivedPackets: source.receivedPackets,
      decodedFrames: source.decodedFrames,
      renderedPcmSamples: source.renderedPcmSamples,
      renderRms: source.renderRms,
      localDecodeDrops: source.localDecodeDrops,
    })),
    screen: screen ? {
      publisherState: screen.publisherState,
      receiverState: screen.receiverState,
      receivedFrames: screen.receivedFrames,
      decodedFrames: screen.decodedFrames,
      renderedFrames: screen.renderedFrames,
      width: screen.width,
      height: screen.height,
    } : null,
  };
}

async function switchToLobby(client) {
  await client.page.locator('[data-room-choice="lobby"]').click();
  await waitFor(() => client.page.locator('[data-testid="interaction-room"]').textContent().then((text) => text?.trim() === "lobby"), `${client.name} moves to lobby`);
}

async function interactionWhileOwnerOffline(B, C) {
  const counters = [B, C].map((client) => client.page.getByTestId("feedback-like").locator(".interaction-feedback-count"));
  const before = await Promise.all(counters.map((locator) => locator.getAttribute("aria-label")));
  await C.page.getByTestId("feedback-like").click();
  await waitFor(async () => {
    const current = await Promise.all(counters.map((locator) => locator.getAttribute("aria-label")));
    return current.every((value, index) => value && value !== before[index] && /1 次/u.test(value));
  }, "healthy B and C exchange a room interaction while A is blackholed");
  return { bothHealthyPeersObservedInteraction: true };
}

async function runOptionalSoak(B, C, sourceGeneration) {
  if (SOAK_MS === 0) return;
  const intervals = Math.min(60, Math.max(1, Math.ceil(SOAK_MS / 1_000)));
  for (let index = 0; index < intervals; index += 1) {
    const before = await readAudio(C);
    const sourceBefore = before.sources.find((source) => source.generation === sourceGeneration && source.active);
    const bBefore = await readAudio(B);
    await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(1_000, SOAK_MS - index * 1_000)));
    const after = await readAudio(C);
    const sourceAfter = after.sources.find((source) => source.generation === sourceGeneration && source.active);
    const bAfter = await readAudio(B);
    assert.ok(sourceBefore && sourceAfter && sourceAfter.renderedPcmSamples > sourceBefore.renderedPcmSamples,
      "The healthy C PCM counter must advance during the optional post-recovery soak.");
    assert.ok(bAfter.sentPackets > bBefore.sentPackets, "The healthy B publisher counter must advance during the optional post-recovery soak.");
  }
  stage("optional-post-recovery-soak-kept-B-publishing-and-C-rendering", { requestedMs: SOAK_MS, checkedWindows: intervals });
}

async function runSmoke() {
  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(profileRoot, { recursive: true, mode: 0o700 });
  const proxyAddress = await proxy.listen(0);
  const proxiedURL = `http://${proxyAddress.host}:${proxyAddress.port}`;
  const A = await launchClient(CLIENTS[0], proxiedURL);
  const B = await launchClient(CLIENTS[1], appTarget.origin);
  const C = await launchClient(CLIENTS[2], appTarget.origin);
  report.runtime.browsers.chrome.playwrightVersion = A.context.browser()?.version() ?? report.runtime.browsers.chrome.playwrightVersion;
  report.runtime.browsers.edge.playwrightVersion = B.context.browser()?.version() ?? report.runtime.browsers.edge.playwrightVersion;
  report.proxy.snapshots.push({ phase: "listener-ready", ...proxy.getSnapshot() });

  const aSession = await joinRoom(A);
  const bSession = await joinRoom(B);
  const cSession = await joinRoom(C);
  assert.ok(new Set([aSession.participantId, bSession.participantId, cSession.participantId]).size === 3,
    "The private fixture must issue three distinct participant identities.");
  assert.ok(aSession.state.canLock && !aSession.state.isLocked, "The private studio fixture must start unlocked for A's normal UI lock flow.");
  stage("three isolated Chrome/Edge pages joined the private unlocked studio", { participantCount: 3, distinctServerIdentities: true });

  await lockRoom(A);
  const ownerAfterLock = latestManagement(A);
  assert.equal(ownerAfterLock?.ownerId, aSession.participantId);
  assert.equal(ownerAfterLock?.isLocked, true);
  stage("A locked the studio through the normal room-management UI", { lockKind: ownerAfterLock.lockKind });

  const aPublish = await startPublisher(A);
  const bPublish = await startPublisher(B);
  await startScreen(A);
  await startListening(C);
  await C.page.locator('[data-testid="screen-start-watching"]').click();
  const cInitialMedia = await waitForDecodedSources(C, [aPublish.publisherGeneration, bPublish.publisherGeneration], "two synthetic audio sources");
  const cInitialScreen = await waitForScreen(C, "decodes and renders the synthetic screen source");
  report.mediaSnapshots.push({ phase: "before-blackhole", receiver: summarizeMedia(C, cInitialMedia, cInitialScreen) });
  assert.equal(cInitialMedia.activeSources.length, 2);
  assert.ok(aPublish.sentPackets > 5 && bPublish.sentPackets > 5);
  stage("Chrome/Edge performed two-source Opus decode, PCM output, and screen decode/render", {
    audioSources: cInitialMedia.activeSources.length,
    pcmSources: cInitialMedia.activeSources.filter((source) => source.renderedPcmSamples > 0).length,
    screenRenderedFrames: cInitialScreen.renderedFrames,
  });

  await waitFor(() => proxy.getSnapshot().activeWebSocketPairs === 1, "A's proxied WebSocket pair becomes active", DEFAULT_TIMEOUT_MS);
  const proxyBeforeBlackhole = proxy.getSnapshot();
  const aCloseCountBefore = A.websocketCloseCount;
  const bPacketsBeforeBlackhole = (await readAudio(B)).sentPackets;
  const cSourceBBeforeBlackhole = cInitialMedia.activeSources.find((source) => source.generation === bPublish.publisherGeneration);
  assert.ok(proxyBeforeBlackhole.pairs.some((pair) => pair.isWebSocket && pair.upstreamConnected && pair.clientOpen),
    "The proxy must have the active A WebSocket before the fault begins.");
  proxy.blackholeWebSockets();
  const proxyWhileBlackholed = await waitFor(() => {
    const snapshot = proxy.getSnapshot();
    return snapshot.blackholeDiscardedClientBytes > 0 && snapshot.blackholeDiscardedServerBytes > 0 ? snapshot : null;
  }, "the A-owned raw TCP proxy discards bytes in both directions", 5_000);
  report.proxy.snapshots.push({ phase: "active-blackhole", ...proxyWhileBlackholed });
  const successor = await waitForOwner([B, C], (state, client) => state.isLocked && state.isOwner && state.ownerId === client.issuedIds[0],
    "server liveness expiry transfers ownership to an online studio member");
  assert.ok([bSession.participantId, cSession.participantId].includes(successor.state.ownerId), "The successor must be a live B or C room participant.");
  assert.notEqual(successor.state.ownerId, aSession.participantId, "The offline A participant cannot remain the room owner.");
  assert.equal(A.websocketCloseCount, aCloseCountBefore, "The local blackhole must keep A's browser WebSocket from observing a normal close before liveness expiry.");
  const proxyAfterLiveness = proxy.getSnapshot();
  const deadWebSocketPair = proxyAfterLiveness.pairs.find((pair) => pair.isWebSocket && pair.blackholed);
  assert.ok(deadWebSocketPair && deadWebSocketPair.clientOpen && !deadWebSocketPair.upstreamOpen,
    "The server must have terminated its side while the blackholed browser-side TCP connection stays open.");
  stage("server liveness expired the blackholed A socket and a legal B/C member became owner", {
    successorIsLiveRoomPeer: true,
    successorIsA: false,
    browserSawCloseBeforeHandover: false,
    serverSideSocketTerminated: true,
  });

  const cAfterHandover = await waitForDecodedSources(C, [bPublish.publisherGeneration], "the surviving B source after A disconnects");
  const cSourceBAfterHandover = cAfterHandover.activeSources[0];
  assert.ok(cSourceBBeforeBlackhole && cSourceBAfterHandover.renderedPcmSamples > cSourceBBeforeBlackhole.renderedPcmSamples,
    "C must continue rendering new PCM from healthy B while A is offline.");
  const bAfterHandover = await readAudio(B);
  assert.ok(bAfterHandover.sentPackets > bPacketsBeforeBlackhole, "B must continue publishing while A is blackholed.");
  const screenClearedAfterA = await waitFor(async () => {
    const screen = await readScreen(C);
    return screen.receiverState === "waiting" && screen.width === 0 && screen.height === 0 ? screen : null;
  }, "A's ended screen source is removed and C clears the old decoded canvas", MEDIA_TIMEOUT_MS);
  const interactionCheck = await interactionWhileOwnerOffline(B, C);
  report.mediaSnapshots.push({ phase: "A-offline", receiver: summarizeMedia(C, cAfterHandover, screenClearedAfterA) });
  stage("healthy B/C kept PCM playback and room interaction after A went offline", {
    bPublisherAdvanced: true,
    cPcmAdvanced: true,
    staleAScreenCleared: true,
    interactionSeenByBothHealthyPeers: interactionCheck.bothHealthyPeersObservedInteraction,
  });

  const resumedCountBefore = A.resumedIds.length;
  const websocketCountBeforeRelease = proxy.getSnapshot().websocketConnections;
  proxy.releaseAndReconnect();
  const passwordWasRequested = await handleResumeGate(A, ROOM_PASSWORD, resumedCountBefore);
  const resumedId = A.resumedIds.at(-1);
  assert.equal(resumedId, aSession.participantId, "The new TCP socket must resume the original participant ID using the page's existing session proof.");
  const aResumedManagement = await waitFor(() => {
    const state = latestManagement(A);
    return state?.isLocked && !state.isOwner && state.ownerId === null && latestManagement(successor.client)?.isOwner ? state : null;
  }, "A resumes without reclaiming room management", RECONNECT_TIMEOUT_MS);
  await waitFor(() => proxy.getSnapshot().websocketConnections > websocketCountBeforeRelease && proxy.getSnapshot().activeWebSocketPairs === 1,
    "a fresh proxied TCP/WebSocket pair replaces the stale blackholed pair", RECONNECT_TIMEOUT_MS);
  const aResumedAudio = await readAudio(A);
  const aResumedScreen = await readScreen(A);
  assert.equal(aResumedAudio.publisherState, "idle", "A's old audio publication must not resume automatically.");
  assert.equal(aResumedScreen.publisherState, "idle", "A's old screen publication must not resume automatically.");
  const cAfterResume = await waitForDecodedSources(C, [bPublish.publisherGeneration], "B remains the only active source after A resumes");
  assert.ok(!audioRows(cAfterResume).some((source) => source.generation === aPublish.publisherGeneration), "A's old audio generation must remain absent after proof-based resume.");
  report.proxy.snapshots.push({ phase: "fresh-pair-after-resume", ...proxy.getSnapshot() });
  report.mediaSnapshots.push({ phase: "after-A-resume", receiver: summarizeMedia(C, cAfterResume, await readScreen(C)) });
  stage("A reconnected on a new TCP pair with the same identity and did not reclaim owner or old media", {
    resumedSameParticipantId: true,
    passwordPromptShownByRoomGate: passwordWasRequested,
    ownerRemainedBOrC: latestManagement(successor.client)?.ownerId === successor.state.ownerId,
    resumedNonOwnerReceivedNoPrivateOwnerIdentity: aResumedManagement.ownerId === null,
    oldAudioPublicationResumed: false,
    oldScreenPublicationResumed: false,
  });

  await runOptionalSoak(B, C, bPublish.publisherGeneration);

  const otherHealthyPeer = successor.client === B ? C : B;
  await switchToLobby(A);
  await switchToLobby(otherHealthyPeer);
  const ownerOnlyState = await waitFor(() => {
    const state = latestManagement(successor.client);
    if (!state?.isOwner || state.ownerId !== successor.client.issuedIds[0] || !state.isLocked) return null;
    const otherIds = [aSession.participantId, otherHealthyPeer.issuedIds[0]];
    return state.memberIds && otherIds.every((id) => !state.memberIds.includes(id)) ? state : null;
  }, "the online room owner is the only remaining studio candidate");
  await successor.client.page.getByTestId("control-leave").click();
  await waitForOwner([A, otherHealthyPeer], (state) => !state.isLocked && !state.isOwner && state.lockKind === "none",
    "the offline owner with no room candidates automatically unlocks the studio", DEFAULT_TIMEOUT_MS);
  stage("owner leaving with no remaining studio candidates automatically unlocked the room", {
    ownerWasOnlyStudioMember: ownerOnlyState.memberIds?.length === 1,
    unlockedObservedByRemainingParticipant: true,
  });

  const finalProxy = proxy.getSnapshot();
  assert.equal(finalProxy.queueOverflowResets, 0, "No delayed/rate-limited TCP queue overflow should be hidden in a passing run.");
  assert.equal(finalProxy.blackholeEnabled, false);
  assert.equal(report.errors.pageErrors.length, 0, "No browser page errors should occur in the short smoke.");
  report.proxy.snapshots.push({ phase: "final", ...finalProxy });
  stage("network smoke finished with bounded proxy queues and no unhandled page errors", {
    proxyQueueOverflowResets: finalProxy.queueOverflowResets,
    browserPageErrors: report.errors.pageErrors.length,
  });
}

async function cleanup() {
  for (const client of clients.values()) {
    if (client.page.isClosed()) continue;
    try { await client.page.evaluate(async () => await window.__final01SyntheticMedia?.stopAll?.()); }
    catch { /* The browser may already be closing. */ }
  }
  for (const context of contexts) {
    try {
      await context.close();
      report.cleanup.contextsClosed += 1;
    } catch (error) {
      if (report.errors.cleanupErrors.length < 8) report.errors.cleanupErrors.push(boundedError(error));
    }
  }
  try {
    rmSync(profileRoot, { recursive: true, force: true });
    report.cleanup.profilesRemoved = !existsSync(profileRoot);
  } catch (error) {
    if (report.errors.cleanupErrors.length < 8) report.errors.cleanupErrors.push(boundedError(error));
  }
  try {
    await proxy.close();
    report.cleanup.proxyClosed = true;
  } catch (error) {
    if (report.errors.cleanupErrors.length < 8) report.errors.cleanupErrors.push(boundedError(error));
  }
}

try {
  await runSmoke();
  report.status = "passed";
} catch (error) {
  failure = error;
  report.status = "failed";
  report.errors.failure = boundedError(error);
} finally {
  await cleanup();
  if (!report.cleanup.profilesRemoved || report.cleanup.contextsClosed !== contexts.length || !report.cleanup.proxyClosed || report.errors.cleanupErrors.length > 0) {
    report.status = "failed";
    report.errors.failure ??= "A browser profile, context, or owned proxy listener was not fully cleaned up.";
    failure ??= new Error(report.errors.failure);
  }
  report.finishedAt = new Date().toISOString();
  report.durationMs = elapsedMs();
  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(join(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

if (failure) {
  console.error(`[FINAL01-NET] failed: ${boundedError(failure)}`);
  process.exitCode = 1;
} else {
  console.log(`[FINAL01-NET] ${report.status}; report: ${relative(root, join(outputDirectory, "report.json"))}`);
}
