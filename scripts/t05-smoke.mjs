import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const root = process.cwd();
const scratchRoot = resolve(root, ".scratch/t05");
const outputDirectory = resolve(root, process.env.T05_OUTPUT_DIR ?? ".scratch/t05/desktop-smoke");
const outputRelative = relative(scratchRoot, outputDirectory);
if (isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(`..${sep}`)) {
  throw new Error("T05_OUTPUT_DIR must stay inside .scratch/t05.");
}

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, ".tools/playwright-browsers");
const { firefox } = await import("playwright");
const defaultTlsDirectory = resolve(root, ".scratch/t01/tls");
const caCertificate = resolve(process.env.T05_CA_CERT ?? join(defaultTlsDirectory, "local-ca.pem"));
const serverCertificate = resolve(process.env.TLS_CERT_FILE ?? join(defaultTlsDirectory, "localhost-cert.pem"));
const baseURL = process.env.T05_BASE_URL ?? `https://localhost:${process.env.PORT ?? "4173"}`;
const target = new URL(baseURL);
const certificateUtility = process.env.CERTUTIL_BIN ?? "certutil";
const headless = process.env.HEADLESS !== "0";

mkdirSync(outputDirectory, { recursive: true });
const report = {
  schemaVersion: 1,
  purpose: "Short T05 screen-share core flow with injected synthetic display source; not physical display capture, late-join sync, or quality acceptance.",
  startedAt: new Date().toISOString(),
  status: "running",
  baseURL: target.origin,
  topology: { publishers: 1, receivers: 2, browserProcesses: 3, network: "one local application over trusted HTTPS/WSS" },
  headless,
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
  mediaSource: {
    kind: "synthetic animated canvas MediaStreamTrack injected by this test",
    replacement: "publisher-page init script replaces navigator.mediaDevices.getDisplayMedia before the app loads",
    realDisplayCaptureSelected: false,
    realMicrophoneSelected: false,
    realMediaRecorded: false,
  },
  permissionAutomation: {
    microphone: "Firefox fake media stream enabled in all profiles; simulated allow only in publisher profile",
    screenCapture: "synthetic source returned by test injection; denial is a synthetic NotAllowedError",
    nativeDisplayPickerUsed: false,
  },
  clients: {},
  snapshots: [],
  independenceChecks: [],
  observations: [],
  transport: [],
  errors: { pageErrors: [], socketErrors: [] },
  limitations: {
    endToEndLatencyMs: null,
    physicalDisplayCapture: "not-tested; script replaces getDisplayMedia with a synthetic canvas track",
    phoneBrowser: "not-tested",
    lateJoinSynchronization: "not-implemented",
    serverCpuAndMemory: "not-collected-by-browser-script",
    qualityThresholds: "not-run under DEC-010 light POC scope",
  },
  screenshots: ["receiver-a-screen-panel-active.png", "receiver-a-audio-panel-active.png", "receiver-a-screen-cleared-audio-continuing.png", "receiver-a-screen-cleared-after-ended.png"],
};

let failure;
const contexts = [];
const pageTransports = [];

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

async function launchIsolatedFirefox(name, microphonePermission = null) {
  const profile = createTrustedProfile(name);
  const firefoxUserPrefs = { "media.navigator.streams.fake": true };
  if (microphonePermission !== null) firefoxUserPrefs["permissions.default.microphone"] = microphonePermission;
  const context = await firefox.launchPersistentContext(profile.profileDirectory, {
    headless,
    env: { ...process.env, MOZ_APP_DATA: profile.appData, MOZ_LOCAL_APP_DATA: profile.localAppData },
    viewport: { width: 1440, height: 1080 },
    colorScheme: "light",
    firefoxUserPrefs,
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
        try { transport.receivedControls.push({ at: new Date().toISOString(), message: JSON.parse(frame.payload) }); }
        catch { transport.receivedControls.push({ at: new Date().toISOString(), message: { type: "unparsed-control" } }); }
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

async function waitForControl(transport, type, previousCount = 0, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const matches = transport.receivedControls.filter((entry) => entry.message.type === type).slice(previousCount);
    if (matches.length) return matches.at(-1).message;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`${transport.name} did not receive ${type} within ${timeoutMs} ms.`);
}

async function joinRoom(page, displayName) {
  await page.goto(target.origin, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Local room presence" }).waitFor();
  await page.getByLabel("Your display name").fill(displayName);
  await page.getByRole("button", { name: "Join room" }).click();
  await page.getByText("Connected to Local test room", { exact: true }).waitFor();
  await page.locator('[data-testid="audio-panel"]').waitFor();
  await page.locator('[data-testid="screen-panel"]').waitFor();
}

async function screenSnapshot(page, label) {
  const snapshot = await page.locator('[data-testid="screen-panel"]').evaluate((panel) => {
    const canvas = panel.querySelector('[data-testid="screen-preview"]');
    const context = canvas?.getContext("2d");
    const pixel = canvas && canvas.width > 0 && canvas.height > 0 && context
      ? Array.from(context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data)
      : null;
    return {
      capturedAt: new Date().toISOString(),
      publisherState: panel.getAttribute("data-publisher-state"),
      receiverState: panel.getAttribute("data-receiver-state"),
      sentFrames: Number(panel.getAttribute("data-sent-frames")),
      receivedFrames: Number(panel.getAttribute("data-received-frames")),
      decodedFrames: Number(panel.getAttribute("data-decoded-frames")),
      renderedFrames: Number(panel.getAttribute("data-rendered-frames")),
      renderedWidth: Number(panel.getAttribute("data-rendered-width")) || null,
      renderedHeight: Number(panel.getAttribute("data-rendered-height")) || null,
      renderFps: Number(panel.getAttribute("data-render-fps")),
      encodeQueueHighWater: Number(panel.getAttribute("data-encode-queue-high-water")),
      decodeQueueHighWater: Number(panel.getAttribute("data-decode-queue-high-water")),
      socketQueueHighWaterBytes: Number(panel.getAttribute("data-socket-queue-high-water-bytes")),
      pixel,
      publisherMessage: panel.querySelector('[data-screen-status="publisher"]')?.textContent?.trim() ?? "",
      receiverMessage: panel.querySelector('[data-screen-status="receiver"]')?.textContent?.trim() ?? "",
    };
  });
  report.snapshots.push({ client: label, ...snapshot });
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
    renderRms: Number(panel.getAttribute("data-render-rms")),
    listenerMessage: panel.querySelector('[data-audio-status="listener"]')?.textContent?.trim() ?? "",
    publisherMessage: panel.querySelector('[data-audio-status="publisher"]')?.textContent?.trim() ?? "",
  }));
  report.snapshots.push({ client: label, audio: snapshot });
  return snapshot;
}

async function waitForRendered(page, label, minimumFrames = 4, timeoutMs = 20_000) {
  await page.waitForFunction((count) => {
    const panel = document.querySelector('[data-testid="screen-panel"]');
    const canvas = panel?.querySelector('[data-testid="screen-preview"]');
    return panel && canvas && Number(panel.getAttribute("data-rendered-frames")) >= count && canvas.width > 0 && canvas.height > 0;
  }, minimumFrames, { timeout: timeoutMs });
  const snapshot = await screenSnapshot(page, label);
  assert.ok(snapshot.receivedFrames > 0, `${label} should receive screen frames`);
  assert.ok(snapshot.decodedFrames > 0, `${label} should decode screen frames`);
  assert.ok(snapshot.renderedFrames >= minimumFrames, `${label} should render at least ${minimumFrames} frames`);
  assert.ok(snapshot.renderedWidth && snapshot.renderedHeight, `${label} should expose actual render dimensions`);
  assert.ok(snapshot.pixel?.some((channel) => channel !== 0), `${label} canvas should contain non-black rendered pixels`);
  return snapshot;
}

async function waitForAudio(page, label, timeoutMs = 20_000) {
  await page.waitForFunction(() => {
    const panel = document.querySelector('[data-testid="audio-panel"]');
    return panel && Number(panel.getAttribute("data-rendered-samples")) > 0 && Number(panel.getAttribute("data-render-rms")) > 0.0001;
  }, undefined, { timeout: timeoutMs });
  const snapshot = await audioSnapshot(page, label);
  assert.ok(snapshot.receivedPackets > 0 && snapshot.decodedFrames > 0 && snapshot.renderedSamples > 0, `${label} should decode and render audio`);
  return snapshot;
}

async function installSyntheticDisplaySource(page) {
  await page.addInitScript(() => {
    const mediaDevices = navigator.mediaDevices;
    const original = mediaDevices.getDisplayMedia.bind(mediaDevices);
    Object.defineProperty(window, "__t05SyntheticState", { value: { original, track: null, sequence: 0 }, configurable: false });
    Object.defineProperty(mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: async () => {
        if (window.__t05SyntheticState.denyNext) {
          window.__t05SyntheticState.denyNext = false;
          throw new DOMException("Synthetic test denial", "NotAllowedError");
        }
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 180;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Could not create synthetic canvas context.");
        const draw = () => {
          const sequence = window.__t05SyntheticState.sequence++;
          context.fillStyle = sequence % 2 === 0 ? "rgb(230, 80, 45)" : "rgb(35, 150, 90)";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = "white";
          context.font = "24px sans-serif";
          context.fillText(`Synthetic frame ${sequence}`, 18, 45);
          if (canvas.isConnected || window.__t05SyntheticState.active) requestAnimationFrame(draw);
        };
        window.__t05SyntheticState.active = true;
        draw();
        const stream = canvas.captureStream(15);
        const track = stream.getVideoTracks()[0];
        window.__t05SyntheticState.track = track;
        const stop = track.stop.bind(track);
        track.stop = () => {
          window.__t05SyntheticState.active = false;
          stop();
        };
        return stream;
      },
    });
  });
}

async function downloadObservation(page, clientName) {
  const downloadPromise = page.waitForEvent("download", { timeout: 12_000 });
  await page.getByRole("button", { name: "下載畫面觀測" }).click();
  const download = await downloadPromise;
  const destination = join(outputDirectory, "observations", `${clientName}-screen.json`);
  mkdirSync(dirname(destination), { recursive: true });
  await download.saveAs(destination);
  const observation = JSON.parse(readFileSync(destination, "utf8"));
  assert.equal(observation.schemaVersion, 1);
  assert.equal(observation.encoding.codec, "vp8");
  if (clientName.startsWith("receiver")) {
    assert.ok(observation.rendering.renderedFrames > 0);
    assert.ok(observation.rendering.width > 0 && observation.rendering.height > 0);
  }
  if (clientName === "publisher") {
    assert.ok(observation.capture.trackSettingsReportedByBrowser?.width > 0);
    assert.ok(observation.capture.trackSettingsReportedByBrowser?.height > 0);
    assert.ok(observation.encoding.sentFrames > 0);
  }
  assert.equal(observation.capture.physicalDisplayVerified, false);
  assert.equal(observation.evidence.lateJoinSynchronization, "not-implemented");
  assert.equal(observation.evidence.endToEndLatencyMs, null);
  assert.equal(observation.evidence.serverCpuAndMemory, "not-collected-in-browser");
  report.observations.push({ client: clientName, path: relative(root, destination), json: observation });
  return observation;
}

function outputReport() {
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
    "# T05 synthetic desktop smoke",
    "",
    "This script injects an animated canvas MediaStreamTrack in place of getDisplayMedia(). The track travels through the real VP8 WebCodecs encoder, LTS1 WebSocket relay, native VideoDecoder, and receiver canvas. It is synthetic-source pipeline evidence only; it does not demonstrate the native capture picker, physical display capture, phone support, or late-join synchronization.",
    "",
    `Status: ${report.status}`,
    `Run started: ${report.startedAt}`,
    `Run finished: ${report.finishedAt}`,
    `Topology: ${report.topology.publishers} publisher, ${report.topology.receivers} receivers, ${report.topology.browserProcesses} Firefox processes over trusted local HTTPS/WSS.`,
    "",
    "The report includes actual browser counters, frame dimensions, source track settings, recent render fps, queue high-water counters, audio continuation checks, and downloaded observation JSON. It does not contain captured screen pixels beyond the focused screenshots.",
    "",
    failure ? `Failure: ${String(failure.stack ?? failure)}` : "Failure: none",
    "",
  ].join("\n"));
}

try {
  const [publisherContext, receiverAContext, receiverBContext] = await Promise.all([
    launchIsolatedFirefox("publisher", 1),
    launchIsolatedFirefox("receiver-a"),
    launchIsolatedFirefox("receiver-b"),
  ]);
  report.runtime.firefox = publisherContext.browser()?.version() ?? "not-reported";
  const publisherPage = await publisherContext.newPage();
  const receiverAPage = await receiverAContext.newPage();
  const receiverBPage = await receiverBContext.newPage();
  await installSyntheticDisplaySource(publisherPage);
  const publisherTransport = recordTransport(publisherPage, "publisher");
  const receiverATransport = recordTransport(receiverAPage, "receiver-a");
  const receiverBTransport = recordTransport(receiverBPage, "receiver-b");

  await Promise.all([
    joinRoom(publisherPage, "Speaker"),
    joinRoom(receiverAPage, "Viewer A"),
    joinRoom(receiverBPage, "Viewer B"),
  ]);
  report.clients = {
    publisher: { browser: "Firefox", role: "synthetic display and microphone publisher" },
    receiverA: { browser: "Firefox", role: "screen and audio receiver" },
    receiverB: { browser: "Firefox", role: "second screen and audio receiver" },
  };

  const receiverAScreenSubscribed = waitForControl(receiverATransport, "screen.subscribed");
  const receiverBScreenSubscribed = waitForControl(receiverBTransport, "screen.subscribed");
  const receiverAAudioSubscribed = waitForControl(receiverATransport, "audio.subscribed");
  const receiverBAudioSubscribed = waitForControl(receiverBTransport, "audio.subscribed");
  await receiverAPage.getByRole("button", { name: "開始觀看分享" }).click();
  await receiverBPage.getByRole("button", { name: "開始觀看分享" }).click();
  await receiverAPage.getByRole("button", { name: "開始收聽" }).click();
  await receiverBPage.getByRole("button", { name: "開始收聽" }).click();
  await Promise.all([receiverAScreenSubscribed, receiverBScreenSubscribed, receiverAAudioSubscribed, receiverBAudioSubscribed]);

  const previousStreamA = controlCount(receiverATransport, "screen.stream");
  const previousStreamB = controlCount(receiverBTransport, "screen.stream");
  const publisherStarted = controlCount(publisherTransport, "screen.started");
  await publisherPage.getByRole("button", { name: "開始分享畫面" }).click();
  const [screenStreamA, screenStreamB] = await Promise.all([
    waitForControl(receiverATransport, "screen.stream", previousStreamA),
    waitForControl(receiverBTransport, "screen.stream", previousStreamB),
    waitForControl(publisherTransport, "screen.started", publisherStarted),
  ]).then((messages) => [messages[0], messages[1]]);
  assert.equal(screenStreamA.codec, "vp8");
  assert.equal(screenStreamB.codec, "vp8");
  const [firstA, firstB] = await Promise.all([
    waitForRendered(receiverAPage, "receiver-a-first-share"),
    waitForRendered(receiverBPage, "receiver-b-first-share"),
  ]);
  assert.equal(firstA.renderedWidth, screenStreamA.width);
  assert.equal(firstA.renderedHeight, screenStreamA.height);
  assert.equal(firstB.renderedWidth, screenStreamB.width);

  const publisherAudioStarted = controlCount(publisherTransport, "audio.started");
  await publisherPage.getByRole("button", { name: "開始麥克風" }).click();
  await waitForControl(publisherTransport, "audio.started", publisherAudioStarted);
  await Promise.all([waitForAudio(receiverAPage, "receiver-a-audio-start"), waitForAudio(receiverBPage, "receiver-b-audio-start")]);
  await receiverAPage.waitForFunction(() => {
    const panel = document.querySelector('[data-testid="screen-panel"]');
    return Number(panel?.getAttribute("data-rendered-frames")) >= 10 && Number(panel?.getAttribute("data-render-fps")) > 0;
  }, undefined, { timeout: 15_000 });

  await receiverAPage.locator('[data-testid="screen-panel"]').screenshot({ path: join(outputDirectory, "receiver-a-screen-panel-active.png") });
  await receiverAPage.locator('[data-testid="audio-panel"]').screenshot({ path: join(outputDirectory, "receiver-a-audio-panel-active.png") });
  await downloadObservation(publisherPage, "publisher");
  await downloadObservation(receiverAPage, "receiver-a");

  const beforeScreenStopAudioA = await audioSnapshot(receiverAPage, "receiver-a-before-screen-stop");
  const beforeScreenStopA = await screenSnapshot(receiverAPage, "receiver-a-before-screen-stop");
  const streamEndedA = controlCount(receiverATransport, "screen.streamEnded");
  const screenStoppedAtPublisher = controlCount(publisherTransport, "screen.stopped");
  await publisherPage.getByRole("button", { name: "停止分享" }).click();
  await Promise.all([
    waitForControl(receiverATransport, "screen.streamEnded", streamEndedA),
    waitForControl(publisherTransport, "screen.stopped", screenStoppedAtPublisher),
    receiverAPage.waitForFunction(() => {
      const canvas = document.querySelector('[data-testid="screen-preview"]');
      return canvas instanceof HTMLCanvasElement && canvas.width === 0 && canvas.height === 0;
    }),
  ]);
  const atScreenStopAckA = await screenSnapshot(receiverAPage, "receiver-a-at-screen-stop-ack");
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  const afterScreenStopAudioA = await audioSnapshot(receiverAPage, "receiver-a-after-screen-stop");
  const afterScreenStopA = await screenSnapshot(receiverAPage, "receiver-a-after-screen-stop");
  assert.ok(afterScreenStopAudioA.receivedPackets > beforeScreenStopAudioA.receivedPackets, "audio should continue receiving after screen stop");
  assert.ok(afterScreenStopAudioA.renderedSamples > beforeScreenStopAudioA.renderedSamples, "audio should continue rendering after screen stop");
  assert.equal(afterScreenStopA.receivedFrames, atScreenStopAckA.receivedFrames, "screen frames should stop after streamEnded");
  assert.equal(afterScreenStopA.renderedWidth, null, "screen dimensions should clear after streamEnded");
  assert.equal(afterScreenStopA.renderedHeight, null, "screen dimensions should clear after streamEnded");
  assert.equal(afterScreenStopA.pixel, null, "screen canvas should remain clear after streamEnded");
  report.independenceChecks.push({ check: "audio-continues-after-screen-stop", passed: true, beforePackets: beforeScreenStopAudioA.receivedPackets, afterPackets: afterScreenStopAudioA.receivedPackets, beforeRenderedSamples: beforeScreenStopAudioA.renderedSamples, afterRenderedSamples: afterScreenStopAudioA.renderedSamples });
  report.independenceChecks.push({ check: "screen-frames-stop-and-canvas-clears", passed: true, beforeFrames: atScreenStopAckA.receivedFrames, afterFrames: afterScreenStopA.receivedFrames, canvasPixelAfterStop: afterScreenStopA.pixel });
  await receiverAPage.locator('[data-testid="screen-panel"]').screenshot({ path: join(outputDirectory, "receiver-a-screen-cleared-audio-continuing.png") });

  const startedBeforeDenial = controlCount(publisherTransport, "screen.started");
  const audioBeforeDenial = await audioSnapshot(receiverAPage, "receiver-a-before-synthetic-denial");
  await publisherPage.evaluate(() => { window.__t05SyntheticState.denyNext = true; });
  await publisherPage.getByRole("button", { name: "開始分享畫面" }).click();
  await publisherPage.getByText(/已取消或拒絕畫面擷取/).waitFor();
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  const denialState = await screenSnapshot(publisherPage, "publisher-after-synthetic-denial");
  const audioAfterDenial = await audioSnapshot(receiverAPage, "receiver-a-after-synthetic-denial");
  assert.equal(denialState.publisherState, "denied");
  assert.equal(controlCount(publisherTransport, "screen.started"), startedBeforeDenial, "denied capture must not create a screen publisher");
  assert.ok(audioAfterDenial.receivedPackets > audioBeforeDenial.receivedPackets, "audio should continue receiving through screen capture denial");
  assert.ok(audioAfterDenial.renderedSamples > audioBeforeDenial.renderedSamples, "audio should continue rendering through screen capture denial");
  report.independenceChecks.push({ check: "synthetic-capture-denial-does-not-start-screen-or-stop-audio", passed: true, screenStartedCountBefore: startedBeforeDenial, screenStartedCountAfter: controlCount(publisherTransport, "screen.started"), beforeRenderedSamples: audioBeforeDenial.renderedSamples, afterRenderedSamples: audioAfterDenial.renderedSamples, source: "injected NotAllowedError, not a native picker denial" });

  const streamCountA = controlCount(receiverATransport, "screen.stream");
  const streamCountB = controlCount(receiverBTransport, "screen.stream");
  const startedCount = controlCount(publisherTransport, "screen.started");
  await publisherPage.getByRole("button", { name: "重新要求分享權限" }).click();
  const [secondStreamA, secondStreamB] = await Promise.all([
    waitForControl(receiverATransport, "screen.stream", streamCountA),
    waitForControl(receiverBTransport, "screen.stream", streamCountB),
    waitForControl(publisherTransport, "screen.started", startedCount),
  ]).then((messages) => [messages[0], messages[1]]);
  await Promise.all([waitForRendered(receiverAPage, "receiver-a-share-restarted"), waitForRendered(receiverBPage, "receiver-b-share-restarted")]);
  const audioStoppedAtPublisher = controlCount(publisherTransport, "audio.stopped");
  const audioEndedAtReceiverA = controlCount(receiverATransport, "audio.streamEnded");
  const screenBeforeAudioStop = await screenSnapshot(receiverAPage, "receiver-a-before-audio-stop");
  await publisherPage.getByRole("button", { name: "停止麥克風" }).click();
  await Promise.all([
    waitForControl(publisherTransport, "audio.stopped", audioStoppedAtPublisher),
    waitForControl(receiverATransport, "audio.streamEnded", audioEndedAtReceiverA),
  ]);
  const nextFrames = screenBeforeAudioStop.renderedFrames + 3;
  await receiverAPage.waitForFunction((count) => Number(document.querySelector('[data-testid="screen-panel"]')?.getAttribute("data-rendered-frames")) >= count, nextFrames);
  const screenAfterAudioStop = await screenSnapshot(receiverAPage, "receiver-a-after-audio-stop");
  assert.ok(screenAfterAudioStop.renderedFrames > screenBeforeAudioStop.renderedFrames, "screen should continue rendering after microphone stop");
  report.independenceChecks.push({ check: "screen-continues-after-microphone-stop", passed: true, beforeFrames: screenBeforeAudioStop.renderedFrames, afterFrames: screenAfterAudioStop.renderedFrames });

  const trackEndedAtPublisher = controlCount(publisherTransport, "screen.stopped");
  await publisherPage.evaluate(() => {
    if (!window.__t05SyntheticState.track) throw new Error("Synthetic test track was not retained.");
    window.__t05SyntheticState.track.stop();
  });
  await waitForControl(publisherTransport, "screen.stopped", trackEndedAtPublisher);
  await receiverAPage.waitForFunction(() => {
    const canvas = document.querySelector('[data-testid="screen-preview"]');
    return canvas instanceof HTMLCanvasElement && canvas.width === 0 && canvas.height === 0;
  });
  await receiverAPage.locator('[data-testid="screen-panel"]').screenshot({ path: join(outputDirectory, "receiver-a-screen-cleared-after-ended.png") });
  await screenSnapshot(receiverAPage, "receiver-a-after-injected-track-ended");
  assert.equal((await screenSnapshot(publisherPage, "publisher-after-synthetic-track-ended")).publisherState, "idle");
  report.independenceChecks.push({ check: "synthetic-track-stop-state-clears-screen", passed: true, eventSource: "synthetic track.stop() sets readyState=ended; app capture-loop check handles cleanup without assuming an ended event" });

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
      } catch { /* A closed or unavailable page cannot supply diagnostics. */ }
    }
  }
  for (const context of contexts) {
    try { await context.close(); } catch { /* Ensure all browser profiles close. */ }
  }
  contexts.length = 0;
} finally {
  outputReport();
}

if (failure) throw failure;
console.log(`T05 smoke passed; evidence saved under ${relative(root, outputDirectory)}.`);
