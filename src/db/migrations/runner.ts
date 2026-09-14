import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import type { Pool } from "pg";

export async function runMigrations(pool: Pick<Pool, "connect">, directory: string): Promise<string[]> {
  const files = (await readdir(directory)).filter(file => /^\d+[-_].+\.sql$/i.test(file)).sort();
  const db = await pool.connect();
  try {
    await db.query("SELECT pg_advisory_lock(hashtextextended('powu:migrations', 0))");
    await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const applied: string[] = [];
    for (const file of files) {
      const sql = await readFile(join(directory, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await db.query<{ checksum: string }>("SELECT checksum FROM schema_migrations WHERE filename=$1", [file]);
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`migration checksum changed: ${file}`);
        continue;
      }
      await db.query("BEGIN");
      try {
        await db.query(sql);
        await db.query("INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)", [file, checksum]);
        await db.query("COMMIT");
        applied.push(basename(file));
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      }
    }
    return applied;
  } finally {
    await db.query("SELECT pg_advisory_unlock(hashtextextended('powu:migrations', 0))").catch(() => undefined);
    db.release();
  }
}
