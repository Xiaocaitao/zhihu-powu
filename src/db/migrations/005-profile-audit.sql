ALTER TABLE profile_change_log ADD COLUMN IF NOT EXISTS change_type TEXT;
ALTER TABLE profile_change_log ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE profile_change_log ADD COLUMN IF NOT EXISTS before_json JSONB;
ALTER TABLE profile_change_log ADD COLUMN IF NOT EXISTS after_json JSONB;
ALTER TABLE profile_command_receipts ADD COLUMN IF NOT EXISTS command_name TEXT;
ALTER TABLE profile_command_receipts ADD COLUMN IF NOT EXISTS request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS profile_change_log_entity_version_uq ON profile_change_log (owner_id, entity_type, entity_id, entity_version);
