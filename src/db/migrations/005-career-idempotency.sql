ALTER TABLE career_gap_analyses
ADD COLUMN IF NOT EXISTS recommended_actions JSONB NOT NULL DEFAULT '[]';

ALTER TABLE career_target_jobs
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS career_idempotency_records (
  owner_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, idempotency_key)
);
