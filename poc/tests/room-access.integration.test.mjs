import assert from "node:assert/strict";
import { after, test } from "node:test";
import WebSocket from "ws";
import { createApp } from "../src/server/app.ts";

const MESSAGE_TIMEOUT_MS = 5_000;
const TEST_TIMEOUT_MS = 15_000;
const ROOM_PASSWORD = "room-access-poc-credential";
const sockets = [];
const apps = [];

after(async () => {
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  }
  await Promise.all(apps.map((app) => app.close()));
});

async function startServer(meetingRoomPassword) {
  const app = await createApp({ serveClient: false, meetingRoomPassword });
  await app.listen({ host: "127.0.0.1", port: 0 });
  apps.push(app);
  const address = app.server.address();
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}

function decode(raw) {
  return JSON.parse(raw.toString());
}

async function connect(baseUrl) {
  const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/ws`, { origin: baseUrl });
  socket.trace = [];
  socket.on("message", (raw, isBinary) => {
    socket.trace.push(isBinary ? { type: "binary", bytes: raw.byteLength } : decode(raw));
  });
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error(`WebSocket did not open within ${MESSAGE_TIMEOUT_MS} ms.`));
    }, MESSAGE_TIMEOUT_MS);
    socket.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return socket;
}

function nextJson(socket, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      socket.off("error", onError);
      reject(new Error(`Expected WebSocket message did not arrive within ${MESSAGE_TIMEOUT_MS} ms.`));
    }, MESSAGE_TIMEOUT_MS);
    const onError = (error) => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      reject(error);
    };
    const onMessage = (raw, isBinary) => {
      if (isBinary) return;
      const message = decode(raw);
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

function send(socket, value) {
  socket.send(JSON.stringify(value));
}

async function join(socket, displayName, roomId, password) {
  const roomMessage = nextJson(socket, (message) => message.type === "room.snapshot");
  const spaceMessage = nextJson(socket, (message) => message.type === "space.snapshot");
  send(socket, { type: "join", roomId, displayName, ...(password === undefined ? {} : { password }) });
  return { room: await roomMessage, space: await spaceMessage };
}

function makeAudioFrame(sequence, payload = Buffer.from([0xf8, 0xff, 0xfe])) {
  const frame = Buffer.alloc(24 + payload.byteLength);
  frame.write("LTA1", 0, "ascii");
  frame.writeUInt32BE(1, 4);
  frame.writeUInt32BE(sequence, 8);
  frame.writeDoubleBE(sequence * 20_000, 12);
  frame.writeUInt32BE(20_000, 20);
  payload.copy(frame, 24);
  return frame;
}

function makeScreenFrame() {
  const frame = Buffer.alloc(25);
  frame.write("LTS1", 0, "ascii");
  frame.writeUInt32BE(1, 4);
  frame.writeUInt32BE(0, 8);
  frame.writeDoubleBE(1_000, 12);
  frame[20] = 0;
  frame[24] = 0;
  return frame;
}

async function startAudioPublisher(socket) {
  const started = nextJson(socket, (message) => message.type === "audio.started");
  send(socket, {
    type: "audio.start",
    codec: "opus",
    sampleRate: 48_000,
    channels: 1,
    bitrate: 32_000,
    frameDurationUs: 20_000,
  });
  return await started;
}

async function subscribeAudio(socket) {
  const subscribed = nextJson(socket, (message) => message.type === "audio.subscribed");
  send(socket, { type: "audio.subscribe" });
  await subscribed;
}

function nextBinary(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      socket.off("error", onError);
      reject(new Error(`Expected binary packet did not arrive within ${MESSAGE_TIMEOUT_MS} ms.`));
    }, MESSAGE_TIMEOUT_MS);
    const onError = (error) => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      reject(error);
    };
    const onMessage = (raw, isBinary) => {
      if (!isBinary) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      socket.off("error", onError);
      resolve(Buffer.from(raw));
    };
    socket.on("message", onMessage);
    socket.once("error", onError);
  });
}

async function noEntryLeak(socket, from = 0) {
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.deepEqual(
    socket.trace.slice(from).filter((message) => ["room.snapshot", "space.snapshot", "control.event"].includes(message.type)),
    [],
    "a denied entry must not create a member, snapshot, or event",
  );
}

async function noBinary(socket) {
  let count = 0;
  const onMessage = (_raw, isBinary) => { if (isBinary) count += 1; };
  socket.on("message", onMessage);
  await new Promise((resolve) => setTimeout(resolve, 90));
  socket.off("message", onMessage);
  assert.equal(count, 0, "the rejected connection must receive no room media bytes");
}

test("room door policy shares one locked server gate for join, switch, and room media", { timeout: TEST_TIMEOUT_MS }, async () => {
  const unlocked = await startServer("");
  const unlockedRooms = await (await fetch(`${unlocked.baseUrl}/api/rooms`)).json();
  assert.deepEqual(unlockedRooms.map(({ id, isLocked }) => ({ id, isLocked })), [
    { id: "lobby", isLocked: false },
    { id: "studio", isLocked: false },
  ]);
  const directOpen = await connect(unlocked.baseUrl);
  const openJoin = await join(directOpen, "Open visitor", "studio");
  assert.equal(openJoin.room.room.isLocked, false);
  assert.equal(openJoin.space.rooms.find((room) => room.id === "studio").isLocked, false);
  const openSwitchRoom = nextJson(directOpen, (message) => message.type === "room.snapshot");
  const openSwitchSpace = nextJson(directOpen, (message) => message.type === "space.snapshot");
  send(directOpen, { type: "room.switch", roomId: "lobby" });
  assert.equal((await openSwitchRoom).room.id, "lobby");
  assert.equal((await openSwitchSpace).currentRoomId, "lobby");

  const locked = await startServer(ROOM_PASSWORD);
  const roomCatalogue = await (await fetch(`${locked.baseUrl}/api/rooms`)).json();
  assert.deepEqual(roomCatalogue.map(({ id, isLocked }) => ({ id, isLocked })), [
    { id: "lobby", isLocked: false },
    { id: "studio", isLocked: true },
  ]);
  assert.equal(JSON.stringify(roomCatalogue).includes(ROOM_PASSWORD), false, "room catalogue must not include the configured password");
  assert.doesNotMatch(JSON.stringify(roomCatalogue), /verifier|salt|scrypt/iu);

  const deniedJoiner = await connect(locked.baseUrl);
  const missingJoin = nextJson(deniedJoiner, (message) => message.type === "protocol.error");
  send(deniedJoiner, { type: "join", roomId: "studio", displayName: "Door visitor" });
  assert.equal((await missingJoin).code, "room_password_required");
  assert.equal(deniedJoiner.readyState, WebSocket.OPEN, "a missing password keeps the same socket available for retry");
  await noEntryLeak(deniedJoiner);

  const wrongJoin = nextJson(deniedJoiner, (message) => message.type === "protocol.error");
  send(deniedJoiner, { type: "join", roomId: "studio", displayName: "Door visitor", password: "wrong" });
  const wrongJoinError = await wrongJoin;
  assert.equal(wrongJoinError.code, "room_password_incorrect");
  assert.equal(JSON.stringify(wrongJoinError).includes(ROOM_PASSWORD), false, "password errors must not echo credentials");
  assert.equal(deniedJoiner.readyState, WebSocket.OPEN);
  await noEntryLeak(deniedJoiner);

  const rateLimitedSocket = await connect(locked.baseUrl);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const required = nextJson(rateLimitedSocket, (message) => message.type === "protocol.error");
    send(rateLimitedSocket, { type: "join", roomId: "studio", displayName: "Rate limited" });
    assert.equal((await required).code, "room_password_required");
  }
  const rateLimited = nextJson(rateLimitedSocket, (message) => message.type === "protocol.error");
  send(rateLimitedSocket, { type: "join", roomId: "studio", displayName: "Rate limited" });
  assert.equal((await rateLimited).code, "room_password_rate_limited");
  await noEntryLeak(rateLimitedSocket);

  const mediaNotJoined = nextJson(deniedJoiner, (message) => message.type === "protocol.error");
  deniedJoiner.send(makeAudioFrame(0));
  assert.equal((await mediaNotJoined).code, "media_not_joined");
  const screenNotJoined = nextJson(deniedJoiner, (message) => message.type === "protocol.error");
  deniedJoiner.send(makeScreenFrame());
  assert.equal((await screenNotJoined).code, "media_not_joined");
  await noEntryLeak(deniedJoiner);

  const publisher = await connect(locked.baseUrl);
  const resident = await connect(locked.baseUrl);
  await join(publisher, "Lobby speaker", "lobby");
  const residentLobby = await join(resident, "Lobby listener", "lobby");
  assert.equal(residentLobby.space.rooms.find((room) => room.id === "studio").isLocked, true);
  await subscribeAudio(resident);
  await startAudioPublisher(publisher);

  let residentTraceStart = resident.trace.length;
  const missingSwitch = nextJson(resident, (message) => message.type === "protocol.error");
  send(resident, { type: "room.switch", roomId: "studio" });
  assert.equal((await missingSwitch).code, "room_password_required");
  await noEntryLeak(resident, residentTraceStart);
  residentTraceStart = resident.trace.length;
  const wrongSwitch = nextJson(resident, (message) => message.type === "protocol.error");
  send(resident, { type: "room.switch", roomId: "studio", password: "wrong" });
  assert.equal((await wrongSwitch).code, "room_password_incorrect");
  await noEntryLeak(resident, residentTraceStart);
  const lobbyAudioAfterDenial = nextBinary(resident);
  publisher.send(makeAudioFrame(1));
  assert.deepEqual(await lobbyAudioAfterDenial, makeAudioFrame(1), "denied entry leaves the lobby subscription active");

  const authorizedRoom = nextJson(deniedJoiner, (message) => message.type === "room.snapshot");
  const authorizedSpace = nextJson(deniedJoiner, (message) => message.type === "space.snapshot");
  send(deniedJoiner, { type: "join", roomId: "studio", displayName: "Door visitor", password: ROOM_PASSWORD });
  const [meetingJoin, meetingJoinSpace] = await Promise.all([authorizedRoom, authorizedSpace]);
  assert.equal(meetingJoin.room.isLocked, true);
  assert.equal(meetingJoinSpace.currentRoomId, "studio");
  assert.deepEqual(meetingJoin.members.map((member) => member.displayName), ["Door visitor"]);

  const admittedSwitchRoom = nextJson(resident, (message) => message.type === "room.snapshot");
  const admittedSwitchSpace = nextJson(resident, (message) => message.type === "space.snapshot" && message.currentRoomId === "studio");
  send(resident, { type: "room.switch", roomId: "studio", password: ROOM_PASSWORD });
  const [switched, switchedSpace] = await Promise.all([admittedSwitchRoom, admittedSwitchSpace]);
  assert.equal(switched.room.isLocked, true);
  assert.equal(switchedSpace.currentRoomId, "studio");
  assert.deepEqual(switchedSpace.rooms.find((room) => room.id === "studio").players.map((player) => player.displayName), ["Lobby listener", "Door visitor"]);

  await subscribeAudio(resident);
  const stream = nextJson(resident, (message) => message.type === "audio.stream");
  await startAudioPublisher(deniedJoiner);
  const admittedStream = await stream;
  assert.equal(admittedStream.type, "audio.stream");
  assert.equal(admittedStream.config.codec, "opus");
  const meetingAudio = nextBinary(resident);
  deniedJoiner.send(makeAudioFrame(0, Buffer.from([0xf8, 0x61, 0x62])));
  assert.deepEqual(await meetingAudio, makeAudioFrame(0, Buffer.from([0xf8, 0x61, 0x62])));

  const forgedJoin = await connect(locked.baseUrl);
  const forgedJoinError = nextJson(forgedJoin, (message) => message.type === "protocol.error");
  const forgedJoinClose = new Promise((resolve) => forgedJoin.once("close", resolve));
  send(forgedJoin, {
    type: "join",
    roomId: "studio",
    displayName: "Forged visitor",
    password: ROOM_PASSWORD,
    isLocked: false,
    role: "host",
    participantId: "forged-id",
  });
  assert.equal((await forgedJoinError).code, "invalid_join");
  await forgedJoinClose;
  await noBinary(forgedJoin);

  const forgedSwitcher = await connect(locked.baseUrl);
  await join(forgedSwitcher, "Forged switcher", "lobby");
  const forgedSwitchStart = forgedSwitcher.trace.length;
  const forgedSwitchError = nextJson(forgedSwitcher, (message) => message.type === "protocol.error");
  const forgedSwitchClose = new Promise((resolve) => forgedSwitcher.once("close", resolve));
  send(forgedSwitcher, { type: "room.switch", roomId: "studio", password: ROOM_PASSWORD, isLocked: false, role: "host" });
  assert.equal((await forgedSwitchError).code, "invalid_room_switch");
  await forgedSwitchClose;
  assert.equal(
    forgedSwitcher.trace.slice(forgedSwitchStart).some((message) => message.type === "control.event" && message.event?.roomId === "studio"),
    false,
    "forged room and role fields must not create a meeting-room event",
  );

  const diagnostics = await (await fetch(`${locked.baseUrl}/api/media-diagnostics`)).json();
  const publicState = JSON.stringify({ roomCatalogue, meetingJoin, meetingJoinSpace, switched, switchedSpace, diagnostics });
  assert.equal(publicState.includes(ROOM_PASSWORD), false, "public room state and diagnostics must not include the password");
  assert.doesNotMatch(publicState, /verifier|scrypt|salt/iu);
});
