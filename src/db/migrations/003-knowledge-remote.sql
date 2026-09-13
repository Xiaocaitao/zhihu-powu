ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS remote_knowledge_base_id TEXT;
ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS remote_recall_content_id TEXT;
ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('synced','failed'));
