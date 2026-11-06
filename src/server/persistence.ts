import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { RoomId, SpacePlayer } from "./space.ts";
import type { ControlResumeRecord, ResumeMode, ResumeRole } from "./control-resume.ts";
import type { InteractionRecord } from "./interactions.ts";
import type { SanitizedCapabilityReport } from "./capabilities.ts";
import type { RoomLockKind } from "./room-management.ts";

const { Pool } = pg;
const ADVISORY_LOCK_NAMESPACE = 1_431_065_428;
const ADVISORY_LOCK_ID = 1;

export type PersistedRoomSettings = {
  roomId: RoomId;
  locked: boolean;
  passwordSalt: string | null;
  passwordVerifier: string | null;
  admissionRevision: number;
  lockKind: RoomLockKind;
  managerParticipantId: string | null;
  interactionPaused: boolean;
  danmakuEnabled: boolean;
};

export type PersistedParticipant = {
  id: string;
  displayName: string;
  roomId: RoomId;
  role: ResumeRole;
  mode: ResumeMode;
  x: number;
  y: number;
};

export type PersistedSession = Omit<ControlResumeRecord, "token"> & { tokenDigest: string };

export type ActivityCounters = {
  joins: number;
  leaves: number;
  moves: number;
  reactions: number;
  interactions: number;
  capabilityReports: number;
  hostActions: number;
};

export type PersistenceBootstrap = {
  managedHostMode: boolean;
  roomSettings: PersistedRoomSettings[];
  participants: PersistedParticipant[];
  sessions: PersistedSession[];
  recentlyExpiredSessionDigests: string[];
  activeInteractions: InteractionRecord[];
  publicQueueInteractionIds: string[];
  dedup: Array<{ senderId: string; eventId: string; roomId: RoomId; fingerprint: string; interactionId: string; expiresAt: number }>;
  controlSequence: number;
  spaceSequence: number;
  roomCounters: Record<RoomId, ActivityCounters>;
};

export type DurableSnapshot = {
  roomSettings: PersistedRoomSettings[];
  participants: PersistedParticipant[];
  sessions: PersistedSession[];
  controlSequence: number;
  spaceSequence: number;
  roomCounters: Record<RoomId, ActivityCounters>;
};

export type PendingPersistence = {
  interactions: InteractionRecord[];
  interactionDedup: Array<{ senderId: string; eventId: string; roomId: RoomId; fingerprint: string; interactionId: string; expiresAt: number }>;
  controlEvents: Array<{ seq: number; kind: "member.joined" | "member.left" | "reaction"; roomId: RoomId; participantId: string; displayName: string; reaction?: string; at: number }>;
  tombstones: Array<{ interactionId: string; roomId: RoomId; action: "remove" | "clearQueue" | "participantRemoved"; actorParticipantId: string | null }>;
  moderation: Array<{ roomId: RoomId; actorParticipantId: string | null; action: string; itemCount?: number; details?: Record<string, unknown> }>;
  management: Array<{ roomId: RoomId; actorParticipantId: string | null; targetParticipantId?: string | null; action: string; details?: Record<string, unknown> }>;
  capabilities: Array<{ observationId: string; observedAtServer: string; connectionId: string; roomId: RoomId; participantId: string; displayName: string; report: SanitizedCapabilityReport }>;
  revokedSessionDigests: string[];
};

export type SeedPersistenceOptions = {
  roomIds: readonly RoomId[];
  initialRoomSettings: PersistedRoomSettings[];
  managedHostMode: boolean;
};

export interface SystemPersistence {
  readonly mode: "postgresql";
  initialize(seed: SeedPersistenceOptions): Promise<PersistenceBootstrap>;
  save(snapshot: DurableSnapshot, pending: PendingPersistence): Promise<void>;
  getObservation(observationId: string): Promise<PendingPersistence["capabilities"][number] | null>;
  onFatal(handler: () => void): void;
  close(): Promise<void>;
}

export class PostgresPersistence implements SystemPersistence {
  readonly mode = "postgresql" as const;
  private readonly pool: pg.Pool;
  private readonly advisoryClient: pg.PoolClient;
  private closed = false;
  private advisoryLockLost = false;
  private fatalHandler: (() => void) | undefined;

  private constructor(pool: pg.Pool, advisoryClient: pg.PoolClient) {
    this.pool = pool;
    this.advisoryClient = advisoryClient;
    const markLost = () => {
      if (this.closed || this.advisoryLockLost) return;
      this.advisoryLockLost = true;
      this.fatalHandler?.();
    };
    this.pool.on("error", markLost);
    this.advisoryClient.on("error", markLost);
    this.advisoryClient.on("end", markLost);
  }

  static async open(databaseUrl: string, schema?: string): Promise<PostgresPersistence> {
    if (schema && !/^[a-z][a-z0-9_]{0,62}$/u.test(schema)) throw new Error("Invalid test database schema name.");
    const pool = new Pool({
      connectionString: databaseUrl,
      max: 8,
      connectionTimeoutMillis: 2_000,
      idleTimeoutMillis: 10_000,
      options: `-c statement_timeout=5000 -c lock_timeout=2000${schema ? ` -c search_path=${schema},public` : ""}`,
    });
    let lockClient: pg.PoolClient | undefined;
    try {
      lockClient = await pool.connect();
      const lockResult = await lockClient.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock($1, $2) AS locked",
        [ADVISORY_LOCK_NAMESPACE, ADVISORY_LOCK_ID],
      );
      if (!lockResult.rows[0]?.locked) throw new Error("A PostgreSQL-backed LaiTse app is already active for this database.");
      const persistence = new PostgresPersistence(pool, lockClient);
      return persistence;
    } catch (error) {
      lockClient?.release();
      await pool.end().catch(() => {});
      if (error instanceof Error && error.message === "A PostgreSQL-backed LaiTse app is already active for this database.") throw error;
      throw new Error("Unable to initialize the PostgreSQL connection or acquire the single-app lock.");
    }
  }

  async initialize(seed: SeedPersistenceOptions): Promise<PersistenceBootstrap> {
    await this.migrate();
    await this.pool.query("INSERT INTO application_settings(singleton, managed_host_mode) VALUES (true, $1) ON CONFLICT (singleton) DO NOTHING", [seed.managedHostMode]);
    for (const room of seed.initialRoomSettings) {
      await this.pool.query(
        `INSERT INTO room_settings
          (room_id, is_locked, password_salt, password_verifier, admission_revision, lock_kind, manager_participant_id, interaction_paused, danmaku_enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (room_id) DO NOTHING`,
        [room.roomId, room.locked, room.passwordSalt ? Buffer.from(room.passwordSalt, "base64") : null,
          room.passwordVerifier ? Buffer.from(room.passwordVerifier, "base64") : null, room.admissionRevision,
          room.lockKind, room.managerParticipantId, room.interactionPaused, room.danmakuEnabled],
      );
      await this.pool.query("INSERT INTO room_counters(room_id) VALUES ($1) ON CONFLICT (room_id) DO NOTHING", [room.roomId]);
    }

    // An anonymous owner is an online connection identity. A process restart leaves no such owner online.
    await this.pool.query(`UPDATE room_settings
                           SET is_locked = false, password_salt = NULL, password_verifier = NULL,
                               admission_revision = admission_revision + 1, lock_kind = 'none',
                               manager_participant_id = NULL, updated_at = clock_timestamp()
                           WHERE lock_kind = 'anonymous'`);

    // A process restart invalidates connection ownership but keeps a proof resumable until its original TTL.
    await this.pool.query("UPDATE control_sessions SET active_connection_id = NULL WHERE revoked_at IS NULL");

    const [settingsResult, sessionsResult, expiredSessionsResult, participantResult, interactionResult, dedupResult, appCountersResult, roomCountersResult, appSettingsResult] = await Promise.all([
      this.pool.query(`SELECT room_id, is_locked, password_salt, password_verifier, admission_revision,
                              lock_kind, manager_participant_id, interaction_paused, danmaku_enabled
                       FROM room_settings ORDER BY room_id`),
      this.pool.query(`SELECT encode(token_digest, 'hex') AS token_digest, participant_id, room_id, role, mode,
                              admission_revision, expires_at, active_connection_id
                       FROM control_sessions WHERE revoked_at IS NULL AND expires_at > clock_timestamp()`),
      this.pool.query(`SELECT encode(token_digest, 'hex') AS token_digest FROM control_sessions
                       WHERE revoked_at IS NULL AND expires_at <= clock_timestamp()
                         AND expires_at > clock_timestamp() - interval '10 minutes'
                       ORDER BY expires_at DESC LIMIT 512`),
      this.pool.query(`SELECT DISTINCT p.participant_id, p.display_name, p.last_room_id, p.role, p.mode, p.position_x, p.position_y
                       FROM participants p JOIN control_sessions s USING (participant_id)
                       WHERE s.revoked_at IS NULL AND s.expires_at > clock_timestamp()`),
      this.pool.query(`WITH history AS (
                         SELECT interaction_id, event_id, room_id, participant_id, display_name, kind, content, public_cleared_at,
                                extract(epoch FROM created_at) * 1000 AS created_ms,
                                extract(epoch FROM live_expires_at) * 1000 AS expires_ms,
                                row_number() OVER (PARTITION BY room_id ORDER BY created_at DESC, interaction_id) AS rn
                         FROM interaction_archive
                         WHERE tombstoned_at IS NULL AND kind <> 'feedback'
                           AND created_at > clock_timestamp() - interval '5 minutes'
                       ), feedback AS (
                         SELECT interaction_id, event_id, room_id, participant_id, display_name, kind, content, public_cleared_at,
                                extract(epoch FROM created_at) * 1000 AS created_ms,
                                extract(epoch FROM live_expires_at) * 1000 AS expires_ms,
                                row_number() OVER (PARTITION BY room_id ORDER BY created_at DESC, interaction_id) AS rn
                         FROM interaction_archive
                         WHERE tombstoned_at IS NULL AND kind = 'feedback' AND live_expires_at > clock_timestamp()
                       )
                       SELECT * FROM history WHERE rn <= 50
                       UNION ALL SELECT * FROM feedback WHERE rn <= 512
                       ORDER BY created_ms`),
      this.pool.query(`SELECT participant_id, event_id, room_id, encode(fingerprint_sha256, 'hex') AS fingerprint,
                              interaction_id, extract(epoch FROM expires_at) * 1000 AS expires_ms
                       FROM interaction_dedup WHERE expires_at > clock_timestamp()
                       ORDER BY expires_at DESC LIMIT 2048`),
      this.pool.query("SELECT control_sequence, space_sequence FROM application_counters WHERE singleton = true"),
      this.pool.query("SELECT room_id, joins, leaves, moves, reactions, interactions, capability_reports, host_actions FROM room_counters"),
      this.pool.query("SELECT managed_host_mode FROM application_settings WHERE singleton = true"),
    ]);

    const roomSettings = settingsResult.rows.map((row) => ({
      roomId: row.room_id as RoomId,
      locked: row.is_locked as boolean,
      passwordSalt: row.password_salt ? Buffer.from(row.password_salt as Buffer).toString("base64") : null,
      passwordVerifier: row.password_verifier ? Buffer.from(row.password_verifier as Buffer).toString("base64") : null,
      admissionRevision: Number(row.admission_revision),
      lockKind: row.lock_kind as RoomLockKind,
      managerParticipantId: row.manager_participant_id as string | null,
      interactionPaused: row.interaction_paused as boolean,
      danmakuEnabled: row.danmaku_enabled as boolean,
    }));
    const sessions = sessionsResult.rows.map((row): PersistedSession => ({
      tokenDigest: row.token_digest as string,
      participantId: row.participant_id as string,
      displayName: "", // Display name is read from the participant table after join; never a proof secret.
      roomId: row.room_id as RoomId,
      role: row.role as ResumeRole,
      mode: row.mode as ResumeMode,
      admissionRevision: Number(row.admission_revision),
      expiresAt: new Date(row.expires_at as string).getTime(),
      activeConnectionId: null,
    }));
    const participants = participantResult.rows.map((row): PersistedParticipant => ({
      id: row.participant_id as string,
      displayName: row.display_name as string,
      roomId: row.last_room_id as RoomId,
      role: row.role as ResumeRole,
      mode: row.mode as ResumeMode,
      x: Number(row.position_x),
      y: Number(row.position_y),
    }));
    const participantById = new Map(participants.map((participant) => [participant.id, participant]));
    for (const session of sessions) session.displayName = participantById.get(session.participantId)?.displayName ?? "";

    const activeInteractions: InteractionRecord[] = interactionResult.rows.map((row) => ({
      id: row.interaction_id as string,
      eventId: row.event_id as string,
      roomId: row.room_id as string,
      participantId: row.participant_id as string,
      displayName: row.display_name as string,
      kind: row.kind as InteractionRecord["kind"],
      ...(typeof (row.content as Record<string, unknown>).text === "string" ? { text: (row.content as Record<string, string>).text } : {}),
      ...(typeof (row.content as Record<string, unknown>).sticker === "string" ? { sticker: (row.content as Record<string, string>).sticker as InteractionRecord["sticker"] } : {}),
      ...(typeof (row.content as Record<string, unknown>).feedback === "string" ? { feedback: (row.content as Record<string, string>).feedback as InteractionRecord["feedback"] } : {}),
      at: Number(row.created_ms),
      expiresAt: Number(row.expires_ms),
    }));
    const publicQueueInteractionIds = interactionResult.rows
      .filter((row) => row.kind === "danmaku" && !row.public_cleared_at && Number(row.expires_ms) > Date.now())
      .sort((a, b) => Number(a.created_ms) - Number(b.created_ms))
      .slice(-20)
      .map((row) => row.interaction_id as string);
    const dedup = dedupResult.rows.map((row) => ({
      senderId: row.participant_id as string,
      eventId: row.event_id as string,
      roomId: row.room_id as RoomId,
      fingerprint: row.fingerprint as string,
      interactionId: row.interaction_id as string,
      expiresAt: Number(row.expires_ms),
    }));
    const appCounters = appCountersResult.rows[0];
    const roomCounters = Object.fromEntries(seed.roomIds.map((roomId) => [roomId, {
      joins: 0, leaves: 0, moves: 0, reactions: 0, interactions: 0, capabilityReports: 0, hostActions: 0,
    }])) as Record<RoomId, ActivityCounters>;
    for (const row of roomCountersResult.rows) {
      roomCounters[row.room_id as RoomId] = {
        joins: Number(row.joins), leaves: Number(row.leaves), moves: Number(row.moves), reactions: Number(row.reactions),
        interactions: Number(row.interactions), capabilityReports: Number(row.capability_reports), hostActions: Number(row.host_actions),
      };
    }

    return {
      managedHostMode: Boolean(appSettingsResult.rows[0]?.managed_host_mode),
      roomSettings,
      participants,
      sessions,
      recentlyExpiredSessionDigests: expiredSessionsResult.rows.map((row) => row.token_digest as string),
      activeInteractions,
      publicQueueInteractionIds,
      dedup,
      controlSequence: Number(appCounters?.control_sequence ?? 0),
      spaceSequence: Number(appCounters?.space_sequence ?? 0),
      roomCounters,
    };
  }

  async save(snapshot: DurableSnapshot, pending: PendingPersistence): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM interaction_dedup WHERE expires_at <= clock_timestamp()");
      for (const room of snapshot.roomSettings) {
        await client.query(
          `INSERT INTO room_settings
             (room_id, is_locked, password_salt, password_verifier, admission_revision, lock_kind, manager_participant_id,
              interaction_paused, danmaku_enabled, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, clock_timestamp())
           ON CONFLICT (room_id) DO UPDATE SET is_locked = EXCLUDED.is_locked,
             password_salt = EXCLUDED.password_salt, password_verifier = EXCLUDED.password_verifier,
             admission_revision = EXCLUDED.admission_revision, lock_kind = EXCLUDED.lock_kind,
             manager_participant_id = EXCLUDED.manager_participant_id, interaction_paused = EXCLUDED.interaction_paused,
             danmaku_enabled = EXCLUDED.danmaku_enabled, updated_at = EXCLUDED.updated_at`,
          [room.roomId, room.locked, room.passwordSalt ? Buffer.from(room.passwordSalt, "base64") : null,
            room.passwordVerifier ? Buffer.from(room.passwordVerifier, "base64") : null,
            room.admissionRevision, room.lockKind, room.managerParticipantId, room.interactionPaused, room.danmakuEnabled],
        );
      }
      for (const participant of snapshot.participants) {
        await client.query(
          `INSERT INTO participants(participant_id, display_name, last_room_id, role, mode, position_x, position_y, last_seen_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, clock_timestamp())
           ON CONFLICT (participant_id) DO UPDATE SET display_name = EXCLUDED.display_name,
             last_room_id = EXCLUDED.last_room_id, role = EXCLUDED.role, mode = EXCLUDED.mode,
             position_x = EXCLUDED.position_x, position_y = EXCLUDED.position_y, last_seen_at = EXCLUDED.last_seen_at`,
          [participant.id, participant.displayName, participant.roomId, participant.role, participant.mode, participant.x, participant.y],
        );
      }
      for (const session of snapshot.sessions) {
        const digest = Buffer.from(session.tokenDigest, "hex");
        await client.query(
          `INSERT INTO control_sessions
             (token_digest, participant_id, room_id, role, mode, admission_revision, expires_at, active_connection_id, revoked_at)
           VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0), $8, NULL)
           ON CONFLICT (token_digest) DO UPDATE SET participant_id = EXCLUDED.participant_id, room_id = EXCLUDED.room_id,
             role = EXCLUDED.role, mode = EXCLUDED.mode, admission_revision = EXCLUDED.admission_revision,
             expires_at = EXCLUDED.expires_at, active_connection_id = EXCLUDED.active_connection_id
           WHERE control_sessions.revoked_at IS NULL`,
          [digest, session.participantId, session.roomId, session.role, session.mode,
            session.admissionRevision, session.expiresAt, session.activeConnectionId],
        );
      }
      for (const digestHex of pending.revokedSessionDigests) {
        await client.query("UPDATE control_sessions SET revoked_at = COALESCE(revoked_at, clock_timestamp()), active_connection_id = NULL WHERE token_digest = $1", [Buffer.from(digestHex, "hex")]);
      }
      for (const event of pending.interactions) {
        const content = {
          ...(event.text !== undefined ? { text: event.text } : {}),
          ...(event.sticker !== undefined ? { sticker: event.sticker } : {}),
          ...(event.feedback !== undefined ? { feedback: event.feedback } : {}),
        };
        await client.query(
          `INSERT INTO interaction_archive
             (interaction_id, event_id, room_id, participant_id, display_name, kind, content, created_at, history_expires_at, live_expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, to_timestamp($8 / 1000.0), to_timestamp($10 / 1000.0), to_timestamp($9 / 1000.0))
           ON CONFLICT (interaction_id) DO NOTHING`,
          [event.id, event.eventId, event.roomId, event.participantId, event.displayName, event.kind,
            JSON.stringify(content), event.at, event.expiresAt, event.at + 5 * 60_000],
        );
      }
      for (const dedup of pending.interactionDedup) {
        await client.query(
          `INSERT INTO interaction_dedup(participant_id, event_id, room_id, fingerprint_sha256, interaction_id, expires_at)
           VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))
           ON CONFLICT (participant_id, event_id) DO UPDATE SET room_id = EXCLUDED.room_id,
             fingerprint_sha256 = EXCLUDED.fingerprint_sha256, interaction_id = EXCLUDED.interaction_id, expires_at = EXCLUDED.expires_at`,
          [dedup.senderId, dedup.eventId, dedup.roomId, Buffer.from(dedup.fingerprint, "hex"), dedup.interactionId, dedup.expiresAt],
        );
      }
      for (const tombstone of pending.tombstones) {
        if (tombstone.action === "clearQueue") {
          await client.query(
            `UPDATE interaction_archive SET public_cleared_at = COALESCE(public_cleared_at, clock_timestamp())
             WHERE interaction_id = $1 AND room_id = $2 AND kind = 'danmaku'`,
            [tombstone.interactionId, tombstone.roomId],
          );
        } else {
          await client.query(
            `UPDATE interaction_archive SET tombstoned_at = COALESCE(tombstoned_at, clock_timestamp()),
               tombstone_action = COALESCE(tombstone_action, $2)
             WHERE interaction_id = $1 AND room_id = $3`,
            [tombstone.interactionId, tombstone.action, tombstone.roomId],
          );
        }
      }
      for (const audit of pending.moderation) {
        await client.query(
          `INSERT INTO moderation_audit(room_id, actor_participant_id, action, item_count, details)
           VALUES ($1, $2, $3, $4, $5::jsonb)`,
          [audit.roomId, audit.actorParticipantId, audit.action, audit.itemCount ?? null, JSON.stringify(audit.details ?? {})],
        );
      }
      for (const event of pending.controlEvents) {
        await client.query(
          `INSERT INTO control_event_archive(seq, room_id, participant_id, display_name, kind, reaction, occurred_at)
           VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0))
           ON CONFLICT (seq) DO NOTHING`,
          [event.seq, event.roomId, event.participantId, event.displayName, event.kind, event.reaction ?? null, event.at],
        );
      }
      for (const audit of pending.management) {
        await client.query(
          `INSERT INTO management_audit(room_id, actor_participant_id, target_participant_id, action, details)
           VALUES ($1, $2, $3, $4, $5::jsonb)`,
          [audit.roomId, audit.actorParticipantId, audit.targetParticipantId ?? null, audit.action, JSON.stringify(audit.details ?? {})],
        );
      }
      for (const observation of pending.capabilities) {
        await client.query(
          `INSERT INTO capability_observations(observation_id, observed_at_server, connection_id, room_id, participant_id, display_name, report)
           VALUES ($1, $2::timestamptz, $3, $4, $5, $6, $7::jsonb)
           ON CONFLICT (observation_id) DO NOTHING`,
          [observation.observationId, observation.observedAtServer, observation.connectionId, observation.roomId,
            observation.participantId, observation.displayName, JSON.stringify(observation.report)],
        );
      }
      await client.query(
        `INSERT INTO application_counters(singleton, control_sequence, space_sequence, updated_at)
         VALUES (true, $1, $2, clock_timestamp())
         ON CONFLICT (singleton) DO UPDATE SET control_sequence = EXCLUDED.control_sequence,
           space_sequence = EXCLUDED.space_sequence, updated_at = EXCLUDED.updated_at`,
        [snapshot.controlSequence, snapshot.spaceSequence],
      );
      for (const [roomId, counters] of Object.entries(snapshot.roomCounters) as Array<[RoomId, ActivityCounters]>) {
        await client.query(
          `INSERT INTO room_counters(room_id, joins, leaves, moves, reactions, interactions, capability_reports, host_actions, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, clock_timestamp())
           ON CONFLICT (room_id) DO UPDATE SET joins = EXCLUDED.joins, leaves = EXCLUDED.leaves,
             moves = EXCLUDED.moves, reactions = EXCLUDED.reactions, interactions = EXCLUDED.interactions,
             capability_reports = EXCLUDED.capability_reports, host_actions = EXCLUDED.host_actions,
             updated_at = EXCLUDED.updated_at`,
          [roomId, counters.joins, counters.leaves, counters.moves, counters.reactions, counters.interactions,
            counters.capabilityReports, counters.hostActions],
        );
      }
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK").catch(() => {});
      throw new Error("PostgreSQL system-state transaction failed; the app must fail closed.");
    } finally {
      client.release();
    }
  }

  async getObservation(observationId: string): Promise<PendingPersistence["capabilities"][number] | null> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(observationId)) return null;
    const result = await this.pool.query(
      `SELECT observation_id, observed_at_server, connection_id, room_id, participant_id, display_name, report
       FROM capability_observations WHERE observation_id = $1`,
      [observationId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      observationId: row.observation_id as string,
      observedAtServer: new Date(row.observed_at_server as string).toISOString(),
      connectionId: row.connection_id as string,
      roomId: row.room_id as RoomId,
      participantId: row.participant_id as string,
      displayName: row.display_name as string,
      report: row.report as SanitizedCapabilityReport,
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.advisoryClient.query("SELECT pg_advisory_unlock($1, $2)", [ADVISORY_LOCK_NAMESPACE, ADVISORY_LOCK_ID]).catch(() => {});
    this.advisoryClient.release();
    await this.pool.end().catch(() => {});
  }

  onFatal(handler: () => void): void {
    this.fatalHandler = handler;
    if (this.advisoryLockLost) handler();
  }

  private async migrate(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    const migrationNames = ["001_system_persistence.sql", "002_anonymous_room_management.sql"];
    for (const version of migrationNames) {
      const migrationPath = fileURLToPath(new URL(`../../db/migrations/${version}`, import.meta.url));
      const seen = await this.pool.query("SELECT 1 FROM schema_migrations WHERE version = $1", [version]);
      if (seen.rowCount) continue;
      const sql = await readFile(path.resolve(migrationPath), "utf8");
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [version]);
        await client.query("COMMIT");
      } catch {
        await client.query("ROLLBACK").catch(() => {});
        throw new Error(`PostgreSQL schema migration ${version} failed.`);
      } finally {
        client.release();
      }
    }
  }
}

export async function openSystemPersistence(databaseUrl: string | undefined, schema?: string): Promise<SystemPersistence | null> {
  if (!databaseUrl) return null;
  const persistence = await PostgresPersistence.open(databaseUrl, schema);
  return persistence;
}

export type DurableSpacePlayer = Pick<SpacePlayer, "id" | "displayName" | "roomId" | "x" | "y">;
