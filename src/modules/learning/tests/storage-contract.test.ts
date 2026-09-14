import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const migrationPath = fileURLToPath(new URL("../../../db/migrations/006-learning-normalized.sql", import.meta.url));
const hardeningPath = fileURLToPath(new URL("../../../db/migrations/007-learning-normalized-hardening.sql", import.meta.url));
const repositoryPath = fileURLToPath(new URL("../postgres-repository.ts", import.meta.url));

test("normalized Learning migration defines the fixed seven-table storage contract", async () => {
  const sql = await readFile(migrationPath, "utf8");
  const hardening = await readFile(hardeningPath, "utf8");
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
  assert.match(hardening, /learning_adjustment_version_check/);
  assert.match(hardening, /DROP COLUMN IF EXISTS tasks/);
  assert.match(sql, /learning_task_migration_map/);
});

test("PostgreSQL Learning repository writes stages without the removed legacy task snapshot", async () => {
  const repository = await readFile(repositoryPath, "utf8");
  assert.doesNotMatch(repository, /progress_percent, tasks\)/);
  assert.doesNotMatch(repository, /'\[\]'::jsonb/);
  assert.match(repository, /INSERT INTO learning_tasks/);
  assert.match(repository, /INSERT INTO learning_task_schedules/);
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
