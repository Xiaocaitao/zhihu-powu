import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createEvidencePorts } from "../src/app/evidence-ports.ts";
import { MemoryLearningRepository } from "../src/modules/learning/repository.ts";
import { MemoryCareerRepository } from "../src/modules/career/repository.ts";
import { ProfileService } from "../src/modules/profile/service.ts";
import { MemoryProfileRepository } from "../src/modules/profile/repository.ts";
import { MemorySkillRepository } from "../src/modules/skills/repository.ts";
import { initialSkillDefinitions } from "../src/modules/skills/definitions.ts";
import { SharedSkills } from "../src/modules/skills/service.ts";
import type { KnowledgeStore } from "../src/modules/knowledge/contracts.ts";

function fixture(knowledge?: KnowledgeStore) {
  const learning = new MemoryLearningRepository();
  const career = new MemoryCareerRepository();
  return { learning, career, ports: createEvidencePorts({
    learning, career, profile: new ProfileService(new MemoryProfileRepository()),
    skills: new SharedSkills(new MemorySkillRepository(initialSkillDefinitions)), knowledge,
  }) };
}

test("AI 产品岗位能力精确映射到共享目录，未知要求仍说明限制", async () => {
  const { career, ports } = fixture();
  const codes = ["user_research", "ai_product_design", "product_iteration", "communication", "llm", "ai_product_experience"];
  const job = { id: "ai-job", ownerId: "owner", title: "AI 产品经理", description: "基于用户行为改进大模型产品",
    employmentType: "internship" as const, requirements: codes.map(skillCode => ({ skillCode, skillName: skillCode, importance: "required" as const })),
    source: "manual" as const, createdAt: new Date().toISOString() };
  await career.saveJob(job);
  const result = await ports.career!.getJobRequirements({ ownerId: "owner" }, job.id);
  assert.equal(result.coverage.complete, true);
  assert.equal(result.value?.skillRefs.length, codes.length);
  assert.equal(result.value?.skillRefs.find(skill => skill.skillId === "skill-llm")?.name, "大语言模型");
  await career.saveJob({ ...job, requirements: [...job.requirements, { skillCode: "unregistered", skillName: "尚未收录的专业能力", importance: "required" }] });
  const incomplete = await ports.career!.getJobRequirements({ ownerId: "owner" }, job.id);
  assert.equal(incomplete.coverage.complete, false);
  assert.equal(incomplete.value?.skillRefs.length, codes.length);
  assert.match(incomplete.coverage.missing[0].reason, /尚未收录的专业能力/);
  assert.doesNotMatch(incomplete.coverage.missing[0].reason, /unregistered/);
});

test("跨模块查询保持真实任务与岗位归属；缺失阶段范围和历史不伪造", async () => {
  const { learning, career, ports } = fixture();
  const now = new Date().toISOString();
  await learning.savePlan({
    id: "plan", ownerId: "owner", mode: "trial", status: "active", sourceProfileVersion: 1,
    startDate: "2026-09-14", endDate: "2026-09-21", weeklyMinutes: 120, version: 3,
    learningGoals: ["练习 SQL"], updatedAt: now,
    stages: [{ id: "stage", planId: "plan", order: 1, title: "查询练习", objective: "理解查询", status: "in_progress",
      startDate: "2026-09-14T00:00:00+08:00", endDate: "2026-09-21T00:00:00+08:00",
      tasks: [{ id: "task", planId: "plan", stageId: "stage", title: "完成查询", description: "说明一条查询",
        taskType: "practice", status: "in_progress", priority: 1, estimatedMinutes: 60, actualMinutes: null, evidenceRequired: true }] }],
  });
  const task = await ports.learning!.getTask({ ownerId: "owner" }, "task");
  assert.equal(task.value?.revision, "3");
  assert.equal(task.value?.criteria, null);
  assert.equal(task.coverage.complete, false);
  assert.equal((await ports.learning!.getTask({ ownerId: "other" }, "task")).value, null);
  const stage = await ports.learning!.getStage({ ownerId: "owner" }, "stage");
  assert.equal(stage.value?.from, "2026-09-14T00:00:00+08:00");
  assert.equal(stage.value?.to, "2026-09-21T00:00:00+08:00");
  assert.equal(stage.coverage.complete, true);

  // 只有 Learning 已确认的计划调整会进入时间线；任务状态变化不伪造成历史事件。
  await learning.saveAdjustment({
    id: "adjustment-1", ownerId: "owner", planId: "plan", fromVersion: 3, toVersion: 4,
    trigger: "time_change", reason: "用户本周可用时间减少，改为先完成查询练习",
    changeSummary: { type: "reschedule", taskId: "task" }, createdAt: now,
  });
  const history = await ports.learning!.listHistory({ ownerId: "owner" },
    { from: new Date(Date.parse(now) - 1000).toISOString(), to: new Date(Date.parse(now) + 1000).toISOString() });
  assert.equal(history.value?.items.length, 1);
  assert.equal(history.value?.items[0].kind, "plan_adjustment");
  assert.equal(history.value?.items[0].sourceEntityId, "adjustment-1");
  assert.equal(history.value?.items[0].sourceRevision, 4);
  assert.equal(history.value?.items[0].snapshot.taskId, "task");
  assert.equal(history.coverage.complete, false);
  assert.match(history.coverage.missing[0].reason, /任务状态变化/);
  await career.saveJob({ id: "job", ownerId: "owner", title: "数据库岗位", description: "岗位要求说明",
    employmentType: "internship", requirements: [{ skillCode: "sql", skillName: "SQL", importance: "required" }],
    source: "manual", createdAt: now });
  const job = await ports.career!.getJobRequirements({ ownerId: "owner" }, "job");
  assert.equal(job.value?.skillRefs[0].skillId, "skill-sql");
  assert.equal(job.coverage.complete, true);
  assert.equal((await ports.career!.getJobRequirements({ ownerId: "other" }, "job")).value, null);
});

test("Knowledge 材料适配只引用可访问的真实文本，缺解析、超预算和权限缺失均说明限制", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidence-material-test-"));
  const path = join(directory, "notes.txt");
  await writeFile(path, "本人已实现 HTTP 请求解析，尚未验证缓存行为。", "utf8");
  const store: KnowledgeStore = {
    save: async () => { throw new Error("No write expected"); },
    list: async () => [],
    get: async (ownerId, id) => ownerId === "owner" ? {
      id, original_name: "notes.txt", mime_type: id === "image" ? "image/png" : "text/plain",
      size_bytes: 100, url: "/api/knowledge/files/" + id, created_at: new Date().toISOString(), path,
    } : null,
  };
  try {
    const { ports } = fixture(store);
    const result = await ports.knowledge!.resolveMaterials({ ownerId: "owner" }, [{ documentId: "text" }, { documentId: "image" }]);
    assert.match(result.value![0].excerpts[0].text, /尚未验证缓存/);
    assert.ok(result.value![0].revision);
    assert.equal(result.value![1].state, "unavailable");
    assert.deepEqual(result.value![1].excerpts, []);
    assert.equal(result.coverage.complete, false);
    const denied = await ports.knowledge!.resolveMaterials({ ownerId: "other" }, [{ documentId: "text" }]);
    assert.equal(denied.value![0].state, "unavailable");
    assert.deepEqual(denied.value![0].excerpts, []);
    await writeFile(path, "a".repeat(20001), "utf8");
    const oversized = await ports.knowledge!.resolveMaterials({ ownerId: "owner" }, [{ documentId: "text" }]);
    assert.equal(oversized.value![0].state, "unavailable");
    assert.deepEqual(oversized.value![0].excerpts, []);
  } finally {
    const root = resolve(tmpdir()) + sep;
    assert.ok(resolve(directory).startsWith(root) && directory.includes("evidence-material-test-"));
    await rm(directory, { recursive: true, force: true });
  }
});
