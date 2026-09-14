import assert from "node:assert/strict";
import test from "node:test";
import { CareerService } from "../src/modules/career/service.ts";
import { MemoryCareerRepository } from "../src/modules/career/repository.ts";
import { LearningService } from "../src/modules/learning/service.ts";
import { MemoryLearningRepository } from "../src/modules/learning/repository.ts";
import { createCareerCapabilities } from "../src/modules/career/capabilities.ts";
import { createLearningCapabilities } from "../src/modules/learning/capabilities.ts";

const context = { ownerId: "owner-1", requestId: "req-1", operationKey: "op-1" };

test("Career 草稿确认遵守版本和状态", async () => {
  const service = new CareerService(new MemoryCareerRepository());
  const created = await service.createCareerPlanDraft({ context, payload: { directionCodes: ["backend"] }, idempotencyKey: "draft-1" });
  assert.equal(created.ok, true);
  const plan = (created.data as { plan: { id: string; version: number } }).plan;
  const confirmed = await service.confirmCareerPlan({ context, payload: { planId: plan.id, expectedVersion: plan.version }, idempotencyKey: "confirm-1" });
  assert.equal(confirmed.ok, true);
  const conflict = await service.confirmCareerPlan({ context, payload: { planId: plan.id, expectedVersion: plan.version }, idempotencyKey: "confirm-2" });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error?.code, "VERSION_CONFLICT");
});

test("Learning 只保存 Agent 提供的结构化计划，不生成默认任务", async () => {
  const service = new LearningService(new MemoryLearningRepository());
  const plan = await service.createLearningPlan({ context, payload: { mode: "trial", sourceProfileVersion: 1, startDate: "2026-09-14", endDate: "2026-09-20", weeklyMinutes: 120, learningGoals: ["API 基础"], stages: [{ title: "阶段一", objective: "完成基础练习", tasks: [{ title: "阅读资料", description: "阅读用户提供的资料", taskType: "reading", estimatedMinutes: 30 }] }] }, idempotencyKey: "plan-1" });
  assert.equal(plan.ok, true);
  const data = plan.data as { plan: { stages: Array<{ tasks: unknown[] }> } };
  assert.equal(data.plan.stages[0].tasks.length, 1);
});

test("Learning 草案列表保留真实 ID 并隔离 owner", async () => {
  const repository = new MemoryLearningRepository();
  const service = new LearningService(repository);
  const payload = { mode: "trial" as const, sourceProfileVersion: 1, startDate: "2026-09-14", endDate: "2026-09-20", weeklyMinutes: 120, learningGoals: ["API 基础"], stages: [{ title: "阶段一", objective: "完成基础练习", tasks: [{ title: "阅读资料", description: "阅读用户提供的资料", taskType: "reading" as const, estimatedMinutes: 30 }] }] };
  const created = await service.createLearningPlan({ context, payload, idempotencyKey: "draft-list-1" });
  assert.equal(created.ok, true);
  const plans = await service.listPlans(context);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].mode, "trial");
  assert.equal(plans[0].status, "draft");
  assert.notEqual(plans[0].id, "");
  assert.equal((await service.listPlans({ ...context, ownerId: "owner-2" })).length, 0);
  const draft = plans[0];
  draft.mode = "final"; draft.status = "active"; await repository.savePlan(draft);
  assert.equal((await service.listPlans(context)).length, 0);
});

test("Career/Learning 读取工具返回统一能力结果协议", async () => {
  const career = new CareerService(new MemoryCareerRepository());
  const careerRead = createCareerCapabilities(career).find(tool => tool.name === "get_career_plan")!;
  const careerResult = await careerRead.execute(context, {});
  assert.deepEqual({ ok: careerResult.ok, changed: careerResult.changed, domain: careerResult.domain, status: careerResult.status }, { ok: true, changed: false, domain: "career", status: "read" });

  const learning = new LearningService(new MemoryLearningRepository());
  const learningRead = createLearningCapabilities(learning).find(tool => tool.name === "get_active_learning_plan")!;
  const learningResult = await learningRead.execute(context, {});
  assert.deepEqual({ ok: learningResult.ok, changed: learningResult.changed, domain: learningResult.domain, status: learningResult.status }, { ok: true, changed: false, domain: "learning", status: "read" });
});
