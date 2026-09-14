import { createHash } from "node:crypto";
import type { CapabilityErrorCode, DomainCommand } from "../../contracts/capability.ts";
import type { LearningApplication } from "./types.ts";
import type { AdjustmentOperation, AdjustPlanInput, CreatePlanInput, FeedbackInput, LearningContext, LearningFeedback, LearningPlan, LearningProgress, LearningResult, LearningTask, TaskStatus, UpdateTaskInput } from "./contracts.ts";
import type { LearningRepository } from "./repository.ts";
import { clone, newId, stageContext, taskById, taskContext } from "./repository.ts";

const writableStatuses = new Set(["draft", "active", "paused"]);
const transitions: Record<TaskStatus, readonly TaskStatus[]> = {
  todo: ["todo", "in_progress", "completed", "paused"],
  in_progress: ["in_progress", "todo", "completed", "paused"],
  completed: ["completed"],
  paused: ["paused", "todo", "in_progress"],
};

export class LearningService implements LearningApplication {
  private readonly repo: LearningRepository;
  constructor(repo: LearningRepository) { this.repo = repo; }

  async getActivePlan(ctx: LearningContext, input: { includeTasks?: boolean }) {
    const plan = await this.repo.getPlan(ctx.ownerId);
    if (!plan || input.includeTasks !== false) return plan;
    return { ...plan, stages: plan.stages.map(stage => ({ ...stage, tasks: [] })) };
  }

  async listPlans(ctx: LearningContext) { return (this.repo.listPlans ? await this.repo.listPlans(ctx.ownerId) : []).filter(plan => plan.status === "draft"); }

  async getTodayTasks(ctx: LearningContext, input: { date?: string }) {
    const plan = await this.repo.getPlan(ctx.ownerId);
    const date = input.date ?? new Date().toISOString().slice(0, 10);
    return plan?.stages.flatMap(stage => stage.tasks).filter(task => task.scheduleDate === date || task.schedules?.some(schedule => schedule.scheduleDate === date)) ?? [];
  }

  async getLearningProgress(ctx: LearningContext, input: { planId?: string }): Promise<LearningProgress | null> {
    const plan = await this.repo.getPlan(ctx.ownerId, input.planId); if (!plan) return null;
    const tasks = plan.stages.flatMap(stage => stage.tasks); const completed = tasks.filter(task => task.status === "completed").length;
    const current = plan.stages.find(stage => stage.tasks.some(task => task.status !== "completed")); const currentTasks = current?.tasks ?? [];
    return { planId: plan.id, planVersion: plan.version, totalTasks: tasks.length, completedTasks: completed, progressPercent: tasks.length ? Math.round(completed / tasks.length * 100) : 0, currentStageId: current?.id, currentStageProgressPercent: currentTasks.length ? Math.round(currentTasks.filter(task => task.status === "completed").length / currentTasks.length * 100) : undefined };
  }

  async getPlanProgress(ctx: LearningContext, input: { planId?: string }) {
    return this.getLearningProgress(ctx, input);
  }

  async createLearningPlan(command: DomainCommand<CreatePlanInput>) {
    const duplicate = await this.replay(command, "create_learning_plan"); if (duplicate) return duplicate as LearningResult<{ plan: LearningPlan }>;
    const existingFinal = await this.findActiveFinal(command.context.ownerId);
    if (command.payload.mode === "final" && existingFinal) return this.reject("当前用户已有 active final 学习计划", "INVALID_STATE");
    const now = new Date().toISOString(); const planId = newId();
    const plan: LearningPlan = { id: planId, ownerId: command.context.ownerId, mode: command.payload.mode, status: "draft", sourceProfileVersion: command.payload.sourceProfileVersion, sourceCareerPlanVersion: command.payload.sourceCareerPlanVersion, targetJobId: command.payload.targetJobId, startDate: command.payload.startDate, endDate: command.payload.endDate, weeklyMinutes: command.payload.weeklyMinutes, version: 1, learningGoals: command.payload.learningGoals, availableSlots: command.payload.availableSlots, sources: command.payload.sources, stages: command.payload.stages.map((stage, index) => ({ id: newId(), planId: planId, order: index + 1, title: stage.title, objective: stage.objective, status: "todo", progressPercent: 0, tasks: stage.tasks.map((task, taskIndex) => ({ id: newId(), planId, stageId: "", title: task.title, description: task.description, taskType: task.taskType, status: "todo", priority: taskIndex + 1, estimatedMinutes: task.estimatedMinutes, actualMinutes: null, capabilityKey: task.capabilityKey, evidenceRequired: task.evidenceRequired ?? false, scheduleDate: command.payload.startDate, schedules: [{ id: newId(), taskId: "", scheduleDate: command.payload.startDate, durationMinutes: task.estimatedMinutes, status: "scheduled" as const }] })) })) , updatedAt: now };
    for (const stage of plan.stages) for (const task of stage.tasks) { task.stageId = stage.id; for (const schedule of task.schedules ?? []) { schedule.taskId = task.id; } }
    await this.repo.savePlan(plan);
    return await this.applied({ plan }, "学习计划草案已保存", plan.id, plan.version, command, "create_learning_plan");
  }

  async updateTaskStatus(command: DomainCommand<UpdateTaskInput>) {
    const duplicate = await this.replay(command, "update_learning_task"); if (duplicate) return duplicate as LearningResult<{ task: LearningTask }>;
    const plan = await this.repo.getPlan(command.context.ownerId); const task = plan && taskById(plan, command.payload.taskId);
    if (!plan || !task) return this.reject("任务不存在", "NOT_FOUND");
    const versionError = this.assertVersion(command, plan); if (versionError) return versionError;
    const stateError = this.assertWritable(plan); if (stateError) return stateError;
    if (!transitions[task.status].includes(command.payload.status)) return this.reject(`任务不能从 ${task.status} 变更为 ${command.payload.status}`, "INVALID_STATE");
    task.status = command.payload.status; if (command.payload.actualMinutes !== undefined) task.actualMinutes = command.payload.actualMinutes; task.updatedAt = new Date().toISOString();
    plan.version++; plan.updatedAt = task.updatedAt; this.refreshProgress(plan); await this.repo.savePlan(plan);
    return await this.applied({ task: clone(task) }, "学习任务状态已更新", task.id, plan.version, command, "update_learning_task");
  }

  async recordLearningFeedback(command: DomainCommand<FeedbackInput>) {
    const duplicate = await this.replay(command, "record_learning_feedback"); if (duplicate) return duplicate as LearningResult<{ feedback: LearningFeedback }>;
    const plan = await this.repo.getPlan(command.context.ownerId, command.payload.planId); if (!plan) return this.reject("学习计划不存在", "NOT_FOUND");
    const versionError = this.assertVersion(command, plan); if (versionError) return versionError;
    const stateError = this.assertWritable(plan, false); if (stateError) return stateError;
    if (command.payload.taskId && !taskById(plan, command.payload.taskId)) return this.reject("反馈任务不属于该计划", "NOT_FOUND");
    const feedback: LearningFeedback = { id: newId(), ownerId: command.context.ownerId, ...command.payload, createdAt: new Date().toISOString() };
    plan.version++; plan.updatedAt = feedback.createdAt;
    if (this.repo.savePlanAndFeedback) await this.repo.savePlanAndFeedback(plan, feedback);
    else { await this.repo.savePlan(plan); await this.repo.saveFeedback(feedback); }
    return await this.applied({ feedback }, "学习反馈已记录", feedback.id, plan.version, command, "record_learning_feedback");
  }

  async adjustLearningPlan(command: DomainCommand<AdjustPlanInput>) {
    const duplicate = await this.replay(command, "adjust_learning_plan"); if (duplicate) return duplicate as LearningResult<{ plan: LearningPlan; adjustment: AdjustPlanInput }>;
    const plan = await this.repo.getPlan(command.context.ownerId, command.payload.planId); if (!plan) return this.reject("学习计划不存在", "NOT_FOUND");
    const versionError = this.assertVersion(command, plan); if (versionError) return versionError;
    const stateError = this.assertWritable(plan); if (stateError) return stateError;
    const summary: unknown[] = [];
    for (const operation of command.payload.operations) {
      const error = this.applyAdjustment(plan, operation, summary); if (error) return error;
    }
    const fromVersion = plan.version; plan.version++; plan.updatedAt = new Date().toISOString(); this.refreshProgress(plan);
    const adjustment = { id: newId(), ownerId: command.context.ownerId, planId: plan.id, fromVersion, toVersion: plan.version, trigger: command.payload.trigger, reason: command.payload.reason, changeSummary: summary, createdAt: plan.updatedAt };
    if (this.repo.savePlanChange) await this.repo.savePlanChange(plan, adjustment);
    else { await this.repo.savePlan(plan); await this.repo.saveAdjustment?.(adjustment); }
    return await this.applied({ plan: clone(plan), adjustment: command.payload }, "学习计划已调整", plan.id, plan.version, command, "adjust_learning_plan");
  }

  async confirmLearningPlan(command: DomainCommand<{ planId: string; expectedPlanVersion: number; keepUnfinishedTasks?: boolean }>) {
    const duplicate = await this.replay(command, "confirm_learning_plan"); if (duplicate) return duplicate as LearningResult<{ plan: LearningPlan }>;
    const plan = await this.repo.getPlan(command.context.ownerId, command.payload.planId); if (!plan) return this.reject("学习计划不存在", "NOT_FOUND");
    const versionError = this.assertVersion(command, plan, command.payload.expectedPlanVersion); if (versionError) return versionError;
    if (plan.mode !== "trial" || !["draft", "active"].includes(plan.status)) return this.reject("当前计划不可确认", "INVALID_STATE");
    const plansToSave: LearningPlan[] = [];
    for (const existing of (this.repo.listPlans ? await this.repo.listPlans(command.context.ownerId) : [])) if (existing.mode === "final" && existing.status === "active") {
      existing.status = "archived";
      existing.version++;
      existing.updatedAt = new Date().toISOString();
      plansToSave.push(existing);
    }
    if (command.payload.keepUnfinishedTasks === false) for (const task of plan.stages.flatMap(stage => stage.tasks)) if (task.status !== "completed") task.status = "paused";
    plan.mode = "final"; plan.status = "active"; plan.version++; plan.updatedAt = new Date().toISOString(); plansToSave.push(plan);
    if (this.repo.savePlans) await this.repo.savePlans(plansToSave);
    else for (const planToSave of plansToSave) await this.repo.savePlan(planToSave);
    return await this.applied({ plan: clone(plan) }, "学习计划已确认并激活", plan.id, plan.version, command, "confirm_learning_plan");
  }

  async getCompletedCapabilityKeys(ctx: LearningContext, input: { planId?: string }) { const plan = await this.repo.getPlan(ctx.ownerId, input.planId); return [...new Set(plan?.stages.flatMap(stage => stage.tasks).filter(task => task.status === "completed" && task.capabilityKey).map(task => task.capabilityKey!) ?? [])]; }
  async getTaskContext(ctx: LearningContext, input: { taskId: string }) { const plan = await this.repo.getPlan(ctx.ownerId); return plan ? taskContext(plan, input.taskId) : null; }
  async getStageContext(ctx: LearningContext, input: { stageId: string }) { const plan = await this.repo.getPlan(ctx.ownerId); return plan ? stageContext(plan, input.stageId) : null; }

  private async findActiveFinal(ownerId: string) { const plans = this.repo.listPlans ? await this.repo.listPlans(ownerId) : []; return plans.find(plan => plan.mode === "final" && plan.status === "active") ?? null; }
  private assertWritable(plan: LearningPlan, allowPaused = true) { if (!writableStatuses.has(plan.status) || (!allowPaused && plan.status === "paused")) return this.reject("当前学习计划状态不允许此操作", "INVALID_STATE"); return null; }
  private assertVersion(command: DomainCommand<unknown>, plan: LearningPlan, explicit?: number) { const expected = explicit ?? command.expectedVersion; return expected !== undefined && expected !== plan.version ? this.reject("学习计划版本已变化，请刷新后重试", "VERSION_CONFLICT", true) : null; }
  private refreshProgress(plan: LearningPlan) { for (const stage of plan.stages) { const tasks = stage.tasks; const completed = tasks.filter(task => task.status === "completed").length; stage.progressPercent = tasks.length ? Math.round(completed / tasks.length * 100) : 0; stage.status = completed === tasks.length ? "completed" : tasks.some(task => task.status === "in_progress") ? "in_progress" : "todo"; } if (plan.stages.length && plan.stages.every(stage => stage.status === "completed")) plan.status = "completed"; }
  private applyAdjustment(plan: LearningPlan, operation: AdjustmentOperation, summary: unknown[]): LearningResult<never> | null {
    if (operation.type === "change_order") { const found = operation.taskIds.map(id => taskById(plan, id)); if (found.some(task => !task)) return this.reject("调整操作包含不存在的任务", "NOT_FOUND"); const stageIds = new Set(found.map(task => task!.stageId)); if (stageIds.size !== 1) return this.reject("调整顺序的任务必须属于同一阶段", "INVALID_ARGUMENT"); found.forEach((task, index) => { task!.priority = index + 1; }); summary.push({ type: operation.type, taskIds: operation.taskIds }); return null; }
    const task = taskById(plan, operation.taskId); if (!task) return this.reject("调整操作包含不存在的任务", "NOT_FOUND");
    if (operation.type === "reschedule") { task.scheduleDate = operation.scheduleDate; task.schedules = [{ id: task.schedules?.[0]?.id ?? newId(), taskId: task.id, scheduleDate: operation.scheduleDate, durationMinutes: task.estimatedMinutes, status: "rescheduled" }]; summary.push(operation); return null; }
    if (operation.type === "replace_resource") { task.description = operation.resource; summary.push({ type: operation.type, taskId: task.id }); return null; }
    if (operation.type === "split_task") { if (task.status === "completed") return this.reject("已完成任务不能拆分", "INVALID_STATE"); const stage = plan.stages.find(item => item.id === task.stageId)!; const created = operation.newTasks.map((input, index) => ({ id: newId(), planId: plan.id, stageId: stage.id, parentTaskId: task.id, title: input.title, description: input.description ?? "", taskType: input.taskType ?? "practice", status: "todo" as const, priority: task.priority + index + 1, estimatedMinutes: input.estimatedMinutes, actualMinutes: null, capabilityKey: task.capabilityKey, evidenceRequired: task.evidenceRequired, schedules: [] })); task.status = "paused"; stage.tasks.push(...created); summary.push({ type: operation.type, taskId: task.id, createdTaskIds: created.map(item => item.id) }); return null; }
    return this.reject("不支持的计划调整操作", "INVALID_ARGUMENT");
  }
  private async replay<T>(command: DomainCommand<unknown>, commandName: string): Promise<LearningResult<T> | null> { if (!command.idempotencyKey || !this.repo.getIdempotency) return null; const existing = await this.repo.getIdempotency(command.context.ownerId, command.idempotencyKey); if (!existing) return null; const hash = this.hash(command.payload); if (existing.commandName !== commandName || existing.requestHash !== hash) return this.reject("相同幂等键对应了不同请求", "DUPLICATE_REQUEST"); return clone(existing.result) as LearningResult<T>; }
  private async remember<T>(command: DomainCommand<unknown>, commandName: string, result: LearningResult<T>) { if (command.idempotencyKey && this.repo.saveIdempotency) await this.repo.saveIdempotency(command.context.ownerId, command.idempotencyKey, { commandName, requestHash: this.hash(command.payload), result }); }
  private hash(payload: unknown) { return createHash("sha256").update(JSON.stringify(payload)).digest("hex"); }
  private async applied<T>(data: T, summary: string, entityId: string, version: number, command: DomainCommand<unknown>, commandName: string) { const result = this.result(data, summary, true, entityId, version); await this.remember(command, commandName, result); return result; }
  private result<T>(data: T, summary: string, changed = false, entityId?: string, version?: number): LearningResult<T> { return { ok: true, changed, domain: "learning", status: changed ? "applied" : "read", summary, data, ...(entityId ? { entityId } : {}), ...(version ? { version } : {}) }; }
  private reject<T = never>(summary: string, code: CapabilityErrorCode, retryable = false): LearningResult<T> { return { ok: false, changed: false, domain: "learning", status: "rejected", summary, error: { code, message: summary, retryable } }; }
}
