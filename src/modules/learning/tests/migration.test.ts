import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("learning migration keeps the seven fixed C tables and key constraints", async () => {
  const sql = await readFile(new URL("../../../db/migrations/004-learning.sql", import.meta.url), "utf8");
  const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+(learning_[a-z_]+)/g)].map(match => match[1]);
  assert.deepEqual(tables, ["learning_plans", "learning_stages", "learning_tasks", "learning_task_schedules", "learning_feedback", "learning_plan_adjustments", "learning_idempotency_records"]);
  assert.match(sql, /mode IN \('trial','final'\)/);
  assert.match(sql, /status IN \('draft','active','paused','completed','archived'\)/);
  assert.match(sql, /task_type IN \('reading','practice','project','review'\)/);
  assert.match(sql, /status IN \('todo','in_progress','completed','paused'\)/);
  assert.match(sql, /PRIMARY KEY\(owner_id,idempotency_key\)/);
  assert.match(sql, /WHERE mode='final' AND status='active'/);
});
