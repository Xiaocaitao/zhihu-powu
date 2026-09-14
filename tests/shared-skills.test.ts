import assert from "node:assert/strict";
import test from "node:test";
import { initialSkillDefinitions } from "../src/modules/skills/definitions.ts";
import { MemorySkillRepository, PostgresSkillRepository } from "../src/modules/skills/repository.ts";
import { SharedSkills } from "../src/modules/skills/service.ts";
import { createSkillCapabilities } from "../src/modules/skills/capabilities.ts";
import { Pool } from "pg";
import { ensureSchema } from "../src/db/postgres.ts";

test("共享能力解析只做精确别名匹配，不将岗位或相关能力猜为同一个 ID", async () => {
  const skills = new SharedSkills(new MemorySkillRepository(initialSkillDefinitions));
  const [http, js, unknown] = await skills.resolve(["ＨＴＴＰ", " JS ", "后端工程师"]);
  assert.equal(http.status, "resolved");
  assert.equal(http.candidates[0].skillId, "skill-http");
  assert.equal(js.candidates[0].skillId, "skill-javascript");
  assert.equal(unknown.status, "unresolved");
  assert.deepEqual(unknown.candidates, []);
  const ids = await skills.get(["skill-http", "skill-made-up"]);
  assert.deepEqual(ids.missingIds, ["skill-made-up"]);
  assert.equal(ids.items.length, 1);
});

test("能力别名歧义返回全部候选，不自动选择；查询不写入", async () => {
  const sharedAlias = [
    { skillId: "a", name: "A", description: "A", aliases: ["共同名称"], revision: 1 },
    { skillId: "b", name: "B", description: "B", aliases: ["共同名称"], revision: 1 },
  ];
  const skills = new SharedSkills(new MemorySkillRepository(sharedAlias));
  const [resolution] = await skills.resolve(["共同名称"]);
  assert.equal(resolution.status, "ambiguous");
  assert.equal(resolution.candidates.length, 2);
  const tool = createSkillCapabilities(skills)[0];
  const result = await tool.execute({ ownerId: "owner", requestId: "read", operationKey: "read" }, { terms: ["共同名称"] });
  assert.equal(result.changed, false);
  assert.equal(result.domain, "skills");
  await assert.rejects(tool.execute({ ownerId: "owner", requestId: "read", operationKey: "read" }, { terms: ["A"], ownerId: "other" }));
});

test("PostgreSQL 共享目录重复安装不降级、并与内存解析保持一致", {
  skip: process.env.TEST_DATABASE_URL ? false : "TEST_DATABASE_URL is not configured",
}, async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    await ensureSchema(pool);
    const repository = new PostgresSkillRepository(pool);
    await repository.install(initialSkillDefinitions);
    await repository.install(initialSkillDefinitions);
    const skills = new SharedSkills(repository);
    const resolved = await skills.resolve(["ＨＴＴＰ", "JS"]);
    assert.equal(resolved[0].candidates[0].skillId, "skill-http");
    assert.equal(resolved[1].candidates[0].skillId, "skill-javascript");
    const product = await skills.resolve(["user_research", "ai_product_design", "product_iteration", "communication", "llm", "ai_product_experience"]);
    assert.ok(product.every(item => item.status === "resolved"));
    assert.equal((await repository.list("postgres")).length, 1);
    assert.equal((await repository.list()).length, initialSkillDefinitions.length);
  } finally { await pool.end(); }
});
