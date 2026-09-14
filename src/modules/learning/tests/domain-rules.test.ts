import assert from "node:assert/strict";
import test from "node:test";
import { adjustPlanSchema, createPlanSchema, type CreatePlanInput } from "../contracts.ts";
import { MemoryLearningRepository } from "../repository.ts";
import { LearningService } from "../service.ts";

const owner = "learning-owner";
const otherOwner = "other-owner";
const context = { ownerId: owner, requestId: "request-1", operationKey: "operation-1" };
const baseInput: CreatePlanInput = {
  mode: "trial",
  sourceProfileVersion: 2,
  startDate: "2026-09-14",
  endDate: "2026-09-20",
  weeklyMinutes: 240,
  availableSlots: [{ weekday: 1, startTime: "19:00", endTime: "20:00" }],
  learningGoals: ["掌握基础实践"],
  stages: [{ title: "基础阶段", objective: "完成第一轮练习", tasks: [
    { title: "阅读资料", description: "整理关键概念和疑问", taskType: "reading", estimatedMinutes: 30, capabilityKey: "skill.read" },
    { title: "完成练习", description: "独立完成一组基础练习", taskType: "practice", estimatedMinutes: 45 },
  ] }],
};

function command<T>(payload: T, key: string, expectedVersion?: number) { return { context, payload, idempotencyKey: key, expectedVersion }; }

async function create(service: LearningService, input = baseInput, key = "create-1") {
  return service.createLearningPlan(command(input, key));
}

test("Learning schemas enforce date range, slots and fixed adjustment operations", () => {
  assert.throws(() => createPlanSchema.parse({ ...baseInput, endDate: "2026-09-01" }));
  assert.throws(() => createPlanSchema.parse({ ...baseInput, availableSlots: [{ weekday: 8, startTime: "19:00", endTime: "20:00" }] }));
  assert.throws(() => createPlanSchema.parse({ ...baseInput, availableSlots: [{ weekday: 1, startTime: "20:00", endTime: "19:00" }] }));
  const parsed = adjustPlanSchema.parse({ planId: "plan-1", trigger: "user_feedback", reason: "任务需要拆小", adjustmentMode: "split_task", operations: [{ type: "split_task", taskId: "task-1", newTasks: [{ title: "子任务", estimatedMinutes: 15 }] }] });
  assert.equal(parsed.operations[0].type, "split_task");
});

test("Learning service isolates owners, computes scheduled tasks and supports progress", async () => {
  const repository = new MemoryLearningRepository();
  const service = new LearningService(repository);
  const created = await create(service);
  assert.equal(created.ok, true);
  const plan = created.data!.plan;
  const full = await service.getActivePlan(context, { includeTasks: true });
  assert.equal(full?.id, plan.id);
  const task = full!.stages[0].tasks[0];
  task.scheduleDate = "2026-09-15";
  task.schedules![0].scheduleDate = "2026-09-15";
  await repository.savePlan(full!);
  assert.equal((await service.getTodayTasks(context, { date: "2026-09-14" })).length, 1);
  assert.equal((await service.getTodayTasks(context, { date: "2026-09-15" })).length, 1);
  assert.equal(await service.getActivePlan({ ownerId: otherOwner }, { includeTasks: true }), null);
  const updated = await service.updateTaskStatus(command({ taskId: task.id, status: "completed", actualMinutes: 35 }, "task-1", full!.version));
  assert.equal(updated.ok, true);
  const progress = await service.getLearningProgress(context, { planId: plan.id });
  assert.equal(progress?.completedTasks, 1);
  assert.equal(progress?.progressPercent, 50);
});

test("Learning feedback is readable by the owning user and isolated from other users", async () => {
  const repository = new MemoryLearningRepository();
  const service = new LearningService(repository);
  const created = await create(service, baseInput, "feedback-plan");
  const plan = created.data!.plan;
  const task = plan.stages[0].tasks[0];
  const recorded = await service.recordLearningFeedback(command({ planId: plan.id, taskId: task.id, difficulty: "too_hard", note: "需要拆分第一步" }, "feedback-record", plan.version));
  assert.equal(recorded.ok, true);
  assert.equal((await service.getLearningFeedback(context, { planId: plan.id })).length, 1);
  assert.equal((await service.getLearningFeedback({ ownerId: otherOwner }, { planId: plan.id })).length, 0);
});

test("Learning service enforces transitions, optimistic versions and idempotent replay", async () => {
  const repository = new MemoryLearningRepository();
  const service = new LearningService(repository);
  const created = await create(service, baseInput, "create-transition");
  const plan = created.data!.plan;
  const task = plan.stages[0].tasks[0];
  const conflict = await service.updateTaskStatus(command({ taskId: task.id, status: "in_progress" }, "bad-version", 99));
  assert.equal(conflict.error?.code, "VERSION_CONFLICT");
  const first = await service.updateTaskStatus(command({ taskId: task.id, status: "in_progress" }, "same-task", plan.version));
  assert.equal(first.ok, true);
  const replay = await service.updateTaskStatus(command({ taskId: task.id, status: "in_progress" }, "same-task", plan.version));
  assert.deepEqual(replay, first);
  const duplicate = await service.updateTaskStatus(command({ taskId: task.id, status: "completed" }, "same-task", plan.version));
  assert.equal(duplicate.error?.code, "DUPLICATE_REQUEST");
  const completed = await service.updateTaskStatus(command({ taskId: task.id, status: "completed" }, "complete-task", plan.version + 1));
  assert.equal(completed.ok, true);
  const invalid = await service.updateTaskStatus(command({ taskId: task.id, status: "todo" }, "rollback-task", plan.version + 2));
  assert.equal(invalid.error?.code, "INVALID_STATE");
});

test("Learning adjustments update tasks, preserve history and confirm trial plans", async () => {
  const repository = new MemoryLearningRepository();
  const service = new LearningService(repository);
  const created = await create(service, baseInput, "create-adjust");
  const plan = created.data!.plan;
  const [first, second] = plan.stages[0].tasks;
  const adjusted = await service.adjustLearningPlan(command({ planId: plan.id, trigger: "user_feedback", reason: "调整任务安排", adjustmentMode: "split_task", operations: [
    { type: "split_task", taskId: first.id, newTasks: [{ title: "拆分练习", description: "完成拆分后的练习", estimatedMinutes: 15 }] },
    { type: "reschedule", taskId: second.id, scheduleDate: "2026-09-18" },
    { type: "change_order", taskIds: [second.id, first.id] },
    { type: "replace_resource", taskId: second.id, resource: "替换后的资料" },
  ] }, "adjust-1", plan.version));
  assert.equal(adjusted.ok, true);
  assert.equal(adjusted.data!.plan.version, plan.version + 1);
  assert.equal(adjusted.data!.plan.stages[0].tasks.find(item => item.id === second.id)?.scheduleDate, "2026-09-18");
  assert.match(adjusted.data!.plan.stages[0].tasks.find(item => item.id === second.id)!.description, /替换后的资料/);
  assert.equal(adjusted.data!.plan.stages[0].tasks.find(item => item.id === second.id)?.priority, 1);
  assert.equal((await repository.listAdjustments!(owner, plan.id)).length, 1);
  const confirmed = await service.confirmLearningPlan(command({ planId: plan.id, expectedPlanVersion: adjusted.data!.plan.version, keepUnfinishedTasks: false }, "confirm-1"));
  assert.equal(confirmed.data!.plan.mode, "final");
  assert.equal(confirmed.data!.plan.status, "active");
  assert.equal(confirmed.data!.plan.stages[0].tasks.some(item => item.status === "paused"), true);
});

test("a confirmed trial archives an existing active final plan", async () => {
  const repository = new MemoryLearningRepository();
  const service = new LearningService(repository);
  const final = await create(service, { ...baseInput, mode: "final" }, "final-1");
  const trial = await create(service, baseInput, "trial-1");
  const finalPlan = final.data!.plan;
  finalPlan.status = "active";
  await repository.savePlan(finalPlan);
  const confirmed = await service.confirmLearningPlan(command({ planId: trial.data!.plan.id, expectedPlanVersion: trial.data!.plan.version }, "confirm-2"));
  assert.equal(confirmed.ok, true);
  assert.equal((await repository.getPlan(owner, finalPlan.id))?.status, "archived");
});

test("Learning exposes facts for Career and Evidence without crossing owner boundaries", async () => {
  const repository = new MemoryLearningRepository();
  const service = new LearningService(repository);
  const created = await create(service, baseInput, "context-1");
  const plan = created.data!.plan;
  const task = plan.stages[0].tasks[0];
  await service.updateTaskStatus(command({ taskId: task.id, status: "completed" }, "context-task", plan.version));
  assert.deepEqual(await service.getCompletedCapabilityKeys(context, { planId: plan.id }), ["skill.read"]);
  assert.equal((await service.getTaskContext(context, { taskId: task.id }))?.planId, plan.id);
  assert.equal((await service.getStageContext(context, { stageId: plan.stages[0].id }))?.stageOrder, 1);
  assert.equal((await service.getTaskContext({ ownerId: otherOwner }, { taskId: task.id })), null);
});
