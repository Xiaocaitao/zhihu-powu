import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const migrationPath = fileURLToPath(new URL("../../../db/migrations/006-learning-normalized.sql", import.meta.url));

test("normalized Learning migration defines the fixed seven-table storage contract", async () => {
  const sql = await readFile(migrationPath, "utf8");
  for (const table of [
    "learning_plans",
    "learning_stages",
    "learning_tasks",
    "learning_task_schedules",
    "learning_feedback",
    "learning_plan_adjustments",
    "learning_idempotency_records",
  ]) assert.match(sql, new RegExp(`(?:CREATE TABLE IF NOT EXISTS|ALTER TABLE) ${table}`));
  assert.match(sql, /learning_plans_one_active_final/);
  assert.match(sql, /PRIMARY KEY \(owner_id, idempotency_key\)/);
  assert.match(sql, /learning_adjustment_version_check/);
  assert.match(sql, /learning_task_migration_map/);
});

test("PostgreSQL Learning migration runs when TEST_DATABASE_URL is configured", { skip: process.env.TEST_DATABASE_URL ? false : "TEST_DATABASE_URL is not configured" }, async () => {
  const { createPool, migrate } = await import("../../../db/postgres.ts");
  const pool = createPool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    await migrate(pool);
    const result = await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM learning_tasks");
    assert.ok(Number(result.rows[0].count) >= 0);
  } finally {
    await pool.end();
  }
});
