CREATE TABLE IF NOT EXISTS knowledge_files (
  id UUID PRIMARY KEY,
  owner TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS knowledge_files_owner_created ON knowledge_files(owner, created_at DESC);
