ALTER TABLE room_settings
  ADD COLUMN lock_kind text,
  ADD COLUMN manager_participant_id text;

UPDATE room_settings
SET lock_kind = CASE WHEN is_locked THEN 'legacy' ELSE 'none' END
WHERE lock_kind IS NULL;

ALTER TABLE room_settings
  ALTER COLUMN lock_kind SET DEFAULT 'none',
  ALTER COLUMN lock_kind SET NOT NULL,
  ADD CONSTRAINT room_settings_lock_kind_check
    CHECK ((is_locked AND lock_kind IN ('legacy', 'anonymous')) OR (NOT is_locked AND lock_kind = 'none')),
  ADD CONSTRAINT room_settings_manager_check
    CHECK ((lock_kind = 'anonymous' AND manager_participant_id IS NOT NULL)
        OR (lock_kind <> 'anonymous' AND manager_participant_id IS NULL));
