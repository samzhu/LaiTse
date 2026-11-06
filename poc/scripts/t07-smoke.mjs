import { enterRepositoryRootForLegacyScript, repositoryRoot, pocRoot } from "./lib/project-paths.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

enterRepositoryRootForLegacyScript();

const root = repositoryRoot;
const scratchRoot = resolve(root, ".scratch/t07");
const outputDirectory = resolve(root, process.env.T07_OUTPUT_DIR ?? ".scratch/t07/desktop-smoke");
const outputRelative = relative(scratchRoot, outputDirectory);
if (isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(`..${sep}`)) {
  throw new Error("T07_OUTPUT_DIR must stay inside .scratch/t07.");
}

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, ".tools/playwright-browsers");
const { firefox } = await import("playwright");
const packageManifest = JSON.parse(await (await import("node:fs/promises")).readFile(join(pocRoot, "package.json"), "utf8"));
const caCertificate = resolve(process.env.T07_CA_CERT ?? ".scratch/t01/tls/local-ca.pem");
const baseURL = process.env.T07_BASE_URL ?? `https://localhost:${process.env.PORT ?? "4173"}`;
const target = new URL(baseURL);
const certificateUtility = process.env.CERTUTIL_BIN ?? "certutil";
const headless = process.env.HEADLESS !== "0";

mkdirSync(outputDirectory, { recursive: true });
const report = {
  schemaVersion: 1,
  purpose: "Short T07 desktop flow for server-backed Phaser pixel avatars, two-room movement, roster updates, and reduced motion.",
  startedAt: new Date().toISOString(),
  status: "running",
  baseURL: target.origin,
  topology: { participants: 2, browserProcesses: 2, websocketConnections: 2, network: "one local application over trusted HTTPS/WSS" },
  headless,
  runtime: {
    node: process.version,
    npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
    platform: process.platform,
    architecture: process.arch,
    phaserDependency: packageManifest.dependencies.phaser,
  },
  tls: {
    trust: "local CA imported only into each isolated Firefox NSS profile",
    caCertificate,
    ignoreCertificateErrors: false,
    systemTrustChanged: false,
  },
  artwork: {
    source: "original 16×20 avatar pixel patterns authored in src/client/pixel-space.ts and drawn into Phaser CanvasTextures from a fixed palette",
    externalAssetsDownloaded: false,
    imageGenerationUsed: false,
  },
  clients: {},
  stages: [],
  screenshots: [],
  errors: { pageErrors: [], socketErrors: [] },
  limitations: {
    physicalPhone: "not-tested; the real phone check remains deferred",
    mobileViewport: "not-tested by this desktop flow",
    mediaCaptureOrPlayback: "not-tested; no microphone, screen, audio, or video source was requested",
    screenReaderOrKeyboardCompatibility: "not-tested beyond the focused map key and its visible direction buttons",
    persistence: "room membership and positions remain process-memory state",
    capacityAndLatency: "not-claimed; two local desktop browsers only",
  },
};

const contexts = [];
const transports = {};
const pages = {};
let failure;

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

async function launchFirefox(name) {
  const profile = createTrustedProfile(name);
  const context = await firefox.launchPersistentContext(profile.profileDirectory, {
    headless,
    env: { ...process.env, MOZ_APP_DATA: profile.appData, MOZ_LOCAL_APP_DATA: profile.localAppData },
    viewport: { width: 1440, height: 1000 },
    colorScheme: "light",
  });
  context.setDefaultTimeout(10_000);
  contexts.push(context);
  const page = context.pages()[0] ?? await context.newPage();
  recordTransport(page, name);
  pages[name] = page;
  return page;
}

function recordTransport(page, name) {
  const transport = { name, sockets: [], receivedControls: [], sentControls: [], pageErrors: [], userAgent: "" };
  page.on("pageerror", (error) => {
    const entry = { at: new Date().toISOString(), message: error.message };
    transport.pageErrors.push(entry);
    report.errors.pageErrors.push({ client: name, ...entry });
  });
  page.on("websocket", (socket) => {
    const item = { url: socket.url(), sentTextFrames: 0, sentBinaryFrames: 0, receivedTextFrames: 0, receivedBinaryFrames: 0, errors: [] };
    transport.sockets.push(item);
    const collect = (frame, direction) => {
      const payload = frame.payload;
      if (typeof payload === "string") {
        item[direction === "sent" ? "sentTextFrames" : "receivedTextFrames"] += 1;
        let message;
        try { message = JSON.parse(payload); }
        catch { message = { type: "unparsed-control", text: payload.slice(0, 120) }; }
        const entry = { at: new Date().toISOString(), client: name, direction, rawText: payload, message };
        (direction === "sent" ? transport.sentControls : transport.receivedControls).push(entry);
        return;
      }
      item[direction === "sent" ? "sentBinaryFrames" : "receivedBinaryFrames"] += 1;
    };
    socket.on("framesent", (frame) => collect(frame, "sent"));
    socket.on("framereceived", (frame) => collect(frame, "received"));
    socket.on("socketerror", (error) => {
      item.errors.push(String(error));
      report.errors.socketErrors.push({ client: name, message: String(error) });
    });
  });
  transports[name] = transport;
}

function spaceMessages(name) {
  return transports[name].receivedControls
    .filter((entry) => entry.message.type === "space.snapshot")
    .map((entry) => entry.message);
}

function latestSpace(name, predicate = () => true) {
  const latest = spaceMessages(name).at(-1) ?? null;
  return latest && predicate(latest) ? latest : null;
}

function findPlayer(snapshot, displayName) {
  return snapshot?.rooms.flatMap((room) => room.players).find((player) => player.displayName === displayName) ?? null;
}

function assertRenderedAtServerPosition(renderedState, serverPlayer) {
  const rendered = renderedState.players.find((player) => player.id === serverPlayer.id);
  assert.ok(rendered, `${serverPlayer.displayName} should exist as a Phaser scene object`);
  const roomOriginX = serverPlayer.roomId === "lobby" ? 14 : 526;
  const expectedX = roomOriginX + 42 + (serverPlayer.x + 0.5) * 23;
  const expectedY = 116 + (serverPlayer.y + 0.5) * 23;
  assert.equal(rendered.roomId, serverPlayer.roomId);
  assert.equal(rendered.gridX, serverPlayer.x);
  assert.equal(rendered.gridY, serverPlayer.y);
  assert.equal(rendered.x, expectedX, "actual Phaser container x should match the server grid position");
  assert.equal(rendered.y, expectedY, "actual Phaser container y should match the server grid position");
  assert.equal(rendered.tweenActive, false);
  assert.match(rendered.texture, /^t07-avatar-/);
  return rendered;
}

async function waitForSpace(name, predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = latestSpace(name, predicate);
    if (match) return match;
    await new Promise((resolveWait) => setTimeout(resolveWait, 30));
  }
  throw new Error(`${name} did not receive the expected space snapshot within ${timeoutMs} ms.`);
}

async function waitForRenderedPlayer(page, playerId, roomId, gridX, gridY, snapshotSeq, timeoutMs = 10_000) {
  await page.waitForFunction(({ playerId, roomId, gridX, gridY, snapshotSeq }) => {
    const host = document.querySelector('[data-testid="phaser-space"]');
    const raw = host?.getAttribute("data-rendered-phaser-state");
    if (!raw) return false;
    try {
      const state = JSON.parse(raw);
      const player = state.players.find((item) => item.id === playerId);
      return state.ready === true && state.snapshotSeq >= snapshotSeq && player &&
        player.roomId === roomId && player.gridX === gridX && player.gridY === gridY &&
        player.tweenActive === false && Math.abs(player.x - player.targetX) < 0.01 && Math.abs(player.y - player.targetY) < 0.01;
    } catch { return false; }
  }, { playerId, roomId, gridX, gridY, snapshotSeq }, { timeout: timeoutMs });
  return readRenderedState(page);
}

async function readRenderedState(page) {
  return page.locator('[data-testid="phaser-space"]').evaluate((host) => {
    const raw = host.getAttribute("data-rendered-phaser-state");
    return raw ? JSON.parse(raw) : null;
  });
}

async function waitForRoom(page, roomName) {
  await page.waitForFunction((expected) => document.querySelector(".connection-status")?.textContent?.trim() === expected, `Connected to ${roomName}`);
}

async function joinRoom(page, name, roomId) {
  await page.goto(target.origin, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Local room presence" }).waitFor();
  await page.locator(`[data-room-choice="${roomId}"]`).click();
  await page.getByLabel("Your display name").fill(name);
  await page.getByRole("button", { name: "Join room" }).click();
  const roomName = roomId === "lobby" ? "Local test room" : "Studio";
  await waitForRoom(page, roomName);
  await page.waitForFunction(() => {
    const host = document.querySelector('[data-testid="phaser-space"]');
    return host?.getAttribute("data-render-ready") === "true" && window.__t07SpaceRender?.ready === true;
  });
  await waitForSpace(name === "Ada" ? "A" : "B", (snapshot) => snapshot.currentRoomId === roomId && Boolean(findPlayer(snapshot, name)));
}

async function switchRoom(page, name, roomId) {
  const roomName = roomId === "lobby" ? "Local test room" : "Studio";
  await page.locator(`[data-room-choice="${roomId}"]`).click();
  await waitForRoom(page, roomName);
  const transportName = name === "Ada" ? "A" : "B";
  await waitForSpace(transportName, (snapshot) => snapshot.currentRoomId === roomId && Boolean(findPlayer(snapshot, name)));
}

async function domSnapshot(page, name, stage) {
  const snapshot = await page.evaluate(() => {
    const host = document.querySelector('[data-testid="phaser-space"]');
    const canvas = host?.querySelector("canvas");
    const roster = [...document.querySelectorAll(".member-row")].map((row) => row.querySelector(".member-name")?.textContent?.trim() ?? "");
    return {
      connectionStatus: document.querySelector(".connection-status")?.textContent?.trim() ?? "",
      currentRoom: host?.getAttribute("data-current-room") ?? "",
      snapshotSeq: Number(host?.getAttribute("data-space-seq")) || null,
      renderReady: host?.getAttribute("data-render-ready") === "true",
      canvasWidth: canvas?.width ?? 0,
      canvasHeight: canvas?.height ?? 0,
      canvasClientWidth: canvas?.clientWidth ?? 0,
      canvasClientHeight: canvas?.clientHeight ?? 0,
      currentRoomButton: document.querySelector(".space-room-choice.is-selected")?.getAttribute("data-room-choice") ?? "",
      roster,
      renderState: host?.getAttribute("data-rendered-phaser-state")
        ? JSON.parse(host.getAttribute("data-rendered-phaser-state"))
        : null,
    };
  });
  report.stages.push({ at: new Date().toISOString(), client: name, stage, dom: snapshot });
  return snapshot;
}

async function capture(page, name, fileName) {
  const path = join(outputDirectory, fileName);
  await page.locator('[data-testid="space-panel"]').screenshot({ path, animations: "disabled" });
  report.screenshots.push(fileName);
}

try {
  const pageA = await launchFirefox("A");
  const pageB = await launchFirefox("B");
  await Promise.all([joinRoom(pageA, "Ada", "lobby"), joinRoom(pageB, "Grace", "lobby")]);
  report.runtime.firefoxA = await pageA.evaluate(() => navigator.userAgent);
  report.runtime.firefoxB = await pageB.evaluate(() => navigator.userAgent);
  transports.A.userAgent = report.runtime.firefoxA;
  transports.B.userAgent = report.runtime.firefoxB;
  await pageA.waitForFunction(() => window.__t07SpaceRender?.players.some((player) => player.displayName === "Ada"));
  await pageB.waitForFunction(() => window.__t07SpaceRender?.players.some((player) => player.displayName === "Grace"));
  let stateA = await waitForSpace("A", (snapshot) => Boolean(findPlayer(snapshot, "Ada")) && Boolean(findPlayer(snapshot, "Grace")));
  let stateB = await waitForSpace("B", (snapshot) => Boolean(findPlayer(snapshot, "Ada")) && Boolean(findPlayer(snapshot, "Grace")));
  const adaInitial = findPlayer(stateA, "Ada");
  const graceInitial = findPlayer(stateA, "Grace");
  assert.equal(adaInitial.roomId, "lobby");
  assert.equal(graceInitial.roomId, "lobby");
  const initialRenderA = await waitForRenderedPlayer(pageA, adaInitial.id, "lobby", adaInitial.x, adaInitial.y, stateA.seq);
  const initialRenderB = await waitForRenderedPlayer(pageB, adaInitial.id, "lobby", adaInitial.x, adaInitial.y, stateB.seq);
  assert.equal(initialRenderA.renderer, initialRenderB.renderer);
  assert.equal(initialRenderA.phaserVersion, "4.2.1");
  assertRenderedAtServerPosition(initialRenderA, adaInitial);
  assertRenderedAtServerPosition(initialRenderB, adaInitial);
  await domSnapshot(pageA, "A", "both-in-lobby");
  await domSnapshot(pageB, "B", "both-in-lobby");
  await capture(pageA, "A", "both-in-lobby.png");

  const moveCountA = spaceMessages("A").length;
  const moveCountB = spaceMessages("B").length;
  await pageA.locator('[data-testid="phaser-space"]').focus();
  await pageA.keyboard.press("ArrowRight");
  const stateMovedA = await waitForSpace("A", (snapshot) => spaceMessages("A").indexOf(snapshot) >= moveCountA && findPlayer(snapshot, "Ada")?.x === adaInitial.x + 1);
  const stateMovedB = await waitForSpace("B", (snapshot) => spaceMessages("B").indexOf(snapshot) >= moveCountB && findPlayer(snapshot, "Ada")?.x === adaInitial.x + 1);
  assert.equal(stateMovedA.seq, stateMovedB.seq);
  const movedAPlayer = findPlayer(stateMovedA, "Ada");
  const renderedAtB = await waitForRenderedPlayer(pageB, movedAPlayer.id, "lobby", movedAPlayer.x, movedAPlayer.y, stateMovedB.seq);
  const renderedAdaOnB = assertRenderedAtServerPosition(renderedAtB, movedAPlayer);
  await domSnapshot(pageA, "A", "keyboard-move-acknowledged");
  await domSnapshot(pageB, "B", "keyboard-move-rendered-on-peer");
  await capture(pageB, "B", "movement-synchronized.png");

  await switchRoom(pageA, "Ada", "studio");
  stateA = await waitForSpace("A", (snapshot) => snapshot.currentRoomId === "studio" && Boolean(findPlayer(snapshot, "Grace")));
  assert.equal(findPlayer(stateA, "Ada").roomId, "studio");
  assert.equal(findPlayer(stateA, "Grace").roomId, "lobby");
  await switchRoom(pageB, "Grace", "studio");
  stateB = await waitForSpace("B", (snapshot) => snapshot.currentRoomId === "studio" && findPlayer(snapshot, "Grace")?.roomId === "studio" && findPlayer(snapshot, "Ada")?.roomId === "studio");
  const studioRenderB = await waitForRenderedPlayer(pageB, findPlayer(stateB, "Ada").id, "studio", findPlayer(stateB, "Ada").x, findPlayer(stateB, "Ada").y, stateB.seq);
  const studioRenderA = await waitForRenderedPlayer(pageA, findPlayer(stateB, "Grace").id, "studio", findPlayer(stateB, "Grace").x, findPlayer(stateB, "Grace").y, stateB.seq);
  assertRenderedAtServerPosition(studioRenderB, findPlayer(stateB, "Ada"));
  assertRenderedAtServerPosition(studioRenderA, findPlayer(stateB, "Grace"));
  await domSnapshot(pageA, "A", "both-in-studio");
  await domSnapshot(pageB, "B", "both-in-studio");
  await capture(pageA, "A", "both-in-studio.png");

  await switchRoom(pageB, "Grace", "lobby");
  await switchRoom(pageA, "Ada", "lobby");
  stateA = await waitForSpace("A", (snapshot) => snapshot.currentRoomId === "lobby" && findPlayer(snapshot, "Ada")?.roomId === "lobby" && findPlayer(snapshot, "Grace")?.roomId === "lobby");
  assert.deepEqual(stateA.rooms.find((room) => room.id === "studio").players, [], "empty room stays in the room catalogue");
  assert.deepEqual(stateA.rooms.map((room) => room.id), ["lobby", "studio"]);
  const emptyStudioRenderAda = await waitForRenderedPlayer(pageA, findPlayer(stateA, "Ada").id, "lobby", findPlayer(stateA, "Ada").x, findPlayer(stateA, "Ada").y, stateA.seq);
  assertRenderedAtServerPosition(emptyStudioRenderAda, findPlayer(stateA, "Ada"));
  const emptyStudioRenderGrace = await waitForRenderedPlayer(pageA, findPlayer(stateA, "Grace").id, "lobby", findPlayer(stateA, "Grace").x, findPlayer(stateA, "Grace").y, stateA.seq);
  assertRenderedAtServerPosition(emptyStudioRenderGrace, findPlayer(stateA, "Grace"));
  await domSnapshot(pageA, "A", "studio-empty-and-still-listed");
  await capture(pageA, "A", "studio-empty.png");

  const leaveCount = spaceMessages("A").length;
  await pageB.getByRole("button", { name: "Leave" }).click();
  const afterGraceLeaves = await waitForSpace("A", (snapshot) => spaceMessages("A").indexOf(snapshot) >= leaveCount && findPlayer(snapshot, "Grace") === null);
  assert.equal(findPlayer(afterGraceLeaves, "Ada").roomId, "lobby");
  await pageA.waitForFunction(() => {
    const renderedPlayers = window.__t07SpaceRender?.players ?? [];
    const rosterNames = [...document.querySelectorAll(".member-name")].map((item) => item.textContent?.trim());
    return renderedPlayers.every((player) => player.displayName !== "Grace") && !rosterNames.includes("Grace");
  });
  const leaveDom = await domSnapshot(pageA, "A", "grace-left");
  assert.deepEqual(leaveDom.roster, ["Ada"]);
  await capture(pageA, "A", "member-left.png");

  await joinRoom(pageB, "Grace", "studio");
  const rejoinStateA = await waitForSpace("A", (snapshot) => findPlayer(snapshot, "Grace")?.roomId === "studio");
  assert.equal(findPlayer(rejoinStateA, "Ada").roomId, "lobby");
  const rejoinedRenderA = await waitForRenderedPlayer(pageA, findPlayer(rejoinStateA, "Grace").id, "studio", findPlayer(rejoinStateA, "Grace").x, findPlayer(rejoinStateA, "Grace").y, rejoinStateA.seq);
  assertRenderedAtServerPosition(rejoinedRenderA, findPlayer(rejoinStateA, "Grace"));
  await pageB.waitForFunction(() => window.__t07SpaceRender?.players.some((player) => player.displayName === "Grace"));
  await domSnapshot(pageB, "B", "grace-rejoined-studio");
  await capture(pageB, "B", "grace-rejoined.png");

  await pageA.getByLabel("Reduce motion").check();
  const reducedMoveCount = spaceMessages("A").length;
  const beforeReducedMove = findPlayer(latestSpace("A"), "Ada");
  await pageA.locator('[data-testid="phaser-space"]').focus();
  await pageA.keyboard.press("ArrowDown");
  const reducedState = await waitForSpace("A", (snapshot) => spaceMessages("A").indexOf(snapshot) >= reducedMoveCount && findPlayer(snapshot, "Ada")?.y === beforeReducedMove.y + 1);
  const reducedPlayer = findPlayer(reducedState, "Ada");
  const reducedRender = await waitForRenderedPlayer(pageA, reducedPlayer.id, "lobby", reducedPlayer.x, reducedPlayer.y, reducedState.seq);
  const firstReducedPosition = assertRenderedAtServerPosition(reducedRender, reducedPlayer);
  await new Promise((resolveWait) => setTimeout(resolveWait, 120));
  const secondReducedPosition = (await readRenderedState(pageA)).players.find((player) => player.id === reducedPlayer.id);
  assert.equal(firstReducedPosition.tweenActive, false);
  assert.equal(secondReducedPosition.tweenActive, false);
  assert.equal(secondReducedPosition.x, firstReducedPosition.x);
  assert.equal(secondReducedPosition.y, firstReducedPosition.y);
  await domSnapshot(pageA, "A", "reduced-motion-settled");
  await capture(pageA, "A", "reduced-motion.png");

  for (const name of ["A", "B"]) {
    const transport = transports[name];
    const noBinaryMedia = transport.sockets.every((socket) => socket.sentBinaryFrames === 0 && socket.receivedBinaryFrames === 0);
    assert.equal(noBinaryMedia, true, `${name} should not send or receive media frames during this smoke`);
    report.clients[name] = {
      userAgent: transport.userAgent,
      spaceSnapshots: spaceMessages(name),
      sentControls: transport.sentControls,
      receivedControls: transport.receivedControls,
      sockets: transport.sockets,
      pageErrors: transport.pageErrors,
      finalRender: await readRenderedState(pages[name]),
      finalDom: await domSnapshot(pages[name], name, "final"),
    };
  }
  assert.deepEqual(report.errors.pageErrors, []);
  report.renderer = {
    phaserVersion: initialRenderA.phaserVersion,
    actualRenderer: initialRenderA.renderer,
    fallbackRule: "Phaser.AUTO chooses WebGL when available and falls back to Canvas; the report records Phaser's actual renderer type.",
    diagnostics: "window.__t07SpaceRender and the canvas host dataset are written only by Phaser POST_RENDER after its scene objects render.",
  };
  report.status = "passed";
} catch (error) {
  failure = error;
  report.status = "failed";
  report.failure = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error);
  for (const [name, page] of Object.entries(pages)) {
    try {
      if (await page.locator('[data-testid="space-panel"]').count()) {
        const fileName = `${name}-failure.png`;
        await page.locator('[data-testid="space-panel"]').screenshot({ path: join(outputDirectory, fileName), animations: "disabled" });
        report.screenshots.push(fileName);
      }
    } catch {
      // A blank or closed page does not add useful evidence.
    }
  }
} finally {
  report.finishedAt = new Date().toISOString();
  for (const [name, transport] of Object.entries(transports)) {
    if (!report.clients[name]) {
      report.clients[name] = {
        sentControls: transport.sentControls,
        receivedControls: transport.receivedControls,
        sockets: transport.sockets,
        pageErrors: transport.pageErrors,
      };
    }
  }
  writeFileSync(join(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  for (const context of contexts) await context.close();
}

if (failure) throw failure;
console.log(`[T07] desktop room flow ${report.status}; evidence: ${relative(root, outputDirectory)}`);
