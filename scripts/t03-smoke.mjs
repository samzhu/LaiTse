import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const root = process.cwd();
const scratchRoot = resolve(root, ".scratch/t03");
const outputDirectory = resolve(root, process.env.T03_OUTPUT_DIR ?? ".scratch/t03/desktop-smoke");
const outputRelative = relative(scratchRoot, outputDirectory);
if (isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(`..${sep}`)) {
  throw new Error("T03_OUTPUT_DIR must stay inside .scratch/t03.");
}

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, ".tools/playwright-browsers");
const { firefox } = await import("playwright");
const defaultTlsDirectory = resolve(root, ".scratch/t01/tls");
const caCertificate = resolve(process.env.T03_CA_CERT ?? join(defaultTlsDirectory, "local-ca.pem"));
const serverCertificate = resolve(process.env.TLS_CERT_FILE ?? join(defaultTlsDirectory, "localhost-cert.pem"));
const baseURL = process.env.T03_BASE_URL ?? `https://localhost:${process.env.PORT ?? "4173"}`;
const target = new URL(baseURL);
const certificateUtility = process.env.CERTUTIL_BIN ?? "certutil";
const headless = process.env.HEADLESS !== "0";

mkdirSync(outputDirectory, { recursive: true });
const report = {
  startedAt: new Date().toISOString(),
  status: "running",
  baseURL: target.origin,
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
    trust: "local CA imported only into isolated Firefox NSS profiles",
    caCertificate,
    serverCertificate,
    ignoreCertificateErrors: false,
  },
  mediaSource: {
    kind: "Firefox synthetic fake media stream",
    preference: "media.navigator.streams.fake=true in every mic-attempt profile",
    realMicrophoneSelected: false,
    realAudioRecorded: false,
  },
  permissionAutomation: {
    allowedProfile: "permissions.default.microphone=1 (profile-scoped simulated allow)",
    deniedProfile: "permissions.default.microphone=2 (profile-scoped simulated denial)",
    permissionDisabledPreferenceUsed: false,
  },
  publisher: null,
  listener: null,
  denial: { verified: false, status: "not-run" },
  transport: [],
  playback: null,
  limitations: {
    humanListening: false,
    endToEndLatencyMs: null,
    mobileBrowser: "not-tested",
  },
  screenshots: ["listener-playback.png", "microphone-denied.png"],
};

let failure;
const contexts = [];

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

async function launchIsolatedFirefox(name, microphonePermission) {
  const profile = createTrustedProfile(name);
  const context = await firefox.launchPersistentContext(profile.profileDirectory, {
    headless,
    env: { ...process.env, MOZ_APP_DATA: profile.appData, MOZ_LOCAL_APP_DATA: profile.localAppData },
    viewport: { width: 1440, height: 1050 },
    colorScheme: "light",
    firefoxUserPrefs: {
      "media.navigator.streams.fake": true,
      "permissions.default.microphone": microphonePermission,
    },
  });
  contexts.push(context);
  return context;
}

function recordTransport(page, name) {
  const transport = { name, sockets: [], pageErrors: [] };
  page.on("pageerror", (error) => transport.pageErrors.push(error.message));
  page.on("websocket", (socket) => {
    const item = { url: socket.url(), sentTextFrames: 0, sentBinaryFrames: 0, receivedTextFrames: 0, receivedBinaryFrames: 0, errors: [] };
    transport.sockets.push(item);
    socket.on("framesent", (frame) => {
      if (typeof frame.payload === "string") item.sentTextFrames += 1;
      else item.sentBinaryFrames += 1;
    });
    socket.on("framereceived", (frame) => {
      if (typeof frame.payload === "string") item.receivedTextFrames += 1;
      else item.receivedBinaryFrames += 1;
    });
    socket.on("socketerror", (error) => item.errors.push(String(error)));
  });
  return transport;
}

async function joinRoom(page, displayName) {
  await page.goto(target.origin, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Local room presence" }).waitFor();
  await page.getByLabel("Your display name").fill(displayName);
  await page.getByRole("button", { name: "Join room" }).click();
  await page.getByText("Connected to Local test room", { exact: true }).waitFor();
  await page.locator('[data-testid="audio-panel"]').waitFor();
}

function panelState(page, attribute) {
  return page.locator('[data-testid="audio-panel"]').getAttribute(`data-${attribute}`);
}

try {
  assert.equal(target.protocol, "https:", "T03 browser evidence requires trusted HTTPS and WSS.");
  readFileSync(caCertificate);
  readFileSync(serverCertificate);

  const listenerContext = await launchIsolatedFirefox("listener", 0);
  const publisherContext = await launchIsolatedFirefox("publisher", 1);
  const listenerPage = listenerContext.pages()[0] ?? await listenerContext.newPage();
  const publisherPage = publisherContext.pages()[0] ?? await publisherContext.newPage();
  const listenerTransport = recordTransport(listenerPage, "listener");
  const publisherTransport = recordTransport(publisherPage, "publisher");
  report.listener = { browser: "Firefox", version: listenerContext.browser()?.version() ?? "unknown", role: "explicit subscriber" };
  report.publisher = { browser: "Firefox", version: publisherContext.browser()?.version() ?? "unknown", role: "synthetic microphone publisher" };

  await Promise.all([joinRoom(listenerPage, "T03 listener"), joinRoom(publisherPage, "T03 speaker")]);
  await listenerPage.getByRole("button", { name: "開始收聽" }).click();
  await listenerPage.waitForFunction(() => document.querySelector('[data-testid="audio-panel"]')?.getAttribute("data-listener-state") === "ready");
  await publisherPage.getByRole("button", { name: "開始麥克風" }).click();
  await publisherPage.waitForFunction(() => document.querySelector('[data-testid="audio-panel"]')?.getAttribute("data-publisher-state") === "broadcasting", undefined, { timeout: 20_000 });

  await listenerPage.waitForFunction(() => {
    const panel = document.querySelector('[data-testid="audio-panel"]');
    if (!panel) return false;
    const rendered = Number(panel.getAttribute("data-rendered-samples"));
    const rms = Number(panel.getAttribute("data-render-rms"));
    const received = Number(panel.getAttribute("data-received-packets"));
    const decoded = Number(panel.getAttribute("data-decoded-frames"));
    return rendered > 0 && rms > 0.0001 && received > 0 && decoded > 0;
  }, undefined, { timeout: 20_000 });

  const playback = await listenerPage.locator('[data-testid="audio-panel"]').evaluate((panel) => ({
    receivedPackets: Number(panel.getAttribute("data-received-packets")),
    decodedFrames: Number(panel.getAttribute("data-decoded-frames")),
    renderedSamples: Number(panel.getAttribute("data-rendered-samples")),
    queuedSamples: Number(panel.getAttribute("data-queued-samples")),
    renderRms: Number(panel.getAttribute("data-render-rms")),
    queueOverflowResets: Number(panel.getAttribute("data-queue-overflow-resets")),
    listenerMessage: panel.querySelector('[data-audio-status="listener"]')?.textContent?.trim() ?? "",
  }));
  assert.ok(playback.receivedPackets > 0, "the listener should receive relayed compressed frames");
  assert.ok(playback.decodedFrames > 0, "the listener should decode native Opus frames");
  assert.ok(playback.renderedSamples > 0, "the playback worklet should emit decoded PCM samples");
  assert.ok(playback.renderRms > 0.0001, "the playback worklet should emit non-silent PCM samples");
  report.playback = {
    ...playback,
    source: "synthetic Firefox fake media stream; not a real microphone",
    workletRenderEvidence: "non-silent decoded PCM samples were emitted to AudioContext.destination",
  };

  await listenerPage.screenshot({ path: join(outputDirectory, "listener-playback.png"), fullPage: true });
  await publisherPage.getByRole("button", { name: "停止麥克風" }).click();
  await listenerPage.getByText("發布者已停止；播放仍保持啟動並等待下一次發布。", { exact: true }).waitFor();
  const receivedAfterStop = Number(await panelState(listenerPage, "received-packets"));
  await listenerPage.waitForTimeout(250);
  assert.equal(Number(await panelState(listenerPage, "received-packets")), receivedAfterStop, "the subscriber should receive no new frame after the server reports stream end");
  assert.equal(await panelState(publisherPage, "publisher-state"), "idle");
  report.stop = { publisherState: await panelState(publisherPage, "publisher-state"), noNewPacketsAfterStreamEnd: true };

  const denialContext = await launchIsolatedFirefox("denial", 2);
  const denialPage = denialContext.pages()[0] ?? await denialContext.newPage();
  const denialTransport = recordTransport(denialPage, "denial");
  await joinRoom(denialPage, "T03 denied");
  await denialPage.getByRole("button", { name: "開始麥克風" }).click();
  try {
    await denialPage.waitForFunction(() => {
      const panel = document.querySelector('[data-testid="audio-panel"]');
      const state = panel?.getAttribute("data-publisher-state");
      return state === "denied" || state === "blocked";
    }, undefined, { timeout: 5_000 });
    const denialState = await panelState(denialPage, "publisher-state");
    assert.notEqual(denialState, "broadcasting");
    report.denial = {
      verified: denialState === "denied",
      status: denialState,
      visibleMessage: await denialPage.locator('[data-audio-status="publisher"]').textContent(),
      source: "synthetic-only isolated Firefox profile with permissions.default.microphone=2",
      broadcastingClaimed: false,
    };
  } catch {
    report.denial = {
      verified: false,
      status: await panelState(denialPage, "publisher-state"),
      reason: "The isolated profile did not expose a denied/blocked result within five seconds; no permission result is claimed.",
      source: "synthetic-only isolated Firefox profile with permissions.default.microphone=2",
      broadcastingClaimed: await panelState(denialPage, "publisher-state") === "broadcasting",
    };
  }
  await denialPage.screenshot({ path: join(outputDirectory, "microphone-denied.png"), fullPage: true });

  assert.deepEqual(listenerTransport.pageErrors, []);
  assert.deepEqual(publisherTransport.pageErrors, []);
  assert.deepEqual(denialTransport.pageErrors, []);
  for (const transport of [listenerTransport, publisherTransport, denialTransport]) {
    assert.ok(transport.sockets.length === 1, `${transport.name} should use one room WebSocket`);
    assert.equal(transport.sockets[0].url, `${target.origin.replace(/^https:/, "wss:")}/ws`);
    assert.deepEqual(transport.sockets[0].errors, []);
  }
  assert.ok(publisherTransport.sockets[0].sentBinaryFrames > 0, "publisher should send binary Opus frames");
  assert.ok(listenerTransport.sockets[0].receivedBinaryFrames > 0, "subscriber should receive binary Opus frames");
  report.transport = [listenerTransport, publisherTransport, denialTransport];
  report.status = "complete";
} catch (error) {
  failure = error;
  report.status = "failed";
  report.failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
} finally {
  await Promise.all(contexts.map((context) => context.close().catch(() => {})));
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(outputDirectory, "audio-evidence.json"), `${JSON.stringify(report, null, 2)}\n`);
}

if (failure) {
  console.error(`T03 synthetic audio smoke failed; evidence saved to ${join(outputDirectory, "audio-evidence.json")}`);
  console.error(failure);
  process.exitCode = 1;
} else {
  console.log("Synthetic Firefox Opus relay, decode, and AudioWorklet render evidence was saved.");
  console.log(`Audio evidence: ${join(outputDirectory, "audio-evidence.json")}`);
}
