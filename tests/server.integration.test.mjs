import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import WebSocket from "ws";
import { createApp } from "../src/server/app.ts";

let app;
let baseUrl;
const MESSAGE_TIMEOUT_MS = 5_000;

before(async () => {
  app = await createApp({ serveClient: false, localCapacityAdmin: true });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await app?.close();
});

function connect(origin = baseUrl) {
  const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/ws`, { origin });
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
    const onMessage = (raw) => {
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

function send(socket, value) {
  socket.send(JSON.stringify(value));
}

async function updateCapacity(softLimit) {
  const response = await fetch(`${baseUrl}/api/poc/capacity`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ softLimit }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.error ?? body.message);
  return body;
}

function waitForClose(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("close", onClose);
      reject(new Error(`WebSocket did not close within ${MESSAGE_TIMEOUT_MS} ms.`));
    }, MESSAGE_TIMEOUT_MS);
    const onClose = (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    };
    socket.once("close", onClose);
  });
}

test("the application serves health and a built-in room catalogue", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", persistence: "process-memory" });

  const rooms = await fetch(`${baseUrl}/api/rooms`);
  assert.equal(rooms.status, 200);
  assert.deepEqual(await rooms.json(), [
    { id: "lobby", name: "Open area", kind: "open-area", audioPolicy: "proximity", audioRadiusGridUnits: 6, isLocked: false, hostControlsEnabled: false },
    { id: "studio", name: "Meeting room", kind: "meeting-room", audioPolicy: "room", audioRadiusGridUnits: null, isLocked: false, hostControlsEnabled: false },
  ]);
});

test("two clients receive the same authoritative members and sequenced reaction", async () => {
  const first = await connect();
  const firstSnapshot = nextMessage(first, (message) => message.type === "room.snapshot");
  send(first, { type: "join", roomId: "lobby", displayName: "Ada" });
  const firstState = await firstSnapshot;
  assert.deepEqual(firstState.members.map((member) => member.displayName), ["Ada"]);

  const second = await connect();
  const secondSnapshot = nextMessage(second, (message) => message.type === "room.snapshot");
  const firstJoin = nextMessage(first, (message) => message.type === "control.event" && message.event.kind === "member.joined");
  send(second, { type: "join", roomId: "lobby", displayName: "Grace" });
  const secondState = await secondSnapshot;
  const firstJoinEvent = await firstJoin;
  assert.deepEqual(secondState.members.map((member) => member.displayName), ["Ada", "Grace"]);
  assert.equal(firstJoinEvent.event.seq, secondState.lastSeq);

  const firstReaction = nextMessage(first, (message) => message.type === "control.event" && message.event.kind === "reaction");
  const secondReaction = nextMessage(second, (message) => message.type === "control.event" && message.event.kind === "reaction");
  send(first, { type: "reaction", reaction: "wave" });
  const [seenByFirst, seenBySecond] = await Promise.all([firstReaction, secondReaction]);
  assert.deepEqual(seenByFirst, seenBySecond);
  assert.equal(seenByFirst.event.displayName, "Ada");
  assert.equal(seenByFirst.event.reaction, "wave");
  assert.equal(seenByFirst.event.seq, firstJoinEvent.event.seq + 1);

  const leftEvent = nextMessage(first, (message) => message.type === "control.event" && message.event.kind === "member.left");
  second.close();
  const left = await leftEvent;
  assert.equal(left.event.displayName, "Grace");
  assert.equal(left.event.seq, seenByFirst.event.seq + 1);
  first.close();
});

test("the websocket rejects cross-origin clients before joining", async () => {
  const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/ws`, { origin: "https://attacker.invalid" });
  const result = await new Promise((resolve) => {
    socket.once("unexpected-response", (_request, response) => resolve({ status: response.statusCode }));
    socket.once("error", () => {});
  });
  assert.equal(result.status, 403);
  socket.terminate();
});

test("malformed or oversized control frames close without being broadcast", async () => {
  const sender = await connect();
  const snapshot = nextMessage(sender, (message) => message.type === "room.snapshot");
  send(sender, { type: "join", roomId: "lobby", displayName: "Sender" });
  await snapshot;

  const invalid = nextMessage(sender, (message) => message.type === "protocol.error");
  const invalidClosePromise = waitForClose(sender);
  sender.send("not-json");
  const protocolError = await invalid;
  assert.equal(protocolError.code, "invalid_message");
  const invalidClose = await invalidClosePromise;
  assert.equal(invalidClose.code, 1008);

  const oversized = await connect();
  const oversizedClose = waitForClose(oversized);
  oversized.send("x".repeat(1025));
  assert.equal((await oversizedClose).code, 1009);
});

test("clients cannot select arbitrary rooms", async () => {
  const socket = await connect();
  const error = nextMessage(socket, (message) => message.type === "protocol.error");
  const closed = waitForClose(socket);
  send(socket, { type: "join", roomId: "elsewhere", displayName: "A" });
  assert.equal((await error).code, "invalid_join");
  assert.equal((await closed).code, 1008);
});

test("display names longer than the server limit are rejected", async () => {
  const socket = await connect();
  const error = nextMessage(socket, (message) => message.type === "protocol.error");
  const closed = waitForClose(socket);
  send(socket, { type: "join", roomId: "lobby", displayName: "A".repeat(33) });
  assert.equal((await error).code, "invalid_join");
  assert.equal((await closed).code, 1008);
});

test("control events reject client-supplied fields outside the protocol", async () => {
  const socket = await connect();
  const snapshot = nextMessage(socket, (message) => message.type === "room.snapshot");
  send(socket, { type: "join", roomId: "lobby", displayName: "Ada" });
  await snapshot;
  const error = nextMessage(socket, (message) => message.type === "protocol.error");
  const closed = waitForClose(socket);
  send(socket, { type: "reaction", reaction: "wave", roomId: "another-room" });
  assert.equal((await error).code, "invalid_event");
  assert.equal((await closed).code, 1008);
});

async function cleanupCapacitySockets(sockets) {
  await Promise.all(sockets.map(async (socket) => {
    if (socket.readyState === WebSocket.CLOSED) return;
    const closed = waitForClose(socket);
    socket.close();
    await closed;
  }));
  await updateCapacity(10);
  const deadline = Date.now() + MESSAGE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = await (await fetch(`${baseUrl}/api/poc/capacity`)).json();
    if (state.currentMembers === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Capacity test fixture did not clear its joined members.");
}

test("the default service member limit is ten and rejects a join at capacity", async () => {
  const sockets = [];
  try {
    for (let index = 1; index <= 10; index += 1) {
      const socket = await connect();
      sockets.push(socket);
      const snapshot = nextMessage(socket, (message) => message.type === "room.snapshot");
      send(socket, { type: "join", roomId: "lobby", displayName: `Guest ${index}` });
      assert.equal((await snapshot).members.length, index);
    }

    const eleventh = await connect();
    sockets.push(eleventh);
    const error = nextMessage(eleventh, (message) => message.type === "protocol.error");
    const closed = waitForClose(eleventh);
    send(eleventh, { type: "join", roomId: "lobby", displayName: "Guest 11" });
    const rejection = await error;
    assert.equal(rejection.code, "room_full");
    assert.match(rejection.message, /10 members/u);
    assert.equal((await closed).code, 1008);
  } finally {
    await cleanupCapacitySockets(sockets);
  }
});

test("capacity can be raised or lowered without removing current members", async () => {
  const sockets = [];
  try {
    for (const [index, name] of ["Ada", "Grace"].entries()) {
      const socket = await connect();
      sockets.push(socket);
      const snapshot = nextMessage(socket, (message) => message.type === "room.snapshot");
      send(socket, { type: "join", roomId: "studio", displayName: name });
      assert.equal((await snapshot).members.length, index + 1);
    }

    assert.equal((await updateCapacity(2)).softLimit, 2);
    const denied = await connect();
    sockets.push(denied);
    const full = nextMessage(denied, (message) => message.type === "protocol.error");
    const deniedClosed = waitForClose(denied);
    send(denied, { type: "join", roomId: "studio", displayName: "Lin" });
    assert.equal((await full).code, "room_full");
    assert.equal((await deniedClosed).code, 1008);

    const lowered = await updateCapacity(1);
    assert.equal(lowered.currentMembers, 2);
    assert.ok(sockets.slice(0, 2).every((socket) => socket.readyState === WebSocket.OPEN));

    assert.equal((await updateCapacity(3)).softLimit, 3);
    const admitted = await connect();
    sockets.push(admitted);
    const snapshot = nextMessage(admitted, (message) => message.type === "room.snapshot");
    send(admitted, { type: "join", roomId: "studio", displayName: "Lin" });
    const joined = await snapshot;
    assert.equal(joined.members.length, 3);
    assert.deepEqual(joined.members.map((member) => member.displayName), ["Ada", "Grace", "Lin"]);
  } finally {
    await cleanupCapacitySockets(sockets);
  }
});

test("resume is subject to the current limit and can retry after it is raised", async () => {
  const sockets = [];
  try {
    await updateCapacity(2);
    const resumable = await connect();
    sockets.push(resumable);
    const issuedPromise = nextMessage(resumable, (message) => message.type === "session.issued");
    const snapshotPromise = nextMessage(resumable, (message) => message.type === "room.snapshot");
    send(resumable, { type: "join", roomId: "lobby", displayName: "Resume member", resumable: true });
    const issued = await issuedPromise;
    await snapshotPromise;

    const other = await connect();
    sockets.push(other);
    const otherSnapshot = nextMessage(other, (message) => message.type === "room.snapshot");
    send(other, { type: "join", roomId: "lobby", displayName: "Other member" });
    await otherSnapshot;

    const leftEvent = nextMessage(other, (message) => message.type === "control.event" && message.event.kind === "member.left");
    resumable.close();
    await leftEvent;
    assert.equal((await updateCapacity(1)).currentMembers, 1);

    const deniedResume = await connect();
    sockets.push(deniedResume);
    const denied = nextMessage(deniedResume, (message) => message.type === "protocol.error");
    const deniedClosed = waitForClose(deniedResume);
    send(deniedResume, { type: "session.resume", token: issued.token });
    assert.equal((await denied).code, "room_full");
    assert.match((await denied).message, /1 members/u);
    assert.equal((await deniedClosed).code, 1013);

    await updateCapacity(2);
    const retry = await connect();
    sockets.push(retry);
    const resumed = nextMessage(retry, (message) => message.type === "room.snapshot");
    send(retry, { type: "session.resume", token: issued.token });
    assert.deepEqual((await resumed).members.map((member) => member.displayName), ["Other member", "Resume member"]);
  } finally {
    await cleanupCapacitySockets(sockets);
  }
});

test("the server closes a client that exceeds the reaction rate limit", async () => {
  const socket = await connect();
  const snapshot = nextMessage(socket, (message) => message.type === "room.snapshot");
  send(socket, { type: "join", roomId: "lobby", displayName: "Ada" });
  await snapshot;
  const error = nextMessage(socket, (message) => message.type === "protocol.error");
  const closed = waitForClose(socket);
  for (let index = 0; index < 11; index += 1) send(socket, { type: "reaction", reaction: "wave" });
  assert.equal((await error).code, "rate_limited");
  assert.equal((await closed).code, 1008);
});
