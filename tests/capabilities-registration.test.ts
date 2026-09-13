import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultCapabilityRegistry } from "../src/app/composition-root.ts";

test("四个成长空间业务块注册到统一 Agent Registry", () => {
  const names = createDefaultCapabilityRegistry().list().map(capability => capability.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of ["get_user_profile", "get_career_plan", "get_active_learning_plan", "get_learning_records", "start_interview"]) assert.ok(names.includes(name), name);
  assert.equal(names.filter(name => name.startsWith("get_")).length > 0, true);
});
