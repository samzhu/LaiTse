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

function nextBinary(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      socket.off("error", onError);
      reject(new Error(`Expected binary audio did not arrive within ${MESSAGE_TIMEOUT_MS} ms.`));
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
  });
}

async function noBinary(socket, durationMs = 90) {
  let received = false;
  const onMessage = (_raw, isBinary) => {
    if (isBinary) received = true;
  };
  socket.on("message", onMessage);
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  socket.off("message", onMessage);
  assert.equal(received, false, "this socket should receive no audio binary");
}

async function noJson(socket, predicate, durationMs = 90) {
  let received = false;
  const onMessage = (raw, isBinary) => {
    if (!isBinary && predicate(decode(raw))) received = true;
  };
  socket.on("message", onMessage);
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  socket.off("message", onMessage);
  assert.equal(received, false, "this socket should receive no matching control message");
}

function send(socket, value) {
  socket.send(JSON.stringify(value));
}

async function join(socket, displayName, roomId = "lobby") {
  const roomSnapshot = nextJson(socket, (message) => message.type === "room.snapshot");
  const spaceSnapshot = nextJson(socket, (message) => message.type === "space.snapshot");
  send(socket, { type: "join", roomId, displayName });
  const [room, space] = await Promise.all([roomSnapshot, spaceSnapshot]);
  return { room, space };
}

function player(snapshot, displayName) {
  return snapshot.rooms.flatMap((room) => room.players).find((member) => member.displayName === displayName);
}

async function move(socket, direction, displayName) {
  const snapshot = nextJson(socket, (message) => message.type === "space.snapshot");
  send(socket, { type: "space.move", direction });
  return player(await snapshot, displayName);
}

function makeFrame(generation, sequence, payload = Buffer.from([0xf8, 0xff, 0xfe])) {
  const frame = Buffer.alloc(24 + payload.byteLength);
  frame.write("LTA1", 0, "ascii");
  frame.writeUInt32BE(generation, 4);
  frame.writeUInt32BE(sequence, 8);
  frame.writeDoubleBE(sequence * 20_000, 12);
  frame.writeUInt32BE(20_000, 20);
  payload.copy(frame, 24);
  return frame;
}

async function startPublisher(socket) {
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

async function subscribe(socket) {
  const subscribed = nextJson(socket, (message) => message.type === "audio.subscribed");
  send(socket, { type: "audio.subscribe" });
  await subscribed;
}

function closeAll(sockets) {
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  }
}

test("open-area audio follows authoritative distance, including the six-unit edge", { timeout: TEST_TIMEOUT_MS }, async () => {
  const sockets = [];
  try {
    const publisher = await connect();
    const near = await connect();
    const boundary = await connect();
    const far = await connect();
    sockets.push(publisher, near, boundary, far);

    await join(publisher, "Speaker");
    await join(near, "Near listener");
    await join(boundary, "Boundary listener");
    const farJoined = await join(far, "Far listener");
    assert.deepEqual(farJoined.room.room, {
      id: "lobby",
      name: "Open area",
      kind: "open-area",
      audioPolicy: "proximity",
      audioRadiusGridUnits: 6,
      isLocked: false,
      hostControlsEnabled: false,
      publishAllowed: true,
    });
    assert.deepEqual(
      ["Speaker", "Near listener", "Boundary listener", "Far listener"].map((name) => {
        const { x, y } = player(farJoined.space, name);
        return [x, y];
      }),
      [[2, 2], [5, 2], [8, 2], [11, 2]],
    );

    await Promise.all([subscribe(near), subscribe(boundary), subscribe(far)]);
    const nearStream = nextJson(near, (message) => message.type === "audio.stream");
    const boundaryStream = nextJson(boundary, (message) => message.type === "audio.stream");
    const farUnavailable = nextJson(far, (message) => message.type === "audio.unavailable");
    const started = await startPublisher(publisher);
    assert.equal((await nearStream).generation, started.generation);
    assert.equal((await boundaryStream).generation, started.generation);
    assert.deepEqual(await farUnavailable, { type: "audio.unavailable", reason: "out_of_range" });
    await noJson(far, (message) => message.type === "audio.stream");

    const firstAtNear = nextBinary(near);
    const firstAtBoundary = nextBinary(boundary);
    const first = makeFrame(started.generation, 0, Buffer.from([0xf8, 0x11, 0x22, 0x33]));
    publisher.send(first);
    assert.deepEqual(await firstAtNear, first);
    assert.deepEqual(await firstAtBoundary, first);
    await noBinary(far);

    await move(far, "left", "Far listener");
    await move(far, "left", "Far listener");
    const farReenteredStream = nextJson(far, (message) => message.type === "audio.stream");
    const atBoundary = await move(far, "left", "Far listener");
    assert.equal(atBoundary.x, 8);
    assert.equal((await farReenteredStream).generation, started.generation);
    const atFarAfterReentry = nextBinary(far);
    const second = makeFrame(started.generation, 1, Buffer.from([0xf8, 0x44, 0x55, 0x66]));
    publisher.send(second);
    assert.deepEqual(await atFarAfterReentry, second);

    const farEnded = nextJson(far, (message) => message.type === "audio.streamEnded");
    const atFarAgain = await move(far, "right", "Far listener");
    assert.equal(atFarAgain.x, 9);
    assert.deepEqual(await farEnded, { type: "audio.streamEnded", generation: started.generation, reason: "out_of_range" });
    await noBinary(far);

    const boundaryEnded = nextJson(boundary, (message) => message.type === "audio.streamEnded");
    const publisherAtOne = nextJson(publisher, (message) => message.type === "space.snapshot");
    send(publisher, { type: "space.move", direction: "left" });
    assert.equal(player(await publisherAtOne, "Speaker").x, 1);
    assert.deepEqual(await boundaryEnded, { type: "audio.streamEnded", generation: started.generation, reason: "out_of_range" });

    const boundaryRestored = nextJson(boundary, (message) => message.type === "audio.stream");
    const publisherBackAtTwo = nextJson(publisher, (message) => message.type === "space.snapshot");
    send(publisher, { type: "space.move", direction: "right" });
    assert.equal(player(await publisherBackAtTwo, "Speaker").x, 2);
    assert.equal((await boundaryRestored).generation, started.generation);
    const thirdAtBoundary = nextBinary(boundary);
    const third = makeFrame(started.generation, 2, Buffer.from([0xf8, 0x77, 0x88, 0x99]));
    publisher.send(third);
    assert.deepEqual(await thirdAtBoundary, third);
  } finally {
    closeAll(sockets);
  }
});

test("meeting-room audio reaches a distant member while staying inside its room", { timeout: TEST_TIMEOUT_MS }, async () => {
  const sockets = [];
  try {
    const publisher = await connect();
    sockets.push(publisher);
    await join(publisher, "Meeting speaker", "studio");
    for (const name of ["Seat two", "Seat three"]) {
      const socket = await connect();
      sockets.push(socket);
      await join(socket, name, "studio");
    }
    const distant = await connect();
    sockets.push(distant);
    const distantJoined = await join(distant, "Distant attendee", "studio");
    assert.equal(distantJoined.room.room.kind, "meeting-room");
    assert.equal(distantJoined.room.room.audioPolicy, "room");
    assert.equal(distantJoined.room.room.audioRadiusGridUnits, null);
    assert.equal(player(distantJoined.space, "Distant attendee").x - player(distantJoined.space, "Meeting speaker").x, 9);

    const outside = await connect();
    sockets.push(outside);
    await join(outside, "Outside attendee", "lobby");
    await Promise.all([subscribe(distant), subscribe(outside)]);
    const distantStream = nextJson(distant, (message) => message.type === "audio.stream");
    const started = await startPublisher(publisher);
    assert.equal((await distantStream).generation, started.generation);
    await noJson(outside, (message) => message.type === "audio.stream");

    const distantPacket = nextBinary(distant);
    const packet = makeFrame(started.generation, 0, Buffer.from([0xf8, 0xaa, 0xbb]));
    publisher.send(packet);
    assert.deepEqual(await distantPacket, packet);
    await noBinary(outside);
  } finally {
    closeAll(sockets);
  }
});

test("clients cannot supply position, audio policy, range, or participant identity", { timeout: TEST_TIMEOUT_MS }, async () => {
  const sockets = [];
  try {
    const probes = [
      { name: "Forged position", message: { type: "space.move", direction: "right", x: 15, y: 8 }, code: "invalid_space_move" },
      { name: "Forged policy", message: { type: "room.switch", roomId: "studio", audioPolicy: "room" }, code: "invalid_room_switch" },
      { name: "Forged identity", message: { type: "space.move", direction: "right", participantId: "another-member" }, code: "invalid_space_move" },
      { name: "Forged range", message: { type: "audio.subscribe", radius: 999, audible: true }, code: "invalid_audio_control" },
    ];
    for (const probe of probes) {
      const socket = await connect();
      sockets.push(socket);
      await join(socket, probe.name);
      const error = nextJson(socket, (message) => message.type === "protocol.error");
      const closed = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Invalid client control did not close the connection.")), MESSAGE_TIMEOUT_MS);
        socket.once("close", (code) => {
          clearTimeout(timer);
          resolve(code);
        });
      });
      send(socket, probe.message);
      assert.equal((await error).code, probe.code);
      assert.equal(await closed, 1008);
    }
  } finally {
    closeAll(sockets);
  }
});
