ALTER TABLE application_settings
  ADD COLUMN member_soft_limit integer NOT NULL DEFAULT 10,
  ADD CONSTRAINT application_settings_member_soft_limit_check
    CHECK (member_soft_limit BETWEEN 1 AND 1000);
