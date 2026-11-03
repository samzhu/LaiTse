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

function nextBinary(socket) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      socket.off("message", onMessage);
      reject(error);
    };
    const onMessage = (raw, isBinary) => {
      if (!isBinary) return;
      socket.off("message", onMessage);
      socket.off("error", onError);
      resolve(Buffer.from(raw));
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
  assert.deepEqual(received, [], "no audio binary should be delivered to this socket");
}

async function join(socket, displayName) {
  const snapshot = nextJson(socket, (message) => message.type === "room.snapshot");
  socket.send(JSON.stringify({ type: "join", roomId: "lobby", displayName }));
  await snapshot;
}

function makeFrame(generation, sequence, packet = Buffer.from([0xf8, 0xff, 0xfe])) {
  const frame = Buffer.alloc(24 + packet.byteLength);
  frame.write("LTA1", 0, "ascii");
  frame.writeUInt32BE(generation, 4);
  frame.writeUInt32BE(sequence, 8);
  frame.writeDoubleBE(sequence * 20_000, 12);
  frame.writeUInt32BE(20_000, 20);
  packet.copy(frame, 24);
  return frame;
}

async function startPublisher(socket) {
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

test("opaque Opus bytes reach only subscribed room members and stop after publisher stop", async () => {
  const publisher = await connect();
  const subscriber = await connect();
  const passive = await connect();
  try {
    await Promise.all([join(publisher, "Speaker"), join(subscriber, "Listener"), join(passive, "Not listening")]);

    const subscribed = nextJson(subscriber, (message) => message.type === "audio.subscribed");
    subscriber.send(JSON.stringify({ type: "audio.subscribe" }));
    await subscribed;

    const startedAtSubscriber = nextJson(subscriber, (message) => message.type === "audio.stream");
    const started = await startPublisher(publisher);
    assert.deepEqual(started.config, {
      codec: "opus",
      sampleRate: 48_000,
      channels: 1,
      bitrate: 32_000,
      frameDurationUs: 20_000,
    });
    const stream = await startedAtSubscriber;
    assert.equal(stream.generation, started.generation);

    const deliveredPromise = nextBinary(subscriber);
    const publisherEcho = expectNoBinary(publisher);
    const passiveDelivery = expectNoBinary(passive);
    const packet = makeFrame(started.generation, 0, Buffer.from([0xf8, 0x10, 0x22, 0x34]));
    publisher.send(packet);
    assert.deepEqual(await deliveredPromise, packet);
    await Promise.all([publisherEcho, passiveDelivery]);

    const stoppedAtPublisher = nextJson(publisher, (message) => message.type === "audio.stopped");
    const endedAtSubscriber = nextJson(subscriber, (message) => message.type === "audio.streamEnded");
    publisher.send(JSON.stringify({ type: "audio.stop", generation: started.generation }));
    assert.equal((await stoppedAtPublisher).generation, started.generation);
    assert.equal((await endedAtSubscriber).generation, started.generation);

    const rejection = nextJson(publisher, (message) => message.type === "protocol.error");
    const closed = new Promise((resolve) => publisher.once("close", (code) => resolve(code)));
    const afterStopNoAudio = expectNoBinary(subscriber);
    publisher.send(makeFrame(started.generation, 1));
    assert.equal((await rejection).code, "audio_not_publisher");
    assert.equal(await closed, 1008);
    await afterStopNoAudio;
  } finally {
    publisher.close();
    subscriber.close();
    passive.close();
  }
});

test("audio binary from non-publishers and malformed publisher frames are rejected", async () => {
  const listener = await connect();
  const nonPublisher = await connect();
  const publisher = await connect();
  try {
    await Promise.all([join(listener, "Listener"), join(nonPublisher, "Intruder"), join(publisher, "Speaker")]);
    const subscribed = nextJson(listener, (message) => message.type === "audio.subscribed");
    listener.send(JSON.stringify({ type: "audio.subscribe" }));
    await subscribed;

    const nonPublisherError = nextJson(nonPublisher, (message) => message.type === "protocol.error");
    const nonPublisherClosed = new Promise((resolve) => nonPublisher.once("close", (code) => resolve(code)));
    const noLeakedFrame = expectNoBinary(listener);
    nonPublisher.send(makeFrame(1, 0));
    assert.equal((await nonPublisherError).code, "audio_not_publisher");
    assert.equal(await nonPublisherClosed, 1008);
    await noLeakedFrame;

    const startedAtListener = nextJson(listener, (message) => message.type === "audio.stream");
    const started = await startPublisher(publisher);
    assert.equal((await startedAtListener).generation, started.generation);
    const malformedError = nextJson(publisher, (message) => message.type === "protocol.error");
    const malformedClosed = new Promise((resolve) => publisher.once("close", (code) => resolve(code)));
    const noMalformedFrame = expectNoBinary(listener);
    publisher.send(Buffer.from("bad"));
    assert.equal((await malformedError).code, "invalid_audio_frame");
    assert.equal(await malformedClosed, 1009);
    await noMalformedFrame;
  } finally {
    listener.close();
    nonPublisher.close();
    publisher.close();
  }
});

test("subscribers receive identical frames across one receiver unsubscribe and re-subscribe", async () => {
  const publisher = await connect();
  const receiverA = await connect();
  const receiverB = await connect();
  try {
    await Promise.all([join(publisher, "Speaker"), join(receiverA, "Receiver A"), join(receiverB, "Receiver B")]);

    const receiverASubscribed = nextJson(receiverA, (message) => message.type === "audio.subscribed");
    const receiverBSubscribed = nextJson(receiverB, (message) => message.type === "audio.subscribed");
    receiverA.send(JSON.stringify({ type: "audio.subscribe" }));
    receiverB.send(JSON.stringify({ type: "audio.subscribe" }));
    await Promise.all([receiverASubscribed, receiverBSubscribed]);

    const streamA = nextJson(receiverA, (message) => message.type === "audio.stream");
    const streamB = nextJson(receiverB, (message) => message.type === "audio.stream");
    const started = await startPublisher(publisher);
    assert.equal((await streamA).generation, started.generation);
    assert.equal((await streamB).generation, started.generation);

    const firstA = nextBinary(receiverA);
    const firstB = nextBinary(receiverB);
    const firstFrame = makeFrame(started.generation, 0, Buffer.from([0xf8, 0x11, 0x21, 0x31]));
    publisher.send(firstFrame);
    assert.deepEqual(await firstA, firstFrame);
    assert.deepEqual(await firstB, firstFrame);

    const unsubscribed = nextJson(receiverA, (message) => message.type === "audio.unsubscribed");
    receiverA.send(JSON.stringify({ type: "audio.unsubscribe" }));
    await unsubscribed;

    const secondB = nextBinary(receiverB);
    const secondFrame = makeFrame(started.generation, 1, Buffer.from([0xf8, 0x12, 0x22, 0x32]));
    publisher.send(secondFrame);
    assert.deepEqual(await secondB, secondFrame);
    await expectNoBinary(receiverA);

    const reSubscribed = nextJson(receiverA, (message) => message.type === "audio.subscribed");
    const currentStream = nextJson(receiverA, (message) => message.type === "audio.stream");
    receiverA.send(JSON.stringify({ type: "audio.subscribe" }));
    await reSubscribed;
    assert.equal((await currentStream).generation, started.generation);

    const thirdA = nextBinary(receiverA);
    const thirdB = nextBinary(receiverB);
    const thirdFrame = makeFrame(started.generation, 2, Buffer.from([0xf8, 0x13, 0x23, 0x33]));
    publisher.send(thirdFrame);
    assert.deepEqual(await thirdA, thirdFrame);
    assert.deepEqual(await thirdB, thirdFrame);
  } finally {
    publisher.close();
    receiverA.close();
    receiverB.close();
  }
});
