import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import WebSocket from "ws";
import { createApp } from "../src/server/app.ts";
import { createRoomAccessPolicy } from "../src/server/room-access.ts";

const { Pool } = pg;
const DATABASE_URL = process.env.PG_TEST_DATABASE_URL;
const LEGACY_PASSWORD = "room-management-existing-001-password";
const ANONYMOUS_PASSWORD = "room-management-new-anonymous-password";
const sockets = [];
const apps = [];

function nextMessage(socket, predicate, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Expected WebSocket message did not arrive.")), timeoutMs);
    const onMessage = (raw, isBinary) => {
      if (isBinary) return;
      const message = JSON.parse(raw.toString());
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

async function connect(baseUrl) {
  const socket = new WebSocket(`${baseUrl.replace(/^http/u, "ws")}/ws`, { origin: baseUrl });
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}

function send(socket, message) {
  socket.send(JSON.stringify(message));
}

async function startApp(options) {
  const app = await createApp({ serveClient: false, ...options });
  apps.push(app);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function closeApp(app) {
  const index = apps.indexOf(app);
  if (index >= 0) apps.splice(index, 1);
  await app.close();
}

async function join(socket, displayName, roomId, password) {
  const issued = nextMessage(socket, (message) => message.type === "session.issued");
  const room = nextMessage(socket, (message) => message.type === "room.snapshot");
  const state = nextMessage(socket, (message) => message.type === "room.management.state");
  send(socket, { type: "join", roomId, displayName, password, resumable: true });
  const [session, roomSnapshot, managementState] = await Promise.all([issued, room, state]);
  return { ...session, room: roomSnapshot, management: managementState };
}

function makeAdminPool(schema) {
  return new Pool({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 2_000,
    options: `-c search_path=${schema},public -c statement_timeout=5000`,
  });
}

if (!DATABASE_URL) {
  test("PostgreSQL room management integration (set PG_TEST_DATABASE_URL to enable)", { skip: true }, () => {});
} else {
  test("PostgreSQL migrates legacy locks, commits anonymous ownership, and clears orphaned locks after restart", { timeout: 90_000 }, async () => {
    const parsed = new URL(DATABASE_URL);
    assert.equal(decodeURIComponent(parsed.pathname.slice(1)), "laitse_poc_test",
      "PG_TEST_DATABASE_URL must point to the dedicated laitse_poc_test database.");
    const suffix = `${process.pid}_${randomBytes(4).toString("hex")}`;
    const legacySchema = `rm_legacy_${suffix}`;
    const anonymousSchema = `rm_anon_${suffix}`;
    const schemas = [legacySchema, anonymousSchema];
    const adminPool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2_000, options: "-c statement_timeout=5000" });
    const legacyPool = makeAdminPool(legacySchema);
    const anonymousPool = makeAdminPool(anonymousSchema);
    let currentApp;
    try {
      for (const schema of schemas) await adminPool.query(`CREATE SCHEMA "${schema}"`);

      // Seed a schema already at migration 001, as an existing installation would be before this POC.
      await legacyPool.query("CREATE TABLE schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())");
      const migration001 = await readFile(new URL("../db/migrations/001_system_persistence.sql", import.meta.url), "utf8");
      await legacyPool.query(migration001);
      await legacyPool.query("INSERT INTO schema_migrations(version) VALUES ('001_system_persistence.sql')");
      const legacyAccess = createRoomAccessPolicy(LEGACY_PASSWORD).snapshot();
      await legacyPool.query(
        `INSERT INTO room_settings(room_id, is_locked, password_salt, password_verifier, admission_revision)
         VALUES ('studio', true, $1, $2, 7)`,
        [Buffer.from(legacyAccess.passwordSalt, "base64"), Buffer.from(legacyAccess.passwordVerifier, "base64")],
      );

      let running = await startApp({ databaseUrl: DATABASE_URL, databaseSchema: legacySchema, meetingRoomPassword: "ignored-new-seed-password" });
      currentApp = running.app;
      let row = await legacyPool.query("SELECT is_locked, lock_kind, manager_participant_id, admission_revision, password_salt, password_verifier FROM room_settings WHERE room_id = 'studio'");
      assert.deepEqual(row.rows[0], {
        is_locked: true,
        lock_kind: "legacy",
        manager_participant_id: null,
        admission_revision: "7",
        password_salt: Buffer.from(legacyAccess.passwordSalt, "base64"),
        password_verifier: Buffer.from(legacyAccess.passwordVerifier, "base64"),
      }, "migration 002 classifies an existing lock without replacing its verifier or revision");
      const applied = await legacyPool.query("SELECT version FROM schema_migrations ORDER BY version");
      assert.deepEqual(applied.rows.map((entry) => entry.version), ["001_system_persistence.sql", "002_anonymous_room_management.sql", "003_capacity_settings.sql"]);
      let legacySocket = await connect(running.baseUrl);
      let legacyJoin = await join(legacySocket, "Legacy lock visitor", "studio", LEGACY_PASSWORD);
      assert.equal(legacyJoin.management.lockKind, "legacy");
      assert.equal(legacyJoin.management.canLock, false);
      assert.equal(legacyJoin.room.room.isLocked, true);
      legacySocket.close();
      await closeApp(currentApp);
      currentApp = undefined;

      running = await startApp({ databaseUrl: DATABASE_URL, databaseSchema: legacySchema, meetingRoomPassword: "ignored-new-seed-password" });
      currentApp = running.app;
      assert.equal((await (await fetch(`${running.baseUrl}/api/rooms`)).json()).find((room) => room.id === "studio").isLocked, true,
        "a legacy startup lock survives restart");
      row = await legacyPool.query("SELECT lock_kind, manager_participant_id, encode(password_verifier, 'hex') AS verifier FROM room_settings WHERE room_id = 'studio'");
      assert.equal(row.rows[0].lock_kind, "legacy");
      assert.equal(row.rows[0].manager_participant_id, null);
      assert.equal(row.rows[0].verifier, Buffer.from(legacyAccess.passwordVerifier, "base64").toString("hex"));
      await closeApp(currentApp);
      currentApp = undefined;

      running = await startApp({ databaseUrl: DATABASE_URL, databaseSchema: anonymousSchema });
      currentApp = running.app;
      const owner = await connect(running.baseUrl);
      const candidate = await connect(running.baseUrl);
      const ownerJoin = await join(owner, "PG anonymous owner", "lobby");
      const candidateJoin = await join(candidate, "PG room member", "studio");

      const lockResult = nextMessage(owner, (message) => message.type === "room.management.result" && message.action === "lock");
      send(owner, { type: "room.management.lock", password: ANONYMOUS_PASSWORD });
      await lockResult;
      row = await anonymousPool.query("SELECT is_locked, lock_kind, manager_participant_id, password_salt, password_verifier FROM room_settings WHERE room_id = 'studio'");
      assert.equal(row.rows[0].is_locked, true);
      assert.equal(row.rows[0].lock_kind, "anonymous");
      assert.equal(row.rows[0].manager_participant_id, ownerJoin.participantId);
      assert.ok(row.rows[0].password_salt);
      assert.ok(row.rows[0].password_verifier);
      assert.equal(row.rows[0].password_verifier.includes(Buffer.from(ANONYMOUS_PASSWORD)), false, "only a salted verifier is stored");

      const transferResult = nextMessage(owner, (message) => message.type === "room.management.result" && message.action === "transfer");
      send(owner, { type: "room.management.transfer", participantId: candidateJoin.participantId });
      await transferResult;
      row = await anonymousPool.query("SELECT is_locked, lock_kind, manager_participant_id FROM room_settings WHERE room_id = 'studio'");
      assert.deepEqual(row.rows[0], { is_locked: true, lock_kind: "anonymous", manager_participant_id: candidateJoin.participantId },
        "the transfer ACK follows a committed owner update");

      await closeApp(currentApp);
      currentApp = undefined;
      running = await startApp({ databaseUrl: DATABASE_URL, databaseSchema: anonymousSchema });
      currentApp = running.app;
      row = await anonymousPool.query("SELECT is_locked, lock_kind, manager_participant_id, password_salt, password_verifier, admission_revision FROM room_settings WHERE room_id = 'studio'");
      assert.deepEqual(row.rows[0], {
        is_locked: false,
        lock_kind: "none",
        manager_participant_id: null,
        password_salt: null,
        password_verifier: null,
        admission_revision: "2",
      }, "restart clears the anonymous lock, manager, and credential when nobody can be online owner");
      assert.equal((await (await fetch(`${running.baseUrl}/api/rooms`)).json()).find((room) => room.id === "studio").isLocked, false);
    } finally {
      if (currentApp) await closeApp(currentApp).catch(() => {});
      for (const socket of sockets) {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
      }
      for (const schema of schemas) await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
      await Promise.all([legacyPool.end(), anonymousPool.end(), adminPool.end()]);
    }
  });
}
