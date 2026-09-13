import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createLearningCapabilities } from "../capabilities.ts";
import { createLearningPlanSchema, type CreateLearningPlanInput, type LearningPlanDTO } from "../contracts.ts";
import { InMemoryLearningRepository } from "../mock-repository.ts";
import { LearningService } from "../service.ts";

const owner = "owner-a";
const otherOwner = "owner-b";
const context = { ownerId: owner, requestId: "request-1", operationKey: "operation-1" };
const baseInput: CreateLearningPlanInput = {
  mode: "trial", sourceProfileVersion: 3, startDate: "2026-09-14", endDate: "2026-09-20", weeklyMinutes: 240,
  learningGoals: ["建立基础练习节奏"],
  stages: [{ title: "基础阶段", objective: "完成第一轮基础训练", tasks: [
    { title: "阅读模块资料", description: "整理关键概念和疑问", taskType: "reading", estimatedMinutes: 40, capabilityKey: "capability.read", evidenceRequired: false },
    { title: "完成小练习", description: "独立完成一组基础练习", taskType: "practice", estimatedMinutes: 50, capabilityKey: "capability.practice", evidenceRequired: false },
  ] }],
};

function command<T>(payload: T, key: string = randomUUID()) { return { context, payload, idempotencyKey: key }; }
async function create(service: LearningService, input = baseInput, key = crypto.randomUUID()) { return service.createLearningPlan(command(input, key)); }
function planId(result: { data?: LearningPlanDTO }) { assert.ok(result.data); return result.data.planId; }

test("learning contracts reject invalid date range and unsupported task fields", () => {
  assert.throws(() => createLearningPlanSchema.parse({ ...baseInput, endDate: "2026-09-01" }));
  assert.throws(() => createLearningPlanSchema.parse({ ...baseInput, stages: [{ ...baseInput.stages[0], tasks: [{ ...baseInput.stages[0].tasks[0], taskType: "video" }] }] }));
});

test("learning mock service creates plans, isolates owners and computes progress", async () => {
  const repository = new InMemoryLearningRepository(() => new Date("2026-09-14T08:00:00Z"));
  const service = new LearningService(repository, () => new Date("2026-09-14T08:00:00Z"));
  const created = await create(service, baseInput, "00000000-0000-4000-8000-000000000001");
  const id = planId(created);
  const full = await service.getActivePlan(context, { includeTasks: true });
  assert.equal(full?.planId, id);
  const tasks = full?.stages.flatMap(stage => stage.tasks ?? []) ?? [];
  assert.equal(tasks.length, 2);
  const first = await service.updateTaskStatus({ context, payload: { taskId: tasks[0].taskId, status: "completed", actualMinutes: 45 }, expectedVersion: full!.version, idempotencyKey: "update-a" });
  assert.equal(first.data?.status, "completed");
  const progress = await service.getLearningProgress(context, { planId: id });
  assert.equal(progress.completedTasks, 1);
  assert.equal(progress.progressPercent, 50);
  assert.equal(await service.getActivePlan({ ...context, ownerId: otherOwner }, { includeTasks: true }), null);
});

test("learning service enforces task transitions, optimistic versions and idempotent replay", async () => {
  const repository = new InMemoryLearningRepository();
  const service = new LearningService(repository);
  const id = planId(await create(service));
  const plan = await service.getActivePlan(context, { includeTasks: true });
  const task = plan!.stages[0].tasks![0];
  await assert.rejects(() => service.updateTaskStatus({ context, payload: { taskId: task.taskId, status: "paused" }, expectedVersion: 99, idempotencyKey: "bad-version" }), { code: "VERSION_CONFLICT" });
  await service.updateTaskStatus({ context, payload: { taskId: task.taskId, status: "in_progress" }, expectedVersion: plan!.version, idempotencyKey: "same-update" });
  const replay = await service.updateTaskStatus({ context, payload: { taskId: task.taskId, status: "in_progress" }, expectedVersion: plan!.version, idempotencyKey: "same-update" });
  assert.equal(replay.data?.taskId, task.taskId);
  await assert.rejects(() => service.updateTaskStatus({ context, payload: { taskId: task.taskId, status: "completed" }, expectedVersion: plan!.version, idempotencyKey: "same-update" }), { code: "DUPLICATE_REQUEST" });
  await assert.rejects(() => service.updateTaskStatus({ context, payload: { taskId: task.taskId, status: "todo" }, expectedVersion: 1, idempotencyKey: "new-update" }), { code: "VERSION_CONFLICT" });
  assert.equal(id.length, 36);
});

test("feedback, structured adjustment history and trial confirmation follow the C flow", async () => {
  const repository = new InMemoryLearningRepository();
  const service = new LearningService(repository);
  const created = await create(service);
  const id = planId(created);
  const plan = await service.getActivePlan(context, { includeTasks: true });
  const task = plan!.stages[0].tasks![0];
  const feedback = await service.recordLearningFeedback({ context, payload: { planId: id, taskId: task.taskId, difficulty: "too_hard", reason: "unclear_first_step", availableMinutes: 30 }, expectedVersion: plan!.version, idempotencyKey: "feedback-1" });
  assert.equal(feedback.data?.difficulty, "too_hard");
  const adjusted = await service.adjustLearningPlan({ context, payload: { planId: id, trigger: "user_feedback", reason: "需要拆成更小的练习", adjustmentMode: "split_task", operations: [{ type: "split_task", taskId: task.taskId, newTasks: [{ title: "拆分练习一", estimatedMinutes: 20 }, { title: "拆分练习二", estimatedMinutes: 20 }] }] }, expectedVersion: plan!.version, idempotencyKey: "adjust-1" });
  assert.equal(adjusted.data?.version, plan!.version + 1);
  const history = await repository.listAdjustments!(owner, id);
  assert.equal(history.length, 1);
  assert.equal(history[0].trigger, "user_feedback");
  const confirmed = await service.confirmLearningPlan({ context, payload: { planId: id, expectedPlanVersion: adjusted.data!.version, keepUnfinishedTasks: true }, idempotencyKey: "confirm-1" });
  assert.equal(confirmed.data?.mode, "final");
  assert.equal(confirmed.data?.status, "active");
});

test("learning capabilities validate inputs, inject owner context and expose all required tools", async () => {
  const service = new LearningService(new InMemoryLearningRepository());
  const capabilities = createLearningCapabilities(service);
  assert.deepEqual(capabilities.map(capability => capability.name), ["get_active_learning_plan", "get_today_learning_tasks", "get_learning_progress", "create_learning_plan", "update_learning_task", "record_learning_feedback", "adjust_learning_plan", "confirm_learning_plan"]);
  const query = capabilities[0];
  const response = await query.execute({ ...context, requestId: "cap-query", operationKey: "cap-query" }, { includeTasks: false });
  assert.equal(response.ok, true);
  const createTool = capabilities.find(capability => capability.name === "create_learning_plan")!;
  const created = await createTool.execute({ ...context, requestId: "cap-create", operationKey: "cap-create" }, { ...baseInput, ownerId: "model-cannot-set-owner" });
  assert.equal(created.ok, false);
  assert.equal(created.error?.code, "INVALID_ARGUMENT");
  const validCreated = await createTool.execute({ ...context, requestId: "cap-create-2", operationKey: "cap-create-2" }, baseInput);
  assert.equal(validCreated.ok, true);
});

test("all fixed adjustment operations update schedules, order and resource description", async () => {
  const repository = new InMemoryLearningRepository();
  const service = new LearningService(repository);
  const created = await create(service);
  const plan = created.data!;
  const [first, second] = plan.stages[0].tasks!;
  const adjusted = await service.adjustLearningPlan({ context, payload: { planId: plan.planId, trigger: "time_change", reason: "可用时间发生变化", adjustmentMode: "reschedule", operations: [
    { type: "reschedule", taskId: first.taskId, scheduleDate: "2026-09-18" },
    { type: "change_order", taskIds: [second.taskId, first.taskId] },
    { type: "replace_resource", taskId: first.taskId, resource: "替换后的学习资料" },
  ] }, expectedVersion: plan.version, idempotencyKey: "adjust-all" });
  const tasks = adjusted.data!.stages[0].tasks!;
  assert.equal(tasks.find(task => task.taskId === first.taskId)?.schedules[0].scheduleDate, "2026-09-18");
  assert.match(tasks.find(task => task.taskId === first.taskId)!.description, /替换后的学习资料/);
  assert.equal(tasks.find(task => task.taskId === second.taskId)?.priority, 1);
  assert.equal((await repository.listAdjustments!(owner, plan.planId)).length, 1);
});

test("today tasks and context queries expose owned facts to Career and Evidence only", async () => {
  const repository = new InMemoryLearningRepository();
  const service = new LearningService(repository, () => new Date("2026-09-14T06:00:00Z"));
  const plan = (await create(service)).data!;
  const task = plan.stages[0].tasks![0];
  assert.equal((await service.getTodayTasks(context, {})).length, 2);
  assert.equal((await service.getTaskContext(context, { taskId: task.taskId }))?.planId, plan.planId);
  assert.equal((await service.getStageContext(context, { stageId: task.stageId }))?.stageOrder, 1);
  await service.updateTaskStatus({ context, payload: { taskId: task.taskId, status: "completed" }, expectedVersion: plan.version, idempotencyKey: "complete-context" });
  assert.deepEqual(await service.getCompletedCapabilityKeys(context, { planId: plan.planId }), ["capability.read"]);
  assert.equal(await service.getTaskContext({ ownerId: otherOwner }, { taskId: task.taskId }), null);
});
