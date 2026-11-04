import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import WebSocket from "ws";
import { createApp } from "../src/server/app.ts";

let app;
let baseUrl;
const MESSAGE_TIMEOUT_MS = 5_000;
const TEST_TIMEOUT_MS = 15_000;

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
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error(`WebSocket did not open within ${MESSAGE_TIMEOUT_MS} ms.`));
    }, MESSAGE_TIMEOUT_MS);
    socket.once("open", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function decode(raw) {
  return JSON.parse(raw.toString());
}

function nextMessage(socket, predicate = () => true) {
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

function waitForClose(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("close", onClose);
      reject(new Error(`WebSocket did not close within ${MESSAGE_TIMEOUT_MS} ms.`));
    }, MESSAGE_TIMEOUT_MS);
    const onClose = (code) => {
      clearTimeout(timer);
      resolve(code);
    };
    socket.once("close", onClose);
  });
}

function noMessage(socket, predicate, timeoutMs = 60) {
  return new Promise((resolve) => {
    const onMessage = (raw, isBinary) => {
      if (isBinary) return;
      const message = decode(raw);
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(message);
    };
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      resolve(null);
    }, timeoutMs);
    socket.on("message", onMessage);
  });
}

function send(socket, value) {
  socket.send(JSON.stringify(value));
}

async function join(socket, displayName, roomId) {
  const roomSnapshot = nextMessage(socket, (message) => message.type === "room.snapshot");
  const spaceSnapshot = nextMessage(socket, (message) => message.type === "space.snapshot");
  send(socket, { type: "join", roomId, displayName });
  const [room, space] = await Promise.all([roomSnapshot, spaceSnapshot]);
  return { room, space };
}

function player(snapshot, displayName) {
  return snapshot.rooms.flatMap((room) => room.players).find((member) => member.displayName === displayName);
}

function closeAll(sockets) {
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  }
}

test("space snapshots expose member positions only for the recipient's current room", { timeout: TEST_TIMEOUT_MS }, async () => {
  const sockets = [];
  try {
    const ada = await connect();
    sockets.push(ada);
    const adaJoined = await join(ada, "Ada", "lobby");
    assert.deepEqual(adaJoined.room.room, {
      id: "lobby",
      name: "Open area",
      kind: "open-area",
      audioPolicy: "proximity",
      audioRadiusGridUnits: 6,
    });
    assert.deepEqual(adaJoined.room.members.map((member) => member.displayName), ["Ada"]);
    assert.deepEqual(adaJoined.space.rooms.map((room) => room.id), ["lobby", "studio"]);
    assert.deepEqual(
      adaJoined.space.rooms.map(({ kind, audioPolicy, audioRadiusGridUnits }) => ({ kind, audioPolicy, audioRadiusGridUnits })),
      [
        { kind: "open-area", audioPolicy: "proximity", audioRadiusGridUnits: 6 },
        { kind: "meeting-room", audioPolicy: "room", audioRadiusGridUnits: null },
      ],
    );
    assert.equal(adaJoined.space.participantId, player(adaJoined.space, "Ada").id);

    const grace = await connect();
    sockets.push(grace);
    const adaUpdatedAfterGrace = nextMessage(ada, (message) => message.type === "space.snapshot");
    const graceJoined = await join(grace, "Grace", "studio");
    const adaSpace = await adaUpdatedAfterGrace;
    assert.equal(graceJoined.room.room.id, "studio");
    assert.deepEqual(graceJoined.room.members.map((member) => member.displayName), ["Grace"]);
    assert.equal(player(adaSpace, "Ada").roomId, "lobby");
    assert.equal(player(adaSpace, "Grace"), undefined);
    assert.deepEqual(adaSpace.rooms.find((room) => room.id === "lobby").players.map((member) => member.displayName), ["Ada"]);
    assert.equal(adaSpace.rooms.find((room) => room.id === "lobby").membersVisible, true);
    assert.deepEqual(adaSpace.rooms.find((room) => room.id === "studio").players, []);
    assert.equal(adaSpace.rooms.find((room) => room.id === "studio").membersVisible, false);
    assert.deepEqual(graceJoined.space.rooms.find((room) => room.id === "lobby").players, []);
    assert.equal(graceJoined.space.rooms.find((room) => room.id === "lobby").membersVisible, false);
    assert.deepEqual(graceJoined.space.rooms.find((room) => room.id === "studio").players.map((member) => member.displayName), ["Grace"]);

    const beforeMove = player(graceJoined.space, "Grace");
    const adaSeesMove = nextMessage(ada, (message) => message.type === "space.snapshot");
    const graceSeesMove = nextMessage(grace, (message) => message.type === "space.snapshot");
    send(grace, { type: "space.move", direction: "right" });
    const [movedAtAda, movedAtGrace] = await Promise.all([adaSeesMove, graceSeesMove]);
    assert.equal(player(movedAtAda, "Grace"), undefined, "a participant in another room is omitted from this snapshot");
    assert.equal(player(movedAtGrace, "Grace").x, beforeMove.x + 1);
    assert.equal(movedAtAda.seq, movedAtGrace.seq);

    const graceSawAdaEnter = nextMessage(grace, (message) => message.type === "control.event" && message.event.kind === "member.joined");
    const graceSpaceAfterSwitch = nextMessage(grace, (message) => message.type === "space.snapshot");
    const adaStudioRoom = nextMessage(ada, (message) => message.type === "room.snapshot" && message.room.id === "studio");
    send(ada, { type: "room.switch", roomId: "studio" });
    const [switchRoom, switchState, joinEvent] = await Promise.all([adaStudioRoom, graceSpaceAfterSwitch, graceSawAdaEnter]);
    assert.deepEqual(switchRoom.members.map((member) => member.displayName).sort(), ["Ada", "Grace"]);
    assert.equal(joinEvent.event.roomId, "studio");
    assert.equal(player(switchState, "Ada").roomId, "studio");
    assert.equal(player(switchState, "Grace").roomId, "studio");
    assert.deepEqual(switchState.rooms.find((room) => room.id === "lobby").players, []);
    assert.equal(switchState.rooms.find((room) => room.id === "lobby").membersVisible, false);

    const adaSawGraceLeave = nextMessage(ada, (message) => message.type === "control.event" && message.event.kind === "member.left");
    const adaAfterGraceLeaves = nextMessage(ada, (message) => message.type === "space.snapshot");
    grace.close();
    const [leaveEvent, leaveState] = await Promise.all([adaSawGraceLeave, adaAfterGraceLeaves]);
    assert.equal(leaveEvent.event.roomId, "studio");
    assert.equal(player(leaveState, "Grace"), undefined);
    assert.deepEqual(leaveState.rooms.find((room) => room.id === "studio").players.map((member) => member.displayName), ["Ada"]);

    const adaLobbySnapshot = nextMessage(ada, (message) => message.type === "room.snapshot" && message.room.id === "lobby");
    const adaSeesEmptyStudio = nextMessage(ada, (message) => message.type === "space.snapshot");
    send(ada, { type: "room.switch", roomId: "lobby" });
    const [lobbyState, emptyState] = await Promise.all([adaLobbySnapshot, adaSeesEmptyStudio]);
    assert.deepEqual(lobbyState.members.map((member) => member.displayName), ["Ada"]);
    assert.deepEqual(emptyState.rooms.find((room) => room.id === "studio").players, []);
    assert.equal(emptyState.rooms.find((room) => room.id === "studio").membersVisible, false);
    assert.deepEqual(emptyState.rooms.map((room) => room.id), ["lobby", "studio"]);

    const returningGrace = await connect();
    sockets.push(returningGrace);
    const adaSeesRejoin = nextMessage(ada, (message) => message.type === "space.snapshot");
    const graceRejoined = await join(returningGrace, "Grace", "studio");
    const rejoinedState = await adaSeesRejoin;
    assert.deepEqual(graceRejoined.room.members.map((member) => member.displayName), ["Grace"]);
    assert.equal(player(rejoinedState, "Grace"), undefined);
    assert.equal(rejoinedState.rooms.find((room) => room.id === "studio").membersVisible, false);
  } finally {
    closeAll(sockets);
  }
});

test("movement is one bounded step, rejects room and participant spoofing, and fails at the grid edge", { timeout: TEST_TIMEOUT_MS }, async () => {
  const sockets = [];
  try {
    const ada = await connect();
    sockets.push(ada);
    const adaJoined = await join(ada, "Ada", "lobby");
    const grace = await connect();
    sockets.push(grace);
    const adaUpdated = nextMessage(ada, (message) => message.type === "space.snapshot");
    const graceJoined = await join(grace, "Grace", "lobby");
    const fullState = await adaUpdated;
    const adaStart = player(fullState, "Ada");
    const graceStart = player(graceJoined.space, "Grace");

    const unknownRoom = nextMessage(ada, (message) => message.type === "protocol.error");
    send(ada, { type: "room.switch", roomId: "roof" });
    assert.equal((await unknownRoom).code, "unknown_room");
    assert.equal(ada.readyState, WebSocket.OPEN);

    const leftOnce = nextMessage(ada, (message) => message.type === "space.snapshot");
    send(ada, { type: "space.move", direction: "left" });
    const atXOne = player(await leftOnce, "Ada");
    assert.equal(atXOne.x, 1);
    const leftTwice = nextMessage(ada, (message) => message.type === "space.snapshot");
    send(ada, { type: "space.move", direction: "left" });
    const atEdge = player(await leftTwice, "Ada");
    assert.equal(atEdge.x, 0);

    const noBoundaryAck = noMessage(ada, (message) => message.type === "space.snapshot");
    const boundaryError = nextMessage(ada, (message) => message.type === "protocol.error");
    send(ada, { type: "space.move", direction: "left" });
    assert.equal((await boundaryError).code, "movement_out_of_bounds");
    assert.equal((await noBoundaryAck), null);
    assert.equal(ada.readyState, WebSocket.OPEN);

    const graceAfterSpoof = nextMessage(grace, (message) => message.type === "space.snapshot");
    const spoofClose = waitForClose(ada);
    const spoofError = nextMessage(ada, (message) => message.type === "protocol.error");
    send(ada, { type: "space.move", direction: "right", participantId: graceStart.id });
    assert.equal((await spoofError).code, "invalid_space_move");
    assert.equal(await spoofClose, 1008);

    const afterDisconnect = await graceAfterSpoof;
    assert.deepEqual(player(afterDisconnect, "Grace"), graceStart);
    assert.equal(player(afterDisconnect, "Ada"), undefined);
  } finally {
    closeAll(sockets);
  }
});

test("media controls are available in both rooms and switching clears the previous publisher", { timeout: TEST_TIMEOUT_MS }, async () => {
  const sockets = [];
  try {
    const ada = await connect();
    sockets.push(ada);
    await join(ada, "Ada", "lobby");
    const grace = await connect();
    sockets.push(grace);
    const adaSpaceAfterGrace = nextMessage(ada, (message) => message.type === "space.snapshot");
    await join(grace, "Grace", "lobby");
    await adaSpaceAfterGrace;

    const audioSubscribed = nextMessage(grace, (message) => message.type === "audio.subscribed");
    const screenSubscribed = nextMessage(grace, (message) => message.type === "screen.subscribed");
    send(grace, { type: "audio.subscribe" });
    send(grace, { type: "screen.subscribe" });
    await Promise.all([audioSubscribed, screenSubscribed]);

    const audioStarted = nextMessage(ada, (message) => message.type === "audio.started");
    const graceAudioStream = nextMessage(grace, (message) => message.type === "audio.stream");
    send(ada, { type: "audio.start", codec: "opus", sampleRate: 48_000, channels: 1, bitrate: 32_000, frameDurationUs: 20_000 });
    await Promise.all([audioStarted, graceAudioStream]);

    const screenStarted = nextMessage(ada, (message) => message.type === "screen.started");
    const graceScreenStream = nextMessage(grace, (message) => message.type === "screen.stream");
    send(ada, { type: "screen.start", codec: "vp8", width: 320, height: 180, frameRate: 15, bitrate: 200_000 });
    await Promise.all([screenStarted, graceScreenStream]);

    const graceAudioEnded = nextMessage(grace, (message) => message.type === "audio.streamEnded");
    const graceScreenEnded = nextMessage(grace, (message) => message.type === "screen.streamEnded");
    const adaStudio = nextMessage(ada, (message) => message.type === "room.snapshot" && message.room.id === "studio");
    const graceLeftLobby = nextMessage(grace, (message) => message.type === "control.event" && message.event.kind === "member.left");
    send(ada, { type: "room.switch", roomId: "studio" });
    await Promise.all([adaStudio, graceLeftLobby, graceAudioEnded, graceScreenEnded]);

    const studioViewer = await connect();
    sockets.push(studioViewer);
    await join(studioViewer, "Studio Viewer", "studio");
    const studioAudioSubscribed = nextMessage(studioViewer, (message) => message.type === "audio.subscribed");
    const studioScreenSubscribed = nextMessage(studioViewer, (message) => message.type === "screen.subscribed");
    send(studioViewer, { type: "audio.subscribe" });
    send(studioViewer, { type: "screen.subscribe" });
    await Promise.all([studioAudioSubscribed, studioScreenSubscribed]);

    const studioAudioStream = nextMessage(studioViewer, (message) => message.type === "audio.stream");
    const studioAudioStarted = nextMessage(ada, (message) => message.type === "audio.started");
    send(ada, { type: "audio.start", codec: "opus", sampleRate: 48_000, channels: 1, bitrate: 32_000, frameDurationUs: 20_000 });
    const [studioAudioAck, audioAtViewer] = await Promise.all([studioAudioStarted, studioAudioStream]);
    assert.equal(audioAtViewer.generation, studioAudioAck.generation);

    const studioScreenStream = nextMessage(studioViewer, (message) => message.type === "screen.stream");
    const studioScreenStarted = nextMessage(ada, (message) => message.type === "screen.started");
    send(ada, { type: "screen.start", codec: "vp8", width: 320, height: 180, frameRate: 10, bitrate: 200_000 });
    const [studioScreenAck, screenAtViewer] = await Promise.all([studioScreenStarted, studioScreenStream]);
    assert.equal(screenAtViewer.generation, studioScreenAck.generation);
    const noForeignMedia = noMessage(grace, (message) => message.type === "audio.stream" || message.type === "screen.stream", 100);
    assert.equal(await noForeignMedia, null, "lobby members do not receive studio publisher controls");

    const returnedToLobby = nextMessage(ada, (message) => message.type === "room.snapshot" && message.room.id === "lobby");
    send(ada, { type: "room.switch", roomId: "lobby" });
    await returnedToLobby;
    const audioResubscribed = nextMessage(ada, (message) => message.type === "audio.subscribed");
    send(ada, { type: "audio.subscribe" });
    await audioResubscribed;
  } finally {
    closeAll(sockets);
  }
});
