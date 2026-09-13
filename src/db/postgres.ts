import { Pool, type PoolConfig } from "pg";

export const schemaSql = `
CREATE TABLE IF NOT EXISTS route_requests (
  id UUID PRIMARY KEY,
  goal TEXT NOT NULL,
  request JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS routes (
  id UUID PRIMARY KEY REFERENCES route_requests(id) ON DELETE CASCADE,
  plan JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export function createPool(options: PoolConfig = {}): Pool {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  const hasEnvironmentConfig = Boolean(options.host ?? process.env.PGHOST);
  if (!connectionString && !hasEnvironmentConfig) {
    throw new Error("DATABASE_URL or PGHOST is required");
  }
  return new Pool({
    max: 5,
    ...options,
    ...(connectionString ? { connectionString } : {}),
  });
}

export async function ensureSchema(pool: Pick<Pool, "query">): Promise<void> {
  await pool.query(schemaSql);
  await pool.query(`CREATE TABLE IF NOT EXISTS chat_sessions (id UUID PRIMARY KEY, owner TEXT NOT NULL, history JSONB NOT NULL DEFAULT '[]', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS chat_runs (request_id UUID PRIMARY KEY, session_id UUID NOT NULL REFERENCES chat_sessions(id), message TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('running','completed','failed','cancelled','interrupted')), events JSONB NOT NULL DEFAULT '[]', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS chat_runs_session_created ON chat_runs(session_id, created_at);`);
}
