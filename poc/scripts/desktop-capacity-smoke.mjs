import { enterRepositoryRootForLegacyScript, repositoryRoot, pocRoot } from "./lib/project-paths.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import os from "node:os";

enterRepositoryRootForLegacyScript();

const root = repositoryRoot;
const harnessRoot = resolve(root, ".scratch/final01/capacity-harness");
const runId = `${new Date().toISOString().replace(/[:.]/gu, "-")}-${process.pid}-${randomUUID().slice(0, 8)}`;
const runDirectory = join(harnessRoot, `run-${runId}`);
const profileRoot = join(runDirectory, "profiles");
const artifactDirectory = runDirectory;

const baseURL = process.env.FINAL_CAP_BASE_URL;
if (!baseURL) throw new Error("Set FINAL_CAP_BASE_URL to the separate loopback HTTP app root; the retained human 4174 service is not a target.");
const target = new URL(baseURL);
if (target.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || target.port === "4174" ||
    target.username || target.password || target.search || target.hash || target.pathname !== "/") {
  throw new Error("FINAL_CAP_BASE_URL must be a separate loopback HTTP app root (not port 4174), without credentials, path, query, or fragment.");
}

const participantCount = Number(process.env.FINAL_CAP_PARTICIPANTS ?? "10");
if (![3, 6, 10].includes(participantCount)) throw new Error("FINAL_CAP_PARTICIPANTS must be exactly 3, 6, or 10; run one level at a time.");

const BROWSERS = {
  chrome: { label: "Google Chrome", executable: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
  edge: { label: "Microsoft Edge", executable: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
};
for (const browser of Object.values(BROWSERS)) {
  if (!existsSync(browser.executable)) throw new Error(`${browser.label} executable was not found at its installed application path.`);
}

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, ".tools/playwright-browsers");
const { chromium } = await import("playwright");

const publisherCount = participantCount - 1;
const receiverName = `FinalCap-P${String(participantCount).padStart(2, "0")}`;
const publisherDefinitions = Array.from({ length: publisherCount }, (_, index) => ({
  key: `P${String(index + 1).padStart(2, "0")}`,
  name: `FinalCap-P${String(index + 1).padStart(2, "0")}`,
  browser: "chrome",
  frequencyHz: 397 + index * 41,
  index,
}));
const receiverDefinition = { key: "R", name: receiverName, browser: "edge", index: participantCount - 1 };
const clients = [];
const contexts = [];
const clientsByKey = new Map();
const startedAt = Date.now();
const MAX_ERRORS = 20;
const MAX_SAMPLES = 8;
const MAX_SCREENSHOTS = 2;
const OBSERVATION_WINDOW_MS = 4_000;
const SAMPLE_INTERVAL_MS = 1_000;
const NORMAL_TIMEOUT_MS = 15_000;
const MEDIA_TIMEOUT_MS = 20_000;
const SCREEN_RGB = [38, 146, 78];

mkdirSync(profileRoot, { recursive: true, mode: 0o700 });

const report = {
  schemaVersion: 1,
  purpose: "Short staged local desktop capacity observation: N-1 independent synthetic Opus publishers feed one installed-Edge receiver, which decodes and renders PCM while one publisher shares a synthetic VP8 canvas.",
  runId,
  startedAt: new Date().toISOString(),
  status: "running",
  baseURL: target.origin,
  artifactDirectory: relative(root, artifactDirectory),
  runtime: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    os: process.platform === "darwin" ? runVersion("/usr/bin/sw_vers", ["-productVersion"]) : `${os.type()} ${os.release()}`,
    headless: process.env.FINAL_CAP_HEADLESS !== "0",
    browsers: Object.fromEntries(Object.entries(BROWSERS).map(([key, browser]) => [key, {
      name: browser.label,
      executable: browser.executable,
      executableVersion: runVersion(browser.executable, ["--version"]),
      playwrightVersion: "not-launched",
    }])),
  },
  topology: {
    room: "studio",
    participants: participantCount,
    publishers: publisherCount,
    publisherBrowser: "Google Chrome, one independent persistent profile per page",
    receiver: { name: receiverName, browser: "Microsoft Edge", profile: "independent persistent workspace profile" },
    profileRoot: relative(root, profileRoot),
    topology: "N-1 publishers send to the final Edge receiver; publishers do not subscribe, so this is not N-by-N mutual listening.",
    observationWindowTargetMs: OBSERVATION_WINDOW_MS,
    sourceStopIsolationProbe: true,
  },
  syntheticSources: {
    audio: "Each publisher page overrides getUserMedia locally with a unique-frequency oscillator-backed MediaStreamDestination; the application uses its normal Opus encoder and publish controls.",
    audioFrequencyHz: publisherDefinitions.map(({ key, frequencyHz }) => ({ key, frequencyHz })),
    screen: `${publisherDefinitions[0].name} overrides getDisplayMedia locally with an animated canvas captureStream; the application uses its normal VP8 share controls.`,
    screenColorRgb: SCREEN_RGB,
    nativePermissionPickerUsed: false,
    physicalMicrophoneSelected: false,
    physicalDisplaySelected: false,
    systemFakePermissionFlags: false,
    rawMediaPayloadsStored: false,
  },
  checks: [],
  publishers: [],
  receiver: null,
  stableWindow: null,
  screen: null,
  stopIsolation: null,
  screenshots: [],
  errors: { pageErrorCount: 0, consoleErrorCount: 0, pageErrors: [], cleanupErrors: [], failure: null },
  privacy: {
    rawControlFramesRetained: false,
    rawMediaPayloadsRetained: false,
    tokensPasswordsProofsCookiesOrPageStorageRecorded: false,
    metadataBounded: true,
  },
  limits: {
    realPeopleOrIndependentDevices: "not-tested; all pages and synthetic identities share this host.",
    realMicrophoneAndHumanListening: "not-tested; oscillator input and PCM/RMS counters show browser pipeline work, not hardware output or what a person hears.",
    physicalDisplayCapture: "not-tested; generated canvas only.",
    cloudRunCapacityOrServerResourceUsage: "not-tested; this is a local browser workload and does not measure Cloud Run, server CPU, memory, bandwidth, or product limits.",
    longDurationOrEndurance: "not-tested; each stage uses a short bounded window.",
    fullMutualListening: "not-tested; only the final Edge receiver subscribes.",
    networkLossOrEndToEndQuality: "not-tested; local source counters are not network packet loss, listening quality, or calibrated latency.",
  },
  cleanup: { contextsClosed: 0, profilesRemoved: false },
  durationMs: null,
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
  return Date.now() - startedAt;
}

function safeMessage(value) {
  return String(value?.message ?? value)
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/\b(token|password|proof|authorization|cookie|secret)\b\s*[:=]\s*[^\s,;]+/giu, "$1=[redacted]")
    .slice(0, 240);
}

function stage(name, details = {}) {
  if (report.checks.length >= 24) throw new Error("The bounded final capacity stage limit was reached.");
  report.checks.push({ name, at: new Date().toISOString(), atMs: elapsedMs(), ...details });
  console.log(`[FINAL-CAP] ${name}`);
}

function pushBounded(array, value) {
  if (array.length < MAX_ERRORS) array.push(value);
}

function sanitizedBrowserEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/(?:TOKEN|PASSWORD|SECRET|CREDENTIAL|API[_-]?KEY|DATABASE_URL|PGPASSWORD|COOKIE|AUTH|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|REFRESH[_-]?TOKEN)/iu.test(key)) delete env[key];
  }
  return env;
}

function setupDiagnostics(client) {
  client.page.on("pageerror", (error) => {
    report.errors.pageErrorCount += 1;
    pushBounded(report.errors.pageErrors, { client: client.name, atMs: elapsedMs(), message: safeMessage(error) });
  });
  client.page.on("console", (message) => {
    if (message.type() === "error") report.errors.consoleErrorCount += 1;
  });
}

async function installSyntheticMedia(page, definition) {
  const frequencyHz = definition.frequencyHz;
  const color = SCREEN_RGB;
  await page.addInitScript(({ frequencyHz, color }) => {
    const state = { contexts: [], tracks: [], oscillators: [], animationFrameId: null, canvasActive: false };
    Object.defineProperty(window, "__finalCapSyntheticMedia", { value: state, configurable: false });
    const devices = navigator.mediaDevices;
    if (!devices) throw new Error("Final capacity local mediaDevices API is unavailable.");
    Object.defineProperty(devices, "getUserMedia", {
      configurable: true,
      value: async () => {
        if (state.contexts.length >= 2) throw new Error("Final capacity synthetic audio context limit reached.");
        const context = new AudioContext({ sampleRate: 48_000 });
        await context.resume();
        const destination = context.createMediaStreamDestination();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequencyHz;
        gain.gain.value = 0.22;
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
        if (!drawing) throw new Error("Final capacity synthetic canvas context is unavailable.");
        state.canvasActive = true;
        let phase = 0;
        const draw = () => {
          if (!state.canvasActive) return;
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
        if (!track) throw new Error("Final capacity synthetic canvas has no video track.");
        state.tracks.push(track);
        const originalStop = track.stop.bind(track);
        track.stop = () => {
          state.canvasActive = false;
          if (state.animationFrameId !== null) cancelAnimationFrame(state.animationFrameId);
          state.animationFrameId = null;
          originalStop();
        };
        return stream;
      },
    });
    state.stopAll = async () => {
      state.canvasActive = false;
      if (state.animationFrameId !== null) cancelAnimationFrame(state.animationFrameId);
      state.animationFrameId = null;
      for (const track of state.tracks) {
        try { track.stop(); } catch { /* Best-effort local synthetic media cleanup. */ }
      }
      for (const oscillator of state.oscillators) {
        try { oscillator.stop(); } catch { /* Already stopped. */ }
      }
      await Promise.all(state.contexts.map((context) => context.close().catch(() => {})));
    };
  }, { frequencyHz, color });
}

async function launchClient(definition) {
  const profileDirectory = join(profileRoot, definition.key.toLowerCase());
  mkdirSync(profileDirectory, { recursive: true, mode: 0o700 });
  const browserDefinition = BROWSERS[definition.browser];
  const context = await chromium.launchPersistentContext(profileDirectory, {
    executablePath: browserDefinition.executable,
    headless: report.runtime.headless,
    env: sanitizedBrowserEnvironment(),
    viewport: { width: 1440, height: 1100 },
    colorScheme: "light",
  });
  context.setDefaultTimeout(NORMAL_TIMEOUT_MS);
  const page = context.pages()[0] ?? await context.newPage();
  const client = { ...definition, profileDirectory, context, page };
  contexts.push(context);
  clients.push(client);
  clientsByKey.set(client.key, client);
  setupDiagnostics(client);
  if (definition.frequencyHz) await installSyntheticMedia(page, definition);
  const version = context.browser()?.version() ?? "not-reported";
  report.runtime.browsers[definition.browser].playwrightVersion = version;
  return client;
}

async function waitFor(predicate, label, timeoutMs = NORMAL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  const suffix = lastError ? `; last probe: ${safeMessage(lastError)}` : "";
  throw new Error(`${label} was not observed within ${timeoutMs} ms${suffix}`);
}

async function joinRoom(client) {
  await client.page.goto(`${target.origin}/?room=studio&mode=watch`, { waitUntil: "domcontentloaded" });
  await client.page.getByRole("heading", { name: "Local room presence" }).waitFor();
  await client.page.getByLabel("Your display name").fill(client.name);
  await client.page.getByRole("button", { name: "Join room" }).click();
  await client.page.waitForFunction(() => {
    const panel = document.querySelector('[data-testid="audio-panel"]');
    const connection = document.querySelector('[data-testid="control-connection-status"]');
    return panel?.getAttribute("data-room-id") === "studio" && /Connected/u.test(connection?.textContent ?? "");
  }, undefined, { timeout: NORMAL_TIMEOUT_MS });
  await client.page.locator('[data-testid="audio-panel"]').waitFor({ state: "visible" });
  await client.page.locator('[data-testid="screen-panel"]').waitFor({ state: "visible" });
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

async function readAudio(client) {
  return client.page.locator('[data-testid="audio-panel"]').evaluate((panel) => {
    const number = (name) => Number(panel.getAttribute(name) ?? 0);
    let sources = [];
    try { sources = JSON.parse(panel.getAttribute("data-audio-streams") ?? "[]"); } catch { sources = []; }
    return {
      listenerState: panel.getAttribute("data-listener-state"),
      receiverSubscribed: panel.getAttribute("data-receiver-subscribed") === "true",
      publisherState: panel.getAttribute("data-publisher-state"),
      publisherGeneration: Number.isInteger(Number(panel.getAttribute("data-publisher-generation"))) && panel.getAttribute("data-publisher-generation") !== ""
        ? Number(panel.getAttribute("data-publisher-generation")) : null,
      sentPackets: number("data-sent-packets"),
      receivedPackets: number("data-received-packets"),
      decodedFrames: number("data-decoded-frames"),
      renderedSamples: number("data-rendered-samples"),
      renderRms: number("data-render-rms"),
      activeSourceCount: number("data-audio-active-stream-count"),
      sources: Array.isArray(sources) ? sources.slice(0, 32).map((source) => ({
        generation: Number.isInteger(source?.generation) ? source.generation : null,
        clockId: typeof source?.clockId === "string" ? source.clockId.slice(0, 100) : "",
        active: source?.active === true,
        receivedPackets: Number(source?.receivedPackets ?? 0),
        decodedFrames: Number(source?.decodedFrames ?? 0),
        renderedPcmSamples: Number(source?.renderedPcmSamples ?? 0),
        queuedSamples: Number(source?.queuedSamples ?? 0),
        renderRms: Number(source?.renderRms ?? 0),
        decodeQueueHighWater: Number(source?.decodeQueueHighWater ?? 0),
        decodeQueueDroppedPackets: Number(source?.decodeQueueDroppedPackets ?? 0),
        packetGapCount: Number(source?.packetGapCount ?? 0),
        error: typeof source?.error === "string" ? source.error.slice(0, 120) : "",
      })) : [],
    };
  });
}

async function startListening(client) {
  const before = await readAudio(client);
  if (!before.receiverSubscribed) await client.page.locator('[data-testid="audio-start-listening"]').click();
  return waitFor(async () => {
    const current = await readAudio(client);
    return current.receiverSubscribed && ["ready", "suspended"].includes(current.listenerState) ? current : null;
  }, `${client.name} audio subscription`, MEDIA_TIMEOUT_MS);
}

async function startPublishing(client) {
  await client.page.locator('[data-testid="audio-start-publishing"]').click();
  return waitFor(async () => {
    const current = await readAudio(client);
    return current.publisherState === "broadcasting" && Number.isInteger(current.publisherGeneration) && current.sentPackets >= 5
      ? current : null;
  }, `${client.name} Opus publisher`, MEDIA_TIMEOUT_MS);
}

async function waitForSource(receiver, generation) {
  return waitFor(async () => {
    const current = await readAudio(receiver);
    const source = current.sources.find((row) => row.active && row.generation === generation);
    return source && source.clockId && source.receivedPackets > 0 && source.decodedFrames > 0 ? source : null;
  }, `${receiver.name} receives source generation ${generation}`, MEDIA_TIMEOUT_MS);
}

async function readScreen(client) {
  return client.page.locator('[data-testid="screen-panel"]').evaluate((panel) => {
    const number = (name) => Number(panel.getAttribute(name) ?? 0);
    const canvas = panel.querySelector('[data-testid="screen-preview"]');
    let centerPixel = null;
    if (canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0) {
      try {
        const context = canvas.getContext("2d");
        if (context) centerPixel = [...context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data];
      } catch { centerPixel = null; }
    }
    return {
      publisherState: panel.getAttribute("data-publisher-state"),
      receiverState: panel.getAttribute("data-receiver-state"),
      receiverSubscribed: panel.getAttribute("data-receiver-subscribed") === "true",
      receivedFrames: number("data-received-frames"),
      decodedFrames: number("data-decoded-frames"),
      renderedFrames: number("data-rendered-frames"),
      width: number("data-rendered-width"),
      height: number("data-rendered-height"),
      centerPixel,
    };
  });
}

async function waitForScreen(client) {
  return waitFor(async () => {
    const screen = await readScreen(client);
    return screen.receiverSubscribed && screen.receivedFrames > 0 && screen.decodedFrames > 0 && screen.renderedFrames >= 3 && screen.width > 0 && screen.height > 0
      ? screen : null;
  }, `${client.name} decoded VP8 screen`, MEDIA_TIMEOUT_MS);
}

async function startScreenShare(client) {
  await client.page.getByRole("button", { name: "開始分享畫面" }).click();
  await client.page.waitForFunction(() => document.querySelector('[data-testid="screen-panel"]')?.getAttribute("data-publisher-state") === "sharing", undefined, { timeout: MEDIA_TIMEOUT_MS });
}

async function captureScreenshot(client, testId, filename) {
  if (report.screenshots.length >= MAX_SCREENSHOTS) return;
  const locator = client.page.locator(`[data-testid="${testId}"]`);
  if (!(await locator.count()) || !(await locator.isVisible())) return;
  await locator.screenshot({ path: join(artifactDirectory, filename), animations: "disabled", timeout: 4_000 });
  report.screenshots.push(filename);
}

async function captureReceiverScreenshots() {
  const receiver = clientsByKey.get("R");
  if (!receiver || receiver.page.isClosed()) return;
  for (const [testId, filename] of [["audio-panel", "edge-receiver-audio.png"], ["screen-panel", "edge-receiver-screen.png"]]) {
    if (report.screenshots.length >= MAX_SCREENSHOTS) break;
    try { await captureScreenshot(receiver, testId, filename); }
    catch (error) { pushBounded(report.errors.cleanupErrors, { action: "screenshot", panel: testId, message: safeMessage(error) }); }
  }
}

function sourceKey(source) {
  return `${source.generation}:${source.clockId}`;
}

function sampleSources(audio, expectedGenerations) {
  const expected = new Set(expectedGenerations);
  return audio.sources.filter((source) => source.active && expected.has(source.generation));
}

async function captureStableWindow(receiver, expectedGenerations) {
  const windowStartedAt = new Date().toISOString();
  const startedMs = Date.now();
  const samples = [];
  for (let sampleIndex = 0; sampleIndex < MAX_SAMPLES; sampleIndex += 1) {
    const sampleStartedAt = Date.now();
    const audio = await readAudio(receiver);
    const sources = sampleSources(audio, expectedGenerations);
    const sampleEndedAt = Date.now();
    samples.push({
      sample: sampleIndex,
      sampledAt: new Date(sampleStartedAt).toISOString(),
      elapsedFromWindowStartMs: sampleStartedAt - startedMs,
      samplingDurationMs: sampleEndedAt - sampleStartedAt,
      receiverActiveSourceCount: audio.activeSourceCount,
      sources,
    });
    if (sampleIndex === MAX_SAMPLES - 1 || Date.now() - startedMs >= OBSERVATION_WINDOW_MS) break;
    const remaining = Math.max(0, SAMPLE_INTERVAL_MS - (Date.now() - sampleStartedAt));
    await new Promise((resolveWait) => setTimeout(resolveWait, remaining));
  }
  const endedMs = Date.now();
  const expectedKeys = new Map();
  for (const publisher of report.publishers) expectedKeys.set(publisher.generation, publisher.clockId);
  const perSource = report.publishers.map((publisher) => {
    const series = samples.map((sample) => sample.sources.find((source) => source.generation === publisher.generation && source.clockId === publisher.clockId) ?? null);
    const first = series.find(Boolean);
    const last = [...series].reverse().find(Boolean);
    const pcmAdvanceIntervals = series.slice(1).filter((source, index) => source && series[index] && source.renderedPcmSamples > series[index].renderedPcmSamples).length;
    const dropsAtStart = first?.decodeQueueDroppedPackets ?? 0;
    const dropsAtEnd = last?.decodeQueueDroppedPackets ?? dropsAtStart;
    return {
      publisher: publisher.name,
      generation: publisher.generation,
      clockId: publisher.clockId,
      observedInSamples: series.filter(Boolean).length,
      activeAtFinalSample: last?.active === true,
      start: first ? compactSource(first) : null,
      end: last ? compactSource(last) : null,
      windowDelta: {
        receivedPackets: first && last ? last.receivedPackets - first.receivedPackets : 0,
        decodedFrames: first && last ? last.decodedFrames - first.decodedFrames : 0,
        renderedPcmSamples: first && last ? last.renderedPcmSamples - first.renderedPcmSamples : 0,
        localDecodeDrops: Math.max(0, dropsAtEnd - dropsAtStart),
      },
      pcmAdvanceIntervals,
      intervalsObserved: Math.max(0, series.length - 1),
      continuousPcmAcrossSamples: series.length > 1 && series.every(Boolean) && pcmAdvanceIntervals === series.length - 1,
      errorObserved: series.some((source) => Boolean(source?.error)),
    };
  });
  return {
    startedAt: windowStartedAt,
    endedAt: new Date(endedMs).toISOString(),
    actualDurationMs: endedMs - startedMs,
    targetDurationMs: OBSERVATION_WINDOW_MS,
    sampleIntervalTargetMs: SAMPLE_INTERVAL_MS,
    samples,
    perSource,
    allExpectedSourcesPresentEverySample: perSource.every((row) => row.observedInSamples === samples.length),
    allSourcesAdvancedPcmEveryInterval: perSource.every((row) => row.continuousPcmAcrossSamples),
    anyLocalDecodeDrops: perSource.some((row) => row.windowDelta.localDecodeDrops > 0),
    anySourceError: perSource.some((row) => row.errorObserved),
    expectedSourceCount: expectedKeys.size,
  };
}

function compactSource(source) {
  return {
    active: source.active,
    receivedPackets: source.receivedPackets,
    decodedFrames: source.decodedFrames,
    renderedPcmSamples: source.renderedPcmSamples,
    renderRms: source.renderRms,
    queuedSamples: source.queuedSamples,
    decodeQueueHighWater: source.decodeQueueHighWater,
    decodeQueueDroppedPackets: source.decodeQueueDroppedPackets,
    packetGapCount: source.packetGapCount,
    error: source.error,
  };
}

function assertScreenColor(actual, expected) {
  assert.ok(Array.isArray(actual) && actual.length >= 3, "Edge receiver should expose a readable decoded canvas pixel.");
  const difference = Math.max(...expected.map((channel, index) => Math.abs(channel - actual[index])));
  assert.ok(difference <= 48, `Edge receiver should display the generated canvas color; observed ${actual}.`);
}

async function main() {
  stage("launch-independent-installed-browser-profiles", { participants: participantCount });
  for (const definition of [...publisherDefinitions, receiverDefinition]) {
    const client = await launchClient(definition);
    await joinRoom(client);
  }
  stage("all-studio-participants-joined", { participants: clients.length });

  const receiver = clientsByKey.get("R");
  await startListening(receiver);
  report.receiver = { name: receiver.name, browser: "Microsoft Edge", receiverSubscribed: true, sources: [] };
  stage("edge-receiver-listening");

  for (const definition of publisherDefinitions) {
    const publisher = clientsByKey.get(definition.key);
    const state = await startPublishing(publisher);
    const source = await waitForSource(receiver, state.publisherGeneration);
    const publisherRecord = {
      name: publisher.name,
      browser: "Google Chrome",
      generation: state.publisherGeneration,
      clockId: source.clockId,
      sentPackets: state.sentPackets,
      selfSourceObserved: false,
    };
    report.publishers.push(publisherRecord);
    const ownState = await readAudio(publisher);
    publisherRecord.selfSourceObserved = ownState.receiverSubscribed || ownState.sources.some((row) => row.active && row.generation === state.publisherGeneration);
    assert.equal(publisherRecord.selfSourceObserved, false, `${publisher.name} must not subscribe to its own source.`);
  }

  const generations = report.publishers.map(({ generation }) => generation);
  const clockIds = report.publishers.map(({ clockId }) => clockId);
  const uniqueGenerations = new Set(generations).size === generations.length;
  const uniqueClockIds = new Set(clockIds).size === clockIds.length;
  assert.ok(uniqueGenerations, "Publisher generations must be unique within this stage.");
  assert.ok(uniqueClockIds, "Publisher clock IDs must be unique within this stage.");
  report.receiver.sources = report.publishers.map(({ name, generation, clockId }) => ({ name, generation, clockId }));
  report.receiver.uniqueGenerations = uniqueGenerations;
  report.receiver.uniqueClockIds = uniqueClockIds;
  report.receiver.publisherSelfSourcesObserved = report.publishers.some(({ selfSourceObserved }) => selfSourceObserved);
  stage("all-publishers-received-with-unique-source-identifiers", { sources: report.publishers.length });

  const screenPublisher = clientsByKey.get(publisherDefinitions[0].key);
  await startScreenShare(screenPublisher);
  await receiver.page.getByRole("button", { name: "開始觀看分享" }).click();
  const screen = await waitForScreen(receiver);
  assertScreenColor(screen.centerPixel, SCREEN_RGB);
  report.screen = {
    publisher: screenPublisher.name,
    receiver: receiver.name,
    codec: "VP8",
    syntheticColorRgb: SCREEN_RGB,
    receivedFrames: screen.receivedFrames,
    decodedFrames: screen.decodedFrames,
    renderedFrames: screen.renderedFrames,
    renderedSize: { width: screen.width, height: screen.height },
    centerPixel: screen.centerPixel,
  };
  stage("single-synthetic-vp8-canvas-decoded-on-edge", { renderedFrames: screen.renderedFrames });

  report.stableWindow = await captureStableWindow(receiver, generations);
  stage("four-second-per-source-observation-finished", {
    actualDurationMs: report.stableWindow.actualDurationMs,
    samples: report.stableWindow.samples.length,
    anyLocalDecodeDrops: report.stableWindow.anyLocalDecodeDrops,
  });

  const stoppedPublisher = clientsByKey.get(publisherDefinitions[0].key);
  const stoppedGeneration = report.publishers[0].generation;
  const beforeStop = await readAudio(receiver);
  await stoppedPublisher.page.locator('[data-testid="audio-stop-publishing"]').click();
  await waitFor(async () => (await readAudio(stoppedPublisher)).publisherState === "idle", `${stoppedPublisher.name} stopped`, MEDIA_TIMEOUT_MS);
  const stoppedRow = await waitFor(async () => {
    const current = await readAudio(receiver);
    const source = current.sources.find((row) => row.generation === stoppedGeneration);
    return !source || !source.active ? source ?? { active: false } : null;
  }, `${stoppedPublisher.name} source end`, MEDIA_TIMEOUT_MS);
  await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  const afterStop = await readAudio(receiver);
  const remaining = report.publishers.slice(1).map((publisher) => {
    const before = beforeStop.sources.find((source) => source.generation === publisher.generation && source.clockId === publisher.clockId);
    const after = afterStop.sources.find((source) => source.generation === publisher.generation && source.clockId === publisher.clockId);
    return {
      publisher: publisher.name,
      generation: publisher.generation,
      activeAfterStop: after?.active === true,
      pcmAdvanced: Boolean(before && after && after.renderedPcmSamples > before.renderedPcmSamples),
      receivedPacketsAdvanced: Boolean(before && after && after.receivedPackets > before.receivedPackets),
      localDecodeDropsAfterStop: Math.max(0, (after?.decodeQueueDroppedPackets ?? 0) - (before?.decodeQueueDroppedPackets ?? 0)),
      error: after?.error ?? "",
    };
  });
  report.stopIsolation = {
    stoppedPublisher: stoppedPublisher.name,
    stoppedGeneration,
    stoppedSourceInactive: stoppedRow.active === false,
    remainingSources: remaining,
    remainingSourcesAllActive: remaining.every((row) => row.activeAfterStop),
    remainingSourcesAllAdvancedPcm: remaining.every((row) => row.pcmAdvanced),
    remainingSourcesAllAdvancedReceived: remaining.every((row) => row.receivedPacketsAdvanced),
  };
  stage("stopped-source-does-not-block-remaining-sources", {
    stoppedSourceInactive: report.stopIsolation.stoppedSourceInactive,
    remainingSources: remaining.length,
  });

  await captureReceiverScreenshots();
  const stable = report.stableWindow;
  const noDrops = !stable.anyLocalDecodeDrops;
  const sourceIsolationPass = report.stopIsolation.stoppedSourceInactive && report.stopIsolation.remainingSourcesAllActive &&
    report.stopIsolation.remainingSourcesAllAdvancedPcm && report.stopIsolation.remainingSourcesAllAdvancedReceived;
  const basicMediaPass = stable.allExpectedSourcesPresentEverySample && stable.allSourcesAdvancedPcmEveryInterval && !stable.anySourceError;
  report.status = basicMediaPass && noDrops && sourceIsolationPass ? "core-pass" : "observed-with-limitations";
  report.outcome = {
    nativeEdgeOpusDecodeAndPcmObserved: stable.perSource.every((source) => source.start && source.end && source.windowDelta.decodedFrames > 0 && source.windowDelta.renderedPcmSamples > 0),
    allSourcesPresentAndAdvancingDuringWindow: basicMediaPass,
    noLocalDecodeQueueDropsDuringWindow: noDrops,
    stopIsolationPass: sourceIsolationPass,
    singleScreenVp8Pass: Boolean(report.screen?.decodedFrames > 0 && report.screen?.renderedFrames >= 3),
    note: report.status === "core-pass"
      ? "All staged browser pipeline checks passed for this local synthetic workload only."
      : "This run completed with one or more observed limits; inspect per-source window deltas and local decode drops. No queue thresholds were changed.",
  };
}

try {
  await main();
} catch (error) {
  report.status = "failed";
  report.errors.failure = safeMessage(error);
  console.error(`[FINAL-CAP] failed: ${report.errors.failure}`);
} finally {
  await captureReceiverScreenshots();
  for (const client of clients) {
    if (client.page.isClosed()) continue;
    try { await client.page.evaluate(() => window.__finalCapSyntheticMedia?.stopAll?.()); }
    catch { /* Page may be in navigation or already shutting down. */ }
  }
  const closeResults = await Promise.allSettled(contexts.map((context) => context.close()));
  for (const result of closeResults) {
    if (result.status === "fulfilled") report.cleanup.contextsClosed += 1;
    else pushBounded(report.errors.cleanupErrors, { action: "close-context", message: safeMessage(result.reason) });
  }
  try {
    rmSync(profileRoot, { recursive: true, force: true });
    report.cleanup.profilesRemoved = !existsSync(profileRoot);
  } catch (error) {
    pushBounded(report.errors.cleanupErrors, { action: "remove-workspace-profiles", message: safeMessage(error) });
  }
  report.durationMs = elapsedMs();
  report.finishedAt = new Date().toISOString();
  mkdirSync(artifactDirectory, { recursive: true, mode: 0o700 });
  const reportPath = join(artifactDirectory, "report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`[FINAL-CAP] saved ${relative(root, reportPath)} status=${report.status} durationMs=${report.durationMs}`);
  if (report.status === "failed") process.exitCode = 1;
}
