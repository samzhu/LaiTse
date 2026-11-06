import assert from "node:assert/strict";
import { after, test } from "node:test";
import WebSocket from "ws";
import { createApp } from "../src/server/app.ts";
import { createRoomManagement } from "../src/server/room-management.ts";

const MESSAGE_TIMEOUT_MS = 5_000;
const TEST_TIMEOUT_MS = 20_000;
const sockets = [];
const apps = [];

after(async () => {
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  }
  await Promise.all(apps.map((app) => app.close()));
});

function decode(raw) {
  return JSON.parse(raw.toString());
}

function nextMessage(socket, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Expected WebSocket message did not arrive.")), MESSAGE_TIMEOUT_MS);
    const onMessage = (raw, isBinary) => {
      if (isBinary) return;
      const message = decode(raw);
      if (predicate(message)) finish(null, message);
    };
    const onError = (error) => finish(error);
    const finish = (error, value) => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      socket.off("error", onError);
      if (error) reject(error);
      else resolve(value);
    };
    socket.on("message", onMessage);
    socket.once("error", onError);
  });
}

async function connect(baseUrl) {
  const socket = new WebSocket(`${baseUrl.replace(/^http/u, "ws")}/ws`, { origin: baseUrl });
  socket.messages = [];
  socket.on("message", (raw, isBinary) => {
    if (!isBinary) socket.messages.push(decode(raw));
  });
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}

function send(socket, message) {
  socket.send(JSON.stringify(message));
}

async function join(socket, displayName, roomId, { role = "participant", password } = {}) {
  const issuedPromise = nextMessage(socket, (message) => message.type === "session.issued");
  const roomPromise = nextMessage(socket, (message) => message.type === "room.snapshot");
  const managerPromise = role === "participant"
    ? nextMessage(socket, (message) => message.type === "room.management.state")
    : Promise.resolve(null);
  send(socket, { type: "join", roomId, displayName, role, resumable: true, ...(password === undefined ? {} : { password }) });
  const [issued, room, manager] = await Promise.all([issuedPromise, roomPromise, managerPromise]);
  return { participantId: issued.participantId, token: issued.token, room, manager };
}

async function startServer(options = {}) {
  const app = await createApp({ serveClient: false, ...options });
  apps.push(app);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}

function nextRoomSnapshot(socket, roomId) {
  return nextMessage(socket, (message) => message.type === "room.snapshot" && message.room.id === roomId);
}

function nextManagerState(socket, predicate) {
  return nextMessage(socket, (message) => message.type === "room.management.state" && predicate(message));
}

test("anonymous management selects only online studio participants and changes owner on disconnect", () => {
  const manager = createRoomManagement({ randomIndex: (length) => length - 1 });
  assert.equal(manager.lockAnonymous("owner"), true);
  assert.equal(manager.lockAnonymous("second-owner"), false);
  assert.equal(manager.transfer("owner", "offline", false), false);
  assert.equal(manager.transfer("owner", "owner", true), false);
  assert.equal(manager.transfer("owner", "target", true), true);
  assert.equal(manager.canManageAnonymously("owner"), false);
  assert.equal(manager.canManageAnonymously("target"), true);

  assert.equal(manager.ownerDisconnected("owner", ["ignored"]), "unchanged");
  assert.equal(manager.ownerDisconnected("target", ["other-a", "other-b", "other-b", "target"]), "transferred");
  assert.equal(manager.snapshot(true).managerParticipantId, "other-b");
  assert.equal(manager.ownerDisconnected("other-b", []), "unlocked");
  assert.deepEqual(manager.snapshot(false), {
    roomId: "studio", locked: false, lockKind: "none", managerParticipantId: null,
  });
});

test("anonymous room manager can manage from the lobby, transfer, and hands over only when offline", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { baseUrl } = await startServer();
  const owner = await connect(baseUrl);
  const candidateA = await connect(baseUrl);
  const candidateB = await connect(baseUrl);
  const display = await connect(baseUrl);
  const visitor = await connect(baseUrl);
  const ownerJoin = await join(owner, "Same name", "lobby");
  const candidateAJoin = await join(candidateA, "Same name", "studio");
  const candidateBJoin = await join(candidateB, "Room resident", "studio");
  const displayJoin = await join(display, "Display view", "studio", { role: "display" });
  assert.ok(ownerJoin.participantId && candidateAJoin.participantId !== ownerJoin.participantId);
  assert.equal(displayJoin.manager, null, "display connections do not receive room manager controls");
  assert.deepEqual(ownerJoin.manager, {
    type: "room.management.state",
    roomId: "studio",
    isLocked: false,
    lockKind: "none",
    anonymousManagementEnabled: true,
    canLock: true,
    isOwner: false,
  });

  const locked = nextMessage(owner, (message) => message.type === "room.management.result" && message.action === "lock");
  const ownerAfterLock = nextManagerState(owner, (message) => message.isOwner && message.isLocked);
  const candidateAfterLock = nextManagerState(candidateA, (message) => message.isLocked && !message.isOwner);
  send(owner, { type: "room.management.lock", password: "anonymous-room-password" });
  assert.equal((await locked).isLocked, true);
  const [ownerManagerState, guestManagerState] = await Promise.all([ownerAfterLock, candidateAfterLock]);
  assert.equal(ownerManagerState.ownerParticipantId, ownerJoin.participantId);
  assert.deepEqual(new Set(ownerManagerState.members.map((member) => member.id)), new Set([candidateAJoin.participantId, candidateBJoin.participantId]));
  assert.equal("members" in guestManagerState, false, "ordinary participants do not receive the room roster from the management state");
  assert.equal((await (await fetch(`${baseUrl}/api/rooms`)).json()).find((room) => room.id === "studio").isLocked, true);

  const wrongPassword = nextMessage(visitor, (message) => message.type === "protocol.error");
  send(visitor, { type: "join", roomId: "studio", displayName: "Visitor", password: "wrong-password" });
  assert.equal((await wrongPassword).code, "room_password_incorrect");
  await join(visitor, "Visitor", "studio", { password: "anonymous-room-password" });
  const visitorInitiallyBack = nextRoomSnapshot(visitor, "lobby");
  send(visitor, { type: "room.switch", roomId: "lobby" });
  await visitorInitiallyBack;

  const passwordChanged = nextMessage(owner, (message) => message.type === "room.management.result" && message.action === "changePassword");
  send(owner, { type: "room.management.changePassword", password: "anonymous-room-password-2" });
  await passwordChanged;
  assert.equal(JSON.stringify(owner.messages).includes("anonymous-room-password-2"), false, "passwords are never echoed to room members");

  const visitorInStudio = nextRoomSnapshot(visitor, "studio");
  send(visitor, { type: "room.switch", roomId: "studio", password: "anonymous-room-password-2" });
  await visitorInStudio;
  const visitorBackToLobby = nextRoomSnapshot(visitor, "lobby");
  send(visitor, { type: "room.switch", roomId: "lobby" });
  await visitorBackToLobby;

  const transferredState = nextManagerState(candidateA, (message) => message.isOwner && message.ownerParticipantId === candidateAJoin.participantId);
  const transferResult = nextMessage(owner, (message) => message.type === "room.management.result" && message.action === "transfer");
  send(owner, { type: "room.management.transfer", participantId: candidateAJoin.participantId });
  await transferResult;
  const newOwnerState = await transferredState;
  assert.equal(newOwnerState.isOwner, true);

  const oldOwnerDenied = nextMessage(owner, (message) => message.type === "room.management.error");
  send(owner, { type: "room.management.unlock" });
  assert.equal((await oldOwnerDenied).code, "room_management_unauthorized");
  const forgedOwnerDenied = nextMessage(owner, (message) => message.type === "room.management.error");
  send(owner, { type: "room.management.unlock", actorParticipantId: candidateAJoin.participantId });
  assert.equal((await forgedOwnerDenied).code, "invalid_room_management");

  const ownerOffline = new Promise((resolve) => owner.once("close", resolve));
  owner.close();
  await ownerOffline;
  const oldOwnerReconnected = await connect(baseUrl);
  const oldResume = nextMessage(oldOwnerReconnected, (message) => message.type === "session.resumed");
  const oldManagerState = nextManagerState(oldOwnerReconnected, (message) => !message.isOwner && message.isLocked);
  send(oldOwnerReconnected, { type: "session.resume", token: ownerJoin.token });
  await oldResume;
  assert.equal((await oldManagerState).isOwner, false, "a former owner keeps no rights when reconnecting under the same participant ID");

  const candidateBState = nextManagerState(candidateB, (message) => message.isOwner && message.ownerParticipantId === candidateBJoin.participantId);
  const candidateAOffline = new Promise((resolve) => candidateA.once("close", resolve));
  candidateA.close();
  await candidateAOffline;
  assert.equal((await candidateBState).isOwner, true, "the remaining online participant receives ownership");

  const candidateBBack = nextRoomSnapshot(candidateB, "lobby");
  const ownerWithEmptyStudio = nextManagerState(candidateB, (message) => message.isOwner && message.members.length === 0);
  send(candidateB, { type: "room.switch", roomId: "lobby" });
  await candidateBBack;
  assert.equal((await ownerWithEmptyStudio).isOwner, true);
  assert.equal((await (await fetch(`${baseUrl}/api/rooms`)).json()).find((room) => room.id === "studio").isLocked, true,
    "leaving the managed room does not transfer ownership or unlock it");

  const unlocked = nextManagerState(oldOwnerReconnected, (message) => !message.isLocked && message.lockKind === "none");
  const candidateBOffline = new Promise((resolve) => candidateB.once("close", resolve));
  candidateB.close();
  await candidateBOffline;
  assert.equal((await unlocked).canLock, true, "an empty studio unlocks only after its manager disconnects");
  const unlockedRooms = await (await fetch(`${baseUrl}/api/rooms`)).json();
  assert.equal(unlockedRooms.find((room) => room.id === "studio").isLocked, false);
});

test("legacy HOST_CONTROL_TOKEN mode keeps its lock path and denies anonymous lock messages", { timeout: TEST_TIMEOUT_MS }, async () => {
  const hostToken = "room-management-legacy-host-token-32-bytes";
  const { baseUrl } = await startServer({ hostControlToken: hostToken });
  const guest = await connect(baseUrl);
  const guestJoin = await join(guest, "Legacy guest", "lobby");
  assert.equal(guestJoin.manager.anonymousManagementEnabled, false);
  assert.equal(guestJoin.manager.canLock, false);
  const anonymousDenied = nextMessage(guest, (message) => message.type === "room.management.error");
  send(guest, { type: "room.management.lock", password: "anonymous-room-password" });
  assert.equal((await anonymousDenied).code, "anonymous_management_disabled");

  const toStudio = nextRoomSnapshot(guest, "studio");
  send(guest, { type: "room.switch", roomId: "studio" });
  await toStudio;
  const claimed = nextMessage(guest, (message) => message.type === "host.claimed");
  send(guest, { type: "host.claim", token: hostToken });
  await claimed;
  const legacyLock = nextMessage(guest, (message) => message.type === "host.actionResult" && message.action === "setMeetingRoomPassword");
  const legacyState = nextManagerState(guest, (message) => message.isLocked && message.lockKind === "legacy");
  send(guest, { type: "host.setMeetingRoomPassword", password: "legacy-room-password" });
  await legacyLock;
  assert.equal((await legacyState).isOwner, false);
});
