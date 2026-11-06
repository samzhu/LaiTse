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

async function expectNoJson(socket, predicate, durationMs = 80) {
  const received = [];
  const onMessage = (raw, isBinary) => {
    if (isBinary) return;
    try {
      const message = JSON.parse(raw.toString());
      if (predicate(message)) received.push(message);
    } catch {}
  };
  socket.on("message", onMessage);
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  socket.off("message", onMessage);
  assert.deepEqual(received, [], "no matching control message should be delivered to this socket");
}

async function join(socket, displayName, roomId = "lobby") {
  const snapshot = nextJson(socket, (message) => message.type === "room.snapshot");
  socket.send(JSON.stringify({ type: "join", roomId, displayName }));
  await snapshot;
}

function nextBinaryGeneration(socket, generation) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onClose = (code) => {
      cleanup();
      reject(new Error(`Socket closed (${code}) before audio generation ${generation} arrived.`));
    };
    const onMessage = (raw, isBinary) => {
      if (!isBinary) return;
      const bytes = Buffer.from(raw);
      if (bytes.byteLength < 8 || bytes.readUInt32BE(4) !== generation) return;
      cleanup();
      resolve(bytes);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Audio generation ${generation} did not arrive within 5 seconds.`));
    }, 5_000);
    socket.on("message", onMessage);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
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

test("studio relays concurrent publisher generations independently with self and room isolation", { timeout: 30_000 }, async () => {
  const sockets = [];
  try {
    const publisherA = await connect();
    const publisherB = await connect();
    const receiverC = await connect();
    const outside = await connect();
    sockets.push(publisherA, publisherB, receiverC, outside);
    await Promise.all([
      join(publisherA, "Speaker A", "studio"),
      join(publisherB, "Speaker B", "studio"),
      join(receiverC, "Listener C", "studio"),
      join(outside, "Lobby listener", "lobby"),
    ]);

    const subscriptions = [publisherA, publisherB, receiverC, outside].map((socket) => {
      const ack = nextJson(socket, (message) => message.type === "audio.subscribed");
      socket.send(JSON.stringify({ type: "audio.subscribe" }));
      return ack;
    });
    await Promise.all(subscriptions);

    const aReceivesB = nextJson(publisherB, (message) => message.type === "audio.stream");
    const cReceivesA = nextJson(receiverC, (message) => message.type === "audio.stream");
    const startedA = await startPublisher(publisherA);
    const [streamAAtB, streamAAtC] = await Promise.all([aReceivesB, cReceivesA]);
    const bReceivesA = nextJson(publisherA, (message) => message.type === "audio.stream");
    const cReceivesB = nextJson(receiverC, (message) => message.type === "audio.stream");
    const startedB = await startPublisher(publisherB);
    const [streamBAtA, streamBAtC] = await Promise.all([bReceivesA, cReceivesB]);
    assert.notEqual(startedA.generation, startedB.generation, "the server assigns an independent generation to each source");
    assert.deepEqual([streamAAtB.generation, streamAAtC.generation, streamBAtA.generation, streamBAtC.generation],
      [startedA.generation, startedA.generation, startedB.generation, startedB.generation]);
    assert.ok([streamAAtB, streamAAtC, streamBAtA, streamBAtC].every((stream) => typeof stream.clockId === "string" && stream.clockId.length > 0));
    assert.equal(streamAAtB.clockId, streamAAtC.clockId, "one publisher has the same server clock on each subscriber");
    assert.equal(streamBAtA.clockId, streamBAtC.clockId, "the other publisher has its own server clock");
    assert.notEqual(streamAAtB.clockId, streamBAtA.clockId, "publisher clocks cannot alias each other");
    await expectNoJson(outside, (message) => message.type === "audio.stream");

    const aToB = nextBinaryGeneration(publisherB, startedA.generation);
    const aToC = nextBinaryGeneration(receiverC, startedA.generation);
    const frameA = makeFrame(startedA.generation, 0, Buffer.from([0xf8, 0x51, 0x61]));
    const noSelfEchoA = expectNoBinary(publisherA);
    publisherA.send(frameA);
    assert.deepEqual(await aToB, frameA);
    assert.deepEqual(await aToC, frameA);
    await noSelfEchoA;

    const bToA = nextBinaryGeneration(publisherA, startedB.generation);
    const bToC = nextBinaryGeneration(receiverC, startedB.generation);
    const frameB = makeFrame(startedB.generation, 0, Buffer.from([0xf8, 0x52, 0x62]));
    const noSelfEchoB = expectNoBinary(publisherB);
    publisherB.send(frameB);
    assert.deepEqual(await bToA, frameB);
    assert.deepEqual(await bToC, frameB);
    await noSelfEchoB;

    const forgedPublisher = await connect();
    sockets.push(forgedPublisher);
    await join(forgedPublisher, "Forged speaker", "studio");
    const forgedStarted = await startPublisher(forgedPublisher);
    const forgedFrameError = nextJson(forgedPublisher, (message) => message.type === "protocol.error");
    const forgedPublisherClosed = new Promise((resolve) => forgedPublisher.once("close", (code) => resolve(code)));
    const noSpoofedFrameAtC = expectNoBinary(receiverC);
    forgedPublisher.send(makeFrame(startedA.generation, 0, Buffer.from([0xf8, 0xee, 0x01])));
    assert.ok(forgedStarted.generation !== startedA.generation && forgedStarted.generation !== startedB.generation);
    assert.equal((await forgedFrameError).code, "invalid_audio_frame", "a connection cannot publish under another source generation");
    assert.equal(await forgedPublisherClosed, 1008);
    await noSpoofedFrameAtC;

    const bContinuesAfterForgeryAtA = nextBinaryGeneration(publisherA, startedB.generation);
    const bContinuesAfterForgeryAtC = nextBinaryGeneration(receiverC, startedB.generation);
    const healthyFrameB = makeFrame(startedB.generation, 1, Buffer.from([0xf8, 0x54, 0x64]));
    publisherB.send(healthyFrameB);
    assert.deepEqual(await bContinuesAfterForgeryAtA, healthyFrameB);
    assert.deepEqual(await bContinuesAfterForgeryAtC, healthyFrameB);

    const late = await connect();
    sockets.push(late);
    await join(late, "Late listener", "studio");
    const lateSubscribed = nextJson(late, (message) => message.type === "audio.subscribed");
    const lateStreamA = nextJson(late, (message) => message.type === "audio.stream" && message.generation === startedA.generation);
    const lateStreamB = nextJson(late, (message) => message.type === "audio.stream" && message.generation === startedB.generation);
    late.send(JSON.stringify({ type: "audio.subscribe" }));
    await lateSubscribed;
    assert.deepEqual(new Set((await Promise.all([lateStreamA, lateStreamB])).map((stream) => stream.generation)),
      new Set([startedA.generation, startedB.generation]));

    const endAAtB = nextJson(publisherB, (message) => message.type === "audio.streamEnded" && message.generation === startedA.generation);
    const endAAtC = nextJson(receiverC, (message) => message.type === "audio.streamEnded" && message.generation === startedA.generation);
    const endAAtLate = nextJson(late, (message) => message.type === "audio.streamEnded" && message.generation === startedA.generation);
    const stoppedA = nextJson(publisherA, (message) => message.type === "audio.stopped");
    publisherA.send(JSON.stringify({ type: "audio.stop", generation: startedA.generation }));
    await Promise.all([stoppedA, endAAtB, endAAtC, endAAtLate]);

    const bContinuesAtA = nextBinaryGeneration(publisherA, startedB.generation);
    const bContinuesAtC = nextBinaryGeneration(receiverC, startedB.generation);
    const bContinuesAtLate = nextBinaryGeneration(late, startedB.generation);
    const nextFrameB = makeFrame(startedB.generation, 2, Buffer.from([0xf8, 0x55, 0x65]));
    publisherB.send(nextFrameB);
    assert.deepEqual(await bContinuesAtA, nextFrameB);
    assert.deepEqual(await bContinuesAtC, nextFrameB);
    assert.deepEqual(await bContinuesAtLate, nextFrameB);
    await expectNoBinary(outside);

    const endBAtA = nextJson(publisherA, (message) => message.type === "audio.streamEnded" && message.generation === startedB.generation);
    const endBAtC = nextJson(receiverC, (message) => message.type === "audio.streamEnded" && message.generation === startedB.generation);
    const endBAtLate = nextJson(late, (message) => message.type === "audio.streamEnded" && message.generation === startedB.generation);
    const stoppedB = nextJson(publisherB, (message) => message.type === "audio.stopped");
    publisherB.send(JSON.stringify({ type: "audio.stop", generation: startedB.generation }));
    await Promise.all([stoppedB, endBAtA, endBAtC, endBAtLate]);
  } finally {
    for (const socket of sockets) socket.close();
  }
});

test("open lobby keeps its single audio publisher rule", { timeout: 10_000 }, async () => {
  const first = await connect();
  const second = await connect();
  try {
    await Promise.all([join(first, "Lobby speaker A"), join(second, "Lobby speaker B")]);
    const active = await startPublisher(first);
    assert.ok(active.generation > 0);
    const rejected = nextJson(second, (message) => message.type === "audio.error" && message.code === "publisher_exists");
    second.send(JSON.stringify({
      type: "audio.start",
      codec: "opus",
      sampleRate: 48_000,
      channels: 1,
      bitrate: 32_000,
      frameDurationUs: 20_000,
    }));
    assert.equal((await rejected).code, "publisher_exists");
  } finally {
    first.close();
    second.close();
  }
});
