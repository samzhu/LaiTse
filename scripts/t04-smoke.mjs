import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const root = process.cwd();
const scratchRoot = resolve(root, ".scratch/t04");
const outputDirectory = resolve(root, process.env.T04_OUTPUT_DIR ?? ".scratch/t04/desktop-smoke");
const outputRelative = relative(scratchRoot, outputDirectory);
if (isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(`..${sep}`)) {
  throw new Error("T04_OUTPUT_DIR must stay inside .scratch/t04.");
}

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, ".tools/playwright-browsers");
const { firefox } = await import("playwright");
const defaultTlsDirectory = resolve(root, ".scratch/t01/tls");
const caCertificate = resolve(process.env.T04_CA_CERT ?? join(defaultTlsDirectory, "local-ca.pem"));
const serverCertificate = resolve(process.env.TLS_CERT_FILE ?? join(defaultTlsDirectory, "localhost-cert.pem"));
const baseURL = process.env.T04_BASE_URL ?? `https://localhost:${process.env.PORT ?? "4173"}`;
const target = new URL(baseURL);
const certificateUtility = process.env.CERTUTIL_BIN ?? "certutil";
const headless = process.env.HEADLESS !== "0";

mkdirSync(outputDirectory, { recursive: true });
const report = {
  schemaVersion: 1,
  purpose: "Short desktop synthetic-source core demonstration for T04; not the original cross-device quality acceptance run.",
  startedAt: new Date().toISOString(),
  status: "running",
  baseURL: target.origin,
  topology: {
    publishers: 1,
    receivers: 2,
    browserProcesses: 3,
    network: "one local application over trusted HTTPS/WSS",
  },
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
    kind: "Firefox synthetic fake media stream",
    preference: "media.navigator.streams.fake=true in every Firefox profile",
    realMicrophoneSelected: false,
    realAudioRecorded: false,
    sourceIdentifiedByApplication: false,
  },
  permissionAutomation: {
    publisherProfile: "permissions.default.microphone=1 (profile-scoped simulated allow)",
    realDevicePermissionPromptUsed: false,
  },
  clients: {},
  snapshots: [],
  unsubscribedReceiverCheck: null,
  stopCheck: null,
  observations: [],
  transport: [],
  errors: { pageErrors: [], socketErrors: [] },
  limitations: {
    endToEndLatencyMs: null,
    humanListening: "not-collected",
    physicalDeviceEvidence: "not-collected",
    phoneBrowser: "not-tested",
    qualityThresholds: "not-run under DEC-010 light POC scope",
  },
  screenshot: "receiver-a-audio-panel.png",
};

let failure;
const contexts = [];
const activeTransports = [];

function runCertutil(args) {
  execFileSync(certificateUtility, args, { stdio: "pipe" });
}

function createTrustedProfile(name) {
  const profileDirectory = join(outputDirectory, name, "profile");
  rmSync(profileDirectory, { recursive: true, force: true });
  mkdirSync(profileDirectory, { recursive: true });
  runCertutil(["-N", "-d", `sql:${profileDirectory}`, "--empty-password"]);
  runCertutil([
    "-A", "-d", `sql:${profileDirectory}`,
    "-n", "LaiTse local development CA", "-t", "C,,", "-i", caCertificate,
  ]);
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
    viewport: { width: 1440, height: 1050 },
    colorScheme: "light",
    firefoxUserPrefs,
  });
  contexts.push(context);
  return context;
}

function recordTransport(page, name) {
  const transport = {
    name,
    sockets: [],
    pageErrors: [],
    receivedControls: [],
  };
  page.on("pageerror", (error) => {
    transport.pageErrors.push({ at: new Date().toISOString(), message: error.message });
  });
  page.on("websocket", (socket) => {
    const item = {
      url: socket.url(),
      sentTextFrames: 0,
      sentBinaryFrames: 0,
      receivedTextFrames: 0,
      receivedBinaryFrames: 0,
      errors: [],
    };
    transport.sockets.push(item);
    socket.on("framesent", (frame) => {
      if (typeof frame.payload === "string") item.sentTextFrames += 1;
      else item.sentBinaryFrames += 1;
    });
    socket.on("framereceived", (frame) => {
      if (typeof frame.payload === "string") {
        item.receivedTextFrames += 1;
        try {
          transport.receivedControls.push({ at: new Date().toISOString(), message: JSON.parse(frame.payload) });
        } catch {
          transport.receivedControls.push({ at: new Date().toISOString(), message: { type: "unparsed-control" } });
        }
      } else {
        item.receivedBinaryFrames += 1;
      }
    });
    socket.on("socketerror", (error) => item.errors.push(String(error)));
  });
  return transport;
}

function controlCount(transport, type) {
  return transport.receivedControls.filter((entry) => entry.message.type === type).length;
}

async function waitForControl(transport, type, previousCount = 0, timeoutMs = 12_000, predicate = () => true) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const matches = transport.receivedControls.filter((entry) => entry.message.type === type).slice(previousCount);
    const match = matches.find((entry) => predicate(entry.message));
    if (match) return match.message;
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
}

async function panelSnapshot(page) {
  return await page.locator('[data-testid="audio-panel"]').evaluate((panel) => ({
    capturedAt: new Date().toISOString(),
    listenerState: panel.getAttribute("data-listener-state"),
    publisherState: panel.getAttribute("data-publisher-state"),
    publisherGeneration: panel.getAttribute("data-publisher-generation") || null,
    receiverGeneration: panel.getAttribute("data-receiver-generation") || null,
    sentPackets: Number(panel.getAttribute("data-sent-packets")),
    receivedPackets: Number(panel.getAttribute("data-received-packets")),
    decodedFrames: Number(panel.getAttribute("data-decoded-frames")),
    renderedSamples: Number(panel.getAttribute("data-rendered-samples")),
    queuedSamples: Number(panel.getAttribute("data-queued-samples")),
    receiverBufferMs: Number(panel.getAttribute("data-receiver-buffer-ms")),
    packetGapCount: Number(panel.getAttribute("data-packet-gap-count")),
    renderRms: Number(panel.getAttribute("data-render-rms")),
    queueOverflowResets: Number(panel.getAttribute("data-queue-overflow-resets")),
    listenerMessage: panel.querySelector('[data-audio-status="listener"]')?.textContent?.trim() ?? "",
  }));
}

async function waitForRenderedPlayback(page, label, timeout = 20_000) {
  await page.waitForFunction(() => {
    const panel = document.querySelector('[data-testid="audio-panel"]');
    if (!panel) return false;
    const rendered = Number(panel.getAttribute("data-rendered-samples"));
    const rms = Number(panel.getAttribute("data-render-rms"));
    const received = Number(panel.getAttribute("data-received-packets"));
    const decoded = Number(panel.getAttribute("data-decoded-frames"));
    return rendered > 0 && rms > 0.0001 && received > 0 && decoded > 0;
  }, undefined, { timeout });
  const snapshot = await panelSnapshot(page);
  assert.ok(snapshot.receivedPackets > 0, `${label} should receive relayed Opus frames`);
  assert.ok(snapshot.decodedFrames > 0, `${label} should decode Opus frames`);
  assert.ok(snapshot.renderedSamples > 0, `${label} playback worklet should emit PCM samples`);
  assert.ok(snapshot.renderRms > 0.0001, `${label} playback worklet should emit non-silent PCM samples`);
  return snapshot;
}

async function saveObservation(page, transport, name) {
  const before = await panelSnapshot(page);
  const downloadPromise = page.waitForEvent("download", { timeout: 12_000 });
  await page.getByRole("button", { name: "下載音訊觀測" }).click();
  const download = await downloadPromise;
  const destination = join(outputDirectory, "observations", `${name}.json`);
  mkdirSync(dirname(destination), { recursive: true });
  await download.saveAs(destination);
  const observation = JSON.parse(readFileSync(destination, "utf8"));

  assert.equal(observation.schemaVersion, 1, `${name} report should use schema version 1`);
  assert.ok(Number.isFinite(Date.parse(observation.observedAt)), `${name} report should include observation time`);
  assert.ok(observation.environment.userAgent.length <= 256, `${name} user agent should be bounded`);
  assert.ok(observation.environment.platform.length <= 100, `${name} platform should be bounded`);
  assert.equal(observation.audioConfiguration.codec, "opus");
  assert.equal(observation.audioConfiguration.sampleRateHz, 48_000);
  assert.equal(observation.audioConfiguration.channels, 1);
  assert.equal(observation.audioConfiguration.bitrateBps, 32_000);
  assert.equal(observation.audioConfiguration.frameDurationMs, 20);
  assert.equal(observation.receiver.streamGeneration, before.receiverGeneration === null ? null : Number(before.receiverGeneration));
  assert.ok(observation.receiver.receivedPackets >= before.receivedPackets);
  assert.ok(observation.receiver.decodedFrames >= before.decodedFrames);
  assert.ok(observation.receiver.renderedSamples >= before.renderedSamples);
  assert.ok(observation.receiver.packetGapCount >= before.packetGapCount);
  assert.ok(observation.receiver.renderedSamples > 0 && observation.receiver.renderRms > 0.0001);
  assert.equal(observation.receiver.receiverBufferMs, Number((observation.receiver.queuedSamples / observation.receiver.sampleRateHz * 1_000).toFixed(2)));
  assert.equal(observation.receiver.packetGapGeneration, observation.receiver.streamGeneration);
  assert.equal(observation.evidence.endToEndLatencyMs, null);
  assert.equal(observation.evidence.humanListening, "not-collected");
  assert.equal(observation.evidence.physicalDeviceEvidence, "not-collected");
  assert.equal(observation.evidence.publisherSource, "not-established-by-application");
  assert.ok(transport.sockets.length === 1, `${name} should use one room WebSocket`);

  return {
    client: name,
    path: relative(root, destination),
    observedAt: observation.observedAt,
    receiverStreamGeneration: observation.receiver.streamGeneration,
    actualCounters: {
      receivedPackets: observation.receiver.receivedPackets,
      decodedFrames: observation.receiver.decodedFrames,
      renderedSamples: observation.receiver.renderedSamples,
      queuedSamples: observation.receiver.queuedSamples,
      receiverBufferMs: observation.receiver.receiverBufferMs,
      packetGapCount: observation.receiver.packetGapCount,
      packetGapGeneration: observation.receiver.packetGapGeneration,
      renderRms: observation.receiver.renderRms,
    },
    source: observation.evidence.publisherSource,
    endToEndLatencyMs: observation.evidence.endToEndLatencyMs,
  };
}

function captureSnapshot(report, phase, entries) {
  report.snapshots.push({
    phase,
    capturedAt: new Date().toISOString(),
    clients: entries,
  });
}

try {
  assert.equal(target.protocol, "https:", "T04 browser evidence requires trusted HTTPS and WSS.");
  readFileSync(caCertificate);
  readFileSync(serverCertificate);

  const publisherContext = await launchIsolatedFirefox("publisher", 1);
  const receiverAContext = await launchIsolatedFirefox("receiver-a");
  const receiverBContext = await launchIsolatedFirefox("receiver-b");
  const publisherPage = publisherContext.pages()[0] ?? await publisherContext.newPage();
  const receiverAPage = receiverAContext.pages()[0] ?? await receiverAContext.newPage();
  const receiverBPage = receiverBContext.pages()[0] ?? await receiverBContext.newPage();
  const publisherTransport = recordTransport(publisherPage, "publisher");
  const receiverATransport = recordTransport(receiverAPage, "receiver-a");
  const receiverBTransport = recordTransport(receiverBPage, "receiver-b");
  activeTransports.push(publisherTransport, receiverATransport, receiverBTransport);

  report.clients = {
    publisher: { browser: "Firefox", version: publisherContext.browser()?.version() ?? "unknown", role: "synthetic-source publisher" },
    receiverA: { browser: "Firefox", version: receiverAContext.browser()?.version() ?? "unknown", role: "early desktop receiver" },
    receiverB: { browser: "Firefox", version: receiverBContext.browser()?.version() ?? "unknown", role: "late-joining desktop receiver" },
  };

  await Promise.all([joinRoom(publisherPage, "T04 synthetic speaker"), joinRoom(receiverAPage, "T04 receiver A")]);
  const subscribedCountA = controlCount(receiverATransport, "audio.subscribed");
  await receiverAPage.getByRole("button", { name: "開始收聽" }).click();
  await waitForControl(receiverATransport, "audio.subscribed", subscribedCountA);
  await receiverAPage.waitForFunction(() => document.querySelector('[data-testid="audio-panel"]')?.getAttribute("data-listener-state") === "ready");

  const startedCount = controlCount(publisherTransport, "audio.started");
  const streamCountA = controlCount(receiverATransport, "audio.stream");
  await publisherPage.getByRole("button", { name: "開始麥克風" }).click();
  const started = await waitForControl(publisherTransport, "audio.started", startedCount);
  const publisherGeneration = Number(started.generation);
  assert.ok(publisherGeneration > 0);
  const streamA = await waitForControl(receiverATransport, "audio.stream", streamCountA);
  assert.equal(Number(streamA.generation), publisherGeneration);
  await publisherPage.waitForFunction(() => document.querySelector('[data-testid="audio-panel"]')?.getAttribute("data-publisher-state") === "broadcasting", undefined, { timeout: 20_000 });

  const receiverAInitial = await waitForRenderedPlayback(receiverAPage, "receiver A");
  assert.equal(Number(receiverAInitial.receiverGeneration), publisherGeneration);
  captureSnapshot(report, "receiver A rendering before late receiver joins", {
    receiverA: receiverAInitial,
    publisher: await panelSnapshot(publisherPage),
  });

  await joinRoom(receiverBPage, "T04 receiver B late join");
  const subscribedCountB = controlCount(receiverBTransport, "audio.subscribed");
  const streamCountB = controlCount(receiverBTransport, "audio.stream");
  await receiverBPage.getByRole("button", { name: "開始收聽" }).click();
  await waitForControl(receiverBTransport, "audio.subscribed", subscribedCountB);
  const streamB = await waitForControl(receiverBTransport, "audio.stream", streamCountB);
  assert.equal(Number(streamB.generation), publisherGeneration, "late receiver should join the active publisher generation");
  const [receiverAConcurrent, receiverBConcurrent] = await Promise.all([
    waitForRenderedPlayback(receiverAPage, "receiver A concurrent playback"),
    waitForRenderedPlayback(receiverBPage, "receiver B late-join playback"),
  ]);
  assert.equal(Number(receiverAConcurrent.receiverGeneration), publisherGeneration);
  assert.equal(Number(receiverBConcurrent.receiverGeneration), publisherGeneration);
  captureSnapshot(report, "publisher and both receivers rendering", {
    publisher: await panelSnapshot(publisherPage),
    receiverA: receiverAConcurrent,
    receiverB: receiverBConcurrent,
  });

  report.observations.push(await saveObservation(receiverAPage, receiverATransport, "receiver-a-observation"));
  report.observations.push(await saveObservation(receiverBPage, receiverBTransport, "receiver-b-observation"));
  await receiverAPage.locator('[data-testid="audio-panel"]').screenshot({ path: join(outputDirectory, report.screenshot) });

  const receiverBUnsubscribedCount = controlCount(receiverBTransport, "audio.unsubscribed");
  await receiverBPage.getByRole("button", { name: "停止收聽" }).click();
  await waitForControl(receiverBTransport, "audio.unsubscribed", receiverBUnsubscribedCount);
  const receiverBBinaryAtAck = receiverBTransport.sockets[0]?.receivedBinaryFrames ?? 0;
  const receiverABinaryAtBUnsubscribeAck = receiverATransport.sockets[0]?.receivedBinaryFrames ?? 0;
  const receiverARenderedAtBUnsubscribeAck = (await panelSnapshot(receiverAPage)).renderedSamples;
  await receiverBPage.waitForTimeout(400);
  const receiverBBinaryAfterWindow = receiverBTransport.sockets[0]?.receivedBinaryFrames ?? 0;
  const receiverABinaryAfterBUnsubscribeWindow = receiverATransport.sockets[0]?.receivedBinaryFrames ?? 0;
  assert.equal(receiverBBinaryAfterWindow, receiverBBinaryAtAck, "unsubscribed receiver should get no binary frames after its server ack");
  await receiverAPage.waitForFunction((baseline) => {
    const panel = document.querySelector('[data-testid="audio-panel"]');
    return Number(panel?.getAttribute("data-rendered-samples")) > baseline;
  }, receiverARenderedAtBUnsubscribeAck, { timeout: 5_000 });
  const receiverAAfterBStop = await panelSnapshot(receiverAPage);
  assert.ok((receiverATransport.sockets[0]?.receivedBinaryFrames ?? 0) > receiverABinaryAtBUnsubscribeAck, "receiver A should continue receiving after receiver B unsubscribes");
  assert.ok(receiverAAfterBStop.renderedSamples > receiverARenderedAtBUnsubscribeAck, "receiver A should continue rendering after receiver B unsubscribes");
  report.unsubscribedReceiverCheck = {
    receiverBReceivedBinaryAtServerAck: receiverBBinaryAtAck,
    receiverBReceivedBinaryAfter400Ms: receiverBBinaryAfterWindow,
    noBinaryAfterAcknowledgement: true,
    receiverAReceivedBinaryAtBUnsubscribeAck: receiverABinaryAtBUnsubscribeAck,
    receiverAReceivedBinaryAfter400Ms: receiverABinaryAfterBUnsubscribeWindow,
    receiverARenderedSamplesAtBUnsubscribeAck: receiverARenderedAtBUnsubscribeAck,
    receiverARenderedSamplesAfter400Ms: receiverAAfterBStop.renderedSamples,
    receiverAContinuedReceiving: true,
    receiverAContinuedRendering: true,
  };
  captureSnapshot(report, "receiver B unsubscribed while receiver A continues", {
    publisher: await panelSnapshot(publisherPage),
    receiverA: receiverAAfterBStop,
    receiverB: await panelSnapshot(receiverBPage),
  });

  const resubscribedCountB = controlCount(receiverBTransport, "audio.subscribed");
  const resumedStreamCountB = controlCount(receiverBTransport, "audio.stream");
  const receiverBBinaryBeforeResume = receiverBTransport.sockets[0]?.receivedBinaryFrames ?? 0;
  await receiverBPage.getByRole("button", { name: "開始收聽" }).click();
  await waitForControl(receiverBTransport, "audio.subscribed", resubscribedCountB);
  const resumedStream = await waitForControl(receiverBTransport, "audio.stream", resumedStreamCountB);
  assert.equal(Number(resumedStream.generation), publisherGeneration, "resubscribed receiver should receive the current generation");
  const receiverBResumed = await waitForRenderedPlayback(receiverBPage, "receiver B re-subscribed playback");
  assert.equal(Number(receiverBResumed.receiverGeneration), publisherGeneration);
  assert.ok((receiverBTransport.sockets[0]?.receivedBinaryFrames ?? 0) > receiverBBinaryBeforeResume, "re-subscribed receiver should receive fresh frames");
  captureSnapshot(report, "receiver B re-subscribed and rendered fresh audio", {
    publisher: await panelSnapshot(publisherPage),
    receiverA: await panelSnapshot(receiverAPage),
    receiverB: receiverBResumed,
  });

  const stoppedCount = controlCount(publisherTransport, "audio.stopped");
  const endedCountA = controlCount(receiverATransport, "audio.streamEnded");
  const endedCountB = controlCount(receiverBTransport, "audio.streamEnded");
  await publisherPage.getByRole("button", { name: "停止麥克風" }).click();
  const stopped = await waitForControl(publisherTransport, "audio.stopped", stoppedCount);
  await Promise.all([
    waitForControl(receiverATransport, "audio.streamEnded", endedCountA),
    waitForControl(receiverBTransport, "audio.streamEnded", endedCountB),
  ]);
  assert.equal(Number(stopped.generation), publisherGeneration);
  const packetsAtEnd = {
    receiverA: receiverATransport.sockets[0]?.receivedBinaryFrames ?? 0,
    receiverB: receiverBTransport.sockets[0]?.receivedBinaryFrames ?? 0,
  };
  const pagePacketsAtEnd = {
    receiverA: (await panelSnapshot(receiverAPage)).receivedPackets,
    receiverB: (await panelSnapshot(receiverBPage)).receivedPackets,
  };
  await receiverAPage.waitForTimeout(400);
  assert.equal(receiverATransport.sockets[0]?.receivedBinaryFrames ?? 0, packetsAtEnd.receiverA, "receiver A should stop receiving after streamEnded");
  assert.equal(receiverBTransport.sockets[0]?.receivedBinaryFrames ?? 0, packetsAtEnd.receiverB, "receiver B should stop receiving after streamEnded");
  assert.equal((await panelSnapshot(receiverAPage)).receivedPackets, pagePacketsAtEnd.receiverA, "receiver A packet counter should remain stable after streamEnded");
  assert.equal((await panelSnapshot(receiverBPage)).receivedPackets, pagePacketsAtEnd.receiverB, "receiver B packet counter should remain stable after streamEnded");
  const pagePacketsAfterStop = {
    receiverA: (await panelSnapshot(receiverAPage)).receivedPackets,
    receiverB: (await panelSnapshot(receiverBPage)).receivedPackets,
  };
  const binaryPacketsAfterStop = {
    receiverA: receiverATransport.sockets[0]?.receivedBinaryFrames ?? 0,
    receiverB: receiverBTransport.sockets[0]?.receivedBinaryFrames ?? 0,
  };
  assert.equal(await publisherPage.locator('[data-testid="audio-panel"]').getAttribute("data-publisher-state"), "idle");
  report.stopCheck = {
    publisherState: "idle",
    streamEndedGeneration: publisherGeneration,
    receiverAStableAfter400Ms: true,
    receiverBStableAfter400Ms: true,
    pageReceivedPacketCountsAtStreamEnd: pagePacketsAtEnd,
    pageReceivedPacketCountsAfter400Ms: pagePacketsAfterStop,
    socketBinaryCountsAtStreamEnd: packetsAtEnd,
    socketBinaryCountsAfter400Ms: binaryPacketsAfterStop,
  };
  captureSnapshot(report, "publisher stopped; streamEnded acknowledged and packet counts stable", {
    publisher: await panelSnapshot(publisherPage),
    receiverA: await panelSnapshot(receiverAPage),
    receiverB: await panelSnapshot(receiverBPage),
  });

  for (const transport of [publisherTransport, receiverATransport, receiverBTransport]) {
    assert.equal(transport.sockets.length, 1, `${transport.name} should use one room WebSocket`);
    assert.equal(transport.sockets[0].url, `${target.origin.replace(/^https:/, "wss:")}/ws`);
    assert.deepEqual(transport.sockets[0].errors, []);
    assert.deepEqual(transport.pageErrors, []);
  }
  assert.ok(publisherTransport.sockets[0].sentBinaryFrames > 0, "publisher should send synthetic Opus frames");
  assert.ok(receiverATransport.sockets[0].receivedBinaryFrames > 0, "receiver A should receive Opus frames");
  assert.ok(receiverBBinaryAtAck > 0, "receiver B should have received Opus frames before unsubscribing");
  report.transport = [publisherTransport, receiverATransport, receiverBTransport].map((transport) => ({
    name: transport.name,
    sockets: transport.sockets,
    pageErrors: transport.pageErrors,
    receivedControls: transport.receivedControls,
  }));
  report.errors = {
    pageErrors: [publisherTransport, receiverATransport, receiverBTransport].flatMap((transport) => transport.pageErrors),
    socketErrors: [publisherTransport, receiverATransport, receiverBTransport].flatMap((transport) =>
      transport.sockets.flatMap((socket) => socket.errors.map((message) => ({ client: transport.name, message })))),
  };
  report.status = "complete";
} catch (error) {
  failure = error;
  report.status = "failed";
  report.failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  report.errors = {
    ...report.errors,
    failure: report.failure,
  };
} finally {
  await Promise.all(contexts.map((context) => context.close().catch(() => {})));
  if (activeTransports.length > 0 && report.transport.length === 0) {
    report.transport = activeTransports.map((transport) => ({
      name: transport.name,
      sockets: transport.sockets,
      pageErrors: transport.pageErrors,
      receivedControls: transport.receivedControls,
    }));
  }
  if (activeTransports.length > 0 && report.errors.pageErrors.length === 0 && report.errors.socketErrors.length === 0) {
    report.errors = {
      pageErrors: activeTransports.flatMap((transport) => transport.pageErrors),
      socketErrors: activeTransports.flatMap((transport) =>
        transport.sockets.flatMap((socket) => socket.errors.map((message) => ({ client: transport.name, message })))),
      ...(failure ? { failure: report.failure } : {}),
    };
  }
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(outputDirectory, "audio-evidence.json"), `${JSON.stringify(report, null, 2)}\n`);
}

if (failure) {
  console.error(`T04 synthetic desktop smoke failed; evidence saved to ${join(outputDirectory, "audio-evidence.json")}`);
  console.error(failure);
  process.exitCode = 1;
} else {
  console.log("T04 synthetic desktop dual-receiver audio evidence was saved.");
  console.log(`Audio evidence: ${join(outputDirectory, "audio-evidence.json")}`);
}
