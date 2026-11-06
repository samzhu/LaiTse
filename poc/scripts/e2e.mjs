import { enterRepositoryRootForLegacyScript, repositoryRoot, pocRoot } from "./lib/project-paths.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

enterRepositoryRootForLegacyScript();

const root = repositoryRoot;
const scratchRoot = resolve(root, ".scratch/t01");
const outputDirectory = resolve(root, process.env.E2E_OUTPUT_DIR ?? ".scratch/t01/e2e-run");
const outputRelative = relative(scratchRoot, outputDirectory);
if (isAbsolute(outputRelative) || outputRelative === ".." || outputRelative.startsWith(`..${sep}`)) {
  throw new Error("E2E_OUTPUT_DIR must stay inside .scratch/t01.");
}

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, ".tools/playwright-browsers");
const { firefox } = await import("playwright");
const tlsDirectory = resolve(root, ".scratch/t01/tls");
const caCertificate = resolve(process.env.LOCAL_CA_CERT ?? join(tlsDirectory, "local-ca.pem"));
const baseURL = process.env.E2E_BASE_URL ?? `https://localhost:${process.env.PORT ?? "4173"}`;
const target = new URL(baseURL);
const certificateUtility = process.env.CERTUTIL_BIN ?? "certutil";
const headless = process.env.HEADLESS !== "0";

mkdirSync(outputDirectory, { recursive: true });
const report = {
  startedAt: new Date().toISOString(),
  baseURL: target.origin,
  headless,
  status: "running",
  runtime: {
    node: process.version,
    npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
    platform: process.platform,
    architecture: process.arch,
    osVersion: process.platform === "darwin" ? execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim() : "not-collected",
  },
  tls: {
    trust: "local CA imported only into two per-run Firefox NSS profiles",
    certificate: resolve(process.env.TLS_CERT_FILE ?? join(tlsDirectory, "localhost-cert.pem")),
    caCertificate,
    ignoreCertificateErrors: false,
  },
  browser: null,
  clients: [],
  screenshots: [],
};

let failure;
const contexts = [];

function runCertutil(args) {
  execFileSync(certificateUtility, args, { stdio: "pipe" });
}

function createTrustedProfile(name) {
  const profileDirectory = join(outputDirectory, "profiles", name);
  rmSync(profileDirectory, { recursive: true, force: true });
  mkdirSync(profileDirectory, { recursive: true });
  runCertutil(["-N", "-d", `sql:${profileDirectory}`, "--empty-password"]);
  runCertutil([
    "-A", "-d", `sql:${profileDirectory}`,
    "-n", "LaiTse local development CA", "-t", "C,,", "-i", caCertificate,
  ]);
  return profileDirectory;
}

async function startClient(name) {
  const profileDirectory = createTrustedProfile(name);
  const appData = join(outputDirectory, "app-data", name);
  const localAppData = join(outputDirectory, "local-app-data", name);
  mkdirSync(appData, { recursive: true });
  mkdirSync(localAppData, { recursive: true });
  const context = await firefox.launchPersistentContext(profileDirectory, {
    headless,
    env: { ...process.env, MOZ_APP_DATA: appData, MOZ_LOCAL_APP_DATA: localAppData },
    viewport: { width: 1440, height: 1000 },
    colorScheme: "light",
  });
  contexts.push(context);
  report.browser ??= { name: "Firefox", version: context.browser()?.version() ?? "unknown" };
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
  return { name, page, transport, appData, localAppData };
}

function readClientState(page) {
  return page.evaluate(() => ({
    origin: location.origin,
    secureContext: window.isSecureContext,
    connection: document.querySelector('[role="status"]')?.textContent?.trim() ?? "",
    api: document.querySelector(".api-status")?.textContent?.trim() ?? "",
    members: [...document.querySelectorAll(".member-row .member-name")].map((element) => element.textContent?.trim() ?? ""),
    events: [...document.querySelectorAll(".event-row")].map((element) => ({
      sequence: Number(element.getAttribute("data-seq")),
      kind: element.getAttribute("data-kind"),
      roomId: element.getAttribute("data-room-id"),
      participantId: element.getAttribute("data-participant-id"),
      displayName: element.getAttribute("data-display-name"),
      reaction: element.getAttribute("data-reaction"),
      at: Number(element.getAttribute("data-at")),
      text: element.textContent?.replace(/\s+/g, " ").trim() ?? "",
    })),
  }));
}

try {
  assert.equal(target.protocol, "https:", "Browser evidence requires HTTPS/WSS with a trusted certificate.");
  readFileSync(caCertificate);
  readFileSync(report.tls.certificate);
  const first = await startClient("client-1");
  const second = await startClient("client-2");
  const firstVersion = report.browser.version;
  const joinRoomClient = async (client, displayName) => {
    await client.page.getByLabel("Your display name").fill(displayName);
    await client.page.getByRole("button", { name: "Join room" }).click();
    await client.page.getByText("Connected to Local test room", { exact: true }).waitFor();
  };

  await joinRoomClient(first, "Ada");
  await first.page.getByRole("list", { name: "Online members" }).getByText("Ada", { exact: true }).waitFor();
  await joinRoomClient(second, "Grace");
  for (const client of [first, second]) {
    await client.page.getByRole("list", { name: "Online members" }).getByText("Ada", { exact: true }).waitFor();
    await client.page.getByRole("list", { name: "Online members" }).getByText("Grace", { exact: true }).waitFor();
    await client.page.getByRole("list", { name: "Recent room events" }).getByText("Grace joined the room").waitFor();
  }

  await first.page.getByRole("button", { name: "Send wave reaction" }).click();
  await second.page.getByRole("button", { name: "Send clap reaction" }).click();
  for (const client of [first, second]) {
    await client.page.getByRole("list", { name: "Recent room events" }).getByText("Ada sent a wave").waitFor();
    await client.page.getByRole("list", { name: "Recent room events" }).getByText("Grace sent a clap").waitFor();
  }

  for (const client of [first, second]) {
    const screenshot = `${client.name}.png`;
    await client.page.screenshot({ path: join(outputDirectory, screenshot), fullPage: true });
    report.screenshots.push(screenshot);
    report.clients.push({
      name: client.name,
      appData: client.appData,
      localAppData: client.localAppData,
      state: await readClientState(client.page),
    });
    const socket = client.transport.sockets[0];
    assert.equal(client.transport.sockets.length, 1);
    assert.equal(socket.url, `${target.origin.replace(/^https:/, "wss:")}/ws`);
    assert.ok(socket.sentFrames >= 2 && socket.receivedFrames >= 3);
    assert.deepEqual(socket.errors, []);
    assert.deepEqual(client.transport.pageErrors, []);
    assert.equal(report.clients.at(-1).state.secureContext, true);
    report.clients.at(-1).transport = client.transport;
  }
  assert.equal(report.clients[0].state.members.length, 2);
  assert.equal(report.clients[1].state.members.length, 2);
  const graceJoined = report.clients[1].state.events.find((event) => event.kind === "member.joined" && event.displayName === "Grace");
  assert.ok(graceJoined, "the second client must observe its server-assigned join event");
  const sharedEventsFromFirst = report.clients[0].state.events.filter((event) => event.sequence >= graceJoined.sequence);
  assert.deepEqual(sharedEventsFromFirst, report.clients[1].state.events, "both clients must observe identical sequenced event payloads after Grace joins");
  assert.ok(report.clients[1].state.events.some((event) => event.kind === "reaction" && event.displayName === "Ada" && event.reaction === "wave"));
  assert.ok(report.clients[1].state.events.some((event) => event.kind === "reaction" && event.displayName === "Grace" && event.reaction === "clap"));
  report.sharedEventPayloadsAndSequencesMatch = true;

  await second.page.getByRole("button", { name: "Leave" }).click();
  await first.page.getByRole("list", { name: "Recent room events" }).getByText("Grace left the room").waitFor();
  await second.page.getByText("Not connected", { exact: true }).waitFor();
  await second.page.getByRole("list", { name: "Online members" }).getByText("You’ll see people here after they join.").waitFor();
  await first.page.getByRole("list", { name: "Online members" }).getByText("Ada", { exact: true }).waitFor();
  assert.equal(await first.page.getByRole("list", { name: "Online members" }).getByText("Grace", { exact: true }).count(), 0);
  report.postLeave = {
    remainingClient: await readClientState(first.page),
    leavingClient: await readClientState(second.page),
  };
  assert.deepEqual(report.postLeave.remainingClient.members, ["Ada"]);
  assert.deepEqual(report.postLeave.leavingClient.members, []);
  report.status = "complete";
  report.browser.version = firstVersion;
} catch (error) {
  failure = error;
  report.status = "failed";
  report.failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
} finally {
  await Promise.all(contexts.map((context) => context.close().catch(() => {})));
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(outputDirectory, "browser-evidence.json"), `${JSON.stringify(report, null, 2)}\n`);
}

if (failure) {
  console.error(`Browser validation failed; evidence saved to ${join(outputDirectory, "browser-evidence.json")}`);
  console.error(failure);
  process.exitCode = 1;
} else {
  console.log(`Two Firefox clients joined and observed the same members and wave event.`);
  console.log(`Screenshots and environment evidence: ${outputDirectory}`);
}
