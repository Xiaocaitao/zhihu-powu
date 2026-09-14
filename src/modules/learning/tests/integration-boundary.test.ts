import assert from "node:assert/strict";
import test from "node:test";
import { planConfirmedEvent, planCreatedEvent, taskUpdatedEvent } from "../events.ts";
import { MemoryLearningRepository } from "../repository.ts";
import { LearningService } from "../service.ts";

const ctx = { ownerId: "boundary-owner", requestId: "boundary-request", operationKey: "boundary-operation" };

test("Career and Evidence receive owner-scoped Learning facts through the application boundary", async () => {
  const service = new LearningService(new MemoryLearningRepository());
  const created = await service.createLearningPlan({ context: ctx, idempotencyKey: "create-boundary", payload: {
    mode: "trial", sourceProfileVersion: 1, startDate: "2026-09-14", endDate: "2026-09-20", weeklyMinutes: 60,
    learningGoals: ["边界测试"], stages: [{ title: "阶段", objective: "验证边界", tasks: [{ title: "任务", description: "完成任务", taskType: "practice", estimatedMinutes: 20, capabilityKey: "skill.boundary", evidenceRequired: true }] }],
  }});
  const plan = created.data!.plan;
  const task = plan.stages[0].tasks[0];
  const progress = await service.getPlanProgress(ctx, { planId: plan.id });
  assert.equal(progress?.totalTasks, 1);
  assert.deepEqual(await service.getCompletedCapabilityKeys(ctx, { planId: plan.id }), []);
  assert.equal((await service.getTaskContext(ctx, { taskId: task.id }))?.evidenceRequired, true);
  assert.equal((await service.getTaskContext({ ownerId: "other" }, { taskId: task.id })), null);
});

test("Learning events are stable, owner-scoped publish data", async () => {
  const service = new LearningService(new MemoryLearningRepository());
  const result = await service.createLearningPlan({ context: ctx, idempotencyKey: "create-events", payload: {
    mode: "trial", sourceProfileVersion: 1, startDate: "2026-09-14", endDate: "2026-09-20", weeklyMinutes: 60,
    learningGoals: ["事件"], stages: [{ title: "阶段", objective: "验证事件", tasks: [{ title: "任务", description: "完成任务", taskType: "practice", estimatedMinutes: 20 }] }],
  }});
  const plan = result.data!.plan;
  const createdEvent = planCreatedEvent(plan);
  assert.deepEqual({ type: createdEvent.type, domain: createdEvent.domain, entityId: createdEvent.entityId, ownerId: createdEvent.ownerId }, { type: "learning.plan.created", domain: "learning", entityId: plan.id, ownerId: ctx.ownerId });
  const task = plan.stages[0].tasks[0];
  const updated = await service.updateTaskStatus({ context: ctx, idempotencyKey: "update-events", expectedVersion: plan.version, payload: { taskId: task.id, status: "in_progress" } });
  const updatedTask = updated.data!.task;
  assert.equal(taskUpdatedEvent(updatedTask, ctx.ownerId, updated.version!).type, "learning.task.updated");
  const confirmed = await service.confirmLearningPlan({ context: ctx, idempotencyKey: "confirm-events", payload: { planId: plan.id, expectedPlanVersion: updated.version! } });
  assert.equal(planConfirmedEvent(confirmed.data!.plan).type, "learning.plan.confirmed");
});
