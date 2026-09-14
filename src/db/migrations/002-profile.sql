-- Profile-owned tables. Applied by the shared migration runner.
CREATE TABLE IF NOT EXISTS profile_facts (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, fact_type TEXT NOT NULL, section TEXT NOT NULL,
  value JSONB NOT NULL, source TEXT NOT NULL, is_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  evidence_ref JSONB, version INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_id, fact_type)
);
CREATE TABLE IF NOT EXISTS profile_goals (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, goal_type TEXT NOT NULL DEFAULT 'target_direction',
  value JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_id, goal_type)
);
CREATE TABLE IF NOT EXISTS profile_change_log (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  entity_version INTEGER NOT NULL, request_id TEXT, idempotency_key TEXT, before_summary JSONB,
  after_summary JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS profile_command_receipts (
  owner_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL,
  result JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(owner_id, idempotency_key)
);
