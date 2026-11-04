import assert from "node:assert/strict";
import { test } from "node:test";
import WebSocket from "ws";
import { createApp } from "../src/server/app.ts";

const MESSAGE_TIMEOUT_MS = 12_000;

async function withServer(options, run) {
  const app = await createApp({ serveClient: false, ...options });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await app.close();
  }
}

function connect(baseUrl) {
  const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/ws`, { origin: baseUrl });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("WebSocket did not open."));
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

function nextMessage(socket, predicate, timeoutMs = MESSAGE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      socket.off("error", onError);
      reject(new Error("Expected WebSocket message did not arrive."));
    }, timeoutMs);
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
      socket.off("error", onError);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
    socket.once("error", onError);
  });
}

function send(socket, message) {
  socket.send(JSON.stringify(message));
}

function expectProtocolError(socket, code) {
  const result = nextMessage(socket, (message) => message.type === "protocol.error");
  return {
    result,
    send(message) {
      send(socket, message);
    },
    async verify() {
      const message = await result;
      assert.equal(message.code, code);
      return message;
    },
  };
}

function beginJoin(socket, fields) {
  const roomSnapshot = nextMessage(socket, (message) => message.type === "room.snapshot");
  const interactionSnapshot = nextMessage(socket, (message) => message.type === "interaction.snapshot");
  const participationSnapshot = nextMessage(socket, (message) => message.type === "participation.self");
  send(socket, { type: "join", ...fields });
  return Promise.all([roomSnapshot, interactionSnapshot, participationSnapshot]);
}

test("watch to interaction transition clears subscriptions and retains usable interactions", { timeout: 15_000 }, async () => {
  await withServer({ meetingRoomPassword: "room-secret" }, async (baseUrl) => {
    const participant = await connect(baseUrl);
    try {
      const missingPassword = nextMessage(participant, (message) => message.type === "protocol.error");
      send(participant, { type: "join", roomId: "studio", displayName: "Direct", role: "participant", mode: "watch" });
      assert.equal((await missingPassword).code, "room_password_required");

      const [room, interaction, self] = await beginJoin(participant, {
        roomId: "studio", displayName: "Direct", role: "participant", mode: "watch", password: "room-secret",
      });
      assert.equal(room.room.id, "studio");
      assert.equal(room.room.role, undefined, "legacy room snapshot schema remains unchanged");
      assert.equal(interaction.roomId, "studio");
      assert.equal(self.role, "participant");
      assert.equal(self.mode, "watch");
      assert.equal(self.media.audio.subscribed, false);
      assert.equal(self.media.screen.subscribed, false);

      const audioSubscribed = nextMessage(participant, (message) => message.type === "audio.subscribed");
      const screenSubscribed = nextMessage(participant, (message) => message.type === "screen.subscribed");
      send(participant, { type: "audio.subscribe" });
      send(participant, { type: "screen.subscribe" });
      await Promise.all([audioSubscribed, screenSubscribed]);

      const audioStarted = nextMessage(participant, (message) => message.type === "audio.started");
      send(participant, { type: "audio.start", codec: "opus", sampleRate: 48_000, channels: 1, bitrate: 32_000, frameDurationUs: 20_000 });
      const screenStarted = nextMessage(participant, (message) => message.type === "screen.started");
      send(participant, { type: "screen.start", codec: "vp8", width: 320, height: 180, frameRate: 10, bitrate: 200_000 });
      await Promise.all([audioStarted, screenStarted]);

      const modeAck = nextMessage(participant, (message) => message.type === "participation.modeChanged");
      const selfAfterMode = nextMessage(participant, (message) => message.type === "participation.self" && message.mode === "interaction");
      send(participant, { type: "participation.setMode", mode: "interaction" });
      const [ack, snapshot] = await Promise.all([modeAck, selfAfterMode]);
      assert.equal(ack.roomId, "studio");
      assert.deepEqual(ack.media, { audioSubscribed: false, screenSubscribed: false });
      assert.equal(snapshot.participantId, self.participantId);
      assert.equal(snapshot.roomId, "studio");
      assert.equal(snapshot.role, "participant");
      assert.equal(snapshot.mode, "interaction");
      assert.equal(snapshot.media.audio.subscribed, false);
      assert.equal(snapshot.media.screen.subscribed, false);
      assert.equal(snapshot.media.audio.downlinkBytes, 0);
      assert.equal(snapshot.media.screen.downlinkBytes, 0);

      for (const control of [
        { type: "audio.subscribe" },
        { type: "screen.subscribe" },
        { type: "audio.start", codec: "opus", sampleRate: 48_000, channels: 1, bitrate: 32_000, frameDurationUs: 20_000 },
        { type: "screen.start", codec: "vp8", width: 320, height: 180, frameRate: 10, bitrate: 200_000 },
      ]) {
        const rejected = expectProtocolError(participant, "interaction_mode_media_denied");
        rejected.send(control);
        await rejected.verify();
      }

      const movedSnapshot = nextMessage(participant, (message) => message.type === "space.snapshot");
      send(participant, { type: "space.move", direction: "up" });
      const movedSpace = await movedSnapshot;
      assert.equal(movedSpace.rooms.flatMap((roomEntry) => roomEntry.players).some((player) => player.id === self.participantId), true);

      const reactionEvent = nextMessage(participant, (message) => message.type === "control.event" && message.event.kind === "reaction");
      send(participant, { type: "reaction", reaction: "wave" });
      assert.equal((await reactionEvent).event.reaction, "wave");

      const interactionAck = nextMessage(participant, (message) => message.type === "interaction.ack");
      send(participant, { type: "interaction.submit", eventId: "only-mode-feedback", kind: "feedback", feedback: "useful" });
      assert.equal((await interactionAck).eventId, "only-mode-feedback");

      const afterInspect = nextMessage(participant, (message) => message.type === "participation.self");
      send(participant, { type: "participation.inspect" });
      assert.equal((await afterInspect).mode, "interaction");
    } finally {
      participant.close();
    }
  });
});

test("legacy join defaults to participant watch mode without changing room snapshot fields", { timeout: 15_000 }, async () => {
  await withServer({}, async (baseUrl) => {
    const participant = await connect(baseUrl);
    try {
      const roomSnapshot = nextMessage(participant, (message) => message.type === "room.snapshot");
      const selfSnapshot = nextMessage(participant, (message) => message.type === "participation.self");
      send(participant, { type: "join", roomId: "lobby", displayName: "Legacy" });
      const [room, self] = await Promise.all([roomSnapshot, selfSnapshot]);
      assert.equal(room.room.id, "lobby");
      assert.equal(Object.hasOwn(room.room, "role"), false);
      assert.equal(self.role, "participant");
      assert.equal(self.mode, "watch");
    } finally {
      participant.close();
    }
  });
});

test("display role stays password-gated, receives public projections, and rejects mutations", { timeout: 22_000 }, async () => {
  const hostToken = "host-secret-for-contract-test-00000001";
  await withServer({ meetingRoomPassword: "room-secret-for-contract", hostControlToken: hostToken }, async (baseUrl) => {
    const display = await connect(baseUrl);
    const host = await connect(baseUrl);
    const guest = await connect(baseUrl);
    const observedDisplayMessages = [];
    const collectDisplayMessage = (raw) => {
      try { observedDisplayMessages.push(JSON.parse(raw.toString())); } catch {}
    };
    display.on("message", collectDisplayMessage);
    try {
      const displayGate = nextMessage(display, (message) => message.type === "protocol.error");
      send(display, { type: "join", roomId: "studio", displayName: "Projector", role: "display", mode: "watch" });
      assert.equal((await displayGate).code, "room_password_required");
      const [displayRoom, , displaySelf] = await beginJoin(display, {
        roomId: "studio", displayName: "Projector", role: "display", mode: "watch", password: "room-secret-for-contract",
      });
      assert.equal(displayRoom.room.id, "studio");
      assert.equal(displayRoom.room.publishAllowed, false);
      assert.equal(displaySelf.role, "display");
      assert.equal(displaySelf.mode, "watch");

      const displaySubscribe = nextMessage(display, (message) => message.type === "screen.subscribed");
      send(display, { type: "screen.subscribe" });
      await displaySubscribe;
      const inspect = nextMessage(display, (message) => message.type === "participation.self");
      send(display, { type: "participation.inspect" });
      assert.equal((await inspect).media.screen.subscribed, true);

      const deniedControls = [
        { type: "host.claim", token: hostToken },
        { type: "audio.start", codec: "opus", sampleRate: 48_000, channels: 1, bitrate: 32_000, frameDurationUs: 20_000 },
        { type: "audio.stop", generation: 1 },
        { type: "screen.start", codec: "vp8", width: 320, height: 180, frameRate: 10, bitrate: 200_000 },
        { type: "screen.stop", generation: 1 },
        { type: "interaction.submit", eventId: "display-write", kind: "chat", text: "forbidden" },
        { type: "reaction", reaction: "wave" },
        { type: "space.move", direction: "up" },
        { type: "room.switch", roomId: "lobby" },
      ];
      for (const control of deniedControls) {
        const denied = nextMessage(display, (message) => message.type === "protocol.error");
        send(display, control);
        assert.equal((await denied).code, "display_read_only", control.type);
      }
      const binaryDenied = nextMessage(display, (message) => message.type === "protocol.error");
      display.send(Buffer.from("LTA1readonly-probe"), { binary: true });
      assert.equal((await binaryDenied).code, "display_read_only");

      const [, , hostSelf] = await beginJoin(host, {
        roomId: "studio", displayName: "Host", role: "participant", mode: "watch", password: "room-secret-for-contract",
      });
      const claimed = nextMessage(host, (message) => message.type === "host.claimed");
      send(host, { type: "host.claim", token: hostToken });
      assert.equal((await claimed).participantId, hostSelf.participantId);
      await beginJoin(guest, {
        roomId: "studio", displayName: "Guest", role: "participant", mode: "interaction", password: "room-secret-for-contract",
      });

      const privateInputs = [
        { type: "interaction.submit", eventId: "private-chat", kind: "chat", text: "PRIVATE-CHAT-SENTINEL" },
        { type: "interaction.submit", eventId: "private-sticker", kind: "sticker", sticker: "✨" },
      ];
      for (const input of privateInputs) {
        const ack = nextMessage(guest, (message) => message.type === "interaction.ack");
        send(guest, input);
        await ack;
      }
      await new Promise((resolve) => setTimeout(resolve, 650));
      assert.equal(JSON.stringify(observedDisplayMessages).includes("PRIVATE-CHAT-SENTINEL"), false);
      assert.equal(JSON.stringify(observedDisplayMessages).includes("private-sticker"), false);
      const privateState = observedDisplayMessages.filter((message) => ["interaction.snapshot", "interaction.state"].includes(message.type));
      assert.ok(privateState.length > 0);
      assert.ok(privateState.every((message) => message.history.length === 0));

      const feedbackEvent = nextMessage(display, (message) => message.type === "interaction.event" && message.event.kind === "feedback");
      const feedbackAck = nextMessage(guest, (message) => message.type === "interaction.ack");
      send(guest, { type: "interaction.submit", eventId: "public-feedback", kind: "feedback", feedback: "like" });
      await feedbackAck;
      assert.equal((await feedbackEvent).event.feedback, "like");

      const initialDanmaku = nextMessage(display, (message) => message.type === "interaction.event" && message.event.kind === "danmaku");
      const initialDanmakuAck = nextMessage(guest, (message) => message.type === "interaction.ack");
      send(guest, { type: "interaction.submit", eventId: "public-danmaku", kind: "danmaku", text: "公開訊息" });
      await initialDanmakuAck;
      const publicEvent = await initialDanmaku;
      assert.deepEqual(publicEvent.state.publicQueue.map((event) => event.text), ["公開訊息"]);

      const pauseUpdate = nextMessage(display, (message) => message.type === "interaction.state" && message.presentation.paused);
      send(host, { type: "host.interaction.setPaused", paused: true });
      const pausedState = await pauseUpdate;
      assert.deepEqual(pausedState.publicQueue, []);
      const unpauseUpdate = nextMessage(display, (message) => message.type === "interaction.state" && !message.presentation.paused);
      send(host, { type: "host.interaction.setPaused", paused: false });
      await unpauseUpdate;

      const removableEvent = nextMessage(display, (message) => message.type === "interaction.event" && message.event.kind === "danmaku");
      const removableAck = nextMessage(guest, (message) => message.type === "interaction.ack");
      send(guest, { type: "interaction.submit", eventId: "public-remove", kind: "danmaku", text: "即將移除" });
      await removableAck;
      const removable = await removableEvent;
      const removedState = nextMessage(display, (message) => message.type === "interaction.state" && message.publicQueue.every((event) => event.id !== removable.event.id));
      send(host, { type: "host.interaction.remove", interactionId: removable.event.id });
      assert.equal((await removedState).publicQueue.some((event) => event.id === removable.event.id), false);

      const expiringEvent = nextMessage(display, (message) => message.type === "interaction.event" && message.event.kind === "danmaku");
      const expiringAck = nextMessage(guest, (message) => message.type === "interaction.ack");
      send(guest, { type: "interaction.submit", eventId: "public-expiry", kind: "danmaku", text: "限時公開" });
      await expiringAck;
      const expiring = await expiringEvent;
      const expiredState = nextMessage(display, (message) => message.type === "interaction.state" && message.publicQueue.every((event) => event.id !== expiring.event.id), 11_000);
      assert.equal((await expiredState).publicQueue.some((event) => event.id === expiring.event.id), false);
      assert.equal(JSON.stringify(observedDisplayMessages).includes("PRIVATE-CHAT-SENTINEL"), false);
    } finally {
      display.off("message", collectDisplayMessage);
      display.close();
      host.close();
      guest.close();
    }
  });
});
