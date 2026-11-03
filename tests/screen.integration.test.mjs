import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import WebSocket from "ws";
import { createApp } from "../src/server/app.ts";

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

function nextJson(socket, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      socket.off("message", onMessage);
      reject(error);
    };
    const onMessage = (raw, isBinary) => {
      if (isBinary) return;
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch (error) {
        socket.off("error", onError);
        socket.off("message", onMessage);
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

function nextBinaryWithMagic(socket, magic) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      socket.off("message", onMessage);
      reject(error);
    };
    const onMessage = (raw, isBinary) => {
      if (!isBinary) return;
      const bytes = Buffer.from(raw);
      if (bytes.byteLength < 4 || bytes.toString("ascii", 0, 4) !== magic) return;
      socket.off("message", onMessage);
      socket.off("error", onError);
      resolve(bytes);
    };
    socket.on("message", onMessage);
    socket.once("error", onError);
  });
}

async function expectNoBinary(socket, durationMs = 80) {
  const received = [];
  const onMessage = (_raw, isBinary) => {
    if (isBinary) received.push(true);
  };
  socket.on("message", onMessage);
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  socket.off("message", onMessage);
  assert.deepEqual(received, [], "no media binary should reach an unsubscribed socket");
}

async function join(socket, displayName) {
  const snapshot = nextJson(socket, (message) => message.type === "room.snapshot");
  socket.send(JSON.stringify({ type: "join", roomId: "lobby", displayName }));
  await snapshot;
}

function makeAudioFrame(generation, sequence, packet = Buffer.from([0xf8, 0xff, 0xfe])) {
  const frame = Buffer.alloc(24 + packet.byteLength);
  frame.write("LTA1", 0, "ascii");
  frame.writeUInt32BE(generation, 4);
  frame.writeUInt32BE(sequence, 8);
  frame.writeDoubleBE(sequence * 20_000, 12);
  frame.writeUInt32BE(20_000, 20);
  packet.copy(frame, 24);
  return frame;
}

function makeScreenFrame(generation, sequence, payload = Buffer.from([0x00, 0x00, 0x00])) {
  const frame = Buffer.alloc(24 + payload.byteLength);
  frame.write("LTS1", 0, "ascii");
  frame.writeUInt32BE(generation, 4);
  frame.writeUInt32BE(sequence, 8);
  frame.writeDoubleBE(sequence * 100_000, 12);
  frame[20] = 0;
  payload.copy(frame, 24);
  return frame;
}

async function subscribe(socket, type, ackType) {
  const ack = nextJson(socket, (message) => message.type === ackType);
  socket.send(JSON.stringify({ type }));
  await ack;
}

async function startAudio(socket) {
  const started = nextJson(socket, (message) => message.type === "audio.started");
  socket.send(JSON.stringify({
    type: "audio.start",
    codec: "opus",
    sampleRate: 48_000,
    channels: 1,
    bitrate: 32_000,
    frameDurationUs: 20_000,
  }));
  return await started;
}

async function startScreen(socket, width = 320, height = 180) {
  const started = nextJson(socket, (message) => message.type === "screen.started");
  socket.send(JSON.stringify({ type: "screen.start", codec: "vp8", width, height, frameRate: 10, bitrate: 800_000 }));
  return await started;
}

test("LTA1 audio and LTS1 screen frames share the socket but keep independent subscriptions and stop state", async () => {
  const publisher = await connect();
  const receiver = await connect();
  const passive = await connect();
  try {
    await Promise.all([join(publisher, "Speaker"), join(receiver, "Viewer"), join(passive, "Passive")]);
    await Promise.all([
      subscribe(receiver, "screen.subscribe", "screen.subscribed"),
      subscribe(receiver, "audio.subscribe", "audio.subscribed"),
    ]);

    const screenStreamAtReceiver = nextJson(receiver, (message) => message.type === "screen.stream");
    const audioStreamAtReceiver = nextJson(receiver, (message) => message.type === "audio.stream");
    const screenStarted = await startScreen(publisher);
    const audioStarted = await startAudio(publisher);
    assert.deepEqual(await screenStreamAtReceiver, {
      type: "screen.stream",
      generation: screenStarted.generation,
      codec: "vp8",
      width: 320,
      height: 180,
      frameRate: 10,
      bitrate: 800_000,
    });
    assert.equal((await audioStreamAtReceiver).generation, audioStarted.generation);

    const screenFrameAtReceiver = nextBinaryWithMagic(receiver, "LTS1");
    const audioFrameAtReceiver = nextBinaryWithMagic(receiver, "LTA1");
    const passiveHasNoFrame = expectNoBinary(passive);
    publisher.send(makeScreenFrame(screenStarted.generation, 0));
    publisher.send(makeAudioFrame(audioStarted.generation, 0));
    const [screenFrame, audioFrame] = await Promise.all([screenFrameAtReceiver, audioFrameAtReceiver]);
    assert.equal(screenFrame.toString("ascii", 0, 4), "LTS1");
    assert.equal(audioFrame.toString("ascii", 0, 4), "LTA1");
    await passiveHasNoFrame;

    const stoppedScreen = nextJson(publisher, (message) => message.type === "screen.stopped");
    const endedScreen = nextJson(receiver, (message) => message.type === "screen.streamEnded");
    publisher.send(JSON.stringify({ type: "screen.stop", generation: screenStarted.generation }));
    assert.equal((await stoppedScreen).generation, screenStarted.generation);
    assert.equal((await endedScreen).generation, screenStarted.generation);

    const audioStillDelivered = nextBinaryWithMagic(receiver, "LTA1");
    publisher.send(makeAudioFrame(audioStarted.generation, 1));
    assert.equal((await audioStillDelivered).readUInt32BE(8), 1);

    const restartedStream = nextJson(receiver, (message) => message.type === "screen.stream");
    const restartedScreen = await startScreen(publisher);
    assert.equal((await restartedStream).generation, restartedScreen.generation);
    const stoppedAudio = nextJson(publisher, (message) => message.type === "audio.stopped");
    const endedAudio = nextJson(receiver, (message) => message.type === "audio.streamEnded");
    publisher.send(JSON.stringify({ type: "audio.stop", generation: audioStarted.generation }));
    assert.equal((await stoppedAudio).generation, audioStarted.generation);
    assert.equal((await endedAudio).generation, audioStarted.generation);

    const screenStillDelivered = nextBinaryWithMagic(receiver, "LTS1");
    publisher.send(makeScreenFrame(restartedScreen.generation, 0));
    assert.equal((await screenStillDelivered).readUInt32BE(8), 0);
  } finally {
    publisher.close();
    receiver.close();
    passive.close();
  }
});

test("screen relay rejects non-publisher frames and invalid publishing bounds", async () => {
  const publisher = await connect();
  const intruder = await connect();
  const receiver = await connect();
  const lateViewer = await connect();
  try {
    await Promise.all([join(publisher, "Speaker"), join(intruder, "Intruder"), join(receiver, "Viewer"), join(lateViewer, "Late viewer")]);
    await subscribe(receiver, "screen.subscribe", "screen.subscribed");

    const invalidConfig = nextJson(publisher, (message) => message.type === "screen.error");
    publisher.send(JSON.stringify({ type: "screen.start", codec: "vp8", width: 1_281, height: 720, frameRate: 10, bitrate: 800_000 }));
    assert.equal((await invalidConfig).code, "unsupported_screen_config");

    const streamAtReceiver = nextJson(receiver, (message) => message.type === "screen.stream");
    const started = await startScreen(publisher);
    await streamAtReceiver;

    const lateJoinError = nextJson(lateViewer, (message) => message.type === "screen.error");
    lateViewer.send(JSON.stringify({ type: "screen.subscribe" }));
    assert.equal((await lateJoinError).code, "late_join_not_supported");

    const error = nextJson(intruder, (message) => message.type === "protocol.error");
    const closed = new Promise((resolve) => intruder.once("close", (code) => resolve(code)));
    const noLeak = expectNoBinary(receiver);
    intruder.send(makeScreenFrame(started.generation, 0));
    assert.equal((await error).code, "screen_not_publisher");
    assert.equal(await closed, 1008);
    await noLeak;
  } finally {
    publisher.close();
    intruder.close();
    receiver.close();
    lateViewer.close();
  }
});

test("text control remains limited to 1 KiB before screen relay dispatch", async () => {
  const socket = await connect();
  try {
    await join(socket, "Viewer");
    const error = nextJson(socket, (message) => message.type === "protocol.error");
    const closed = new Promise((resolve) => socket.once("close", (code) => resolve(code)));
    socket.send(JSON.stringify({ type: "screen.subscribe", extra: "x".repeat(1_100) }));
    assert.equal((await error).code, "invalid_message");
    assert.equal(await closed, 1009);
  } finally {
    socket.close();
  }
});

test("screen frame payload accepts 512 KiB and the WebSocket parser rejects one byte over", async () => {
  const publisher = await connect();
  const receiver = await connect();
  try {
    await Promise.all([join(publisher, "Speaker"), join(receiver, "Viewer")]);
    await subscribe(receiver, "screen.subscribe", "screen.subscribed");
    const stream = nextJson(receiver, (message) => message.type === "screen.stream");
    const started = await startScreen(publisher);
    await stream;

    const maxFrame = makeScreenFrame(started.generation, 0, Buffer.alloc(512 * 1_024, 0x5a));
    const delivered = nextBinaryWithMagic(receiver, "LTS1");
    publisher.send(maxFrame);
    assert.equal((await delivered).byteLength, 24 + 512 * 1_024);

    const closed = new Promise((resolve) => publisher.once("close", (code) => resolve(code)));
    const noOversizeDelivery = expectNoBinary(receiver);
    publisher.send(makeScreenFrame(started.generation, 1, Buffer.alloc((512 * 1_024) + 1, 0x5a)));
    // Fastify's default WebSocket error handler terminates parser errors (1006);
    // ws may complete its size-limit close handshake (1009) before termination.
    assert.ok([1006, 1009].includes(await closed), "oversized frames must close the connection");
    await noOversizeDelivery;
  } finally {
    publisher.close();
    receiver.close();
  }
});
