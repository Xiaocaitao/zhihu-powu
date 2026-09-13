import { Pool, type PoolConfig } from "pg";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrations/runner.ts";

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

export async function migrate(pool: Pool): Promise<string[]> {
  return runMigrations(pool, fileURLToPath(new URL("./migrations/", import.meta.url)));
}

export async function ensureSchema(pool: Pool): Promise<void> {
  await migrate(pool);
}
