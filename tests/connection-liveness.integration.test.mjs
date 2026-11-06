import assert from "node:assert/strict";
import net from "node:net";
import { after, test } from "node:test";
import WebSocket from "ws";
import { createApp } from "../src/server/app.ts";

const MESSAGE_TIMEOUT_MS = 4_000;

function decode(raw) {
  return JSON.parse(raw.toString());
}

function nextMessage(socket, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Expected WebSocket message did not arrive.")), MESSAGE_TIMEOUT_MS);
    const onMessage = (raw, isBinary) => {
      if (isBinary) return;
      let message;
      try {
        message = decode(raw);
      } catch (error) {
        finish(error);
        return;
      }
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

function waitForClose(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("WebSocket did not close after the server heartbeat deadline.")), MESSAGE_TIMEOUT_MS);
    const onClose = (code, reason) => finish(null, { code, reason: reason.toString() });
    const onError = (error) => finish(error);
    const finish = (error, value) => {
      clearTimeout(timer);
      socket.off("close", onClose);
      socket.off("error", onError);
      if (error) reject(error);
      else resolve(value);
    };
    socket.once("close", onClose);
    socket.once("error", onError);
  });
}

async function connect(baseUrl) {
  const socket = new WebSocket(`${baseUrl.replace(/^http/u, "ws")}/ws`, { origin: baseUrl });
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      socket.off("open", onOpen);
      reject(error);
    };
    const onOpen = () => {
      socket.off("error", onError);
      resolve();
    };
    socket.once("open", onOpen);
    socket.once("error", onError);
  });
  socket.on("error", () => {});
  return socket;
}

function send(socket, message) {
  socket.send(JSON.stringify(message));
}

async function join(socket, displayName, roomId, password) {
  const session = nextMessage(socket, (message) => message.type === "session.issued");
  const snapshot = nextMessage(socket, (message) => message.type === "room.snapshot" && message.room.id === roomId);
  const manager = nextMessage(socket, (message) => message.type === "room.management.state");
  send(socket, {
    type: "join", roomId, displayName, resumable: true,
    ...(password === undefined ? {} : { password }),
  });
  const [issued, room, management] = await Promise.all([session, snapshot, manager]);
  return { participantId: issued.participantId, room, management };
}

function startTcpBlackholeProxy(upstreamPort) {
  const pairs = new Set();
  let blackholeClientToServer = false;
  let droppedClientBytes = 0;
  const server = net.createServer((client) => {
    const upstream = net.connect(upstreamPort, "127.0.0.1");
    const pair = { client, upstream };
    pairs.add(pair);
    client.on("data", (chunk) => {
      if (blackholeClientToServer) {
        droppedClientBytes += chunk.byteLength;
        return;
      }
      if (upstream.writable && !upstream.write(chunk)) client.pause();
    });
    upstream.on("drain", () => client.resume());
    upstream.on("data", (chunk) => {
      if (client.writable && !client.write(chunk)) upstream.pause();
    });
    client.on("drain", () => upstream.resume());
    client.on("end", () => upstream.end());
    upstream.on("end", () => client.end());
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
    client.on("close", () => {
      upstream.destroy();
      pairs.delete(pair);
    });
    upstream.on("close", () => client.destroy());
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      server.off("error", reject);
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        get droppedClientBytes() { return droppedClientBytes; },
        blackhole() { blackholeClientToServer = true; },
        async close() {
          for (const { client, upstream } of pairs) {
            client.destroy();
            upstream.destroy();
          }
          if (server.listening) await new Promise((done) => server.close(done));
        },
      });
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("a TCP blackhole expires only its WebSocket, hands over room ownership, and cleans up its media", { timeout: 12_000 }, async () => {
  const app = await createApp({
    serveClient: false,
    connectionLivenessForTest: { pingIntervalMs: 50, pongTimeoutMs: 180 },
  });
  const proxies = [];
  let ownerProxy;
  let candidateProxy;
  let owner;
  let candidate;
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const serverAddress = app.server.address();
    ownerProxy = await startTcpBlackholeProxy(serverAddress.port);
    candidateProxy = await startTcpBlackholeProxy(serverAddress.port);
    proxies.push(ownerProxy, candidateProxy);

    owner = await connect(ownerProxy.baseUrl);
    const ownerJoin = await join(owner, "Original manager", "studio");
    const lockResult = nextMessage(owner, (message) => message.type === "room.management.result" && message.action === "lock");
    send(owner, { type: "room.management.lock", password: "liveness-room-password" });
    assert.equal((await lockResult).isLocked, true);

    candidate = await connect(candidateProxy.baseUrl);
    const candidateJoin = await join(candidate, "Room candidate", "studio", "liveness-room-password");
    assert.notEqual(candidateJoin.participantId, ownerJoin.participantId);
    assert.equal(candidateJoin.management.isOwner, false);

    const candidateStateAfterSwitch = nextMessage(candidate, (message) =>
      message.type === "room.management.state" && message.isLocked && !message.isOwner,
    );
    const ownerLobby = nextMessage(owner, (message) => message.type === "room.snapshot" && message.room.id === "lobby");
    send(owner, { type: "room.switch", roomId: "lobby" });
    await Promise.all([candidateStateAfterSwitch, ownerLobby]);

    const ownerRestoredManager = nextMessage(owner, (message) => message.type === "room.management.state" && message.isOwner);
    const ownerStudio = nextMessage(owner, (message) => message.type === "room.snapshot" && message.room.id === "studio");
    send(owner, { type: "room.switch", roomId: "studio", password: "liveness-room-password" });
    await Promise.all([ownerRestoredManager, ownerStudio]);

    const candidateSubscribed = nextMessage(candidate, (message) => message.type === "audio.subscribed");
    send(candidate, { type: "audio.subscribe" });
    await candidateSubscribed;
    const publisherStarted = nextMessage(owner, (message) => message.type === "audio.started");
    const candidateStream = nextMessage(candidate, (message) => message.type === "audio.stream");
    send(owner, { type: "audio.start", codec: "opus", sampleRate: 48_000, channels: 1, bitrate: 32_000, frameDurationUs: 20_000 });
    await Promise.all([publisherStarted, candidateStream]);

    await sleep(400);
    assert.equal(candidate.readyState, WebSocket.OPEN, "regular pongs keep the other socket alive across several deadlines");

    const ownerClosed = waitForClose(owner);
    const streamEnded = nextMessage(candidate, (message) => message.type === "audio.streamEnded");
    const candidateBecameOwner = nextMessage(candidate, (message) =>
      message.type === "room.management.state" && message.isLocked && message.isOwner && message.ownerParticipantId === candidateJoin.participantId,
    );
    ownerProxy.blackhole();
    await Promise.all([ownerClosed, streamEnded, candidateBecameOwner]);

    assert.ok(ownerProxy.droppedClientBytes > 0, "the proxy discarded the client's WebSocket pong bytes");
    assert.equal((await streamEnded).reason, "publisher_stopped", "disconnect cleanup ends the publisher stream for the healthy subscriber");
    assert.equal(candidate.readyState, WebSocket.OPEN, "only the blackholed socket is terminated");
    const rooms = await (await fetch(`http://127.0.0.1:${serverAddress.port}/api/rooms`)).json();
    assert.equal(rooms.find((room) => room.id === "studio").isLocked, true, "owner timeout transfers management to the online studio member");
  } finally {
    owner?.terminate();
    candidate?.terminate();
    await app.close();
    await Promise.all(proxies.map((item) => item.close()));
  }
});
