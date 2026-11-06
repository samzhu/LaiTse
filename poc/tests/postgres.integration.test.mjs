import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import WebSocket from "ws";
import { createApp } from "../src/server/app.ts";
import { API_KEYS, CODEC_PROBE_KEYS, MEDIA_TYPE_KEYS } from "../src/server/capabilities.ts";

const { Pool } = pg;
const DATABASE_URL = process.env.PG_TEST_DATABASE_URL;
const ROOM_PASSWORD_A = "postgres-first-boot-passphrase";
const ROOM_PASSWORD_B = "postgres-live-updated-passphrase";
const HOST_TOKEN = "postgres-integration-host-control-token-32-bytes-min";
const ROTATED_HOST_TOKEN = "postgres-integration-host-control-token-rotated";

function nextMessage(socket, predicate, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Expected WebSocket message did not arrive.")), timeoutMs);
    const onMessage = (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); }
      catch (error) { finish(error); return; }
      if (predicate(message)) finish(null, message);
    };
    const onClose = (code, reason) => finish(new Error(`WebSocket closed before expected message (${code}: ${reason.toString()}).`));
    const onError = (error) => finish(error);
    const finish = (error, value) => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      socket.off("close", onClose);
      socket.off("error", onError);
      if (error) reject(error);
      else resolve(value);
    };
    socket.on("message", onMessage);
    socket.once("close", onClose);
    socket.once("error", onError);
  });
}

function connect(baseUrl) {
  const socket = new WebSocket(`${baseUrl.replace(/^http/u, "ws")}/ws`, { origin: baseUrl });
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function send(socket, value) {
  socket.send(JSON.stringify(value));
}

async function joinResumable(socket, { roomId = "studio", displayName, password }) {
  const issued = nextMessage(socket, (message) => message.type === "session.issued");
  const room = nextMessage(socket, (message) => message.type === "room.snapshot");
  const space = nextMessage(socket, (message) => message.type === "space.snapshot");
  const participation = nextMessage(socket, (message) => message.type === "participation.self");
  send(socket, { type: "join", roomId, displayName, password, resumable: true });
  const [session, roomSnapshot, spaceSnapshot, participationSnapshot] = await Promise.all([issued, room, space, participation]);
  return { token: session.token, participantId: session.participantId, roomSnapshot, spaceSnapshot, participationSnapshot };
}

async function startApp(options) {
  const app = await createApp({ serveClient: false, ...options });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}

function reportFixture() {
  const probe = { status: "unknown", reason: "PostgreSQL integration fixture" };
  const map = (keys) => Object.fromEntries(keys.map((key) => [key, { ...probe }]));
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    environment: { userAgent: "Node PostgreSQL integration fixture", platform: "test", secureContext: true },
    apis: Object.fromEntries(API_KEYS.map((key) => [key, "present"])),
    codecProbes: map(CODEC_PROBE_KEYS),
    mediaRecorderTypes: map(MEDIA_TYPE_KEYS),
    mseTypes: map(MEDIA_TYPE_KEYS),
    playbackTypes: map(MEDIA_TYPE_KEYS),
  };
}

function appOptions(databaseSchema) {
  return {
    databaseUrl: DATABASE_URL,
    databaseSchema,
    meetingRoomPassword: ROOM_PASSWORD_A,
    hostControlToken: HOST_TOKEN,
    localCapacityAdmin: true,
  };
}

if (!DATABASE_URL) {
  test("PostgreSQL persistence integration (set PG_TEST_DATABASE_URL to enable)", { skip: true }, () => {});
} else {
  test("PostgreSQL persistence survives app restart and fails closed on transaction errors", { timeout: 90_000 }, async (t) => {
    const parsed = new URL(DATABASE_URL);
    const databaseName = decodeURIComponent(parsed.pathname.slice(1));
    assert.equal(databaseName, "laitse_poc_test", "PG_TEST_DATABASE_URL must point to the dedicated laitse_poc_test database.");

    const suffix = `${process.pid}_${randomBytes(4).toString("hex")}`;
    const schema = `laitse_test_${suffix}`;
    const failureSchema = `laitse_fail_${suffix}`;
    const safeSchemas = [schema, failureSchema];
    assert.ok(safeSchemas.every((name) => /^[a-z][a-z0-9_]{0,62}$/u.test(name)));
    const adminPool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2_000, options: "-c statement_timeout=5000" });
    let scopedPool;
    let currentApp;
    let currentSockets = [];
    let failureApp;
    try {
      for (const name of safeSchemas) await adminPool.query(`CREATE SCHEMA "${name}"`);
      scopedPool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2_000, options: `-c search_path=${schema},public -c statement_timeout=5000` });

      let running = await startApp(appOptions(schema));
      currentApp = running.app;
      let baseUrl = running.baseUrl;
      const health = await (await fetch(`${baseUrl}/api/health`)).json();
      assert.equal(health.persistence, "postgresql");
      assert.equal(health.persistenceAvailable, true);
      const defaultCapacity = await (await fetch(`${baseUrl}/api/poc/capacity`)).json();
      assert.equal(defaultCapacity.softLimit, 10);
      assert.equal(defaultCapacity.persistence, "postgresql");
      assert.equal(defaultCapacity.persisted, true);
      const capacityUpdate = await fetch(`${baseUrl}/api/poc/capacity`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ softLimit: 20 }),
      });
      assert.equal(capacityUpdate.status, 200);
      assert.equal((await capacityUpdate.json()).softLimit, 20);
      assert.equal(Number((await scopedPool.query("SELECT member_soft_limit FROM application_settings WHERE singleton = true")).rows[0].member_soft_limit), 20);
      const unknownObservation = await fetch(`${baseUrl}/api/observations/not-a-uuid`);
      assert.equal(unknownObservation.status, 404);
      assert.equal((await (await fetch(`${baseUrl}/api/health`)).json()).persistenceAvailable, true,
        "an invalid public observation ID must not become a database failure or stop the app");
      const rooms = await (await fetch(`${baseUrl}/api/rooms`)).json();
      assert.equal(rooms.find((room) => room.id === "studio").isLocked, true);

      await assert.rejects(() => createApp({ serveClient: false, ...appOptions(schema) }), /already active/u);

      const host = await connect(baseUrl);
      const guest = await connect(baseUrl);
      currentSockets.push(host, guest);
      const hostJoin = await joinResumable(host, { displayName: "PG Host", password: ROOM_PASSWORD_A });
      const guestJoin = await joinResumable(guest, { displayName: "PG Guest", password: ROOM_PASSWORD_A });
      assert.notEqual(hostJoin.participantId, guestJoin.participantId);

      const hostClaimed = nextMessage(host, (message) => message.type === "host.claimed");
      send(host, { type: "host.claim", token: HOST_TOKEN });
      await hostClaimed;

      const grantResult = nextMessage(host, (message) => message.type === "host.actionResult" && message.action === "grantPublisher");
      send(host, { type: "host.grantPublisher", participantId: guestJoin.participantId });
      await grantResult;
      const revokeResult = nextMessage(host, (message) => message.type === "host.actionResult" && message.action === "revokePublisher");
      send(host, { type: "host.revokePublisher", participantId: guestJoin.participantId });
      await revokeResult;

      const pausedResult = nextMessage(host, (message) => message.type === "host.actionResult" && message.action === "interaction.setPaused");
      send(host, { type: "host.interaction.setPaused", paused: true });
      await pausedResult;

      const chatAckPromise = nextMessage(guest, (message) => message.type === "interaction.ack" && message.eventId === "archive-chat");
      send(guest, { type: "interaction.submit", eventId: "archive-chat", kind: "chat", text: "Durable chat fixture" });
      const chatAck = await chatAckPromise;

      const feedbackAck = nextMessage(guest, (message) => message.type === "interaction.ack" && message.eventId === "archive-feedback");
      send(guest, { type: "interaction.submit", eventId: "archive-feedback", kind: "feedback", feedback: "useful" });
      await feedbackAck;

      const clearedDanmakuAck = nextMessage(guest, (message) => message.type === "interaction.ack" && message.eventId === "clear-queue-item");
      send(guest, { type: "interaction.submit", eventId: "clear-queue-item", kind: "danmaku", text: "Keep in history after queue clear" });
      await clearedDanmakuAck;
      const clearQueueResult = nextMessage(host, (message) => message.type === "host.actionResult" && message.action === "interaction.clearQueue");
      send(host, { type: "host.interaction.clearQueue" });
      await clearQueueResult;

      const ttlDanmakuAck = nextMessage(guest, (message) => message.type === "interaction.ack" && message.eventId === "ttl-projection-item");
      send(guest, { type: "interaction.submit", eventId: "ttl-projection-item", kind: "danmaku", text: "Archive remains after projection TTL" });
      await ttlDanmakuAck;

      const removedChatAckPromise = nextMessage(guest, (message) => message.type === "interaction.ack" && message.eventId === "moderated-chat");
      send(guest, { type: "interaction.submit", eventId: "moderated-chat", kind: "chat", text: "Moderated fixture" });
      const removedChatAck = await removedChatAckPromise;
      const removeResult = nextMessage(host, (message) => message.type === "host.actionResult" && message.action === "interaction.remove");
      send(host, { type: "host.interaction.remove", interactionId: removedChatAck.interactionId });
      assert.equal((await removeResult).removed, true);

      const modeAck = nextMessage(guest, (message) => message.type === "participation.modeChanged");
      send(guest, { type: "participation.setMode", mode: "interaction" });
      await modeAck;
      const movedSnapshot = nextMessage(guest, (message) => message.type === "space.snapshot" && message.rooms.some((room) => room.players.some((player) => player.id === guestJoin.participantId && player.y === 1)));
      send(guest, { type: "space.move", direction: "up" });
      await movedSnapshot;

      const hostReaction = nextMessage(host, (message) => message.type === "control.event" && message.event.kind === "reaction");
      send(host, { type: "reaction", reaction: "wave" });
      await hostReaction;

      const capabilityAck = nextMessage(guest, (message) => message.type === "capability.ack");
      send(guest, { type: "capability.report", report: reportFixture() });
      const observation = await capabilityAck;

      const passwordChanged = nextMessage(host, (message) => message.type === "host.actionResult" && message.action === "setMeetingRoomPassword");
      send(host, { type: "host.setMeetingRoomPassword", password: ROOM_PASSWORD_B });
      await passwordChanged;

      const revokedParticipant = await connect(baseUrl);
      currentSockets.push(revokedParticipant);
      const revokedJoin = await joinResumable(revokedParticipant, { roomId: "lobby", displayName: "Revoked proof" });
      const leftAck = nextMessage(revokedParticipant, (message) => message.type === "session.left");
      const revokedClosed = new Promise((resolve) => revokedParticipant.once("close", resolve));
      send(revokedParticipant, { type: "session.leave" });
      await Promise.all([leftAck, revokedClosed]);

      const expiredParticipant = await connect(baseUrl);
      currentSockets.push(expiredParticipant);
      const expiredJoin = await joinResumable(expiredParticipant, { roomId: "lobby", displayName: "Expired proof" });

      const guestDigest = createHash("sha256").update(guestJoin.token).digest("hex");
      const revokedDigest = createHash("sha256").update(revokedJoin.token).digest("hex");
      const expiredDigest = createHash("sha256").update(expiredJoin.token).digest("hex");
      const persistedBeforeRestart = await scopedPool.query("SELECT participant_id, display_name, last_room_id, mode, position_x, position_y FROM participants WHERE participant_id = $1", [guestJoin.participantId]);
      assert.deepEqual(persistedBeforeRestart.rows[0], {
        participant_id: guestJoin.participantId,
        display_name: "PG Guest",
        last_room_id: "studio",
        mode: "interaction",
        position_x: 5,
        position_y: 1,
      });
      const sessionBeforeRestart = await scopedPool.query("SELECT encode(token_digest, 'hex') AS digest, active_connection_id FROM control_sessions WHERE token_digest = decode($1, 'hex')", [guestDigest]);
      assert.equal(sessionBeforeRestart.rows[0].digest, guestDigest);
      assert.ok(!JSON.stringify(sessionBeforeRestart.rows[0]).includes(guestJoin.token));
      assert.ok(sessionBeforeRestart.rows[0].active_connection_id);
      const savedRoom = await scopedPool.query("SELECT is_locked, admission_revision, password_salt, password_verifier FROM room_settings WHERE room_id = 'studio'");
      assert.equal(savedRoom.rows[0].is_locked, true);
      assert.ok(Number(savedRoom.rows[0].admission_revision) > 0);
      assert.ok(!savedRoom.rows[0].password_salt.toString("utf8").includes(ROOM_PASSWORD_A));
      assert.ok(!savedRoom.rows[0].password_verifier.toString("utf8").includes(ROOM_PASSWORD_B));
      const dedupBeforeRestart = await scopedPool.query("SELECT count(*)::int AS count FROM interaction_dedup WHERE participant_id = $1 AND event_id = 'archive-chat'", [guestJoin.participantId]);
      assert.equal(dedupBeforeRestart.rows[0].count, 1);
      const interactionCountBeforeRestart = await scopedPool.query("SELECT count(*)::int AS count FROM interaction_archive");
      assert.equal(interactionCountBeforeRestart.rows[0].count, 5);
      const archiveRowsBeforeRestart = await scopedPool.query("SELECT event_id, tombstoned_at, public_cleared_at FROM interaction_archive ORDER BY event_id");
      assert.equal(archiveRowsBeforeRestart.rows.find((row) => row.event_id === "clear-queue-item").tombstoned_at, null);
      assert.ok(archiveRowsBeforeRestart.rows.find((row) => row.event_id === "clear-queue-item").public_cleared_at);
      assert.ok(archiveRowsBeforeRestart.rows.find((row) => row.event_id === "moderated-chat").tombstoned_at);
      await scopedPool.query("UPDATE interaction_archive SET live_expires_at = clock_timestamp() - interval '1 second' WHERE event_id = 'ttl-projection-item'");
      const revokedRow = await scopedPool.query("SELECT revoked_at FROM control_sessions WHERE token_digest = decode($1, 'hex')", [revokedDigest]);
      assert.ok(revokedRow.rows[0].revoked_at);
      const countersBeforeRestart = await scopedPool.query("SELECT joins, moves, reactions, interactions, capability_reports FROM room_counters WHERE room_id = 'studio'");
      assert.deepEqual(countersBeforeRestart.rows[0], { joins: "2", moves: "1", reactions: "1", interactions: "5", capability_reports: "1" });
      const eventArchiveBeforeRestart = await scopedPool.query("SELECT count(*)::int AS count FROM control_event_archive WHERE room_id = 'studio'");
      assert.equal(eventArchiveBeforeRestart.rows[0].count, 3, "studio archives two joins and one reaction; the other fixtures joined lobby");
      assert.equal(observation.observationId.length > 0, true);

      await currentApp.close();
      currentApp = undefined;
      currentSockets = [];
      const sessionAfterRestart = await scopedPool.query("SELECT active_connection_id FROM control_sessions WHERE token_digest = decode($1, 'hex')", [guestDigest]);
      assert.equal(sessionAfterRestart.rows[0].active_connection_id, null, "graceful shutdown must clear live connection ownership while preserving the proof TTL");
      await scopedPool.query("UPDATE control_sessions SET expires_at = clock_timestamp() - interval '1 second' WHERE token_digest = decode($1, 'hex')", [expiredDigest]);

      // The original startup password remains A, while the saved live room password B must survive restart.
      running = await startApp(appOptions(schema));
      currentApp = running.app;
      baseUrl = running.baseUrl;
      const roomsAfterRestart = await (await fetch(`${baseUrl}/api/rooms`)).json();
      assert.equal(roomsAfterRestart.find((room) => room.id === "studio").isLocked, true);
      const capacityAfterRestart = await (await fetch(`${baseUrl}/api/poc/capacity`)).json();
      assert.equal(capacityAfterRestart.softLimit, 20);
      assert.equal(capacityAfterRestart.persisted, true);
      const wrongPasswordSocket = await connect(baseUrl);
      currentSockets.push(wrongPasswordSocket);
      const wrongPasswordError = nextMessage(wrongPasswordSocket, (message) => message.type === "protocol.error");
      send(wrongPasswordSocket, { type: "join", roomId: "studio", displayName: "Old env password", password: ROOM_PASSWORD_A });
      assert.equal((await wrongPasswordError).code, "room_password_incorrect");
      wrongPasswordSocket.close();

      const guestAfterRestart = await connect(baseUrl);
      currentSockets.push(guestAfterRestart);
      const gateError = nextMessage(guestAfterRestart, (message) => message.type === "protocol.error");
      send(guestAfterRestart, { type: "session.resume", token: guestJoin.token });
      assert.equal((await gateError).code, "room_password_required");
      const resumed = nextMessage(guestAfterRestart, (message) => message.type === "session.resumed");
      const resumedRoom = nextMessage(guestAfterRestart, (message) => message.type === "room.snapshot");
      const resumedSpace = nextMessage(guestAfterRestart, (message) => message.type === "space.snapshot" && message.rooms.some((room) => room.players.some((player) => player.id === guestJoin.participantId)));
      const interactionSnapshot = nextMessage(guestAfterRestart, (message) => message.type === "interaction.snapshot");
      send(guestAfterRestart, { type: "session.resume", token: guestJoin.token, password: ROOM_PASSWORD_B });
      const [resumeMessage, roomMessage, spaceMessage, interactionMessage] = await Promise.all([resumed, resumedRoom, resumedSpace, interactionSnapshot]);
      assert.equal(resumeMessage.participantId, guestJoin.participantId);
      assert.equal(roomMessage.room.publishAllowed, false);
      assert.equal(interactionMessage.presentation.paused, true);
      const restoredPlayer = spaceMessage.rooms.flatMap((room) => room.players).find((player) => player.id === guestJoin.participantId);
      assert.deepEqual({ x: restoredPlayer.x, y: restoredPlayer.y }, { x: 5, y: 1 });
      assert.equal(interactionMessage.history.some((event) => event.eventId === "clear-queue-item"), true);
      assert.equal(interactionMessage.history.some((event) => event.eventId === "ttl-projection-item"), true);
      assert.equal(interactionMessage.history.some((event) => event.eventId === "moderated-chat"), false);
      assert.equal(interactionMessage.publicQueue.some((event) => event.eventId === "clear-queue-item"), false);
      assert.equal(interactionMessage.publicQueue.some((event) => event.eventId === "ttl-projection-item"), false);
      assert.deepEqual(interactionMessage.feedbackStats.useful, { count: 1, uniqueParticipants: 1 });

      const duplicateAck = nextMessage(guestAfterRestart, (message) => message.type === "interaction.ack" && message.eventId === "archive-chat");
      send(guestAfterRestart, { type: "interaction.submit", eventId: "archive-chat", kind: "chat", text: "Durable chat fixture" });
      assert.equal((await duplicateAck).duplicate, true);
      const postReplayCounters = await scopedPool.query("SELECT interactions FROM room_counters WHERE room_id = 'studio'");
      assert.equal(postReplayCounters.rows[0].interactions, "5");
      const postReplayArchive = await scopedPool.query("SELECT count(*)::int AS count FROM interaction_archive WHERE event_id = 'archive-chat'");
      assert.equal(postReplayArchive.rows[0].count, 1);

      const audioDenied = nextMessage(guestAfterRestart, (message) => message.type === "protocol.error" || message.type === "audio.error");
      // Guest mode was persisted as interaction; media is denied before the host publish gate is reached.
      send(guestAfterRestart, { type: "audio.start", codec: "opus", sampleRate: 48_000, channels: 1, bitrate: 32_000, frameDurationUs: 20_000 });
      assert.ok(["interaction_mode_media_denied", "publish_not_authorized"].includes((await audioDenied).code));

      const hostAfterRestart = await connect(baseUrl);
      currentSockets.push(hostAfterRestart);
      const hostResumed = nextMessage(hostAfterRestart, (message) => message.type === "session.resumed");
      const hostRoomSnapshot = nextMessage(hostAfterRestart, (message) => message.type === "room.snapshot");
      send(hostAfterRestart, { type: "session.resume", token: hostJoin.token, password: ROOM_PASSWORD_B });
      await hostResumed;
      const hostSnapshot = await hostRoomSnapshot;
      assert.equal(hostSnapshot.room.publishAllowed, false, "old host claims and publisher grants must not resume");
      const hostAudioDenied = nextMessage(hostAfterRestart, (message) => message.type === "audio.error");
      send(hostAfterRestart, { type: "audio.start", codec: "opus", sampleRate: 48_000, channels: 1, bitrate: 32_000, frameDurationUs: 20_000 });
      assert.equal((await hostAudioDenied).code, "publish_not_authorized");

      const expiredSocket = await connect(baseUrl);
      currentSockets.push(expiredSocket);
      const expiredMessage = nextMessage(expiredSocket, (message) => message.type === "protocol.error");
      send(expiredSocket, { type: "session.resume", token: expiredJoin.token });
      assert.equal((await expiredMessage).code, "resume_expired");
      const revokedSocket = await connect(baseUrl);
      currentSockets.push(revokedSocket);
      const revokedMessage = nextMessage(revokedSocket, (message) => message.type === "protocol.error");
      send(revokedSocket, { type: "session.resume", token: revokedJoin.token });
      assert.equal((await revokedMessage).code, "resume_invalid");

      const storedObservationResponse = await fetch(`${baseUrl}/api/observations/${observation.observationId}`);
      assert.equal(storedObservationResponse.status, 200);
      const storedObservation = await storedObservationResponse.json();
      assert.equal(storedObservation.member.id, guestJoin.participantId);

      await currentApp.close();
      currentApp = undefined;
      currentSockets = [];
      await assert.rejects(
        () => createApp({ serveClient: false, databaseUrl: DATABASE_URL, databaseSchema: schema, meetingRoomPassword: ROOM_PASSWORD_A }),
        /configuration does not match/u,
        "a saved managed-host database must not restart with host controls silently disabled",
      );

      // A database transaction error must discard staged join output, close the app, and leave no participant row.
      const failurePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2_000, options: `-c search_path=${failureSchema},public -c statement_timeout=5000` });
      try {
        failureApp = await createApp({ ...appOptions(failureSchema) });
        await failurePool.query(`CREATE FUNCTION reject_participant_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled persistence failure'; END $$`);
        await failurePool.query(`CREATE TRIGGER reject_participant_insert BEFORE INSERT ON participants FOR EACH ROW EXECUTE FUNCTION reject_participant_insert()`);
        await failureApp.listen({ host: "127.0.0.1", port: 0 });
        const failureUrl = `http://127.0.0.1:${failureApp.server.address().port}`;
        const failingSocket = await connect(failureUrl);
        currentSockets.push(failingSocket);
        let stagedJoinOutput = false;
        failingSocket.on("message", (raw) => {
          const message = JSON.parse(raw.toString());
          if (["session.issued", "room.snapshot", "space.snapshot"].includes(message.type)) stagedJoinOutput = true;
        });
        const failedClose = new Promise((resolve) => failingSocket.once("close", (code) => resolve(code)));
        send(failingSocket, { type: "join", roomId: "lobby", displayName: "DB Failure", resumable: true });
        assert.equal(await failedClose, 1011);
        assert.equal(stagedJoinOutput, false, "join acknowledgement/snapshots must not escape before the failed transaction commits");
        const failedParticipant = await failurePool.query("SELECT count(*)::int AS count FROM participants WHERE display_name = 'DB Failure'");
        assert.equal(failedParticipant.rows[0].count, 0);
        await failureApp.close();
        failureApp = undefined;

        // A capacity change is not applied or acknowledged when its settings transaction fails.
        await failurePool.query(`CREATE FUNCTION reject_capacity_setting_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled capacity persistence failure'; END $$`);
        await failurePool.query(`CREATE TRIGGER reject_capacity_setting_update BEFORE UPDATE ON application_settings FOR EACH ROW EXECUTE FUNCTION reject_capacity_setting_update()`);
        failureApp = await createApp({ ...appOptions(failureSchema) });
        const failedCapacityUpdate = await failureApp.inject({
          method: "POST",
          url: "/api/poc/capacity",
          headers: { host: "127.0.0.1", "content-type": "application/json", origin: "http://127.0.0.1" },
          payload: { softLimit: 12 },
          remoteAddress: "127.0.0.1",
        });
        assert.equal(failedCapacityUpdate.statusCode, 503);
        assert.deepEqual(failedCapacityUpdate.json(), { error: "persistence_unavailable" });
        const persistedCapacityAfterFailure = await failurePool.query("SELECT member_soft_limit FROM application_settings WHERE singleton = true");
        assert.equal(Number(persistedCapacityAfterFailure.rows[0].member_soft_limit), 10, "failed settings transactions must roll back the candidate limit");
        await failureApp.close();
        failureApp = undefined;
      } finally {
        await failurePool.end();
      }

      const startupUnavailableUrl = new URL(DATABASE_URL);
      startupUnavailableUrl.port = "1";
      await assert.rejects(
        () => createApp({ serveClient: false, databaseUrl: startupUnavailableUrl.toString(), databaseSchema: schema }),
        /Unable to initialize the PostgreSQL connection/u,
      );
    } finally {
      for (const socket of currentSockets) {
        try { socket.close(); } catch { /* Best-effort test cleanup. */ }
      }
      await currentApp?.close().catch(() => {});
      await failureApp?.close().catch(() => {});
      await scopedPool?.end().catch(() => {});
      for (const name of safeSchemas) await adminPool.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`).catch(() => {});
      await adminPool.end();
    }
  });
}
