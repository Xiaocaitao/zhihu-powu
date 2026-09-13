CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY,
  owner TEXT NOT NULL,
  history JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chat_runs (
  request_id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES chat_sessions(id),
  message TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed','cancelled','interrupted')),
  events JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_runs_session_created ON chat_runs(session_id, created_at);
