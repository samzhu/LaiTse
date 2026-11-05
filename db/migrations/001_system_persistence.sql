CREATE TABLE IF NOT EXISTS room_settings (
  room_id text PRIMARY KEY,
  is_locked boolean NOT NULL DEFAULT false,
  password_salt bytea,
  password_verifier bytea,
  admission_revision bigint NOT NULL DEFAULT 0 CHECK (admission_revision >= 0),
  interaction_paused boolean NOT NULL DEFAULT false,
  danmaku_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((is_locked AND password_salt IS NOT NULL AND password_verifier IS NOT NULL)
      OR (NOT is_locked AND password_salt IS NULL AND password_verifier IS NULL))
);

CREATE TABLE IF NOT EXISTS participants (
  participant_id text PRIMARY KEY,
  display_name text NOT NULL,
  last_room_id text NOT NULL REFERENCES room_settings(room_id),
  role text NOT NULL CHECK (role IN ('participant', 'display')),
  mode text NOT NULL CHECK (mode IN ('watch', 'interaction')),
  position_x integer NOT NULL CHECK (position_x >= 0),
  position_y integer NOT NULL CHECK (position_y >= 0),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS control_sessions (
  token_digest bytea PRIMARY KEY CHECK (octet_length(token_digest) = 32),
  participant_id text NOT NULL REFERENCES participants(participant_id),
  room_id text NOT NULL REFERENCES room_settings(room_id),
  role text NOT NULL CHECK (role IN ('participant', 'display')),
  mode text NOT NULL CHECK (mode IN ('watch', 'interaction')),
  admission_revision bigint NOT NULL CHECK (admission_revision >= 0),
  expires_at timestamptz NOT NULL,
  active_connection_id text,
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS control_sessions_participant_idx ON control_sessions(participant_id);
CREATE INDEX IF NOT EXISTS control_sessions_expiry_idx ON control_sessions(expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS interaction_archive (
  interaction_id uuid PRIMARY KEY,
  event_id text NOT NULL,
  room_id text NOT NULL REFERENCES room_settings(room_id),
  participant_id text NOT NULL,
  display_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('chat', 'danmaku', 'sticker', 'feedback')),
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  history_expires_at timestamptz NOT NULL,
  live_expires_at timestamptz NOT NULL,
  public_cleared_at timestamptz,
  tombstoned_at timestamptz,
  tombstone_action text CHECK (tombstone_action IN ('remove', 'clearQueue', 'participantRemoved'))
);

CREATE INDEX IF NOT EXISTS interaction_archive_room_time_idx ON interaction_archive(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS interaction_archive_live_idx ON interaction_archive(room_id, live_expires_at) WHERE tombstoned_at IS NULL;

CREATE TABLE IF NOT EXISTS interaction_dedup (
  participant_id text NOT NULL,
  event_id text NOT NULL,
  room_id text NOT NULL REFERENCES room_settings(room_id),
  fingerprint_sha256 bytea NOT NULL CHECK (octet_length(fingerprint_sha256) = 32),
  interaction_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (participant_id, event_id)
);

CREATE INDEX IF NOT EXISTS interaction_dedup_expiry_idx ON interaction_dedup(expires_at);

CREATE TABLE IF NOT EXISTS moderation_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id text NOT NULL REFERENCES room_settings(room_id),
  actor_participant_id text,
  action text NOT NULL,
  interaction_id uuid,
  item_count integer,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS management_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id text NOT NULL REFERENCES room_settings(room_id),
  actor_participant_id text,
  target_participant_id text,
  action text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS control_event_archive (
  seq bigint PRIMARY KEY CHECK (seq > 0),
  room_id text NOT NULL REFERENCES room_settings(room_id),
  participant_id text NOT NULL,
  display_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('member.joined', 'member.left', 'reaction')),
  reaction text,
  occurred_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS control_event_room_time_idx ON control_event_archive(room_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS capability_observations (
  observation_id uuid PRIMARY KEY,
  observed_at_server timestamptz NOT NULL,
  connection_id text NOT NULL,
  room_id text NOT NULL REFERENCES room_settings(room_id),
  participant_id text NOT NULL,
  display_name text NOT NULL,
  report jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS capability_observations_time_idx ON capability_observations(observed_at_server DESC);

CREATE TABLE IF NOT EXISTS application_counters (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  control_sequence bigint NOT NULL DEFAULT 0 CHECK (control_sequence >= 0),
  space_sequence bigint NOT NULL DEFAULT 0 CHECK (space_sequence >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO application_counters(singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS application_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  managed_host_mode boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS room_counters (
  room_id text PRIMARY KEY REFERENCES room_settings(room_id),
  joins bigint NOT NULL DEFAULT 0,
  leaves bigint NOT NULL DEFAULT 0,
  moves bigint NOT NULL DEFAULT 0,
  reactions bigint NOT NULL DEFAULT 0,
  interactions bigint NOT NULL DEFAULT 0,
  capability_reports bigint NOT NULL DEFAULT 0,
  host_actions bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
