import assert from "node:assert/strict";
import { test } from "node:test";
import WebSocket from "ws";
import { createApp } from "../src/server/app.ts";
import { createControlResumeStore } from "../src/server/control-resume.ts";

const MESSAGE_TIMEOUT_MS = 5_000;
const HOST_TOKEN = "control-resume-host-token-minimum-32-bytes";
const OLD_ROOM_PASSWORD = "control-resume-old-room-password";
const NEW_ROOM_PASSWORD = "control-resume-new-room-password";

async function withServer(options, run) {
  const app = await createApp({ serveClient: false, ...options });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await app.close();
  }
}

async function connect(baseUrl) {
  const socket = new WebSocket(`${baseUrl.replace(/^http/u, "ws")}/ws`, { origin: baseUrl });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket did not open.")), MESSAGE_TIMEOUT_MS);
    socket.once("open", () => { clearTimeout(timer); resolve(); });
    socket.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
  return socket;
}

function nextMessage(socket, predicate, timeoutMs = MESSAGE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      socket.off("error", onError);
      reject(new Error("Expected WebSocket message did not arrive."));
    }, timeoutMs);
    const onError = (error) => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      reject(error);
    };
    const onMessage = (raw, isBinary) => {
      if (isBinary) return;
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      socket.off("error", onError);
      resolve(message);
    };
    socket.on("message", onMessage);
    socket.once("error", onError);
  });
}

function send(socket, message) {
  socket.send(JSON.stringify(message));
}

async function joinResumable(socket, { roomId = "lobby", displayName = "Resume user", role = "participant", mode = "watch", password } = {}) {
  const issuedMessage = nextMessage(socket, (message) => message.type === "session.issued");
  const roomMessage = nextMessage(socket, (message) => message.type === "room.snapshot");
  const interactionMessage = nextMessage(socket, (message) => message.type === "interaction.snapshot");
  const participationMessage = nextMessage(socket, (message) => message.type === "participation.self");
  send(socket, { type: "join", roomId, displayName, role, mode, resumable: true, ...(password === undefined ? {} : { password }) });
  const [issued, room, interaction, participation] = await Promise.all([issuedMessage, roomMessage, interactionMessage, participationMessage]);
  assert.ok(typeof issued.token === "string" && issued.token.length === 43, "server did not issue a bounded resume token");
  return { issued, room, interaction, participation };
}

async function resume(socket, token) {
  const resumedMessage = nextMessage(socket, (message) => message.type === "session.resumed");
  const roomMessage = nextMessage(socket, (message) => message.type === "room.snapshot");
  const interactionMessage = nextMessage(socket, (message) => message.type === "interaction.snapshot");
  const participationMessage = nextMessage(socket, (message) => message.type === "participation.self");
  send(socket, { type: "session.resume", token });
  const [resumed, room, interaction, participation] = await Promise.all([resumedMessage, roomMessage, interactionMessage, participationMessage]);
  return { resumed, room, interaction, participation };
}

function closeAndWait(socket) {
  return new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) return resolve();
    socket.once("close", resolve);
    if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    else socket.close();
  });
}

test("resume store keeps a short idle TTL and never evicts an unexpired proof", () => {
  let now = 100;
  let sequence = 0;
  const store = createControlResumeStore({
    ttlMs: 8_000,
    maxEntries: 1,
    now: () => now,
    createToken: () => String(++sequence).padStart(43, "0"),
  });
  const first = store.issue({
    participantId: "member-a", displayName: "A", roomId: "lobby", role: "participant", mode: "watch", admissionRevision: 0,
  }, "connection-a");
  assert.ok(first);
  now += 600_000;
  assert.equal(store.lookup(first.token).record?.participantId, "member-a", "active sessions do not expire while their socket remains open");
  store.detach(first.token, "connection-a");
  now += 7_999;
  assert.equal(store.canIssue(), false, "a valid detached record still occupies its bounded slot");
  assert.equal(store.lookup(first.token).record?.participantId, "member-a");
  now += 1;
  const expired = store.lookup(first.token);
  assert.equal(expired.record, null);
  assert.equal(expired.expired, true);
  const second = store.issue({
    participantId: "member-b", displayName: "B", roomId: "lobby", role: "participant", mode: "watch", admissionRevision: 0,
  }, "connection-b");
  assert.ok(second);
  assert.notEqual(first.token, second.token);
});

test("resume preserves room identity and interaction dedup while rechecking live gate and host rights", { timeout: 30_000 }, async () => {
  const sockets = [];
  await withServer({ hostControlToken: HOST_TOKEN, meetingRoomPassword: OLD_ROOM_PASSWORD }, async (baseUrl) => {
    const host = await connect(baseUrl); sockets.push(host);
    const guest = await connect(baseUrl); sockets.push(guest);
    const hostJoin = await joinResumable(host, { roomId: "studio", displayName: "Host", password: OLD_ROOM_PASSWORD });
    const guestJoin = await joinResumable(guest, { roomId: "studio", displayName: "Guest", password: OLD_ROOM_PASSWORD });
    const participantId = guestJoin.participation.participantId;

    const claimedMessage = nextMessage(host, (message) => message.type === "host.claimed");
    send(host, { type: "host.claim", token: HOST_TOKEN });
    await claimedMessage;
    const grantMessage = nextMessage(host, (message) => message.type === "host.actionResult" && message.action === "grantPublisher");
    send(host, { type: "host.grantPublisher", participantId });
    await grantMessage;

    const eventInput = { type: "interaction.submit", eventId: "resume-dedup-01", kind: "chat", text: "one accepted event" };
    const firstAck = nextMessage(guest, (message) => message.type === "interaction.ack" && message.eventId === eventInput.eventId);
    send(guest, eventInput);
    assert.equal((await firstAck).duplicate, false);

    const changedPassword = nextMessage(host, (message) => message.type === "host.actionResult" && message.action === "setMeetingRoomPassword");
    send(host, { type: "host.setMeetingRoomPassword", password: NEW_ROOM_PASSWORD });
    await changedPassword;
    const sameRoomSnapshot = nextMessage(guest, (message) => message.type === "room.snapshot" && message.room.id === "studio");
    send(guest, { type: "room.switch", roomId: "studio" });
    await sameRoomSnapshot;
    const modeAck = nextMessage(guest, (message) => message.type === "participation.modeChanged");
    send(guest, { type: "participation.setMode", mode: "interaction" });
    assert.equal((await modeAck).mode, "interaction");

    const busy = await connect(baseUrl); sockets.push(busy);
    const busyError = nextMessage(busy, (message) => message.type === "protocol.error");
    send(busy, { type: "session.resume", token: guestJoin.issued.token });
    assert.equal((await busyError).code, "resume_busy");
    await closeAndWait(guest);

    const forged = await connect(baseUrl); sockets.push(forged);
    const forgedError = nextMessage(forged, (message) => message.type === "protocol.error");
    send(forged, { type: "session.resume", token: guestJoin.issued.token, role: "display", roomId: "lobby" });
    assert.equal((await forgedError).code, "invalid_resume");
    await closeAndWait(forged);

    const resumed = await connect(baseUrl); sockets.push(resumed);
    const gateError = nextMessage(resumed, (message) => message.type === "protocol.error");
    send(resumed, { type: "session.resume", token: guestJoin.issued.token });
    const missingPassword = await gateError;
    assert.equal(missingPassword.code, "room_password_required");
    assert.equal(missingPassword.roomId, "studio");

    const wrongPasswordError = nextMessage(resumed, (message) => message.type === "protocol.error");
    send(resumed, { type: "session.resume", token: guestJoin.issued.token, password: "wrong-room-password" });
    assert.equal((await wrongPasswordError).code, "room_password_incorrect");

    const resumedMessage = nextMessage(resumed, (message) => message.type === "session.resumed");
    const roomMessage = nextMessage(resumed, (message) => message.type === "room.snapshot");
    const interactionMessage = nextMessage(resumed, (message) => message.type === "interaction.snapshot");
    const selfMessage = nextMessage(resumed, (message) => message.type === "participation.self");
    send(resumed, { type: "session.resume", token: guestJoin.issued.token, password: NEW_ROOM_PASSWORD });
    const [session, room, interactions, self] = await Promise.all([resumedMessage, roomMessage, interactionMessage, selfMessage]);
    assert.equal(session.participantId, participantId);
    assert.equal(session.roomId, "studio");
    assert.equal(session.role, "participant");
    assert.equal(session.mode, "interaction");
    assert.equal(Object.hasOwn(session, "token"), false, "resume must not echo the bearer token");
    assert.equal(room.room.publishAllowed, false, "a disconnected publisher grant must not return");
    assert.deepEqual({ audio: self.media.audio.subscribed, screen: self.media.screen.subscribed }, { audio: false, screen: false });
    assert.equal(interactions.history.filter((item) => item.eventId === eventInput.eventId).length, 1);

    const duplicateAck = nextMessage(resumed, (message) => message.type === "interaction.ack" && message.eventId === eventInput.eventId);
    send(resumed, eventInput);
    assert.equal((await duplicateAck).duplicate, true);

    const unauthorizedHostControl = nextMessage(resumed, (message) => message.type === "host.error");
    send(resumed, { type: "host.endSession" });
    assert.equal((await unauthorizedHostControl).code, "host_unauthorized");

    await closeAndWait(resumed);
    const secondResume = await connect(baseUrl); sockets.push(secondResume);
    const secondState = await resume(secondResume, guestJoin.issued.token);
    assert.equal(secondState.resumed.participantId, participantId);
    assert.equal(secondState.room.room.id, "studio");

    const left = nextMessage(secondResume, (message) => message.type === "session.left");
    send(secondResume, { type: "session.leave" });
    await left;
    await closeAndWait(secondResume);
    const afterLeave = await connect(baseUrl); sockets.push(afterLeave);
    const invalid = nextMessage(afterLeave, (message) => message.type === "protocol.error");
    send(afterLeave, { type: "session.resume", token: guestJoin.issued.token });
    assert.equal((await invalid).code, "resume_invalid");
    await closeAndWait(host);
    await closeAndWait(afterLeave);
    assert.equal(hostJoin.participation.role, "participant");
  });
  await Promise.all(sockets.map(closeAndWait));
});

test("display resumes with its immutable read-only role and expired danmaku stays out of the public queue", { timeout: 25_000 }, async () => {
  const sockets = [];
  await withServer({}, async (baseUrl) => {
    const display = await connect(baseUrl); sockets.push(display);
    const joined = await joinResumable(display, { roomId: "lobby", displayName: "Display", role: "display" });
    assert.equal(joined.participation.role, "display");

    const rejected = nextMessage(display, (message) => message.type === "protocol.error");
    send(display, { type: "interaction.submit", eventId: "display-resume-write", kind: "chat", text: "denied" });
    assert.equal((await rejected).code, "display_read_only");

    const publisher = await connect(baseUrl); sockets.push(publisher);
    await joinResumable(publisher, { roomId: "lobby", displayName: "Participant", mode: "interaction" });
    const ack = nextMessage(publisher, (message) => message.type === "interaction.ack");
    send(publisher, { type: "interaction.submit", eventId: "resume-public-ttl-01", kind: "danmaku", text: "short-lived" });
    await ack;
    await closeAndWait(display);
    await new Promise((resolve) => setTimeout(resolve, 8_150));

    const restored = await connect(baseUrl); sockets.push(restored);
    const recovered = await resume(restored, joined.issued.token);
    assert.equal(recovered.resumed.participantId, joined.participation.participantId);
    assert.equal(recovered.resumed.role, "display");
    assert.equal(recovered.resumed.mode, "watch");
    assert.equal(recovered.interaction.queueCount, 0);
    assert.deepEqual(recovered.interaction.publicQueue, []);
    assert.equal(recovered.participation.media.screen.subscribed, false);

    const replayed = [];
    const recordReplay = (raw, isBinary) => {
      if (isBinary) return;
      const message = JSON.parse(raw.toString());
      if (message.type === "interaction.event") replayed.push(message);
    };
    restored.on("message", recordReplay);
    await new Promise((resolve) => setTimeout(resolve, 120));
    restored.off("message", recordReplay);
    assert.equal(replayed.length, 0, "expired public interactions must not replay after resume");

    const left = nextMessage(restored, (message) => message.type === "session.left");
    send(restored, { type: "session.leave" });
    await left;
    await closeAndWait(publisher);
  });
  await Promise.all(sockets.map(closeAndWait));
});

test("removal invalidates a detached proof and a resumed host must claim again", { timeout: 20_000 }, async () => {
  const sockets = [];
  await withServer({ hostControlToken: HOST_TOKEN }, async (baseUrl) => {
    const host = await connect(baseUrl); sockets.push(host);
    const hostJoin = await joinResumable(host, { roomId: "lobby", displayName: "Host" });
    const claim = nextMessage(host, (message) => message.type === "host.claimed");
    send(host, { type: "host.claim", token: HOST_TOKEN });
    await claim;
    const hostToken = hostJoin.issued.token;
    await closeAndWait(host);

    const restoredHostSocket = await connect(baseUrl); sockets.push(restoredHostSocket);
    const restoredHost = await resume(restoredHostSocket, hostToken);
    assert.equal(restoredHost.resumed.participantId, hostJoin.participation.participantId);
    assert.equal(restoredHost.room.room.publishAllowed, false);
    const deniedHostAction = nextMessage(restoredHostSocket, (message) => message.type === "host.error");
    send(restoredHostSocket, { type: "host.endSession" });
    assert.equal((await deniedHostAction).code, "host_unauthorized");
    const reclaimed = nextMessage(restoredHostSocket, (message) => message.type === "host.claimed");
    send(restoredHostSocket, { type: "host.claim", token: HOST_TOKEN });
    assert.equal((await reclaimed).participantId, hostJoin.participation.participantId);

    const guest = await connect(baseUrl); sockets.push(guest);
    const guestJoin = await joinResumable(guest, { roomId: "lobby", displayName: "Guest" });
    const removeResult = nextMessage(restoredHostSocket, (message) => message.type === "host.actionResult" && message.action === "removeParticipant");
    send(restoredHostSocket, { type: "host.removeParticipant", participantId: guestJoin.participation.participantId });
    await removeResult;
    await closeAndWait(guest);

    const removedProof = await connect(baseUrl); sockets.push(removedProof);
    const removedError = nextMessage(removedProof, (message) => message.type === "protocol.error");
    send(removedProof, { type: "session.resume", token: guestJoin.issued.token });
    assert.equal((await removedError).code, "resume_invalid");
    await closeAndWait(restoredHostSocket);
    await closeAndWait(removedProof);
  });
  await Promise.all(sockets.map(closeAndWait));
});

test("resume rejects wrong and oversized credentials and keeps session leave within the control-frame bound", async () => {
  const sockets = [];
  await withServer({}, async (baseUrl) => {
    const unknown = await connect(baseUrl); sockets.push(unknown);
    const unknownError = nextMessage(unknown, (message) => message.type === "protocol.error");
    send(unknown, { type: "session.resume", token: "x".repeat(43) });
    assert.equal((await unknownError).code, "resume_invalid");
    await closeAndWait(unknown);

    const oversizedResume = await connect(baseUrl); sockets.push(oversizedResume);
    const oversizedResumeError = nextMessage(oversizedResume, (message) => message.type === "protocol.error");
    send(oversizedResume, { type: "session.resume", token: "x".repeat(43), password: "p".repeat(1_100) });
    assert.equal((await oversizedResumeError).code, "invalid_resume");
    await closeAndWait(oversizedResume);

    const oversizedLeave = await connect(baseUrl); sockets.push(oversizedLeave);
    const oversizedLeaveError = nextMessage(oversizedLeave, (message) => message.type === "protocol.error");
    oversizedLeave.send(`${JSON.stringify({ type: "session.leave" })}${" ".repeat(1_100)}`);
    assert.equal((await oversizedLeaveError).code, "invalid_session_leave");
    await closeAndWait(oversizedLeave);
  });
  await Promise.all(sockets.map(closeAndWait));
});
