import assert from "node:assert/strict";
import { after, test } from "node:test";
import WebSocket from "ws";
import { createApp } from "../src/server/app.ts";

const MESSAGE_TIMEOUT_MS = 5_000;
const TEST_TIMEOUT_MS = 25_000;
const HOST_TOKEN = "host-control-integration-token-32-bytes-minimum";
const STARTUP_ROOM_PASSWORD = "startup-room-password-for-host-tests";
const LIVE_ROOM_PASSWORD = "live-room-password-for-host-tests";
const apps = [];
const sockets = [];

after(async () => {
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  }
  await Promise.all(apps.map((app) => app.close()));
});

async function startServer(options = {}) {
  const app = await createApp({ serveClient: false, ...options });
  await app.listen({ host: "127.0.0.1", port: 0 });
  apps.push(app);
  const address = app.server.address();
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function connect(baseUrl) {
  const socket = new WebSocket(`${baseUrl.replace(/^http/u, "ws")}/ws`, { origin: baseUrl });
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`WebSocket did not open within ${MESSAGE_TIMEOUT_MS} ms.`)), MESSAGE_TIMEOUT_MS);
    socket.once("open", () => { clearTimeout(timeout); resolve(); });
    socket.once("error", (error) => { clearTimeout(timeout); reject(error); });
  });
  return socket;
}

function decode(raw) { return JSON.parse(raw.toString()); }

function nextJson(socket, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      socket.off("error", onError);
      reject(new Error(`Expected WebSocket message did not arrive within ${MESSAGE_TIMEOUT_MS} ms.`));
    }, MESSAGE_TIMEOUT_MS);
    const onError = (error) => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      reject(error);
    };
    const onMessage = (raw, isBinary) => {
      if (isBinary) return;
      const message = decode(raw);
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("error", onError);
      resolve(message);
    };
    socket.on("message", onMessage);
    socket.once("error", onError);
  });
}

function nextBinary(socket, magic) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      socket.off("error", onError);
      reject(new Error(`Expected ${magic} binary frame did not arrive within ${MESSAGE_TIMEOUT_MS} ms.`));
    }, MESSAGE_TIMEOUT_MS);
    const onError = (error) => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      reject(error);
    };
    const onMessage = (raw, isBinary) => {
      if (!isBinary || raw.toString("ascii", 0, 4) !== magic) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("error", onError);
      resolve(Buffer.from(raw));
    };
    socket.on("message", onMessage);
    socket.once("error", onError);
  });
}

function send(socket, message) { socket.send(JSON.stringify(message)); }

async function join(socket, displayName, roomId, password) {
  const room = nextJson(socket, (message) => message.type === "room.snapshot" && message.room.id === roomId);
  const space = nextJson(socket, (message) => message.type === "space.snapshot" && message.currentRoomId === roomId);
  send(socket, { type: "join", roomId, displayName, ...(password === undefined ? {} : { password }) });
  return { room: await room, space: await space };
}

async function claimHost(socket, token = HOST_TOKEN) {
  const result = nextJson(socket, (message) => message.type === "host.claimed" || message.type === "host.error");
  send(socket, { type: "host.claim", token });
  return result;
}

function makeAudioFrame(generation, sequence) {
  const frame = Buffer.alloc(27);
  frame.write("LTA1", 0, "ascii");
  frame.writeUInt32BE(generation, 4);
  frame.writeUInt32BE(sequence, 8);
  frame.writeDoubleBE(sequence * 20_000, 12);
  frame.writeUInt32BE(20_000, 20);
  Buffer.from([0xf8, 0xff, 0xfe]).copy(frame, 24);
  return frame;
}

function makeScreenFrame(generation, sequence) {
  const frame = Buffer.alloc(25);
  frame.write("LTS1", 0, "ascii");
  frame.writeUInt32BE(generation, 4);
  frame.writeUInt32BE(sequence, 8);
  frame.writeDoubleBE(sequence * 66_667, 12);
  frame[20] = 0;
  frame[24] = 0;
  return frame;
}

async function assertNoBinary(socket, durationMs = 120) {
  const binary = [];
  const onMessage = (_raw, isBinary) => { if (isBinary) binary.push(true); };
  socket.on("message", onMessage);
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  socket.off("message", onMessage);
  assert.deepEqual(binary, []);
}

test("managed host claims are separate from room passwords; revoke stops both relays and blocks later frames", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { baseUrl } = await startServer({ hostControlToken: HOST_TOKEN, meetingRoomPassword: STARTUP_ROOM_PASSWORD });
  const host = await connect(baseUrl);
  const guest = await connect(baseUrl);
  const cohost = await connect(baseUrl);
  const visitor = await connect(baseUrl);
  const hostJoin = await join(host, "Host", "studio", STARTUP_ROOM_PASSWORD);
  const guestJoin = await join(guest, "Guest", "studio", STARTUP_ROOM_PASSWORD);
  const cohostJoin = await join(cohost, "Other host", "studio", STARTUP_ROOM_PASSWORD);
  const visitorJoin = await join(visitor, "Lobby visitor", "lobby");
  assert.equal(hostJoin.room.room.hostControlsEnabled, true);
  assert.equal(guestJoin.room.room.publishAllowed, false);

  const wrongClaim = await claimHost(host, STARTUP_ROOM_PASSWORD);
  assert.equal(wrongClaim.type, "host.error");
  assert.equal(wrongClaim.code, "host_token_invalid");
  assert.equal(JSON.stringify(wrongClaim).includes(STARTUP_ROOM_PASSWORD), false);
  assert.deepEqual(await claimHost(host), {
    type: "host.claimed",
    roomId: "studio",
    participantId: hostJoin.space.participantId,
    publisherGrants: [],
  });
  assert.equal((await claimHost(cohost)).type, "host.claimed");
  const credentialReuse = nextJson(host, (message) => message.type === "host.error");
  send(host, { type: "host.setMeetingRoomPassword", password: HOST_TOKEN });
  const credentialReuseError = await credentialReuse;
  assert.equal(credentialReuseError.code, "invalid_room_password");
  assert.equal(JSON.stringify(credentialReuseError).includes(HOST_TOKEN), false);

  const unauthorizedOperations = [
    { type: "host.grantPublisher", participantId: guestJoin.space.participantId },
    { type: "host.revokePublisher", participantId: guestJoin.space.participantId },
    { type: "host.removeParticipant", participantId: guestJoin.space.participantId },
    { type: "host.setMeetingRoomPassword", password: LIVE_ROOM_PASSWORD },
    { type: "host.endSession" },
  ];
  for (const operation of unauthorizedOperations) {
    const response = nextJson(guest, (message) => message.type === "host.error");
    send(guest, operation);
    assert.equal((await response).code, "host_unauthorized", operation.type);
  }
  const hostTargetError = nextJson(host, (message) => message.type === "host.error");
  send(host, { type: "host.revokePublisher", participantId: cohostJoin.space.participantId });
  assert.equal((await hostTargetError).code, "host_target_is_host");
  const crossRoomError = nextJson(host, (message) => message.type === "host.error");
  send(host, { type: "host.grantPublisher", participantId: visitorJoin.space.participantId });
  assert.equal((await crossRoomError).code, "host_target_not_in_room");

  const guestAudioDenied = nextJson(guest, (message) => message.type === "audio.error");
  send(guest, { type: "audio.start", codec: "opus", sampleRate: 48_000, channels: 1, bitrate: 32_000, frameDurationUs: 20_000 });
  assert.equal((await guestAudioDenied).code, "publish_not_authorized");
  const guestScreenDenied = nextJson(guest, (message) => message.type === "screen.error");
  send(guest, { type: "screen.start", codec: "vp8", width: 320, height: 180, frameRate: 15, bitrate: 800_000 });
  assert.equal((await guestScreenDenied).code, "publish_not_authorized");

  const hostAudioSubscribed = nextJson(host, (message) => message.type === "audio.subscribed");
  const hostScreenSubscribed = nextJson(host, (message) => message.type === "screen.subscribed");
  send(host, { type: "audio.subscribe" });
  send(host, { type: "screen.subscribe" });
  await Promise.all([hostAudioSubscribed, hostScreenSubscribed]);

  const grantResult = nextJson(host, (message) => message.type === "host.actionResult" && message.action === "grantPublisher");
  const permission = nextJson(guest, (message) => message.type === "host.publishPermission" && message.allowed === true);
  send(host, { type: "host.grantPublisher", participantId: guestJoin.space.participantId });
  assert.equal((await grantResult).allowed, true);
  await permission;

  const audioStarted = nextJson(guest, (message) => message.type === "audio.started");
  const screenStarted = nextJson(guest, (message) => message.type === "screen.started");
  const audioStream = nextJson(host, (message) => message.type === "audio.stream");
  const screenStream = nextJson(host, (message) => message.type === "screen.stream");
  send(guest, { type: "audio.start", codec: "opus", sampleRate: 48_000, channels: 1, bitrate: 32_000, frameDurationUs: 20_000 });
  send(guest, { type: "screen.start", codec: "vp8", width: 320, height: 180, frameRate: 15, bitrate: 800_000 });
  const [audioAck, screenAck] = await Promise.all([audioStarted, screenStarted]);
  assert.equal((await audioStream).generation, audioAck.generation);
  assert.equal((await screenStream).generation, screenAck.generation);

  const hostAudioFrame = nextBinary(host, "LTA1");
  const hostScreenFrame = nextBinary(host, "LTS1");
  guest.send(makeAudioFrame(audioAck.generation, 0));
  guest.send(makeScreenFrame(screenAck.generation, 0));
  await Promise.all([hostAudioFrame, hostScreenFrame]);

  const revokeResult = nextJson(host, (message) => message.type === "host.actionResult" && message.action === "revokePublisher");
  const audioRevoked = nextJson(guest, (message) => message.type === "audio.publishRevoked");
  const screenRevoked = nextJson(guest, (message) => message.type === "screen.publishRevoked");
  const hostRevoked = nextJson(guest, (message) => message.type === "host.publishRevoked");
  const audioEnded = nextJson(host, (message) => message.type === "audio.streamEnded");
  const screenEnded = nextJson(host, (message) => message.type === "screen.streamEnded");
  const permissionRevoked = nextJson(guest, (message) => message.type === "host.publishPermission" && message.allowed === false);
  send(host, { type: "host.revokePublisher", participantId: guestJoin.space.participantId });
  assert.equal((await revokeResult).allowed, false);
  await Promise.all([audioRevoked, screenRevoked, hostRevoked, audioEnded, screenEnded, permissionRevoked]);

  const postRevokeAudioDenied = nextJson(guest, (message) => message.type === "audio.error" && message.code === "publish_not_authorized");
  const postRevokeScreenDenied = nextJson(guest, (message) => message.type === "screen.error" && message.code === "publish_not_authorized");
  send(guest, { type: "audio.start", codec: "opus", sampleRate: 48_000, channels: 1, bitrate: 32_000, frameDurationUs: 20_000 });
  send(guest, { type: "screen.start", codec: "vp8", width: 320, height: 180, frameRate: 15, bitrate: 800_000 });
  assert.equal((await postRevokeAudioDenied).code, "publish_not_authorized");
  assert.equal((await postRevokeScreenDenied).code, "publish_not_authorized");
  const deniedFrames = nextJson(guest, (message) => message.type === "host.publishDenied");
  guest.send(makeAudioFrame(audioAck.generation, 1));
  assert.equal((await deniedFrames).type, "host.publishDenied");
  guest.send(makeScreenFrame(screenAck.generation, 1));
  await nextJson(guest, (message) => message.type === "host.publishDenied");
  await assertNoBinary(host);

  const lockResult = nextJson(host, (message) => message.type === "host.actionResult" && message.action === "setMeetingRoomPassword");
  const visitorCatalogue = nextJson(visitor, (message) => message.type === "room.catalogue");
  send(host, { type: "host.setMeetingRoomPassword", password: LIVE_ROOM_PASSWORD });
  assert.equal((await lockResult).isLocked, true);
  assert.equal((await visitorCatalogue).rooms.find((room) => room.id === "studio").isLocked, true);
  assert.equal((await (await fetch(`${baseUrl}/api/rooms`)).json()).find((room) => room.id === "studio").isLocked, true);
  assert.equal(host.readyState, WebSocket.OPEN);
  assert.equal(guest.readyState, WebSocket.OPEN, "live locking keeps existing members in the room");

  const deniedEntry = nextJson(visitor, (message) => message.type === "protocol.error" && message.code === "room_password_required");
  send(visitor, { type: "room.switch", roomId: "studio" });
  assert.equal((await deniedEntry).code, "room_password_required");
  const wrongEntry = nextJson(visitor, (message) => message.type === "protocol.error" && message.code === "room_password_incorrect");
  send(visitor, { type: "room.switch", roomId: "studio", password: STARTUP_ROOM_PASSWORD });
  assert.equal((await wrongEntry).code, "room_password_incorrect");
  const correctRoom = nextJson(visitor, (message) => message.type === "room.snapshot" && message.room.id === "studio");
  const correctSpace = nextJson(visitor, (message) => message.type === "space.snapshot" && message.currentRoomId === "studio");
  send(visitor, { type: "room.switch", roomId: "studio", password: LIVE_ROOM_PASSWORD });
  assert.equal((await correctRoom).room.isLocked, true);
  await correctSpace;

  const unlockResult = nextJson(host, (message) => message.type === "host.actionResult" && message.action === "unlockMeetingRoom");
  send(host, { type: "host.unlockMeetingRoom" });
  assert.equal((await unlockResult).isLocked, false);
  const visitorLobby = nextJson(visitor, (message) => message.type === "room.snapshot" && message.room.id === "lobby");
  send(visitor, { type: "room.switch", roomId: "lobby" });
  await visitorLobby;
  const grantGuestAgain = nextJson(host, (message) => message.type === "host.actionResult" && message.action === "grantPublisher");
  send(host, { type: "host.grantPublisher", participantId: guestJoin.space.participantId });
  await grantGuestAgain;
  const guestLobby = nextJson(guest, (message) => message.type === "room.snapshot" && message.room.id === "lobby");
  const hostLeftEvent = nextJson(host, (message) => message.type === "control.event" && message.event.kind === "member.left" && message.event.participantId === guestJoin.space.participantId);
  send(guest, { type: "room.switch", roomId: "lobby" });
  await Promise.all([guestLobby, hostLeftEvent]);
  const guestBack = nextJson(guest, (message) => message.type === "room.snapshot" && message.room.id === "studio");
  send(guest, { type: "room.switch", roomId: "studio" });
  const staleGrantSnapshot = await guestBack;
  assert.equal(staleGrantSnapshot.room.publishAllowed, false);
  const staleGrantDenied = nextJson(guest, (message) => message.type === "audio.error" && message.code === "publish_not_authorized");
  send(guest, { type: "audio.start", codec: "opus", sampleRate: 48_000, channels: 1, bitrate: 32_000, frameDurationUs: 20_000 });
  await staleGrantDenied;

  const endGrant = nextJson(host, (message) => message.type === "host.actionResult" && message.action === "grantPublisher");
  const guestGranted = nextJson(guest, (message) => message.type === "host.publishPermission" && message.allowed === true);
  send(host, { type: "host.grantPublisher", participantId: guestJoin.space.participantId });
  await Promise.all([endGrant, guestGranted]);
  const endStarted = nextJson(guest, (message) => message.type === "audio.started");
  const endScreenStarted = nextJson(guest, (message) => message.type === "screen.started");
  send(guest, { type: "audio.start", codec: "opus", sampleRate: 48_000, channels: 1, bitrate: 32_000, frameDurationUs: 20_000 });
  send(guest, { type: "screen.start", codec: "vp8", width: 320, height: 180, frameRate: 15, bitrate: 800_000 });
  const endAudio = await endStarted;
  await endScreenStarted;
  const sessionEndedForGuest = nextJson(guest, (message) => message.type === "host.sessionEnded");
  const endResult = nextJson(host, (message) => message.type === "host.actionResult" && message.action === "endSession");
  const endedAudioPublisher = nextJson(guest, (message) => message.type === "audio.publishRevoked");
  const endedScreenPublisher = nextJson(guest, (message) => message.type === "screen.publishRevoked");
  const noGuestPermission = nextJson(guest, (message) => message.type === "host.publishPermission" && message.allowed === false);
  send(host, { type: "host.endSession" });
  assert.equal((await endResult).membersRetained, true);
  await Promise.all([sessionEndedForGuest, endedAudioPublisher, endedScreenPublisher, noGuestPermission]);
  const endedStartDenied = nextJson(guest, (message) => message.type === "audio.error" && message.code === "publish_not_authorized");
  send(guest, { type: "audio.start", codec: "opus", sampleRate: 48_000, channels: 1, bitrate: 32_000, frameDurationUs: 20_000 });
  await endedStartDenied;
  const retainedMemberEvent = nextJson(guest, (message) => message.type === "control.event" && message.event.kind === "reaction");
  send(host, { type: "reaction", reaction: "wave" });
  await retainedMemberEvent;
  assert.equal(host.readyState, WebSocket.OPEN);
  assert.equal(guest.readyState, WebSocket.OPEN);
  assert.ok(endAudio.generation > 0);
  assert.equal((await (await fetch(`${baseUrl}/api/rooms`)).json()).find((room) => room.id === "studio").isLocked, false);

  const removeResult = nextJson(host, (message) => message.type === "host.actionResult" && message.action === "removeParticipant");
  const removedMemberEvent = nextJson(host, (message) => message.type === "control.event" && message.event.kind === "member.left" && message.event.participantId === guestJoin.space.participantId);
  const closeCode = new Promise((resolve) => guest.once("close", (code) => resolve(code)));
  send(host, { type: "host.removeParticipant", participantId: guestJoin.space.participantId });
  await removeResult;
  await removedMemberEvent;
  assert.equal(await closeCode, 4001);

  const replacement = await connect(baseUrl);
  const replacementJoin = await join(replacement, "Guest", "studio");
  assert.notEqual(replacementJoin.space.participantId, guestJoin.space.participantId);
  assert.equal(replacementJoin.room.room.publishAllowed, false);

  // A host claim belongs to the current room connection, and does not survive a round trip.
  for (const roomId of ["lobby", "studio"]) {
    const switched = nextJson(host, (message) => message.type === "room.snapshot" && message.room.id === roomId);
    send(host, { type: "room.switch", roomId });
    assert.equal((await switched).room.publishAllowed, false);
    const staleHostControl = nextJson(host, (message) => message.type === "host.error");
    send(host, { type: "host.endSession" });
    assert.equal((await staleHostControl).code, "host_unauthorized");
  }
  assert.equal((await claimHost(host)).type, "host.claimed");
});

test("host token startup bounds are enforced without copying the configured value to errors", { timeout: TEST_TIMEOUT_MS }, async () => {
  await assert.rejects(() => createApp({ serveClient: false, hostControlToken: "short" }), /HOST_CONTROL_TOKEN must be/u);
  await assert.rejects(() => createApp({ serveClient: false, hostControlToken: HOST_TOKEN, meetingRoomPassword: HOST_TOKEN }), /must be different/u);
  const legacy = await startServer();
  const rooms = await (await fetch(`${legacy.baseUrl}/api/rooms`)).json();
  assert.equal(rooms.every((room) => room.hostControlsEnabled === false), true);
  const participant = await connect(legacy.baseUrl);
  const joined = await join(participant, "Legacy", "lobby");
  assert.equal(joined.room.room.hostControlsEnabled, false);
  assert.equal(joined.room.room.publishAllowed, true);
});

test("host claims have a per-connection rolling attempt limit", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { baseUrl } = await startServer({ hostControlToken: HOST_TOKEN });
  const participant = await connect(baseUrl);
  await join(participant, "Claim tester", "lobby");

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = nextJson(participant, (message) => message.type === "host.error");
    send(participant, { type: "host.claim", token: `incorrect-token-${attempt}` });
    assert.equal((await response).code, "host_token_invalid");
  }

  const limited = nextJson(participant, (message) => message.type === "host.error");
  send(participant, { type: "host.claim", token: HOST_TOKEN });
  assert.equal((await limited).code, "host_claim_rate_limited");
});
