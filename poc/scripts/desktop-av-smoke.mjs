import { enterRepositoryRootForLegacyScript, repositoryRoot, pocRoot } from "./lib/project-paths.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import os from "node:os";

enterRepositoryRootForLegacyScript();

const root = repositoryRoot;
const scratchRoot = resolve(root, ".scratch/desktop01");
const harnessRoot = join(scratchRoot, "harness");
const profileRoot = join(harnessRoot, "profiles", `run-${Date.now()}-${process.pid}-${randomUUID()}`);
const outputDirectory = resolve(root, process.env.DESKTOP01_OUTPUT_DIR ?? ".scratch/desktop01/browser");
const outputRelative = relative(scratchRoot, outputDirectory);
if (isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(`..${sep}`)) {
  throw new Error("DESKTOP01_OUTPUT_DIR must stay inside .scratch/desktop01.");
}

const baseURL = process.env.DESKTOP01_BASE_URL ?? "http://localhost:4174/";
const target = new URL(baseURL);
if (target.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(target.hostname) || target.port !== "4174" ||
    target.username || target.password || target.search || target.hash || target.pathname !== "/") {
  throw new Error("DESKTOP01_BASE_URL must be the local HTTP app root on port 4174 without credentials, query, or fragment.");
}

const BROWSERS = {
  chrome: {
    label: "Google Chrome",
    executable: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  },
  edge: {
    label: "Microsoft Edge",
    executable: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  },
};
for (const browser of Object.values(BROWSERS)) {
  if (!existsSync(browser.executable)) throw new Error(`${browser.label} executable was not found at its installed application path.`);
}

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, ".tools/playwright-browsers");
const { chromium } = await import("playwright");

const NORMAL_TIMEOUT_MS = 12_000;
const MEDIA_TIMEOUT_MS = 15_000;
const POLL_MS = 50;
const MAX_STAGES = 20;
const MAX_PAGE_ERRORS = 12;
const MAX_SCREENSHOTS = 2;
const AUDIO_FREQUENCIES_HZ = { A: 523, B: 761 };
const SCREEN_RGB = [34, 158, 86];
const CLIENTS = [
  { key: "A", name: "Desktop01-A", browser: "chrome" },
  { key: "B", name: "Desktop01-B", browser: "edge" },
  { key: "C", name: "Desktop01-C", browser: "chrome" },
];
const contexts = [];
const clients = new Map();
const startedAtMs = Date.now();
let failure = null;

mkdirSync(harnessRoot, { recursive: true, mode: 0o700 });
mkdirSync(profileRoot, { recursive: true, mode: 0o700 });
mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });

function runVersion(executable, args) {
  try {
    return execFileSync(executable, args, { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "pipe"] })
      .trim().replace(/[\r\n\t ]+/gu, " ").slice(0, 160);
  } catch {
    return "version-query-failed";
  }
}

function macOSVersion() {
  if (process.platform !== "darwin") return `${os.type()} ${os.release()}`;
  return runVersion("/usr/bin/sw_vers", ["-productVersion"]);
}

const headless = process.env.DESKTOP01_HEADLESS !== "0";
const report = {
  schemaVersion: 1,
  purpose: "Short local cross-browser desktop smoke for two mutual synthetic audio publishers, a late receiver, and one decoded/rendered synthetic screen share.",
  startedAt: new Date().toISOString(),
  status: "running",
  baseURL: target.origin,
  outputDirectory: relative(root, outputDirectory),
  runtime: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    macOS: macOSVersion(),
    headless,
    browsers: Object.fromEntries(Object.entries(BROWSERS).map(([key, browser]) => [key, {
      name: browser.label,
      executable: browser.executable,
      executableVersion: runVersion(browser.executable, ["--version"]),
      playwrightVersion: "not-launched",
    }])),
  },
  topology: {
    room: "studio",
    clients: Object.fromEntries(CLIENTS.map(({ key, name, browser }) => [key, { name, browser }])),
    profiles: "one independent workspace-owned persistent profile per browser page, removed in finally",
    realPeopleOrDevices: false,
  },
  syntheticSources: {
    audio: "getUserMedia is replaced only in each test page with an oscillator-backed MediaStreamDestination; no physical microphone is opened.",
    audioFrequencyHz: AUDIO_FREQUENCIES_HZ,
    screen: "getDisplayMedia is replaced only in A's test page with an animated canvas captureStream; no OS picker or physical display is used.",
    screenColorRgb: SCREEN_RGB,
    nativePermissionPickerUsed: false,
    physicalMicrophoneSelected: false,
    physicalDisplaySelected: false,
    systemFakePermissionFlags: false,
    mediaPayloadsStored: false,
  },
  nativeMediaCapabilities: {
    scope: "observed before page-local test injection; API presence is not capture evidence",
    byClient: {},
  },
  checks: [],
  publishers: {},
  receiverSnapshots: [],
  screen: null,
  screenshots: [],
  privacy: {
    rawControlPayloadsRetained: false,
    rawMediaPayloadsRetained: false,
    sessionProofsTokensAndPasswordsReadOrRecorded: false,
    pageStorageDumped: false,
    metadataBounded: true,
  },
  limits: {
    realMicrophoneAndHumanListening: "not-tested; oscillator-generated streams and PCM/RMS counters do not establish what a person hears",
    realDisplayCaptureOrOSPicker: "not-tested; generated canvas only",
    threePhysicalParticipantsOrDevices: "not-tested; three pages share one machine and are synthetic identities",
    isolationPermissionsLongDurationCapacityAndNetworkFailure: "not-tested; outside this short core flow",
    serverPersistenceCloudDeploymentAndCloudRun: "not-tested; the script attaches to the separately managed local fixture",
    endToEndLatencyOrListeningQuality: "not-measured",
  },
  errors: { pageErrors: [], cleanupErrors: [], failure: null },
  cleanup: { contextsClosed: 0, profilesRemoved: false },
  durationMs: null,
};

function elapsedMs() {
  return Date.now() - startedAtMs;
}

function stage(name, details = {}) {
  if (report.checks.length >= MAX_STAGES) throw new Error("The bounded desktop smoke stage limit was reached.");
  const item = { name, atMs: elapsedMs(), ...details };
  report.checks.push(item);
  console.log(`[DESKTOP01] ${name}`);
}

function boundedError(error) {
  return String(error?.message ?? error).replace(/[\r\n\t]+/gu, " ").slice(0, 300);
}

function setupDiagnostics(client) {
  client.page.on("pageerror", (error) => {
    if (report.errors.pageErrors.length < MAX_PAGE_ERRORS) {
      report.errors.pageErrors.push({ client: client.name, atMs: elapsedMs(), message: boundedError(error) });
    }
  });
}

async function installSyntheticMedia(page, key) {
  const frequency = AUDIO_FREQUENCIES_HZ[key];
  const color = SCREEN_RGB;
  await page.addInitScript(({ frequency, color }) => {
    const state = { contexts: [], tracks: [], oscillators: [], animationFrameId: null, stopped: false };
    Object.defineProperty(window, "__desktop01SyntheticMedia", { value: state, configurable: false });
    const devices = navigator.mediaDevices;
    Object.defineProperty(window, "__desktop01NativeMediaCapabilities", {
      value: {
        secureContext: window.isSecureContext === true,
        mediaDevicesType: typeof devices,
        getUserMediaType: typeof devices?.getUserMedia,
        getDisplayMediaType: typeof devices?.getDisplayMedia,
        captureMethodsCalledForProbe: false,
      },
      configurable: false,
    });
    Object.defineProperty(devices, "getUserMedia", {
      configurable: true,
      value: async () => {
        if (state.contexts.length >= 4) throw new Error("Desktop01 synthetic audio context cap was reached.");
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
        const tracks = destination.stream.getTracks();
        for (const track of tracks) {
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
        if (!drawing) throw new Error("Desktop01 synthetic canvas context is unavailable.");
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
        if (!track) throw new Error("Desktop01 synthetic canvas has no video track.");
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
      state.stopped = true;
      if (state.animationFrameId !== null) cancelAnimationFrame(state.animationFrameId);
      state.animationFrameId = null;
      for (const track of state.tracks) {
        try { track.stop(); } catch { /* Best-effort synthetic media cleanup. */ }
      }
      for (const oscillator of state.oscillators) {
        try { oscillator.stop(); } catch { /* Already stopped. */ }
      }
      await Promise.all(state.contexts.map((context) => context.close().catch(() => {})));
    };
  }, { frequency, color });
}

async function launchClient(definition) {
  const profileDirectory = join(profileRoot, definition.key);
  mkdirSync(profileDirectory, { recursive: true, mode: 0o700 });
  const browserDefinition = BROWSERS[definition.browser];
  const context = await chromium.launchPersistentContext(profileDirectory, {
    executablePath: browserDefinition.executable,
    headless,
    viewport: { width: 1360, height: 1000 },
    colorScheme: "light",
  });
  context.setDefaultTimeout(NORMAL_TIMEOUT_MS);
  const page = context.pages()[0] ?? await context.newPage();
  const client = { ...definition, profileDirectory, context, page };
  contexts.push(context);
  clients.set(definition.key, client);
  setupDiagnostics(client);
  await installSyntheticMedia(page, definition.key);
  const version = context.browser()?.version() ?? "not-reported";
  report.runtime.browsers[definition.browser].playwrightVersion = version;
  return client;
}

async function waitFor(predicate, label, timeoutMs = NORMAL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, POLL_MS));
  }
  const suffix = lastError ? `; last probe error: ${boundedError(lastError)}` : "";
  throw new Error(`${label} was not observed within ${timeoutMs} ms${suffix}`);
}

async function joinRoom(client) {
  await client.page.goto(`${target.origin}/?room=studio&mode=watch`, { waitUntil: "domcontentloaded" });
  await client.page.getByRole("heading", { name: "Local room presence" }).waitFor();
  await client.page.getByLabel("Your display name").fill(client.name);
  await client.page.getByRole("button", { name: "Join room" }).click();
  await client.page.waitForFunction(() => {
    const audio = document.querySelector('[data-testid="audio-panel"]');
    const status = document.querySelector('[data-testid="control-connection-status"]');
    return audio?.getAttribute("data-room-id") === "studio" && /Connected/u.test(status?.textContent ?? "");
  }, undefined, { timeout: NORMAL_TIMEOUT_MS });
  await client.page.locator('[data-testid="screen-panel"]').waitFor({ state: "visible" });
  report.nativeMediaCapabilities.byClient[client.key] = await client.page.evaluate(() => window.__desktop01NativeMediaCapabilities ?? null);
}

async function readAudio(client) {
  return client.page.locator('[data-testid="audio-panel"]').evaluate((panel) => {
    const number = (name) => Number(panel.getAttribute(name) ?? 0);
    let sources = [];
    try { sources = JSON.parse(panel.getAttribute("data-audio-streams") ?? "[]"); } catch { sources = []; }
    const rows = Array.isArray(sources) ? sources.slice(0, 12).map((source) => ({
      generation: Number.isInteger(source?.generation) ? source.generation : null,
      clockId: typeof source?.clockId === "string" ? source.clockId.slice(0, 80) : "",
      active: source?.active === true,
      receivedPackets: Number(source?.receivedPackets ?? 0),
      decodedFrames: Number(source?.decodedFrames ?? 0),
      renderedPcmSamples: Number(source?.renderedPcmSamples ?? 0),
      queuedSamples: Number(source?.queuedSamples ?? 0),
      renderRms: Number(source?.renderRms ?? 0),
      decodeQueueDroppedPackets: Number(source?.decodeQueueDroppedPackets ?? 0),
      packetGapCount: Number(source?.packetGapCount ?? 0),
      error: typeof source?.error === "string" ? source.error.slice(0, 120) : "",
    })) : [];
    return {
      listenerState: panel.getAttribute("data-listener-state"),
      receiverSubscribed: panel.getAttribute("data-receiver-subscribed") === "true",
      publisherState: panel.getAttribute("data-publisher-state"),
      publisherGeneration: panel.getAttribute("data-publisher-generation") && Number.isInteger(Number(panel.getAttribute("data-publisher-generation")))
        ? Number(panel.getAttribute("data-publisher-generation"))
        : null,
      sentPackets: number("data-sent-packets"),
      receivedPackets: number("data-received-packets"),
      decodedFrames: number("data-decoded-frames"),
      renderedSamples: number("data-rendered-samples"),
      renderRms: number("data-render-rms"),
      decodeQueueDroppedPackets: number("data-audio-decode-queue-dropped-packets"),
      activeSourceCount: number("data-audio-active-stream-count"),
      sources: rows,
    };
  });
}

function activeSources(audio) {
  return audio.sources.filter((source) => source.active && Number.isInteger(source.generation));
}

async function waitForPublisher(client, { afterGeneration = null } = {}) {
  return waitFor(async () => {
    const audio = await readAudio(client);
    if (audio.publisherState !== "broadcasting" || audio.sentPackets < 5 || !Number.isInteger(audio.publisherGeneration)) return null;
    if (afterGeneration !== null && audio.publisherGeneration === afterGeneration) return null;
    return audio;
  }, `${client.name} publishing with a new generation`, MEDIA_TIMEOUT_MS);
}

async function startListening(client) {
  const before = await readAudio(client);
  if (!before.receiverSubscribed) await client.page.locator('[data-testid="audio-start-listening"]').click();
  return await waitFor(async () => {
    const audio = await readAudio(client);
    return audio.receiverSubscribed && ["ready", "suspended"].includes(audio.listenerState) ? audio : null;
  }, `${client.name} audio subscription`, MEDIA_TIMEOUT_MS);
}

async function waitForSources(client, expectedGenerations, label) {
  const expected = [...expectedGenerations].sort((a, b) => a - b);
  return waitFor(async () => {
    const audio = await readAudio(client);
    const rows = activeSources(audio);
    const actual = rows.map((row) => row.generation).sort((a, b) => a - b);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) return null;
    if (!rows.every((row) => row.clockId && row.receivedPackets > 0 && row.decodedFrames > 0 && row.renderedPcmSamples > 0 && row.renderRms > 0 && !row.error)) return null;
    return { ...audio, sources: rows };
  }, `${client.name} WebCodecs decode and AudioWorklet PCM for ${label}`, MEDIA_TIMEOUT_MS);
}

async function startPublishing(client) {
  const before = await readAudio(client);
  await client.page.locator('[data-testid="audio-start-publishing"]').click();
  return await waitForPublisher(client, { afterGeneration: Number.isInteger(before.publisherGeneration) ? before.publisherGeneration : null });
}

async function stopPublishing(client) {
  const button = client.page.locator('[data-testid="audio-stop-publishing"]');
  if (await button.count() && await button.isVisible()) await button.click();
  return await waitFor(async () => {
    const audio = await readAudio(client);
    return audio.publisherState === "idle" ? audio : null;
  }, `${client.name} publisher stopped`, MEDIA_TIMEOUT_MS);
}

async function startScreenShare(client) {
  await client.page.getByRole("button", { name: "開始分享畫面" }).click();
  await client.page.waitForFunction(() => document.querySelector('[data-testid="screen-panel"]')?.getAttribute("data-publisher-state") === "sharing", undefined, { timeout: MEDIA_TIMEOUT_MS });
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

async function waitForScreenRender(client) {
  return await waitFor(async () => {
    const screen = await readScreen(client);
    return screen.receiverSubscribed && screen.receivedFrames > 0 && screen.decodedFrames > 0 && screen.renderedFrames >= 3 && screen.width > 0 && screen.height > 0
      ? screen
      : null;
  }, `${client.name} decoded and rendered screen`, MEDIA_TIMEOUT_MS);
}

async function captureScreenshot(client, testId, filename) {
  if (report.screenshots.length >= MAX_SCREENSHOTS) return;
  const panel = client.page.locator(`[data-testid="${testId}"]`);
  if (!(await panel.isVisible())) throw new Error(`${client.name} ${testId} panel is not visible for screenshot.`);
  await panel.screenshot({ path: join(outputDirectory, filename), animations: "disabled", timeout: 4_000 });
  report.screenshots.push(filename);
}

async function stopListening(client) {
  const button = client.page.locator('[data-testid="audio-stop-listening"]');
  if (await button.count() && await button.isVisible()) await button.click();
  return await waitFor(async () => {
    const audio = await readAudio(client);
    return !audio.receiverSubscribed && audio.activeSourceCount === 0 && audio.listenerState === "off" ? audio : null;
  }, `${client.name} listener stopped and cleared`, MEDIA_TIMEOUT_MS);
}

async function runSmoke() {
  const A = await launchClient(CLIENTS[0]);
  const B = await launchClient(CLIENTS[1]);
  await joinRoom(A);
  await joinRoom(B);
  await startListening(A);
  await startListening(B);
  stage("chrome-and-edge-joined-with-listeners-ready");

  const aFirst = await startPublishing(A);
  const aGeneration1 = aFirst.publisherGeneration;
  report.publishers.A = { browser: A.browser, generation1: aGeneration1, clockId: "" };
  const bFirst = await startPublishing(B);
  const bGeneration = bFirst.publisherGeneration;
  report.publishers.B = { browser: B.browser, generation: bGeneration, clockId: "" };

  const aReceivesB = await waitForSources(A, [bGeneration], "B only; A must not receive itself");
  const bReceivesA = await waitForSources(B, [aGeneration1], "A only; B must not receive itself");
  assert.equal(activeSources(await readAudio(A)).some((source) => source.generation === aGeneration1), false, "A must not receive its own audio source.");
  assert.equal(activeSources(await readAudio(B)).some((source) => source.generation === bGeneration), false, "B must not receive its own audio source.");
  report.publishers.A.clockId = bReceivesA.sources.find((source) => source.generation === aGeneration1)?.clockId ?? "";
  report.publishers.B.clockId = aReceivesB.sources.find((source) => source.generation === bGeneration)?.clockId ?? "";
  stage("chrome-and-edge-publish-and-receive-only-the-other-source", {
    AReceivesGeneration: bGeneration,
    BReceivesGeneration: aGeneration1,
    selfSourcesActive: 0,
  });

  const C = await launchClient(CLIENTS[2]);
  await joinRoom(C);
  await startListening(C);
  const cReceivesBoth = await waitForSources(C, [aGeneration1, bGeneration], "both publisher sources on late join");
  assert.equal(cReceivesBoth.activeSourceCount, 2);
  report.receiverSnapshots.push({
    phase: "late-join-baseline",
    client: C.name,
    sources: cReceivesBoth.sources,
    aggregate: {
      receivedPackets: cReceivesBoth.receivedPackets,
      decodedFrames: cReceivesBoth.decodedFrames,
      renderedSamples: cReceivesBoth.renderedSamples,
      renderRms: cReceivesBoth.renderRms,
      decodeQueueDroppedPackets: cReceivesBoth.decodeQueueDroppedPackets,
    },
  });
  stage("late-chrome-receiver-decodes-and-renders-two-independent-pcm-sources", {
    generations: cReceivesBoth.sources.map(({ generation }) => generation),
    clockIds: cReceivesBoth.sources.map(({ clockId }) => clockId),
    decodedFrames: cReceivesBoth.sources.map(({ decodedFrames }) => decodedFrames),
    pcmSamples: cReceivesBoth.sources.map(({ renderedPcmSamples }) => renderedPcmSamples),
    rms: cReceivesBoth.sources.map(({ renderRms }) => renderRms),
    localDecodeQueueDroppedPackets: cReceivesBoth.sources.map(({ decodeQueueDroppedPackets }) => decodeQueueDroppedPackets),
  });

  await startScreenShare(A);
  await C.page.locator('[data-testid="screen-start-watching"]').click();
  const screenBaseline = await waitForScreenRender(C);
  assert.ok(Array.isArray(screenBaseline.centerPixel) && screenBaseline.centerPixel.length >= 3, "C must expose a readable decoded canvas pixel.");
  const pixelDifference = Math.max(...SCREEN_RGB.map((channel, index) => Math.abs(channel - screenBaseline.centerPixel[index])));
  assert.ok(pixelDifference <= 70, `C should render A's injected canvas color; observed ${screenBaseline.centerPixel}.`);
  await captureScreenshot(C, "audio-panel", "desktop01-c-audio-baseline.png");
  await captureScreenshot(C, "screen-panel", "desktop01-c-screen-baseline.png");
  report.screen = { publisher: A.name, receiver: C.name, syntheticColor: SCREEN_RGB, initial: screenBaseline };
  stage("chrome-screen-source-decoded-and-rendered-on-late-receiver", {
    receivedFrames: screenBaseline.receivedFrames,
    decodedFrames: screenBaseline.decodedFrames,
    renderedFrames: screenBaseline.renderedFrames,
    dimensions: [screenBaseline.width, screenBaseline.height],
    observedCenterPixel: screenBaseline.centerPixel,
  });

  const bPacketsBeforeAStop = (await readAudio(B)).sentPackets;
  const cBSourceBeforeAStop = activeSources(await readAudio(C)).find((source) => source.generation === bGeneration)?.renderedPcmSamples ?? 0;
  await stopPublishing(A);
  const bAfterAStops = await waitFor(async () => {
    const audio = await readAudio(B);
    return audio.publisherState === "broadcasting" && !activeSources(audio).some((source) => source.generation === aGeneration1) ? audio : null;
  }, "B clears A's stopped source while B keeps publishing", MEDIA_TIMEOUT_MS);
  assert.equal(bAfterAStops.activeSourceCount, 0, "B must not receive its own source after A stops.");
  const bContinues = await waitFor(async () => {
    const audio = await readAudio(B);
    return audio.sentPackets > bPacketsBeforeAStop && audio.publisherState === "broadcasting" ? audio : null;
  }, "B continues publishing after A stops", MEDIA_TIMEOUT_MS);
  const cBContinues = await waitFor(async () => {
    const audio = await readAudio(C);
    const sources = activeSources(audio);
    return sources.length === 1 && sources[0].generation === bGeneration && sources[0].renderedPcmSamples > cBSourceBeforeAStop ? audio : null;
  }, "C clears A and renders fresh B PCM after A stops", MEDIA_TIMEOUT_MS);
  stage("A-stopped-while-B-kept-publishing", { BPacketsBefore: bPacketsBeforeAStop, BPacketsAfter: bContinues.sentPackets, BGeneration: bGeneration, CBeforeBRenderedPcmSamples: cBSourceBeforeAStop, CAfterBRenderedPcmSamples: activeSources(cBContinues)[0].renderedPcmSamples });

  const aRestart = await startPublishing(A);
  const aGeneration2 = aRestart.publisherGeneration;
  assert.notEqual(aGeneration2, aGeneration1, "A restart must receive a fresh publisher generation.");
  await waitForSources(B, [aGeneration2], "A's new generation on B");
  const cAfterRestart = await waitForSources(C, [aGeneration2, bGeneration], "A's new generation and B on C");
  assert.equal(cAfterRestart.sources.some((source) => source.generation === aGeneration1), false, "C must not keep A's old generation active.");
  report.publishers.A.generation2 = aGeneration2;
  report.publishers.A.restartClockId = cAfterRestart.sources.find((source) => source.generation === aGeneration2)?.clockId ?? "";
  stage("A-reopened-with-fresh-generation", { oldGeneration: aGeneration1, newGeneration: aGeneration2 });

  const bPacketsBeforeCStop = (await readAudio(B)).receivedPackets;
  const aPacketsBeforeCStop = (await readAudio(A)).receivedPackets;
  await stopListening(C);
  await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  const aAfterCStop = await readAudio(A);
  const bAfterCStop = await readAudio(B);
  assert.ok(aAfterCStop.receivedPackets > aPacketsBeforeCStop, "A must continue receiving B while C is stopped.");
  assert.ok(bAfterCStop.receivedPackets > bPacketsBeforeCStop, "B must continue receiving A while C is stopped.");
  const cRestart = await startListening(C);
  const cAfterListenRestart = await waitForSources(C, [aGeneration2, bGeneration], "both sources after C re-subscribes");
  report.receiverSnapshots.push({
    phase: "after-stop-and-restart-listening",
    client: C.name,
    sources: cAfterListenRestart.sources,
    aggregate: {
      receivedPackets: cAfterListenRestart.receivedPackets,
      decodedFrames: cAfterListenRestart.decodedFrames,
      renderedSamples: cAfterListenRestart.renderedSamples,
      renderRms: cAfterListenRestart.renderRms,
      decodeQueueDroppedPackets: cAfterListenRestart.decodeQueueDroppedPackets,
    },
  });
  stage("C-stopped-and-restarted-listening-while-A-and-B-kept-mutual-receive", {
    AReceivedPacketsAdvanced: aAfterCStop.receivedPackets > aPacketsBeforeCStop,
    BReceivedPacketsAdvanced: bAfterCStop.receivedPackets > bPacketsBeforeCStop,
    restartedSources: cAfterListenRestart.sources.map(({ generation }) => generation),
    listenerState: cRestart.listenerState,
  });

  const screenPanel = C.page.locator('[data-testid="screen-panel"]');
  await C.page.locator('[data-testid="screen-stop-watching"]').click();
  await waitFor(async () => {
    const screen = await readScreen(C);
    return !screen.receiverSubscribed && screen.receiverState === "off" && screen.width === 0 && screen.height === 0 ? screen : null;
  }, "C stops screen watching and clears rendered canvas", MEDIA_TIMEOUT_MS);
  await C.page.locator('[data-testid="screen-start-watching"]').click();
  const screenRestarted = await waitForScreenRender(C);
  assert.ok(screenRestarted.renderedFrames >= 3, "C should decode and render again after re-watching.");
  await A.page.getByRole("button", { name: "停止分享" }).click();
  const screenCleared = await waitFor(async () => {
    const screen = await readScreen(C);
    return screen.receiverState === "waiting" && screen.width === 0 && screen.height === 0 ? screen : null;
  }, "A stops the screen source and C clears decoded output", MEDIA_TIMEOUT_MS);
  const aScreenStopped = await screenPanel.getAttribute("data-receiver-state").catch(() => null);
  assert.equal(aScreenStopped, "waiting");
  report.screen.stoppedAndCleared = screenCleared;
  report.screen.rewatched = screenRestarted;
  stage("screen-watch-stop-restart-and-publisher-stop-cleared-canvas", {
    renderedBeforeStop: screenRestarted.renderedFrames,
    clearedWidth: screenCleared.width,
    clearedHeight: screenCleared.height,
    receiverState: screenCleared.receiverState,
  });

  await stopPublishing(A);
  await stopPublishing(B);
  await stopListening(A);
  await stopListening(B);
  await stopListening(C);
  assert.equal(report.screenshots.length, MAX_SCREENSHOTS, "The successful run must retain exactly two bounded screenshots.");
  assert.deepEqual(report.errors.pageErrors, [], "No unhandled browser page errors should occur.");
  stage("publishers-listeners-and-synthetic-tracks-stopped");
}

async function cleanup() {
  for (const client of clients.values()) {
    if (client.page.isClosed()) continue;
    try { await client.page.evaluate(async () => await window.__desktop01SyntheticMedia?.stopAll?.()); }
    catch { /* The page may already be closing. */ }
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
  if (!report.cleanup.profilesRemoved || report.cleanup.contextsClosed !== contexts.length || report.errors.cleanupErrors.length > 0) {
    report.status = "failed";
    report.errors.failure ??= "Browser contexts or isolated workspace profiles were not fully cleaned up.";
    failure ??= new Error(report.errors.failure);
  }
  report.finishedAt = new Date().toISOString();
  report.durationMs = elapsedMs();
  writeFileSync(join(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

if (failure) {
  console.error(`[DESKTOP01] failed: ${boundedError(failure)}`);
  process.exitCode = 1;
} else {
  console.log(`[DESKTOP01] ${report.status}; report: ${relative(root, join(outputDirectory, "report.json"))}`);
}
