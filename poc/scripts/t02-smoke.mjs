import { enterRepositoryRootForLegacyScript, repositoryRoot, pocRoot } from "./lib/project-paths.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

enterRepositoryRootForLegacyScript();

const root = repositoryRoot;
const scratchRoot = resolve(root, ".scratch/t02");
const outputDirectory = resolve(root, process.env.T02_OUTPUT_DIR ?? ".scratch/t02/desktop-smoke");
const outputRelative = relative(scratchRoot, outputDirectory);
if (isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(`..${sep}`)) {
  throw new Error("T02_OUTPUT_DIR must stay inside .scratch/t02.");
}

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, ".tools/playwright-browsers");
const { firefox } = await import("playwright");
const tlsDirectory = resolve(root, ".scratch/t01/tls");
const caCertificate = resolve(process.env.T02_CA_CERT ?? join(tlsDirectory, "local-ca.pem"));
const baseURL = process.env.T02_BASE_URL ?? `https://localhost:${process.env.PORT ?? "4173"}`;
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
    osVersion: process.platform === "darwin" ? execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim() : "not-collected",
  },
  tls: {
    trust: "local CA imported only into this run's isolated Firefox NSS profile",
    caCertificate,
    serverCertificate: resolve(process.env.TLS_CERT_FILE ?? join(tlsDirectory, "localhost-cert.pem")),
    ignoreCertificateErrors: false,
  },
  browser: null,
  client: null,
  serverObservation: null,
  screenshot: "capability-report.png",
};

let failure;
let context;

function runCertutil(args) {
  execFileSync(certificateUtility, args, { stdio: "pipe" });
}

function createTrustedProfile() {
  const profileDirectory = join(outputDirectory, "profile");
  rmSync(profileDirectory, { recursive: true, force: true });
  mkdirSync(profileDirectory, { recursive: true });
  runCertutil(["-N", "-d", `sql:${profileDirectory}`, "--empty-password"]);
  runCertutil([
    "-A", "-d", `sql:${profileDirectory}`,
    "-n", "LaiTse local development CA", "-t", "C,,", "-i", caCertificate,
  ]);
  return profileDirectory;
}

try {
  assert.equal(target.protocol, "https:", "T02 browser evidence requires trusted HTTPS and WSS.");
  readFileSync(caCertificate);
  readFileSync(report.tls.serverCertificate);

  const profileDirectory = createTrustedProfile();
  const appData = join(outputDirectory, "app-data");
  const localAppData = join(outputDirectory, "local-app-data");
  mkdirSync(appData, { recursive: true });
  mkdirSync(localAppData, { recursive: true });
  context = await firefox.launchPersistentContext(profileDirectory, {
    headless,
    env: { ...process.env, MOZ_APP_DATA: appData, MOZ_LOCAL_APP_DATA: localAppData },
    viewport: { width: 1440, height: 1200 },
    colorScheme: "light",
  });
  report.browser = { name: "Firefox", version: context.browser()?.version() ?? "unknown" };

  const page = context.pages()[0] ?? await context.newPage();
  const transport = { sockets: [], pageErrors: [] };
  page.on("pageerror", (error) => transport.pageErrors.push(error.message));
  page.on("websocket", (socket) => {
    const connection = { url: socket.url(), sentFrames: 0, receivedFrames: 0, errors: [] };
    transport.sockets.push(connection);
    socket.on("framesent", () => connection.sentFrames++);
    socket.on("framereceived", () => connection.receivedFrames++);
    socket.on("socketerror", (error) => connection.errors.push(String(error)));
  });

  await page.goto(target.origin, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Local room presence" }).waitFor();
  await page.getByText("API ready · process-memory", { exact: true }).waitFor();
  await page.getByLabel("Your display name").fill("T02 desktop");
  await page.getByRole("button", { name: "Join room" }).click();
  await page.getByText("Connected to Local test room", { exact: true }).waitFor();

  await page.getByRole("button", { name: "探測此瀏覽器" }).click();
  await page.getByText("本機探測完成。這只測 API 存在與設定探針，不代表實際擷取或播放成功。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "送出觀測" }).click();
  const observationCard = page.locator(".observation-card");
  await observationCard.waitFor();
  await page.waitForFunction(() => document.querySelector(".observation-card")?.getAttribute("data-readback-matched") === "true");

  const observationId = await observationCard.getAttribute("data-observation-id");
  assert.ok(observationId);
  const savedObservation = await page.evaluate(async (id) => {
    const response = await fetch(`/api/observations/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`Observation lookup returned ${response.status}.`);
    return await response.json();
  }, observationId);
  assert.equal(savedObservation.observationId, observationId);
  assert.equal(savedObservation.roomId, "lobby");
  assert.equal(savedObservation.member.displayName, "T02 desktop");
  assert.equal(savedObservation.report.environment.secureContext, true);
  assert.equal(await observationCard.getAttribute("data-connection-id"), savedObservation.connectionId);
  assert.equal(await observationCard.getAttribute("data-member-id"), savedObservation.member.id);
  await page.getByRole("button", { name: "Send wave reaction" }).click();
  await page.getByRole("list", { name: "Recent room events" }).getByText("T02 desktop sent a wave").waitFor();
  assert.deepEqual(transport.pageErrors, []);
  assert.equal(transport.sockets.length, 1);
  assert.equal(transport.sockets[0].url, `${target.origin.replace(/^https:/, "wss:")}/ws`);
  assert.deepEqual(transport.sockets[0].errors, []);
  assert.ok(transport.sockets[0].sentFrames >= 3, "join, capability report, and one more control frame should be sent");
  assert.ok(transport.sockets[0].receivedFrames >= 2, "room snapshot and observation acknowledgment should arrive");

  await page.screenshot({ path: join(outputDirectory, report.screenshot), fullPage: true });
  report.client = {
    origin: target.origin,
    secureContext: savedObservation.report.environment.secureContext,
    userAgent: savedObservation.report.environment.userAgent,
    platform: savedObservation.report.environment.platform,
    connection: await page.locator(".connection-status").textContent(),
  };
  report.transport = transport;
  report.serverObservation = savedObservation;
  report.status = "complete";
} catch (error) {
  failure = error;
  report.status = "failed";
  report.failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
} finally {
  await context?.close().catch(() => {});
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(outputDirectory, "capability-evidence.json"), `${JSON.stringify(report, null, 2)}\n`);
}

if (failure) {
  console.error(`T02 browser smoke failed; evidence saved to ${join(outputDirectory, "capability-evidence.json")}`);
  console.error(failure);
  process.exitCode = 1;
} else {
  console.log("Trusted Firefox HTTPS/WSS capability probe was stored and read back from its sending connection.");
  console.log(`Capability matrix and screenshot: ${outputDirectory}`);
}
