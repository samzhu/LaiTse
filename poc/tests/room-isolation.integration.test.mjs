import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import WebSocket from "ws";
import { createApp } from "../src/server/app.ts";

let app;
let baseUrl;
const MESSAGE_TIMEOUT_MS = 3_000;
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
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch (error) {
        clearTimeout(timer);
        socket.off("error", onError);
        socket.off("message", onMessage);
        reject(error);
        return;
      }
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
      reject(new Error(`Expected ${magic} WebSocket frame did not arrive within ${MESSAGE_TIMEOUT_MS} ms.`));
    }, MESSAGE_TIMEOUT_MS);
    const onError = (error) => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      reject(error);
    };
    const onMessage = (raw, isBinary) => {
      if (!isBinary) return;
      const bytes = Buffer.from(raw);
      if (bytes.byteLength < 4 || bytes.toString("ascii", 0, 4) !== magic) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      socket.off("error", onError);
      resolve(bytes);
    };
    socket.on("message", onMessage);
    socket.once("error", onError);
  });
}

function collectBinaries(socket, durationMs = 100) {
  return new Promise((resolve) => {
    const frames = [];
    const onMessage = (raw, isBinary) => {
      if (isBinary) frames.push(Buffer.from(raw));
    };
    socket.on("message", onMessage);
    setTimeout(() => {
      socket.off("message", onMessage);
      resolve(frames);
    }, durationMs);
  });
}

function noMessage(socket, predicate, durationMs = 100) {
  return new Promise((resolve) => {
    const onMessage = (raw, isBinary) => {
      if (isBinary) return;
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(message);
    };
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      resolve(null);
    }, durationMs);
    socket.on("message", onMessage);
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

async function join(socket, roomId, displayName) {
  const roomSnapshot = nextJson(socket, (message) => message.type === "room.snapshot");
  const spaceSnapshot = nextJson(socket, (message) => message.type === "space.snapshot");
  socket.send(JSON.stringify({ type: "join", roomId, displayName }));
  return await Promise.all([roomSnapshot, spaceSnapshot]);
}

function makeAudioFrame(generation, sequence, sourceTag) {
  const payload = Buffer.from(`audio-source-${sourceTag}-${sequence}`);
  const frame = Buffer.alloc(24 + payload.byteLength);
  frame.write("LTA1", 0, "ascii");
  frame.writeUInt32BE(generation, 4);
  frame.writeUInt32BE(sequence, 8);
  frame.writeDoubleBE(sequence * 20_000, 12);
  frame.writeUInt32BE(20_000, 20);
  payload.copy(frame, 24);
  return frame;
}

function makeScreenFrame(generation, sequence, sourceTag, chunkType = 0) {
  const payload = Buffer.from([0x00, 0x00, 0x00, sourceTag.charCodeAt(0), sequence & 0xff]);
  const frame = Buffer.alloc(24 + payload.byteLength);
  frame.write("LTS1", 0, "ascii");
  frame.writeUInt32BE(generation, 4);
  frame.writeUInt32BE(sequence, 8);
  frame.writeDoubleBE(sequence * 100_000, 12);
  frame[20] = chunkType;
  payload.copy(frame, 24);
  return frame;
}

function startAudio(socket) {
  const started = nextJson(socket, (message) => message.type === "audio.started");
  socket.send(JSON.stringify({
    type: "audio.start",
    codec: "opus",
    sampleRate: 48_000,
    channels: 1,
    bitrate: 32_000,
    frameDurationUs: 20_000,
  }));
  return started;
}

function startScreen(socket) {
  const started = nextJson(socket, (message) => message.type === "screen.started");
  socket.send(JSON.stringify({ type: "screen.start", codec: "vp8", width: 64, height: 64, frameRate: 5, bitrate: 80_000 }));
  return started;
}

async function subscribe(socket, channel) {
  const subscribed = nextJson(socket, (message) => message.type === `${channel}.subscribed`);
  socket.send(JSON.stringify({ type: `${channel}.subscribe` }));
  return await subscribed;
}

async function expectRejected(socket, payload, expectedCode) {
  const error = nextJson(socket, (message) => message.type === "protocol.error");
  const closed = waitForClose(socket);
  socket.send(Buffer.isBuffer(payload) ? payload : JSON.stringify(payload));
  assert.equal((await error).code, expectedCode);
  assert.equal(await closed, 1008);
}

function closeAll(sockets) {
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  }
}

test("two rooms relay independent media, hide foreign members, and require a fresh subscription after switching", { timeout: TEST_TIMEOUT_MS }, async () => {
  const sockets = [];
  try {
    const lobbyPublisher = await connect();
    const lobbyReceiver = await connect();
    const studioPublisher = await connect();
    const studioReceiver = await connect();
    sockets.push(lobbyPublisher, lobbyReceiver, studioPublisher, studioReceiver);

    const [, lobbySpace] = await join(lobbyPublisher, "lobby", "Lobby Publisher");
    const [, lobbyReceiverSpace] = await join(lobbyReceiver, "lobby", "Lobby Receiver");
    const noForeignJoinEvent = noMessage(lobbyReceiver, (message) => message.type === "control.event" && message.event.roomId === "studio");
    const lobbySpaceAfterStudioPublisherJoins = nextJson(lobbyReceiver, (message) => message.type === "space.snapshot");
    const [, studioSpace] = await join(studioPublisher, "studio", "Studio Publisher");
    const lobbyUpdatedSpace = await lobbySpaceAfterStudioPublisherJoins;
    const [, studioReceiverSpace] = await join(studioReceiver, "studio", "Studio Receiver");
    assert.equal(await noForeignJoinEvent, null);

    const lobbyId = lobbySpace.rooms.find((room) => room.id === "lobby").players[0].id;
    const foreignStudioId = studioSpace.rooms.find((room) => room.id === "studio").players[0].id;
    assert.deepEqual(lobbySpace.rooms.find((room) => room.id === "lobby").players.map((player) => player.displayName), ["Lobby Publisher"]);
    for (const snapshot of [lobbyReceiverSpace, lobbyUpdatedSpace]) {
      assert.deepEqual(snapshot.rooms.find((room) => room.id === "lobby").players.map((player) => player.displayName).sort(), ["Lobby Publisher", "Lobby Receiver"]);
      assert.equal(snapshot.rooms.find((room) => room.id === "lobby").membersVisible, true);
      assert.deepEqual(snapshot.rooms.find((room) => room.id === "studio").players, []);
      assert.equal(snapshot.rooms.find((room) => room.id === "studio").membersVisible, false);
      assert.equal(JSON.stringify(snapshot).includes("Studio Publisher"), false);
      assert.equal(JSON.stringify(snapshot).includes(foreignStudioId), false);
    }
    assert.deepEqual(studioSpace.rooms.find((room) => room.id === "studio").players.map((player) => player.displayName), ["Studio Publisher"]);
    for (const snapshot of [studioReceiverSpace]) {
      assert.deepEqual(snapshot.rooms.find((room) => room.id === "studio").players.map((player) => player.displayName).sort(), ["Studio Publisher", "Studio Receiver"]);
      assert.equal(snapshot.rooms.find((room) => room.id === "studio").membersVisible, true);
      assert.deepEqual(snapshot.rooms.find((room) => room.id === "lobby").players, []);
      assert.equal(snapshot.rooms.find((room) => room.id === "lobby").membersVisible, false);
      assert.equal(JSON.stringify(snapshot).includes("Lobby Publisher"), false);
      assert.equal(JSON.stringify(snapshot).includes(lobbyId), false);
    }

    await Promise.all([subscribe(lobbyReceiver, "audio"), subscribe(lobbyReceiver, "screen"), subscribe(studioReceiver, "audio"), subscribe(studioReceiver, "screen")]);

    const lobbyAudioStream = nextJson(lobbyReceiver, (message) => message.type === "audio.stream");
    const studioAudioStream = nextJson(studioReceiver, (message) => message.type === "audio.stream");
    const lobbyAudioStarted = startAudio(lobbyPublisher);
    const studioAudioStarted = startAudio(studioPublisher);
    const [lobbyAudioInfo, studioAudioInfo, lobbyAudioAck, studioAudioAck] = await Promise.all([lobbyAudioStream, studioAudioStream, lobbyAudioStarted, studioAudioStarted]);
    assert.equal(lobbyAudioAck.generation, 1);
    assert.equal(studioAudioAck.generation, 1);
    assert.notEqual(lobbyAudioInfo.clockId, studioAudioInfo.clockId, "generation numbers are room-local; clock IDs identify distinct publishers");

    const lobbyScreenStream = nextJson(lobbyReceiver, (message) => message.type === "screen.stream");
    const studioScreenStream = nextJson(studioReceiver, (message) => message.type === "screen.stream");
    const [lobbyScreenAck, studioScreenAck, lobbyScreenInfo, studioScreenInfo] = await Promise.all([
      startScreen(lobbyPublisher),
      startScreen(studioPublisher),
      lobbyScreenStream,
      studioScreenStream,
    ]);
    assert.equal(lobbyScreenAck.generation, 1);
    assert.equal(studioScreenAck.generation, 1);
    assert.notEqual(lobbyScreenInfo.clockId, studioScreenInfo.clockId);

    const lobbyReceived = collectBinaries(lobbyReceiver, 180);
    const studioReceived = collectBinaries(studioReceiver, 180);
    const lobbyAudioFrame = makeAudioFrame(lobbyAudioAck.generation, 0, "L");
    const studioAudioFrame = makeAudioFrame(studioAudioAck.generation, 0, "S");
    const lobbyScreenFrame = makeScreenFrame(lobbyScreenAck.generation, 0, "L");
    const studioScreenFrame = makeScreenFrame(studioScreenAck.generation, 0, "S");
    lobbyPublisher.send(lobbyAudioFrame);
    lobbyPublisher.send(lobbyScreenFrame);
    studioPublisher.send(studioAudioFrame);
    studioPublisher.send(studioScreenFrame);
    const [lobbyPackets, studioPackets] = await Promise.all([lobbyReceived, studioReceived]);
    assert.deepEqual(lobbyPackets.sort((a, b) => a.toString("ascii", 0, 4).localeCompare(b.toString("ascii", 0, 4))), [lobbyAudioFrame, lobbyScreenFrame].sort((a, b) => a.toString("ascii", 0, 4).localeCompare(b.toString("ascii", 0, 4))));
    assert.deepEqual(studioPackets.sort((a, b) => a.toString("ascii", 0, 4).localeCompare(b.toString("ascii", 0, 4))), [studioAudioFrame, studioScreenFrame].sort((a, b) => a.toString("ascii", 0, 4).localeCompare(b.toString("ascii", 0, 4))));
    assert.equal(lobbyPackets.some((packet) => packet.equals(studioAudioFrame) || packet.equals(studioScreenFrame)), false);
    assert.equal(studioPackets.some((packet) => packet.equals(lobbyAudioFrame) || packet.equals(lobbyScreenFrame)), false);

    const audioUnsubscribed = nextJson(lobbyReceiver, (message) => message.type === "audio.unsubscribed");
    const screenUnsubscribed = nextJson(lobbyReceiver, (message) => message.type === "screen.unsubscribed");
    lobbyReceiver.send(JSON.stringify({ type: "audio.unsubscribe" }));
    lobbyReceiver.send(JSON.stringify({ type: "screen.unsubscribe" }));
    await Promise.all([audioUnsubscribed, screenUnsubscribed]);

    const lobbyReceiverRoom = nextJson(lobbyReceiver, (message) => message.type === "room.snapshot" && message.room.id === "studio");
    const lobbyReceiverSwitchedSpace = nextJson(lobbyReceiver, (message) => message.type === "space.snapshot" && message.currentRoomId === "studio");
    lobbyReceiver.send(JSON.stringify({ type: "room.switch", roomId: "studio" }));
    const [studioRoomSnapshot, switchedSpace] = await Promise.all([lobbyReceiverRoom, lobbyReceiverSwitchedSpace]);
    assert.deepEqual(studioRoomSnapshot.members.map((member) => member.displayName).sort(), ["Lobby Receiver", "Studio Publisher", "Studio Receiver"]);
    assert.equal(switchedSpace.rooms.find((room) => room.id === "lobby").membersVisible, false);
    assert.deepEqual(switchedSpace.rooms.find((room) => room.id === "lobby").players, []);

    const noAutomaticResume = collectBinaries(lobbyReceiver, 100);
    lobbyPublisher.send(makeAudioFrame(lobbyAudioAck.generation, 1, "L"));
    lobbyPublisher.send(makeScreenFrame(lobbyScreenAck.generation, 1, "L", 1));
    assert.deepEqual(await noAutomaticResume, [], "a room change removes the old subscriptions and does not resume in the new room");

    const switchedAudioStream = nextJson(lobbyReceiver, (message) => message.type === "audio.stream");
    const switchedScreenStream = nextJson(lobbyReceiver, (message) => message.type === "screen.stream");
    const switchedAudioSubscribed = nextJson(lobbyReceiver, (message) => message.type === "audio.subscribed");
    const switchedScreenSubscribed = nextJson(lobbyReceiver, (message) => message.type === "screen.subscribed");
    lobbyReceiver.send(JSON.stringify({ type: "audio.subscribe" }));
    lobbyReceiver.send(JSON.stringify({ type: "screen.subscribe" }));
    await Promise.all([switchedAudioSubscribed, switchedScreenSubscribed, switchedAudioStream, switchedScreenStream]);
    const movedAudio = nextBinary(lobbyReceiver, "LTA1");
    const movedScreen = nextBinary(lobbyReceiver, "LTS1");
    const nextStudioAudio = makeAudioFrame(studioAudioAck.generation, 1, "S");
    const nextStudioScreen = makeScreenFrame(studioScreenAck.generation, 1, "S");
    studioPublisher.send(nextStudioAudio);
    studioPublisher.send(nextStudioScreen);
    assert.deepEqual(await movedAudio, nextStudioAudio);
    assert.deepEqual(await movedScreen, nextStudioScreen);
    assert.equal((await switchedAudioStream).clockId, studioAudioInfo.clockId);
    assert.equal((await switchedScreenStream).clockId, studioScreenInfo.clockId);

    const forgedJoin = await connect();
    sockets.push(forgedJoin);
    await expectRejected(forgedJoin, {
      type: "join",
      roomId: "studio",
      displayName: "Forged Join",
      participantId: foreignStudioId,
      identity: "claimed-identity",
      role: "host",
    }, "invalid_join");

    const forgedRoomSwitch = await connect();
    sockets.push(forgedRoomSwitch);
    await join(forgedRoomSwitch, "studio", "Switch Spoof");
    await expectRejected(forgedRoomSwitch, {
      type: "room.switch",
      roomId: "lobby",
      participantId: lobbyId,
      role: "host",
    }, "invalid_room_switch");

    const forgedAudio = await connect();
    sockets.push(forgedAudio);
    await join(forgedAudio, "lobby", "Audio Spoof");
    await expectRejected(forgedAudio, {
      type: "audio.start",
      codec: "opus",
      sampleRate: 48_000,
      channels: 1,
      bitrate: 32_000,
      frameDurationUs: 20_000,
      roomId: "studio",
      participantId: foreignStudioId,
      identity: "claimed-identity",
      role: "host",
    }, "invalid_audio_config");

    const forgedScreen = await connect();
    sockets.push(forgedScreen);
    await join(forgedScreen, "studio", "Screen Spoof");
    await expectRejected(forgedScreen, {
      type: "screen.subscribe",
      roomId: "lobby",
      participantId: lobbyId,
      identity: "claimed-identity",
      role: "host",
    }, "invalid_screen_control");

    const unauthorizedAudio = await connect();
    sockets.push(unauthorizedAudio);
    await join(unauthorizedAudio, "lobby", "Audio Intruder");
    await expectRejected(unauthorizedAudio, makeAudioFrame(1, 2, "X"), "audio_not_publisher");

    const unauthorizedScreen = await connect();
    sockets.push(unauthorizedScreen);
    await join(unauthorizedScreen, "studio", "Screen Intruder");
    await expectRejected(unauthorizedScreen, makeScreenFrame(1, 2, "X"), "screen_not_publisher");

    const response = await fetch(`${baseUrl}/api/media-diagnostics`);
    assert.equal(response.status, 200);
    const diagnostics = await response.json();
    assert.deepEqual(diagnostics.rooms.map((room) => room.roomId), ["lobby", "studio"]);
    for (const room of diagnostics.rooms) {
      assert.equal(room.audio.crossRoomGuardBlocks, 0);
      assert.equal(room.screen.crossRoomGuardBlocks, 0);
      assert.equal(room.control.crossRoomGuardBlocks, 0);
      assert.ok(room.audio.guardedSendChecks > 0);
      assert.ok(room.screen.guardedSendChecks > 0);
      assert.ok(room.control.guardedSendChecks > 0);
    }
    const lobbyCounters = diagnostics.rooms.find((room) => room.roomId === "lobby");
    const studioCounters = diagnostics.rooms.find((room) => room.roomId === "studio");
    assert.ok(lobbyCounters.audio.binaryFramesSent >= 1);
    assert.ok(lobbyCounters.screen.binaryFramesSent >= 1);
    assert.ok(studioCounters.audio.binaryFramesSent >= 3);
    assert.ok(studioCounters.screen.binaryFramesSent >= 3);
    assert.ok(lobbyCounters.audio.rejected >= 2, "spoofed audio config and unauthorized binary publish are counted");
    assert.ok(studioCounters.screen.rejected >= 2, "spoofed screen control and unauthorized binary publish are counted");
    assert.ok(diagnostics.unassignedControlRejections >= 1);
    const serializedDiagnostics = JSON.stringify(diagnostics);
    for (const privateValue of ["Lobby Publisher", "Studio Publisher", lobbyId, foreignStudioId, "claimed-identity"]) {
      assert.equal(serializedDiagnostics.includes(privateValue), false, "diagnostics contain counters but no member, connection, or identity values");
    }
  } finally {
    closeAll(sockets);
  }
});
