import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import WebSocket from "ws";
import { InteractionStore, INTERACTION_LIMITS, parseInteractionInput } from "../src/server/interactions.ts";
import { createApp } from "../src/server/app.ts";

const HOST_TOKEN = "T10-host-test-token-0123456789abcdef";
const MESSAGE_TIMEOUT_MS = 5_000;
let app;
let baseUrl;

beforeEach(async () => {
  app = await createApp({ serveClient: false, hostControlToken: HOST_TOKEN });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await app?.close();
});

function connect(origin = baseUrl) {
  const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/ws`, { origin });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error(`WebSocket did not open within ${MESSAGE_TIMEOUT_MS} ms.`));
    }, MESSAGE_TIMEOUT_MS);
    socket.once("open", () => { clearTimeout(timer); resolve(socket); });
    socket.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

function send(socket, message) { socket.send(JSON.stringify(message)); }

function nextMessage(socket, predicate = () => true, timeoutMs = MESSAGE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Expected WebSocket message did not arrive."));
    }, timeoutMs);
    const onMessage = (raw, isBinary) => {
      if (isBinary) return;
      const message = JSON.parse(raw.toString());
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

async function expectNoMessage(socket, predicate, durationMs = 150) {
  const unexpected = [];
  const onMessage = (raw, isBinary) => {
    if (isBinary) return;
    const message = JSON.parse(raw.toString());
    if (predicate(message)) unexpected.push(message);
  };
  socket.on("message", onMessage);
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  socket.off("message", onMessage);
  assert.deepEqual(unexpected, []);
}

async function join(socket, roomId, displayName) {
  const roomSnapshot = nextMessage(socket, (message) => message.type === "room.snapshot");
  const interactionSnapshot = nextMessage(socket, (message) => message.type === "interaction.snapshot");
  send(socket, { type: "join", roomId, displayName });
  const [room, interactions] = await Promise.all([roomSnapshot, interactionSnapshot]);
  assert.equal(interactions.roomId, roomId);
  return { room, interactions };
}

function submit(kind, eventId, values = {}) {
  return { type: "interaction.submit", eventId, kind, ...values };
}

test("interaction snapshots follow the room snapshot and feedback/chat/stickers stay room-scoped", async (t) => {
  const first = await connect();
  const second = await connect();
  const otherRoom = await connect();
  t.after(() => { first.close(); second.close(); otherRoom.close(); });
  const firstJoin = await join(first, "lobby", "Ada");
  assert.deepEqual(firstJoin.interactions.history, []);
  await join(second, "lobby", "Grace");
  await join(otherRoom, "studio", "Lin");

  const chat = "🙂".repeat(300);
  const secondChat = nextMessage(second, (message) => message.type === "interaction.event" && message.event.eventId === "chat-wide");
  const firstAck = nextMessage(first, (message) => message.type === "interaction.ack" && message.eventId === "chat-wide");
  const noCrossRoomChat = expectNoMessage(otherRoom, (message) => message.type === "interaction.event");
  send(first, submit("chat", "chat-wide", { text: chat }));
  const [ack, event] = await Promise.all([firstAck, secondChat]);
  await noCrossRoomChat;
  assert.equal(ack.duplicate, false);
  assert.equal(event.event.roomId, "lobby");
  assert.equal(event.event.participantId, firstJoin.room.members[0].id);
  assert.equal(Array.from(event.event.text).length, 300);

  const stickerEvent = nextMessage(second, (message) => message.type === "interaction.event" && message.event.eventId === "sticker-one");
  const stickerAck = nextMessage(first, (message) => message.type === "interaction.ack" && message.eventId === "sticker-one");
  send(first, submit("sticker", "sticker-one", { sticker: "✨" }));
  assert.equal((await stickerAck).duplicate, false);
  assert.equal((await stickerEvent).event.sticker, "✨");

  const feedbackFromFirst = nextMessage(second, (message) => message.type === "interaction.event" && message.event.eventId === "like-a");
  const feedbackAckFirst = nextMessage(first, (message) => message.type === "interaction.ack" && message.eventId === "like-a");
  send(first, submit("feedback", "like-a", { feedback: "like" }));
  const firstFeedbackEvent = await feedbackFromFirst;
  await feedbackAckFirst;
  assert.deepEqual(firstFeedbackEvent.state.feedbackStats.like, { count: 1, uniqueParticipants: 1 });

  const feedbackFromSecond = nextMessage(first, (message) => message.type === "interaction.event" && message.event.eventId === "like-b");
  const feedbackAckSecond = nextMessage(second, (message) => message.type === "interaction.ack" && message.eventId === "like-b");
  const noCrossRoomFeedback = expectNoMessage(otherRoom, (message) => message.type === "interaction.event");
  send(second, submit("feedback", "like-b", { feedback: "like" }));
  const secondFeedbackEvent = await feedbackFromSecond;
  await feedbackAckSecond;
  await noCrossRoomFeedback;
  assert.deepEqual(secondFeedbackEvent.state.feedbackStats.like, { count: 2, uniqueParticipants: 2 });
});

test("dedup ACK precedes rate checks; event ID collisions and injected room fields are rejected", async (t) => {
  const sender = await connect();
  const observer = await connect();
  t.after(() => { sender.close(); observer.close(); });
  await join(sender, "lobby", "Sender");
  await join(observer, "lobby", "Observer");

  const observed = nextMessage(observer, (message) => message.type === "interaction.event" && message.event.eventId === "dedup-1");
  const ack = nextMessage(sender, (message) => message.type === "interaction.ack" && message.eventId === "dedup-1");
  const payload = submit("chat", "dedup-1", { text: "same content" });
  send(sender, payload);
  const firstEvent = await observed;
  const firstAck = await ack;
  assert.equal(firstAck.duplicate, false);

  const duplicateAck = nextMessage(sender, (message) => message.type === "interaction.ack" && message.eventId === "dedup-1");
  const noDuplicateProjection = expectNoMessage(observer, (message) => message.type === "interaction.event" && message.event.eventId === "dedup-1");
  send(sender, payload);
  assert.equal((await duplicateAck).duplicate, true);
  await noDuplicateProjection;

  const collision = nextMessage(sender, (message) => message.type === "interaction.error");
  const noCollisionProjection = expectNoMessage(observer, (message) => message.type === "interaction.event" && message.event.eventId === "dedup-1");
  send(sender, submit("chat", "dedup-1", { text: "different content" }));
  assert.equal((await collision).code, "interaction_event_id_conflict");
  await noCollisionProjection;

  const injected = nextMessage(sender, (message) => message.type === "interaction.error");
  send(sender, { ...submit("chat", "forged-room", { text: "forged" }), roomId: "studio" });
  assert.equal((await injected).code, "invalid_interaction");

  const tooLong = nextMessage(sender, (message) => message.type === "interaction.error");
  send(sender, submit("danmaku", "too-long", { text: "🙂".repeat(61) }));
  assert.equal((await tooLong).code, "invalid_interaction");
});

test("host pause, block, clear, remove, expiry, and room-switch replay retain separate outcomes", async (t) => {
  const host = await connect();
  const guest = await connect();
  t.after(() => { host.close(); guest.close(); });
  await join(host, "lobby", "Host");
  await join(guest, "lobby", "Guest");
  const hostClaimed = nextMessage(host, (message) => message.type === "host.claimed");
  send(host, { type: "host.claim", token: HOST_TOKEN });
  await hostClaimed;

  const pauseResult = nextMessage(host, (message) => message.type === "host.actionResult" && message.action === "interaction.setPaused");
  const pausedForGuest = nextMessage(guest, (message) => message.type === "interaction.state" && message.presentation.paused);
  send(host, { type: "host.interaction.setPaused", paused: true });
  await Promise.all([pauseResult, pausedForGuest]);

  const guestEvent = nextMessage(guest, (message) => message.type === "interaction.event" && message.event.eventId === "held-danmaku");
  const guestAck = nextMessage(guest, (message) => message.type === "interaction.ack" && message.eventId === "held-danmaku");
  send(guest, submit("danmaku", "held-danmaku", { text: "Queued while paused" }));
  const [heldAck, heldEvent] = await Promise.all([guestAck, guestEvent]);
  assert.equal(heldAck.duplicate, false);
  assert.equal(heldEvent.state.presentation.paused, true);
  assert.equal(heldEvent.state.queueCount, 1);
  assert.deepEqual(heldEvent.state.publicQueue, []);

  const blockedResult = nextMessage(host, (message) => message.type === "host.actionResult" && message.action === "interaction.setDanmakuEnabled");
  send(host, { type: "host.interaction.setDanmakuEnabled", enabled: false });
  await blockedResult;
  const denied = nextMessage(guest, (message) => message.type === "interaction.error" && message.eventId === "blocked-danmaku");
  send(guest, submit("danmaku", "blocked-danmaku", { text: "Not accepted" }));
  assert.equal((await denied).code, "danmaku_blocked");
  const chatAllowed = nextMessage(guest, (message) => message.type === "interaction.ack" && message.eventId === "chat-while-blocked");
  send(guest, submit("chat", "chat-while-blocked", { text: "Chat still works" }));
  assert.equal((await chatAllowed).duplicate, false);

  const resumeResult = nextMessage(host, (message) => message.type === "host.actionResult" && message.action === "interaction.setPaused");
  const acceptResult = nextMessage(host, (message) => message.type === "host.actionResult" && message.action === "interaction.setDanmakuEnabled");
  const resumedState = nextMessage(guest, (message) => message.type === "interaction.state" && !message.presentation.paused && message.presentation.danmakuEnabled);
  send(host, { type: "host.interaction.setPaused", paused: false });
  send(host, { type: "host.interaction.setDanmakuEnabled", enabled: true });
  await Promise.all([resumeResult, acceptResult, resumedState]);

  const setupClearResult = nextMessage(host, (message) => message.type === "host.actionResult" && message.action === "interaction.clearQueue");
  const setupClearState = nextMessage(guest, (message) => message.type === "interaction.state" && message.queueCount === 0 && message.history.some((item) => item.eventId === "held-danmaku"));
  send(host, { type: "host.interaction.clearQueue" });
  assert.equal((await setupClearResult).clearedCount, 1);
  await setupClearState;

  const newDanmakuEvent = nextMessage(guest, (message) => message.type === "interaction.event" && message.event.eventId === "remove-danmaku");
  const newDanmakuAck = nextMessage(guest, (message) => message.type === "interaction.ack" && message.eventId === "remove-danmaku");
  send(guest, submit("danmaku", "remove-danmaku", { text: "Remove this display item" }));
  const [removeAck, danmakuEvent] = await Promise.all([newDanmakuAck, newDanmakuEvent]);
  assert.equal(removeAck.duplicate, false);

  const removedState = nextMessage(guest, (message) => message.type === "interaction.state" && !message.history.some((item) => item.id === danmakuEvent.event.id));
  const removeResult = nextMessage(host, (message) => message.type === "host.actionResult" && message.action === "interaction.remove");
  send(host, { type: "host.interaction.remove", interactionId: danmakuEvent.event.id });
  assert.equal((await removeResult).removed, true);
  const afterRemove = await removedState;
  assert.equal(afterRemove.publicQueue.some((item) => item.id === danmakuEvent.event.id), false);

  const clearItem = nextMessage(guest, (message) => message.type === "interaction.event" && message.event.eventId === "clear-danmaku");
  const clearItemAck = nextMessage(guest, (message) => message.type === "interaction.ack" && message.eventId === "clear-danmaku");
  send(guest, submit("danmaku", "clear-danmaku", { text: "Clear the queue, keep this history" }));
  const clearEvent = await clearItem;
  await clearItemAck;
  const clearedState = nextMessage(guest, (message) => message.type === "interaction.state" && message.queueCount === 0 && message.history.some((item) => item.id === clearEvent.event.id));
  const clearResult = nextMessage(host, (message) => message.type === "host.actionResult" && message.action === "interaction.clearQueue");
  send(host, { type: "host.interaction.clearQueue" });
  assert.equal((await clearResult).clearedCount, 1);
  assert.ok((await clearedState).history.some((item) => item.id === clearEvent.event.id));

  const switched = nextMessage(guest, (message) => message.type === "room.snapshot");
  const switchedInteraction = nextMessage(guest, (message) => message.type === "interaction.snapshot" && message.roomId === "studio");
  send(guest, { type: "room.switch", roomId: "studio" });
  await Promise.all([switched, switchedInteraction]);
  const collision = nextMessage(guest, (message) => message.type === "interaction.error" && message.eventId === "clear-danmaku");
  send(guest, submit("danmaku", "clear-danmaku", { text: "Clear the queue, keep this history" }));
  assert.equal((await collision).code, "interaction_event_id_conflict");

  const unauthorized = nextMessage(guest, (message) => message.type === "host.error");
  send(guest, { type: "host.interaction.clearQueue" });
  assert.equal((await unauthorized).code, "host_unauthorized");
});

test("expired public items are pruned and a replay inside dedup TTL is ACK-only", async (t) => {
  const sender = await connect();
  const observer = await connect();
  t.after(() => { sender.close(); observer.close(); });
  await join(sender, "lobby", "Sender");
  await join(observer, "lobby", "Observer");

  const eventPromise = nextMessage(observer, (message) => message.type === "interaction.event" && message.event.eventId === "expiry-case");
  const ackPromise = nextMessage(sender, (message) => message.type === "interaction.ack" && message.eventId === "expiry-case");
  send(sender, submit("danmaku", "expiry-case", { text: "This item expires" }));
  const event = await eventPromise;
  await ackPromise;
  const pruned = nextMessage(observer, (message) => message.type === "interaction.state" && message.queueCount === 0, INTERACTION_LIMITS.publicTtlMs + 3_000);
  await pruned;

  const duplicateAck = nextMessage(sender, (message) => message.type === "interaction.ack" && message.eventId === "expiry-case");
  const noReplayProjection = expectNoMessage(observer, (message) => message.type === "interaction.event" && message.event.eventId === "expiry-case");
  send(sender, submit("danmaku", "expiry-case", { text: "This item expires" }));
  const duplicate = await duplicateAck;
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.interactionId, event.event.id);
  await noReplayProjection;
});

test("the bounded dedup store does not evict accepted IDs before their TTL", () => {
  const store = new InteractionStore(["lobby"], 2);
  const member = { id: "sender", displayName: "Fixture" };
  const first = parseInteractionInput(submit("chat", "one", { text: "one" }));
  const second = parseInteractionInput(submit("chat", "two", { text: "two" }));
  const third = parseInteractionInput(submit("chat", "three", { text: "three" }));
  assert.ok(first && second && third);
  const now = 1_000;
  assert.ok(store.accept(member.id, "lobby", member, first.eventId, first.input, now));
  assert.ok(store.accept(member.id, "lobby", member, second.eventId, second.input, now));
  assert.equal(store.hasDedupCapacity(now), false);
  assert.deepEqual(store.checkDuplicate(member.id, first.eventId, "lobby", first.fingerprint, now), { kind: "duplicate", interactionId: store.snapshot("lobby", now).history[0].id });
  assert.equal(store.accept(member.id, "lobby", member, third.eventId, third.input, now), null);
  assert.equal(store.checkDuplicate(member.id, first.eventId, "lobby", first.fingerprint, now + INTERACTION_LIMITS.dedupTtlMs + 1).kind, "new");
});
