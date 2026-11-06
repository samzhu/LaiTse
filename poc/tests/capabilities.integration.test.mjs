import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import WebSocket from "ws";
import { createApp } from "../src/server/app.ts";
import { API_KEYS, CODEC_PROBE_KEYS, MEDIA_TYPE_KEYS } from "../src/server/capabilities.ts";

let app;
let baseUrl;

before(async () => {
  app = await createApp({ serveClient: false });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await app?.close();
});

function connect() {
  const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/ws`, { origin: baseUrl });
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function nextMessage(socket, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      socket.off("message", onMessage);
      reject(error);
    };
    const onMessage = (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch (error) {
        socket.off("error", onError);
        reject(error);
        return;
      }
      if (!predicate(message)) return;
      socket.off("message", onMessage);
      socket.off("error", onError);
      resolve(message);
    };
    socket.on("message", onMessage);
    socket.once("error", onError);
  });
}

function waitForClose(socket) {
  return new Promise((resolve) => socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() })));
}

function send(socket, value) {
  socket.send(JSON.stringify(value));
}

function createReport() {
  const unknownProbe = { status: "unknown", reason: "API test fixture" };
  const probeMap = (keys) => Object.fromEntries(keys.map((key) => [key, { ...unknownProbe }]));
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    environment: { userAgent: "Mozilla/5.0 (integration fixture)", platform: "test", secureContext: true },
    apis: Object.fromEntries(API_KEYS.map((key) => [key, "present"])),
    codecProbes: probeMap(CODEC_PROBE_KEYS),
    mediaRecorderTypes: probeMap(MEDIA_TYPE_KEYS),
    mseTypes: probeMap(MEDIA_TYPE_KEYS),
    playbackTypes: probeMap(MEDIA_TYPE_KEYS),
  };
}

test("a capability report is stored against its sending socket and readable by its server ID", async () => {
  const sender = await connect();
  const senderSnapshot = nextMessage(sender, (message) => message.type === "room.snapshot");
  send(sender, { type: "join", roomId: "lobby", displayName: "Ada" });
  const joinedSender = await senderSnapshot;

  const watcher = await connect();
  const watcherSnapshot = nextMessage(watcher, (message) => message.type === "room.snapshot");
  const watcherSawSenderJoin = nextMessage(sender, (message) => message.type === "control.event" && message.event.kind === "member.joined");
  send(watcher, { type: "join", roomId: "lobby", displayName: "Grace" });
  await watcherSnapshot;
  await watcherSawSenderJoin;

  let watcherSawCapabilityMessage = false;
  const watchForCapabilityMessage = (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type.startsWith("capability.")) watcherSawCapabilityMessage = true;
  };
  watcher.on("message", watchForCapabilityMessage);

  const report = createReport();
  const acknowledgmentPromise = nextMessage(sender, (message) => message.type === "capability.ack");
  send(sender, { type: "capability.report", report });
  const acknowledgment = await acknowledgmentPromise;
  assert.ok(acknowledgment.observationId);
  assert.ok(acknowledgment.connectionId);
  assert.equal(acknowledgment.roomId, "lobby");
  assert.equal(acknowledgment.member.id, joinedSender.members[0].id);
  assert.equal(acknowledgment.member.displayName, "Ada");

  const savedResponse = await fetch(`${baseUrl}/api/observations/${acknowledgment.observationId}`);
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json();
  assert.equal(saved.observationId, acknowledgment.observationId);
  assert.equal(saved.connectionId, acknowledgment.connectionId);
  assert.equal(saved.roomId, "lobby");
  assert.equal(saved.member.id, acknowledgment.member.id);
  assert.equal(saved.member.displayName, "Ada");
  assert.deepEqual(saved.report, report);

  const watcherReaction = nextMessage(watcher, (message) => message.type === "control.event" && message.event.kind === "reaction");
  const senderReaction = nextMessage(sender, (message) => message.type === "control.event" && message.event.kind === "reaction");
  send(sender, { type: "reaction", reaction: "wave" });
  const [seenByWatcher, seenBySender] = await Promise.all([watcherReaction, senderReaction]);
  assert.deepEqual(seenByWatcher, seenBySender);
  assert.equal(seenBySender.event.displayName, "Ada");

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(watcherSawCapabilityMessage, false, "capability reports and acknowledgments stay on the sending socket");
  watcher.off("message", watchForCapabilityMessage);
  sender.close();
  watcher.close();
});

test("invalid capability reports are rejected and not stored", async () => {
  const socket = await connect();
  const snapshot = nextMessage(socket, (message) => message.type === "room.snapshot");
  send(socket, { type: "join", roomId: "lobby", displayName: "Ada" });
  await snapshot;

  const errorPromise = nextMessage(socket, (message) => message.type === "protocol.error");
  const closePromise = waitForClose(socket);
  const report = createReport();
  report.environment.userAgent = "u".repeat(257);
  send(socket, { type: "capability.report", report });
  const protocolError = await errorPromise;
  assert.equal(protocolError.code, "invalid_capability_report");
  assert.equal((await closePromise).code, 1008);

  const lookup = await fetch(`${baseUrl}/api/observations/not-a-real-id`);
  assert.equal(lookup.status, 404);
});
