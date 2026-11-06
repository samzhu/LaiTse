import { enterRepositoryRootForLegacyScript, repositoryRoot, pocRoot } from "./lib/project-paths.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

enterRepositoryRootForLegacyScript();

const root = repositoryRoot;
const scratchRoot = resolve(root, ".scratch/t06");
const outputDirectory = resolve(root, process.env.T06_OUTPUT_DIR ?? ".scratch/t06/desktop-smoke");
const outputRelative = relative(scratchRoot, outputDirectory);
if (isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(`..${sep}`)) {
  throw new Error("T06_OUTPUT_DIR must stay inside .scratch/t06.");
}

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, ".tools/playwright-browsers");
const { firefox } = await import("playwright");
const defaultTlsDirectory = resolve(root, ".scratch/t01/tls");
const caCertificate = resolve(process.env.T06_CA_CERT ?? join(defaultTlsDirectory, "local-ca.pem"));
const serverCertificate = resolve(process.env.TLS_CERT_FILE ?? join(defaultTlsDirectory, "localhost-cert.pem"));
const baseURL = process.env.T06_BASE_URL ?? `https://localhost:${process.env.PORT ?? "4173"}`;
const target = new URL(baseURL);
const roomId = process.env.T06_ROOM_ID ?? "lobby";
if (!["lobby", "studio"].includes(roomId)) throw new Error("T06_ROOM_ID must be lobby or studio.");
const certificateUtility = process.env.CERTUTIL_BIN ?? "certutil";
const headless = process.env.HEADLESS !== "0";
const markerPeriodMs = 2_400;
const markerDurationMs = 480;
const markerColors = [
  [250, 50, 40], [35, 220, 80], [45, 90, 255], [245, 220, 35],
  [225, 45, 225], [20, 215, 220], [250, 135, 25], [245, 245, 245],
];

mkdirSync(outputDirectory, { recursive: true });
const report = {
  schemaVersion: 1,
  purpose: "Short T06 synthetic browser feasibility flow: publisher-clocked audio/video, active-share late join, keyframe gating, source replacement, resubscribe, and same-receiver marker sampling.",
  startedAt: new Date().toISOString(),
  status: "running",
  baseURL: target.origin,
  topology: { publishers: 1, receivers: 2, browserProcesses: 3, network: "one local application over trusted HTTPS/WSS" },
  runtime: {
    node: process.version,
    npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
    platform: process.platform,
    architecture: process.arch,
    osVersion: process.platform === "darwin"
      ? execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim()
      : "not-collected",
  },
  tls: {
    trust: "local CA imported only into each isolated Firefox NSS profile",
    caCertificate,
    serverCertificate,
    ignoreCertificateErrors: false,
    systemTrustChanged: false,
  },
  sources: {
    audio: "test-created oscillator → AudioContext → MediaStreamDestination; no hardware microphone",
    video: "animated canvas MediaStreamTrack returned by a test-only getDisplayMedia replacement",
    marker: {
      kind: "same synthetic audio-context pulse drives an audible oscillator interval and a color-coded canvas tile",
      periodMs: markerPeriodMs,
      activeDurationMs: markerDurationMs,
      colors: markerColors.map((rgb, cycleCode) => ({ cycleCode, rgb })),
      physicalInputLatency: "unknown; source audio timestamp is an approximate capture-graph/performance mapping",
    sourceJitter: "AudioContext gain transitions use a 12 ms test timer and a short gain ramp; transition timing is not exact",
    },
    physicalDisplayCaptureSelected: false,
    physicalMicrophoneSelected: false,
    realMediaRecorded: false,
  },
  clients: {},
  stages: [],
  snapshots: [],
  controlEvents: [],
  keyframeRequests: [],
  markerMeasurement: null,
  transport: [],
  errors: { pageErrors: [], socketErrors: [] },
  limitations: {
    endToEndLatencyMs: null,
    physicalDisplayCapture: "not-tested; getDisplayMedia is replaced by a synthetic canvas stream",
    physicalMicrophoneAndHumanListening: "not-tested; capture source is a synthetic oscillator",
    phoneBrowser: "not-tested",
    crossDeviceClockCalibration: "not-tested",
    mappingErrorBoundMs: null,
    audioVideoP95: "not-claimed; this short DEC-010 run samples a few color-coded marker cycles",
    screenCaptureTimestamp: "canvas-to-encoder copy time, not the physical source capture instant",
    audioOutputTimestamp: "browser AudioContext output-device clock mapping, not physical-speaker or human-hearing evidence",
    serverCpuAndMemory: "not-collected-by-browser-script",
    codecFallback: "VP8/Opus only; no Recorder/MSE negotiation in this run",
  },
  screenshots: ["receiver-b-late-join.png", "receiver-b-source-replaced.png", "receiver-b-resubscribed.png"],
};

let failure;
const contexts = [];
const pageTransports = [];

function logStage(name, details = {}) {
  const stage = { name, at: new Date().toISOString(), ...details };
  report.stages.push(stage);
  console.log(`[T06] ${name}${Object.keys(details).length ? ` ${JSON.stringify(details)}` : ""}`);
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

async function launchIsolatedFirefox(name) {
  const profile = createTrustedProfile(name);
  const context = await firefox.launchPersistentContext(profile.profileDirectory, {
    headless,
    env: { ...process.env, MOZ_APP_DATA: profile.appData, MOZ_LOCAL_APP_DATA: profile.localAppData },
    viewport: { width: 1440, height: 1080 },
    colorScheme: "light",
    firefoxUserPrefs: { "media.navigator.streams.fake": true },
  });
  context.setDefaultTimeout(10_000);
  contexts.push(context);
  return context;
}

function recordTransport(page, name) {
  const transport = { name, sockets: [], pageErrors: [], receivedControls: [] };
  page.on("pageerror", (error) => {
    transport.pageErrors.push({ at: new Date().toISOString(), message: error.message });
    report.errors.pageErrors.push({ client: name, message: error.message });
  });
  page.on("websocket", (socket) => {
    const item = { url: socket.url(), sentTextFrames: 0, sentBinaryFrames: 0, receivedTextFrames: 0, receivedBinaryFrames: 0, errors: [] };
    transport.sockets.push(item);
    socket.on("framesent", (frame) => {
      if (typeof frame.payload === "string") item.sentTextFrames += 1;
      else item.sentBinaryFrames += 1;
    });
    socket.on("framereceived", (frame) => {
      if (typeof frame.payload === "string") {
        item.receivedTextFrames += 1;
        try {
          const message = JSON.parse(frame.payload);
          transport.receivedControls.push({ at: new Date().toISOString(), message });
          if (message.type === "screen.keyframeRequest") report.keyframeRequests.push({ client: name, at: new Date().toISOString(), generation: message.generation });
        } catch {
          transport.receivedControls.push({ at: new Date().toISOString(), message: { type: "unparsed-control" } });
        }
      } else item.receivedBinaryFrames += 1;
    });
    socket.on("socketerror", (error) => {
      item.errors.push(String(error));
      report.errors.socketErrors.push({ client: name, message: String(error) });
    });
  });
  pageTransports.push(transport);
  return transport;
}

function controlCount(transport, type) {
  return transport.receivedControls.filter((entry) => entry.message.type === type).length;
}

async function waitForControl(transport, type, previousCount = 0, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const matches = transport.receivedControls.filter((entry) => entry.message.type === type).slice(previousCount);
    if (matches.length) return matches.at(-1).message;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`${transport.name} did not receive ${type} within ${timeoutMs} ms.`);
}

async function joinRoom(page, displayName) {
  await page.goto(`${target.origin}/?room=${roomId}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Local room presence" }).waitFor();
  await page.getByLabel("Your display name").fill(displayName);
  await page.getByRole("button", { name: "Join room" }).click();
  await page.getByTestId("control-connection-status").filter({ hasText: /^Connected to /u }).waitFor();
  await page.locator('[data-testid="audio-panel"]').waitFor();
  await page.locator('[data-testid="screen-panel"]').waitFor();
}

async function installSyntheticMedia(page) {
  await page.addInitScript(({ periodMs, activeMs, colors }) => {
    const mediaDevices = navigator.mediaDevices;
    const state = {
      audioContext: null,
      audioGain: null,
      pulseOriginContextSeconds: null,
      pulseOriginPerformanceTimeMs: null,
      pulseActive: false,
      sourceIndex: 0,
      tracks: [],
    };
    Object.defineProperty(window, "__t06SyntheticState", { value: state, configurable: false });
    Object.defineProperty(mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const context = new AudioContext({ sampleRate: 48_000 });
        await context.resume();
        const destination = context.createMediaStreamDestination();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = 620;
        gain.gain.value = 0;
        oscillator.connect(gain).connect(destination);
        oscillator.start();
        const anchorContextTime = context.currentTime;
        const anchorPerformanceTime = performance.now();
        state.audioContext = context;
        state.audioGain = gain;
        state.pulseOriginContextSeconds = anchorContextTime + 1_500 / 1_000;
        state.pulseOriginPerformanceTimeMs = anchorPerformanceTime + 1_500;
        const updatePulse = () => {
          const elapsedMs = (context.currentTime - state.pulseOriginContextSeconds) * 1_000;
          const phaseMs = ((elapsedMs % periodMs) + periodMs) % periodMs;
          const active = elapsedMs >= 0 && phaseMs < activeMs;
          if (active !== state.pulseActive) {
            state.pulseActive = active;
            gain.gain.setTargetAtTime(active ? 0.24 : 0, context.currentTime, 0.008);
          }
          if (context.state === "running") window.setTimeout(updatePulse, 12);
        };
        updatePulse();
        return destination.stream;
      },
    });
    Object.defineProperty(mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: async () => {
        const context = state.audioContext;
        if (!context || !state.audioGain) throw new Error("Start the synthetic audio source before creating marker video.");
        const sourceIndex = state.sourceIndex++;
        const dimensions = sourceIndex === 0 ? { width: 1280, height: 720 } : sourceIndex === 1 ? { width: 640, height: 360 } : { width: 480, height: 270 };
        const canvas = document.createElement("canvas");
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;
        const drawing = canvas.getContext("2d");
        if (!drawing) throw new Error("Could not create synthetic marker canvas.");
        let active = true;
        const draw = () => {
          if (!active) return;
          const elapsedMs = (context.currentTime - state.pulseOriginContextSeconds) * 1_000;
          const cycle = Math.floor(elapsedMs / periodMs);
          const phaseMs = ((elapsedMs % periodMs) + periodMs) % periodMs;
          const pulseOn = elapsedMs >= 0 && phaseMs < activeMs;
          drawing.fillStyle = "rgb(24, 32, 46)";
          drawing.fillRect(0, 0, canvas.width, canvas.height);
          if (pulseOn) {
            const code = ((cycle % colors.length) + colors.length) % colors.length;
            const [red, green, blue] = colors[code];
            drawing.fillStyle = `rgb(${red}, ${green}, ${blue})`;
            drawing.fillRect(0, 0, Math.max(96, Math.floor(canvas.width * 0.12)), Math.max(96, Math.floor(canvas.height * 0.24)));
          }
          drawing.fillStyle = "white";
          drawing.font = `${Math.max(22, Math.floor(canvas.height * 0.055))}px sans-serif`;
          drawing.fillText(`Synthetic source ${sourceIndex} · ${cycle}`, Math.floor(canvas.width * 0.16), Math.floor(canvas.height * 0.11));
          requestAnimationFrame(draw);
        };
        draw();
        const stream = canvas.captureStream(15);
        const track = stream.getVideoTracks()[0];
        if (!track) throw new Error("Synthetic canvas did not produce a video track.");
        state.tracks.push({ sourceIndex, width: dimensions.width, height: dimensions.height, track });
        const stop = track.stop.bind(track);
        track.stop = () => {
          active = false;
          stop();
        };
        return stream;
      },
    });
  }, { periodMs: markerPeriodMs, activeMs: markerDurationMs, colors: markerColors });
}

async function screenSnapshot(page, label) {
  const snapshot = await page.locator('[data-testid="screen-panel"]').evaluate((panel) => {
    const canvas = panel.querySelector('[data-testid="screen-preview"]');
    const context = canvas?.getContext("2d");
    const pixel = canvas && canvas.width > 0 && canvas.height > 0 && context
      ? Array.from(context.getImageData(40, 40, 1, 1).data)
      : null;
    return {
      capturedAt: new Date().toISOString(),
      receiverState: panel.getAttribute("data-receiver-state"),
      renderedFrames: Number(panel.getAttribute("data-rendered-frames")),
      receivedFrames: Number(panel.getAttribute("data-received-frames")),
      decodedFrames: Number(panel.getAttribute("data-decoded-frames")),
      width: Number(panel.getAttribute("data-rendered-width")) || null,
      height: Number(panel.getAttribute("data-rendered-height")) || null,
      renderFps: Number(panel.getAttribute("data-render-fps")),
      syncMode: panel.getAttribute("data-sync-mode"),
      syncClockId: panel.getAttribute("data-sync-clock-id"),
      scheduledSourceClockOffsetMs: Number(panel.getAttribute("data-scheduled-source-clock-offset-ms")) || null,
      droppedDecodedFrames: Number(panel.getAttribute("data-dropped-decoded-frames")),
      pixel,
      receiverMessage: panel.querySelector('[data-screen-status="receiver"]')?.textContent?.trim() ?? "",
    };
  });
  report.snapshots.push({ client: label, screen: snapshot });
  return snapshot;
}

async function audioSnapshot(page, label) {
  const snapshot = await page.locator('[data-testid="audio-panel"]').evaluate((panel) => ({
    capturedAt: new Date().toISOString(),
    listenerState: panel.getAttribute("data-listener-state"),
    publisherState: panel.getAttribute("data-publisher-state"),
    sentPackets: Number(panel.getAttribute("data-sent-packets")),
    receivedPackets: Number(panel.getAttribute("data-received-packets")),
    decodedFrames: Number(panel.getAttribute("data-decoded-frames")),
    renderedSamples: Number(panel.getAttribute("data-rendered-samples")),
    queuedSamples: Number(panel.getAttribute("data-queued-samples")),
    queueOverflowResets: Number(panel.getAttribute("data-queue-overflow-resets")),
    renderRms: Number(panel.getAttribute("data-render-rms")),
    clockId: panel.getAttribute("data-audio-playback-clock-id"),
    pulseEvents: JSON.parse(panel.getAttribute("data-audio-pulse-events") ?? "[]"),
  }));
  report.snapshots.push({ client: label, audio: snapshot });
  return snapshot;
}

async function waitForRendered(page, label, minimumFrames = 4, timeoutMs = 10_000) {
  await page.waitForFunction((count) => {
    const panel = document.querySelector('[data-testid="screen-panel"]');
    const canvas = panel?.querySelector('[data-testid="screen-preview"]');
    return panel && canvas && Number(panel.getAttribute("data-rendered-frames")) >= count && canvas.width > 0 && canvas.height > 0;
  }, minimumFrames, { timeout: timeoutMs });
  const snapshot = await screenSnapshot(page, label);
  assert.ok(snapshot.receivedFrames > 0 && snapshot.decodedFrames > 0 && snapshot.renderedFrames >= minimumFrames, `${label} should receive, decode, and render screen frames`);
  assert.ok(snapshot.width && snapshot.height, `${label} should expose actual render dimensions`);
  assert.ok(snapshot.pixel?.some((channel) => channel !== 0), `${label} canvas should contain decoded pixels`);
  return snapshot;
}

async function waitForAudio(page, label, timeoutMs = 10_000) {
  await page.waitForFunction(() => {
    const panel = document.querySelector('[data-testid="audio-panel"]');
    return panel && Number(panel.getAttribute("data-rendered-samples")) > 0 && Number(panel.getAttribute("data-render-rms")) > 0.0001;
  }, undefined, { timeout: timeoutMs });
  const snapshot = await audioSnapshot(page, label);
  assert.ok(snapshot.receivedPackets > 0 && snapshot.decodedFrames > 0 && snapshot.renderedSamples > 0, `${label} should decode and render audio samples`);
  return snapshot;
}

async function sampleReceiverMarkers(page, durationMs = 8_000) {
  return await page.evaluate(async ({ duration, colors }) => await new Promise((resolveSample) => {
    const startedAt = performance.now();
    const markers = [];
    let previousCycleCode = null;
    let initializedPixel = false;
    let previousRafTime = null;
    let maximumRafIntervalMs = 0;
    const tick = (time) => {
      if (previousRafTime !== null) maximumRafIntervalMs = Math.max(maximumRafIntervalMs, time - previousRafTime);
      previousRafTime = time;
      const panel = document.querySelector('[data-testid="screen-panel"]');
      const canvas = panel?.querySelector('[data-testid="screen-preview"]');
      const audioPanel = document.querySelector('[data-testid="audio-panel"]');
      if (canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0) {
        const pixel = canvas.getContext("2d")?.getImageData(40, 40, 1, 1).data;
        if (pixel) {
          let bestCode = null;
          let bestDistance = Number.POSITIVE_INFINITY;
          colors.forEach(([red, green, blue], code) => {
            const distance = (red - pixel[0]) ** 2 + (green - pixel[1]) ** 2 + (blue - pixel[2]) ** 2;
            if (distance < bestDistance) { bestDistance = distance; bestCode = code; }
          });
          const maxChannelDifference = bestCode === null
            ? Number.POSITIVE_INFINITY
            : Math.max(Math.abs(colors[bestCode][0] - pixel[0]), Math.abs(colors[bestCode][1] - pixel[1]), Math.abs(colors[bestCode][2] - pixel[2]));
          const cycleCode = maxChannelDifference <= 45 ? bestCode : null;
          if (initializedPixel && cycleCode !== null && cycleCode !== previousCycleCode) {
            markers.push({
              cycleCode,
              receiverPerformanceTimeMs: time,
              observedPixel: [pixel[0], pixel[1], pixel[2]],
              syncMode: panel?.getAttribute("data-sync-mode"),
              screenClockId: panel?.getAttribute("data-sync-clock-id"),
              audioClockId: audioPanel?.getAttribute("data-audio-playback-clock-id"),
              scheduledSourceClockOffsetMs: Number(panel?.getAttribute("data-scheduled-source-clock-offset-ms")) || null,
            });
          }
          initializedPixel = true;
          previousCycleCode = cycleCode;
        }
      }
      if (time - startedAt < duration) requestAnimationFrame(tick);
      else resolveSample({ startedAtPerformanceTimeMs: startedAt, endedAtPerformanceTimeMs: time, maximumRafIntervalMs, markers });
    };
    requestAnimationFrame(tick);
  }), { duration: durationMs, colors: markerColors });
}

async function downloadScreenObservation(page) {
  const downloadPromise = page.waitForEvent("download", { timeout: 10_000 });
  await page.getByRole("button", { name: "下載畫面觀測" }).click();
  const download = await downloadPromise;
  const destination = join(outputDirectory, "observations", "receiver-b-screen.json");
  mkdirSync(dirname(destination), { recursive: true });
  await download.saveAs(destination);
  const observation = JSON.parse(readFileSync(destination, "utf8"));
  assert.equal(observation.schemaVersion, 2);
  assert.equal(observation.encoding.codec, "vp8");
  assert.equal(observation.evidence.lateJoinSynchronization, "keyframe-gated-with-config-metadata");
  assert.equal(observation.evidence.endToEndLatencyMs, null);
  if (observation.audioVideoSync.audioMaster) assert.equal(observation.audioVideoSync.audioMaster.mappingErrorBoundMs, null);
  assert.ok(observation.audioVideoSync.recentAudioPulseEvents.length > 0);
  assert.equal(observation.capture.physicalDisplayVerified, false);
  report.observation = { path: relative(root, destination), json: observation };
  return observation;
}

function writeReport() {
  report.finishedAt = new Date().toISOString();
  report.status = failure ? "failed" : "passed";
  report.transport = pageTransports.map((transport) => ({
    name: transport.name,
    sockets: transport.sockets,
    pageErrors: transport.pageErrors,
    receivedControlTypes: transport.receivedControls.map((entry) => entry.message.type),
  }));
  report.errors.failure = failure ? String(failure.stack ?? failure) : null;
  writeFileSync(join(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(outputDirectory, "README.md"), [
    "# T06 synthetic late-join and sync smoke",
    "",
    `Status: ${report.status}`,
    `Started: ${report.startedAt}`,
    `Finished: ${report.finishedAt}`,
    `Topology: ${report.topology.publishers} publisher, ${report.topology.receivers} receivers, ${report.topology.browserProcesses} isolated Firefox processes over trusted local HTTPS/WSS.`,
    "",
    "The smoke uses an AudioContext oscillator routed through MediaStreamDestination and an animated color-coded canvas stream. It exercises real Opus/VP8 WebCodecs, the local WSS relays, late subscription, publisher keyframe request, source replacement with a new generation/dimensions, and receiver unsubscribe/re-subscribe.",
    "",
    "Marker offsets compare receiver AudioWorklet pulse-observation times with receiver RAF samples of decoded canvas pixels in one receiver performance domain. Each AudioWorklet report records its actual frame-count window (near 20 ms); RAF sampling resolution is recorded. Mapping error is uncalibrated and recorded null. This is graph/render evidence only, not physical speaker, human perception, physical capture, phone, or end-to-end latency evidence; no p95 acceptance is claimed.",
    "",
    failure ? `Failure: ${String(failure.stack ?? failure)}` : "Failure: none",
    "",
  ].join("\n"));
}

try {
  const [publisherContext, receiverAContext, receiverBContext] = await Promise.all([
    launchIsolatedFirefox("publisher"),
    launchIsolatedFirefox("receiver-a"),
    launchIsolatedFirefox("receiver-b"),
  ]);
  report.runtime.firefox = publisherContext.browser()?.version() ?? "not-reported";
  const publisherPage = await publisherContext.newPage();
  const receiverAPage = await receiverAContext.newPage();
  const receiverBPage = await receiverBContext.newPage();
  await installSyntheticMedia(publisherPage);
  const publisherTransport = recordTransport(publisherPage, "publisher");
  const receiverATransport = recordTransport(receiverAPage, "receiver-a");
  const receiverBTransport = recordTransport(receiverBPage, "receiver-b");

  await Promise.all([joinRoom(publisherPage, "Speaker"), joinRoom(receiverAPage, "Viewer A")]);
  report.clients = {
    publisher: { browser: "Firefox", role: "synthetic oscillator and canvas publisher" },
    receiverA: { browser: "Firefox", role: "early audio and screen receiver" },
    receiverB: { browser: "Firefox", role: "late audio and screen receiver" },
  };
  logStage("room-ready");

  const receiverAScreenSubscribed = waitForControl(receiverATransport, "screen.subscribed");
  const receiverAAudioSubscribed = waitForControl(receiverATransport, "audio.subscribed");
  await receiverAPage.getByRole("button", { name: "開始觀看分享" }).click();
  await receiverAPage.getByRole("button", { name: "開始收聽" }).click();
  await Promise.all([receiverAScreenSubscribed, receiverAAudioSubscribed]);

  const audioStreamAtA = waitForControl(receiverATransport, "audio.stream");
  const audioStartedCount = controlCount(publisherTransport, "audio.started");
  await publisherPage.getByRole("button", { name: "開始麥克風" }).click();
  await waitForControl(publisherTransport, "audio.started", audioStartedCount);
  const audioStream = await audioStreamAtA;
  await waitForAudio(receiverAPage, "receiver-a-audio-active");
  logStage("synthetic-audio-active", { clockId: audioStream.clockId });

  const firstScreenStreamAtA = waitForControl(receiverATransport, "screen.stream");
  const firstScreenStartedCount = controlCount(publisherTransport, "screen.started");
  await publisherPage.getByRole("button", { name: "開始分享畫面" }).click();
  const firstStarted = await waitForControl(publisherTransport, "screen.started", firstScreenStartedCount);
  const firstScreenStream = await firstScreenStreamAtA;
  assert.equal(firstScreenStream.clockId, audioStream.clockId, "audio and screen announcements from one socket must share a clockId");
  const firstA = await waitForRendered(receiverAPage, "receiver-a-first-screen");
  assert.equal(firstA.width, 1280);
  assert.equal(firstA.height, 720);
  logStage("screen-active", { generation: firstStarted.generation, width: firstA.width, height: firstA.height, clockId: firstScreenStream.clockId });

  await joinRoom(receiverBPage, "Viewer B");
  const lateScreenSubscribed = waitForControl(receiverBTransport, "screen.subscribed");
  const lateAudioSubscribed = waitForControl(receiverBTransport, "audio.subscribed");
  const lateScreenStream = waitForControl(receiverBTransport, "screen.stream");
  const lateAudioStream = waitForControl(receiverBTransport, "audio.stream");
  const keyframeRequestCount = controlCount(publisherTransport, "screen.keyframeRequest");
  await receiverBPage.getByRole("button", { name: "開始觀看分享" }).click();
  await receiverBPage.getByRole("button", { name: "開始收聽" }).click();
  await Promise.all([lateScreenSubscribed, lateAudioSubscribed]);
  const [lateScreen, lateAudio] = await Promise.all([lateScreenStream, lateAudioStream]);
  await waitForControl(publisherTransport, "screen.keyframeRequest", keyframeRequestCount);
  assert.equal(lateScreen.generation, firstStarted.generation);
  assert.equal(lateScreen.clockId, lateAudio.clockId);
  assert.equal(lateScreen.clockId, audioStream.clockId);
  await waitForAudio(receiverBPage, "receiver-b-late-audio");
  await receiverBPage.waitForFunction(() => document.querySelector('[data-testid="screen-panel"]')?.getAttribute("data-sync-mode") === "audio-master", undefined, { timeout: 10_000 });
  const firstB = await waitForRendered(receiverBPage, "receiver-b-late-join");
  assert.equal(firstB.width, 1280);
  assert.equal(firstB.syncMode, "audio-master", "late receiver must actually schedule frames against the matching audio clock");
  assert.equal(firstB.syncClockId, lateAudio.clockId);
  await receiverBPage.locator('[data-testid="screen-panel"]').screenshot({ path: join(outputDirectory, "receiver-b-late-join.png") });
  logStage("late-join-decoded", { generation: lateScreen.generation, clockId: lateScreen.clockId, dimensions: [firstB.width, firstB.height], syncMode: firstB.syncMode });

  const pulseOrigin = await publisherPage.evaluate(() => window.__t06SyntheticState.pulseOriginPerformanceTimeMs);
  const markerSample = await sampleReceiverMarkers(receiverBPage, 8_000);
  const receiverAudio = await audioSnapshot(receiverBPage, "receiver-b-after-marker-sampling");
  const cycleIndices = receiverAudio.pulseEvents.map((event) => {
    const relativeMs = event.sourceTimestampUs / 1_000 - pulseOrigin;
    const rawCycleIndex = Math.floor(relativeMs / markerPeriodMs);
    const phaseMs = relativeMs - rawCycleIndex * markerPeriodMs;
    const distanceToNextCycleMs = markerPeriodMs - phaseMs;
    const advancesToNextCycle = distanceToNextCycleMs <= event.observationWindowMs;
    return {
      event,
      rawCycleIndex,
      cycleIndex: rawCycleIndex + (advancesToNextCycle ? 1 : 0),
      cycleAdjustmentMs: advancesToNextCycle ? distanceToNextCycleMs : 0,
      cycleAssignment: advancesToNextCycle ? "next-cycle-within-reported-audio-window" : "source-timestamp-cycle",
    };
  }).filter(({ cycleIndex }) => cycleIndex >= 0);
  const usedCycles = new Set();
  const matchedMarkers = [];
  for (const marker of markerSample.markers) {
    const audio = cycleIndices.find(({ event, cycleIndex }) => cycleIndex % markerColors.length === marker.cycleCode && !usedCycles.has(cycleIndex));
    if (!audio) continue;
    usedCycles.add(audio.cycleIndex);
    matchedMarkers.push({
      cycleIndex: audio.cycleIndex,
      cycleCode: marker.cycleCode,
      audio: audio.event,
      marker,
      receiverPerfOffsetMs: Number((marker.receiverPerformanceTimeMs - audio.event.receiverPerformanceTimeMs).toFixed(2)),
      uncertainty: {
        audioObservationWindowMs: audio.event.observationWindowMs,
        markerRafMaximumIntervalMs: Number(markerSample.maximumRafIntervalMs.toFixed(2)),
        mappingErrorBoundMs: null,
      },
      sameClock: marker.syncMode === "audio-master" && marker.screenClockId === marker.audioClockId && marker.audioClockId === lateAudio.clockId,
    });
  }
  report.markerMeasurement = {
    scope: "receiver browser AudioWorklet graph/output-clock observations versus receiver RAF canvas-pixel observations",
    matching: "cycle-coded marker color and source publisher performance-clock pulse cycle, not nearest modulo-time matching",
    receiverClockId: lateAudio.clockId,
    pulseOriginPublisherPerformanceTimeMs: pulseOrigin,
    nominalObservationIntervalMs: 20,
    markerSampling: markerSample,
    audioPulseEvents: cycleIndices.map(({ event, rawCycleIndex, cycleIndex, cycleAdjustmentMs, cycleAssignment }) => ({
      ...event,
      rawCycleIndex,
      cycleIndex,
      cycleCode: cycleIndex % markerColors.length,
      cycleAdjustmentMs,
      cycleAssignment,
    })),
    matchedMarkers,
    rawReceiverPerformanceOffsetsMs: matchedMarkers.map((entry) => entry.receiverPerfOffsetMs),
    uncertainty: {
      audioObservationWindowMsPerPairedCycle: matchedMarkers.map((entry) => ({ cycleIndex: entry.cycleIndex, windowMs: entry.audio.observationWindowMs })),
      markerRafMaximumIntervalMs: Number(markerSample.maximumRafIntervalMs.toFixed(2)),
      mappingErrorBoundMs: null,
      sourceAudioInputLatency: "unknown",
    },
    p95Claim: null,
  };
  assert.ok(matchedMarkers.length >= 2, `expected at least two same-cycle marker pairs; got ${matchedMarkers.length}`);
  assert.ok(matchedMarkers.every((entry) => entry.sameClock), "every paired marker sample must have observed same-publisher audio-master mode");
  logStage("same-receiver-marker-samples", { pairedCycles: matchedMarkers.length, offsetsMs: report.markerMeasurement.rawReceiverPerformanceOffsetsMs, mappingErrorBoundMs: null });

  const previousGeneration = lateScreen.generation;
  const oldDimensions = [firstB.width, firstB.height];
  const clearPromise = receiverBPage.waitForFunction(() => {
    const canvas = document.querySelector('[data-testid="screen-preview"]');
    return canvas instanceof HTMLCanvasElement && canvas.width === 0 && canvas.height === 0;
  }, undefined, { timeout: 10_000 });
  const replacementStreamAtB = waitForControl(receiverBTransport, "screen.stream", controlCount(receiverBTransport, "screen.stream"));
  const replacementStartedCount = controlCount(publisherTransport, "screen.started");
  await publisherPage.getByRole("button", { name: "更換分享來源" }).click();
  await clearPromise;
  const [replacementStart, replacementStream] = await Promise.all([
    waitForControl(publisherTransport, "screen.started", replacementStartedCount),
    replacementStreamAtB,
  ]);
  const replaced = await waitForRendered(receiverBPage, "receiver-b-source-replaced");
  assert.notEqual(replacementStart.generation, previousGeneration);
  assert.notEqual(replacementStream.generation, previousGeneration);
  assert.notDeepEqual([replaced.width, replaced.height], oldDimensions);
  assert.equal(replaced.syncMode, "audio-master");
  assert.equal(replaced.syncClockId, lateAudio.clockId, "audio should retain the publisher clock through screen replacement");
  await receiverBPage.locator('[data-testid="screen-panel"]').screenshot({ path: join(outputDirectory, "receiver-b-source-replaced.png") });
  const afterReplacementAudio = await audioSnapshot(receiverBPage, "receiver-b-audio-after-source-replacement");
  assert.ok(afterReplacementAudio.renderedSamples > receiverAudio.renderedSamples, "audio playback must continue while screen source changes");
  logStage("source-replaced", { fromGeneration: previousGeneration, toGeneration: replacementStart.generation, fromDimensions: oldDimensions, toDimensions: [replaced.width, replaced.height] });

  const framesBeforeResubscribe = replaced.renderedFrames;
  const audioBeforeResubscribe = afterReplacementAudio.renderedSamples;
  await receiverBPage.getByRole("button", { name: "停止觀看並清除" }).click();
  await receiverBPage.waitForFunction(() => {
    const canvas = document.querySelector('[data-testid="screen-preview"]');
    return canvas instanceof HTMLCanvasElement && canvas.width === 0 && canvas.height === 0;
  }, undefined, { timeout: 10_000 });
  const resubscribeCount = controlCount(receiverBTransport, "screen.subscribed");
  const resubscribeStreamCount = controlCount(receiverBTransport, "screen.stream");
  const resubscribeKeyframeRequestCount = controlCount(publisherTransport, "screen.keyframeRequest");
  await receiverBPage.getByRole("button", { name: "開始觀看分享" }).click();
  const [resubscribed, currentStream] = await Promise.all([
    waitForControl(receiverBTransport, "screen.subscribed", resubscribeCount),
    waitForControl(receiverBTransport, "screen.stream", resubscribeStreamCount),
  ]);
  await waitForControl(publisherTransport, "screen.keyframeRequest", resubscribeKeyframeRequestCount);
  const resubscribedScreen = await waitForRendered(receiverBPage, "receiver-b-resubscribed", framesBeforeResubscribe + 3);
  assert.equal(currentStream.generation, replacementStart.generation);
  assert.equal(resubscribedScreen.syncMode, "audio-master");
  await receiverBPage.locator('[data-testid="screen-panel"]').screenshot({ path: join(outputDirectory, "receiver-b-resubscribed.png") });
  const audioAfterResubscribe = await audioSnapshot(receiverBPage, "receiver-b-audio-after-screen-resubscribe");
  assert.ok(audioAfterResubscribe.renderedSamples > audioBeforeResubscribe, "audio must remain active across screen unsubscribe and re-subscribe");
  logStage("receiver-resubscribed", { generation: currentStream.generation, renderedFrames: resubscribedScreen.renderedFrames, syncMode: resubscribedScreen.syncMode });

  const observation = await downloadScreenObservation(receiverBPage);
  assert.ok(observation.audioVideoSync.recentAudioPulseEvents.length > 0);
  logStage("observation-downloaded", { path: report.observation.path, pulseEvents: observation.audioVideoSync.recentAudioPulseEvents.length });

  const audioBeforeScreenStop = await audioSnapshot(receiverBPage, "receiver-b-before-screen-stop");
  const stoppedCount = controlCount(publisherTransport, "screen.stopped");
  await publisherPage.getByRole("button", { name: "停止分享" }).click();
  await waitForControl(publisherTransport, "screen.stopped", stoppedCount);
  await receiverBPage.waitForFunction(() => {
    const canvas = document.querySelector('[data-testid="screen-preview"]');
    return canvas instanceof HTMLCanvasElement && canvas.width === 0 && canvas.height === 0;
  }, undefined, { timeout: 10_000 });
  await receiverBPage.waitForFunction((samples) => Number(document.querySelector('[data-testid="audio-panel"]')?.getAttribute("data-rendered-samples")) > samples, audioBeforeScreenStop.renderedSamples, { timeout: 10_000 });
  logStage("screen-stopped-audio-continuing");

  const restartedStreamAtA = waitForControl(receiverATransport, "screen.stream", controlCount(receiverATransport, "screen.stream"));
  const restartedCount = controlCount(publisherTransport, "screen.started");
  await publisherPage.getByRole("button", { name: "開始分享畫面" }).click();
  const restarted = await waitForControl(publisherTransport, "screen.started", restartedCount);
  const restartedStream = await restartedStreamAtA;
  assert.notEqual(restarted.generation, replacementStart.generation);
  assert.equal(restartedStream.generation, restarted.generation);
  const screenBeforeAudioStop = await waitForRendered(receiverAPage, "receiver-a-before-audio-stop");
  const publisherStoppedAudio = controlCount(publisherTransport, "audio.stopped");
  const audioEndedAtA = controlCount(receiverATransport, "audio.streamEnded");
  await publisherPage.getByRole("button", { name: "停止麥克風" }).click();
  await waitForControl(publisherTransport, "audio.stopped", publisherStoppedAudio);
  await waitForControl(receiverATransport, "audio.streamEnded", audioEndedAtA);
  await receiverAPage.waitForFunction((count) => Number(document.querySelector('[data-testid="screen-panel"]')?.getAttribute("data-rendered-frames")) >= count + 3, screenBeforeAudioStop.renderedFrames, { timeout: 10_000 });
  const screenAfterAudioStop = await screenSnapshot(receiverAPage, "receiver-a-screen-after-audio-stop");
  assert.ok(screenAfterAudioStop.renderedFrames > screenBeforeAudioStop.renderedFrames, "screen rendering should continue after publisher audio stops");
  logStage("audio-stopped-screen-continuing", { beforeFrames: screenBeforeAudioStop.renderedFrames, afterFrames: screenAfterAudioStop.renderedFrames });

  report.controlEvents = [...publisherTransport.receivedControls, ...receiverATransport.receivedControls, ...receiverBTransport.receivedControls]
    .map(({ at, message }) => ({ at, type: message.type, generation: message.generation, clockId: message.clockId }));
  assert.equal(report.errors.pageErrors.length, 0, "browser pages should not report uncaught exceptions");
  await Promise.all([publisherPage.close(), receiverAPage.close(), receiverBPage.close()]);
  await Promise.all(contexts.map((context) => context.close()));
  contexts.length = 0;
} catch (error) {
  failure = error;
  report.failureSnapshots = [];
  for (const context of contexts) {
    for (const page of context.pages()) {
      try {
        if (!await page.locator('[data-testid="screen-panel"]').count()) continue;
        report.failureSnapshots.push(await screenSnapshot(page, "failure-state"));
        report.failureSnapshots.push(await audioSnapshot(page, "failure-audio-state"));
      } catch { /* A closed or unavailable page cannot supply diagnostics. */ }
    }
  }
  for (const context of contexts) {
    try { await context.close(); } catch { /* Ensure all browser profiles close. */ }
  }
  contexts.length = 0;
} finally {
  writeReport();
}

if (failure) throw failure;
console.log(`T06 smoke passed; evidence saved under ${relative(root, outputDirectory)}.`);
