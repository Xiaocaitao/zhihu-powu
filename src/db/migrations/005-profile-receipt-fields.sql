ALTER TABLE profile_command_receipts ADD COLUMN IF NOT EXISTS command_name TEXT;
ALTER TABLE profile_command_receipts ADD COLUMN IF NOT EXISTS request_id TEXT;
