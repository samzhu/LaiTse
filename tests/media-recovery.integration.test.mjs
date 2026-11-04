import assert from "node:assert/strict";
import { test } from "node:test";
import WebSocket from "ws";
import { createApp } from "../src/server/app.ts";
import { MediaRecoveryIntent } from "../src/client/media-recovery.ts";

const MESSAGE_TIMEOUT_MS = 5_000;

async function withServer(run) {
  const app = await createApp({ serveClient: false });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await app.close();
  }
}

function connect(baseUrl) {
  const socket = new WebSocket(`${baseUrl.replace(/^http/u, "ws")}/ws`, { origin: baseUrl });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket did not open.")), MESSAGE_TIMEOUT_MS);
    socket.once("open", () => { clearTimeout(timer); resolve(socket); });
    socket.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

function nextMessage(socket, predicate, timeoutMs = MESSAGE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      socket.off("error", onError);
      reject(new Error("Expected WebSocket control message did not arrive."));
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

function nextBinary(socket, magic) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      socket.off("error", onError);
      reject(new Error(`Expected ${magic} media frame did not arrive.`));
    }, MESSAGE_TIMEOUT_MS);
    const onError = (error) => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      reject(error);
    };
    const onMessage = (raw, isBinary) => {
      if (!isBinary) return;
      const frame = Buffer.from(raw);
      if (frame.byteLength < 4 || frame.toString("ascii", 0, 4) !== magic) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      socket.off("error", onError);
      resolve(frame);
    };
    socket.on("message", onMessage);
    socket.once("error", onError);
  });
}

async function noMatchingMessage(socket, predicate, durationMs = 120) {
  const matches = [];
  const onMessage = (raw, isBinary) => {
    if (isBinary) return;
    try {
      const message = JSON.parse(raw.toString());
      if (predicate(message)) matches.push(message.type);
    } catch { /* Ignore non-JSON controls for this bounded assertion. */ }
  };
  socket.on("message", onMessage);
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  socket.off("message", onMessage);
  assert.deepEqual(matches, []);
}

async function noBinary(socket, durationMs = 80) {
  const received = [];
  const onMessage = (_raw, isBinary) => { if (isBinary) received.push(true); };
  socket.on("message", onMessage);
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  socket.off("message", onMessage);
  assert.deepEqual(received, []);
}

function makeAudioFrame(generation, sequence) {
  const packet = Buffer.from([0xf8, 0xff, 0xfe]);
  const frame = Buffer.alloc(24 + packet.length);
  frame.write("LTA1", 0, "ascii");
  frame.writeUInt32BE(generation, 4);
  frame.writeUInt32BE(sequence, 8);
  frame.writeDoubleBE(sequence * 20_000, 12);
  frame.writeUInt32BE(20_000, 20);
  packet.copy(frame, 24);
  return frame;
}

function makeScreenFrame(generation, sequence, keyframe = true) {
  const frame = Buffer.alloc(27);
  frame.write("LTS1", 0, "ascii");
  frame.writeUInt32BE(generation, 4);
  frame.writeUInt32BE(sequence, 8);
  frame.writeDoubleBE(sequence * 100_000, 12);
  frame[20] = keyframe ? 0 : 1;
  frame[24] = 0x10;
  frame[25] = 0x20;
  frame[26] = 0x30;
  return frame;
}

async function joinResumable(socket, { roomId = "studio", displayName, role = "participant", mode = "watch" }) {
  const issued = nextMessage(socket, (message) => message.type === "session.issued");
  const room = nextMessage(socket, (message) => message.type === "room.snapshot");
  const participation = nextMessage(socket, (message) => message.type === "participation.self");
  socket.send(JSON.stringify({ type: "join", roomId, displayName, role, mode, resumable: true }));
  const [issuedMessage, roomMessage, participationMessage] = await Promise.all([issued, room, participation]);
  return { issued: issuedMessage, room: roomMessage, participation: participationMessage };
}

async function resume(socket, token) {
  const resumed = nextMessage(socket, (message) => message.type === "session.resumed");
  const room = nextMessage(socket, (message) => message.type === "room.snapshot");
  const participation = nextMessage(socket, (message) => message.type === "participation.self");
  socket.send(JSON.stringify({ type: "session.resume", token }));
  const [resumedMessage, roomMessage, participationMessage] = await Promise.all([resumed, room, participation]);
  return { resumed: resumedMessage, room: roomMessage, participation: participationMessage };
}

function subscribe(socket, channel) {
  const ack = nextMessage(socket, (message) => message.type === `${channel}.subscribed`);
  socket.send(JSON.stringify({ type: `${channel}.subscribe` }));
  return ack;
}

function startAudio(socket) {
  const started = nextMessage(socket, (message) => message.type === "audio.started");
  socket.send(JSON.stringify({
    type: "audio.start", codec: "opus", sampleRate: 48_000, channels: 1, bitrate: 32_000, frameDurationUs: 20_000,
  }));
  return started;
}

function startScreen(socket) {
  const started = nextMessage(socket, (message) => message.type === "screen.started");
  socket.send(JSON.stringify({ type: "screen.start", codec: "vp8", width: 320, height: 180, frameRate: 15, bitrate: 200_000 }));
  return started;
}

function closeAndWait(socket) {
  return new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) return resolve();
    socket.once("close", resolve);
    if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    else socket.close();
  });
}

test("same-page receive intent stays scoped to its room until an explicit clear", () => {
  const intent = new MediaRecoveryIntent();
  intent.set("audio", true, "studio");
  intent.set("screen", true, "studio");

  assert.deepEqual(intent.restoreFor({ roomId: "studio", role: "participant", mode: "watch" }), {
    roomId: "studio", audio: true, screen: true,
  });

  // The intent store has no socket lifecycle input; only its explicit actions
  // or an authoritative room/mode check can clear this same-page state.
  assert.deepEqual(intent.snapshot(), { roomId: "studio", audio: true, screen: true });
});

test("manual stop clears one channel and clears the room binding when none remain", () => {
  const intent = new MediaRecoveryIntent();
  intent.set("audio", true, "studio");
  intent.set("screen", true, "studio");
  intent.set("audio", false, "studio");

  assert.deepEqual(intent.restoreFor({ roomId: "studio", role: "participant", mode: "watch" }), {
    roomId: "studio", audio: false, screen: true,
  });

  intent.set("screen", false, "studio");
  assert.deepEqual(intent.snapshot(), { roomId: null, audio: false, screen: false });
});

test("interaction mode and a different resumed room cannot carry prior receive intent", () => {
  for (const authority of [
    { roomId: "studio", role: "participant", mode: "interaction" },
    { roomId: "lobby", role: "participant", mode: "watch" },
  ]) {
    const intent = new MediaRecoveryIntent();
    intent.set("audio", true, "studio");
    assert.deepEqual(intent.restoreFor(authority), { roomId: null, audio: false, screen: false });
  }
});

test("a receive intent never crosses an explicit room selection", () => {
  const intent = new MediaRecoveryIntent();
  intent.set("screen", true, "studio");
  intent.clear();
  intent.set("audio", true, "lobby");

  assert.deepEqual(intent.restoreFor({ roomId: "lobby", role: "participant", mode: "watch" }), {
    roomId: "lobby", audio: true, screen: false,
  });
});

test("display recovery preserves its screen view but never restores audio receive intent", () => {
  const intent = new MediaRecoveryIntent();
  intent.set("audio", true, "studio");
  intent.set("screen", true, "studio");

  assert.deepEqual(intent.restoreFor({ roomId: "studio", role: "display", mode: "watch" }), {
    roomId: "studio", audio: false, screen: true,
  });
});

test("resumed receiver uses fresh subscription metadata and waits for the next VP8 keyframe", { timeout: 25_000 }, async () => {
  const sockets = [];
  await withServer(async (baseUrl) => {
    try {
      const publisher = await connect(baseUrl); sockets.push(publisher);
      const originalReceiver = await connect(baseUrl); sockets.push(originalReceiver);
      const publisherJoin = await joinResumable(publisher, { displayName: "Continuous publisher" });
      const receiverJoin = await joinResumable(originalReceiver, { displayName: "Recovering receiver" });

      const audioSubscribed = subscribe(originalReceiver, "audio");
      const screenSubscribed = subscribe(originalReceiver, "screen");
      const audioStreamAtReceiver = nextMessage(originalReceiver, (message) => message.type === "audio.stream");
      const screenStreamAtReceiver = nextMessage(originalReceiver, (message) => message.type === "screen.stream");
      const audioStarted = startAudio(publisher);
      const screenStarted = startScreen(publisher);
      const [audioAck, screenAck, firstAudioStream, firstScreenStream, audioStart, screenStart] = await Promise.all([
        audioSubscribed, screenSubscribed, audioStreamAtReceiver, screenStreamAtReceiver, audioStarted, screenStarted,
      ]);
      assert.equal(audioAck.type, "audio.subscribed");
      assert.equal(screenAck.type, "screen.subscribed");
      assert.deepEqual(firstAudioStream.config, {
        codec: "opus", sampleRate: 48_000, channels: 1, bitrate: 32_000, frameDurationUs: 20_000,
      });
      assert.equal(firstAudioStream.generation, audioStart.generation);
      assert.equal(firstScreenStream.codec, "vp8");
      assert.equal(firstScreenStream.generation, screenStart.generation);
      assert.equal(firstScreenStream.width, 320);
      assert.equal(firstScreenStream.height, 180);

      const initialAudio = nextBinary(originalReceiver, "LTA1");
      const initialScreen = nextBinary(originalReceiver, "LTS1");
      publisher.send(makeAudioFrame(audioStart.generation, 0));
      publisher.send(makeScreenFrame(screenStart.generation, 0));
      assert.equal((await initialAudio).readUInt32BE(4), audioStart.generation);
      assert.equal((await initialScreen)[20], 0);

      await closeAndWait(originalReceiver);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const resumedReceiver = await connect(baseUrl); sockets.push(resumedReceiver);
      const recovered = await resume(resumedReceiver, receiverJoin.issued.token);
      assert.equal(recovered.resumed.participantId, receiverJoin.participation.participantId);
      assert.equal(recovered.resumed.roomId, "studio");
      assert.equal(recovered.resumed.mode, "watch");
      assert.deepEqual({
        audio: recovered.participation.media.audio.subscribed,
        screen: recovered.participation.media.screen.subscribed,
      }, { audio: false, screen: false }, "a fresh socket begins with no old subscriptions");

      const audioResubscription = subscribe(resumedReceiver, "audio");
      const screenResubscription = subscribe(resumedReceiver, "screen");
      const audioStreamAfterResume = nextMessage(resumedReceiver, (message) => message.type === "audio.stream");
      const screenStreamAfterResume = nextMessage(resumedReceiver, (message) => message.type === "screen.stream");
      const keyframeRequest = nextMessage(publisher, (message) => message.type === "screen.keyframeRequest");
      const [audioReack, screenReack, recoveredAudioStream, recoveredScreenStream, requestedKeyframe] = await Promise.all([
        audioResubscription, screenResubscription, audioStreamAfterResume, screenStreamAfterResume, keyframeRequest,
      ]);
      assert.equal(audioReack.type, "audio.subscribed");
      assert.equal(screenReack.type, "screen.subscribed");
      assert.equal(recoveredAudioStream.generation, firstAudioStream.generation);
      assert.equal(recoveredAudioStream.clockId, firstAudioStream.clockId);
      assert.deepEqual(recoveredAudioStream.config, firstAudioStream.config);
      assert.equal(recoveredScreenStream.generation, firstScreenStream.generation);
      assert.equal(recoveredScreenStream.clockId, firstScreenStream.clockId);
      assert.equal(recoveredScreenStream.codec, firstScreenStream.codec);
      assert.deepEqual({ generation: requestedKeyframe.generation }, { generation: firstScreenStream.generation });

      const inspected = nextMessage(resumedReceiver, (message) => message.type === "participation.self");
      resumedReceiver.send(JSON.stringify({ type: "participation.inspect" }));
      const freshSubscriptionState = await inspected;
      assert.equal(freshSubscriptionState.media.audio.subscribed, true);
      assert.equal(freshSubscriptionState.media.screen.subscribed, true);

      const noDeltaFrame = noBinary(resumedReceiver, 80);
      publisher.send(makeScreenFrame(screenStart.generation, 1, false));
      await noDeltaFrame;
      const recoveredKeyframe = nextBinary(resumedReceiver, "LTS1");
      publisher.send(makeScreenFrame(screenStart.generation, 2, true));
      assert.equal((await recoveredKeyframe)[20], 0, "the resumed screen decoder begins on a current keyframe");
      const recoveredAudio = nextBinary(resumedReceiver, "LTA1");
      publisher.send(makeAudioFrame(audioStart.generation, 1));
      assert.equal((await recoveredAudio).readUInt32BE(4), audioStart.generation);

      await closeAndWait(resumedReceiver);
      await closeAndWait(publisher);
      assert.ok(publisherJoin.participation.participantId);
    } finally {
      await Promise.all(sockets.map(closeAndWait));
    }
  });
});

test("publisher disconnect ends old streams; resuming control does not restart them until a new start", { timeout: 25_000 }, async () => {
  const sockets = [];
  await withServer(async (baseUrl) => {
    try {
      const originalPublisher = await connect(baseUrl); sockets.push(originalPublisher);
      const receiver = await connect(baseUrl); sockets.push(receiver);
      const publisherJoin = await joinResumable(originalPublisher, { displayName: "Publisher" });
      await joinResumable(receiver, { displayName: "Receiver" });
      await Promise.all([subscribe(receiver, "audio"), subscribe(receiver, "screen")]);

      const firstAudioStream = nextMessage(receiver, (message) => message.type === "audio.stream");
      const firstScreenStream = nextMessage(receiver, (message) => message.type === "screen.stream");
      const firstAudioStart = startAudio(originalPublisher);
      const firstScreenStart = startScreen(originalPublisher);
      const [oldAudioStream, oldScreenStream, oldAudioPublisher, oldScreenPublisher] = await Promise.all([
        firstAudioStream, firstScreenStream, firstAudioStart, firstScreenStart,
      ]);
      const oldAudioFrame = nextBinary(receiver, "LTA1");
      const oldScreenFrame = nextBinary(receiver, "LTS1");
      originalPublisher.send(makeAudioFrame(oldAudioPublisher.generation, 0));
      originalPublisher.send(makeScreenFrame(oldScreenPublisher.generation, 0));
      await Promise.all([oldAudioFrame, oldScreenFrame]);

      const audioEnded = nextMessage(receiver, (message) => message.type === "audio.streamEnded");
      const screenEnded = nextMessage(receiver, (message) => message.type === "screen.streamEnded");
      await closeAndWait(originalPublisher);
      assert.equal((await audioEnded).generation, oldAudioPublisher.generation);
      assert.equal((await screenEnded).generation, oldScreenPublisher.generation);

      const resumedPublisher = await connect(baseUrl); sockets.push(resumedPublisher);
      const recovered = await resume(resumedPublisher, publisherJoin.issued.token);
      assert.equal(recovered.resumed.participantId, publisherJoin.participation.participantId);
      assert.equal(recovered.participation.media.audio.subscribed, false);
      assert.equal(recovered.participation.media.screen.subscribed, false);
      await noMatchingMessage(receiver, (message) => message.type === "audio.stream" || message.type === "screen.stream", 150);
      await noBinary(receiver, 80);

      const nextAudioStream = nextMessage(receiver, (message) => message.type === "audio.stream");
      const nextScreenStream = nextMessage(receiver, (message) => message.type === "screen.stream");
      const nextAudioStart = startAudio(resumedPublisher);
      const nextScreenStart = startScreen(resumedPublisher);
      const [audioStream, screenStream, audioStart, screenStart] = await Promise.all([
        nextAudioStream, nextScreenStream, nextAudioStart, nextScreenStart,
      ]);
      assert.ok(audioStart.generation > oldAudioPublisher.generation);
      assert.notEqual(audioStream.clockId, oldAudioStream.clockId);
      assert.equal(audioStream.generation, audioStart.generation);
      assert.ok(screenStart.generation > oldScreenPublisher.generation);
      assert.notEqual(screenStream.clockId, oldScreenStream.clockId);
      assert.equal(screenStream.generation, screenStart.generation);

      const newAudioFrame = nextBinary(receiver, "LTA1");
      const newScreenFrame = nextBinary(receiver, "LTS1");
      resumedPublisher.send(makeAudioFrame(audioStart.generation, 0));
      resumedPublisher.send(makeScreenFrame(screenStart.generation, 0));
      assert.equal((await newAudioFrame).readUInt32BE(4), audioStart.generation);
      assert.equal((await newScreenFrame)[20], 0);
    } finally {
      await Promise.all(sockets.map(closeAndWait));
    }
  });
});
