import { createHash, randomUUID } from "node:crypto";
import type { CapabilityResult, DomainCommand, ModuleContext } from "../../contracts/capability.ts";
import { adjustLearningPlanSchema, confirmLearningPlanSchema, createLearningPlanSchema, getActivePlanSchema, getLearningProgressSchema, getTodayTasksSchema, recordLearningFeedbackSchema, updateTaskStatusSchema, type AdjustLearningPlanCommand, type CreateLearningPlanCommand, type ConfirmLearningPlanCommand, type LearningApplication, type LearningCapabilityResult, type RecordLearningFeedbackCommand, type UpdateTaskStatusCommand, LearningError } from "./contracts.ts";
import { clone, type LearningRepository, planProgress, type NewPlan, stageProgress } from "./repository.ts";

function hashCommand(command: DomainCommand<unknown>): string {
  return createHash("sha256").update(JSON.stringify({ payload: command.payload, expectedVersion: command.expectedVersion })).digest("hex");
}

function result<T>(data: T, summary: string, entityId?: string, version?: number, status: CapabilityResult["status"] = "applied"): LearningCapabilityResult<T> {
  return { ok: true, changed: status !== "read", domain: "learning", entityId, version, status, summary, data };
}

function rejected(error: unknown): never {
  if (error instanceof LearningError) throw error;
  throw new LearningError("INVALID_ARGUMENT", error instanceof Error ? error.message : "学习计划请求无效");
}

export class LearningService implements LearningApplication {
  private readonly repository: LearningRepository;
  private readonly now: () => Date;
  constructor(repository: LearningRepository, now: () => Date = () => new Date()) { this.repository = repository; this.now = now; }

  async getActivePlan(ctx: ModuleContext, input: { includeTasks?: boolean }) {
    const parsed = getActivePlanSchema.parse(input);
    return this.repository.getActivePlan(ctx.ownerId, parsed.includeTasks);
  }

  async getTodayTasks(ctx: ModuleContext, input: { date?: string }) {
    const date = getTodayTasksSchema.parse(input).date ?? this.now().toISOString().slice(0, 10);
    return this.repository.getTodayTasks(ctx.ownerId, date);
  }

  async getLearningProgress(ctx: ModuleContext, input: { planId?: string }) {
    const parsed = getLearningProgressSchema.parse(input);
    const plan = parsed.planId ? await this.repository.getPlan(ctx.ownerId, parsed.planId, true) : await this.repository.getActivePlan(ctx.ownerId, true);
    if (!plan) throw new LearningError("NOT_FOUND", "学习计划不存在");
    const progress = planProgress(plan);
    const current = plan.stages.find(stage => (stage.tasks ?? []).some(task => task.status !== "completed")) ?? plan.stages.at(-1);
    return { planId: plan.planId, planVersion: plan.version, ...progress, currentStageId: current?.stageId, currentStageProgressPercent: current ? stageProgress(current.tasks ?? []) : undefined };
  }

  getPlanProgress(ctx: ModuleContext, input: { planId?: string }) { return this.getLearningProgress(ctx, input); }

  async createLearningPlan(command: CreateLearningPlanCommand) {
    try {
      const payload = createLearningPlanSchema.parse(command.payload);
      const start = new Date(`${payload.startDate}T00:00:00Z`).getTime();
      const end = new Date(`${payload.endDate}T00:00:00Z`).getTime();
      const span = Math.max(1, Math.floor((end - start) / 86_400_000) + 1);
      if (span < payload.stages.length) throw new LearningError("INVALID_ARGUMENT", "计划日期范围必须覆盖所有学习阶段", false, ["startDate", "endDate", "stages"]);
      const stages = payload.stages.map((stage, index) => {
        const stageStart = new Date(start + Math.floor(index * span / payload.stages.length) * 86_400_000).toISOString().slice(0, 10);
        const stageEnd = new Date(start + (Math.floor((index + 1) * span / payload.stages.length) - 1) * 86_400_000).toISOString().slice(0, 10);
        return { ...stage, startDate: stageStart, endDate: stageEnd };
      });
      const plan = await this.withIdempotency(command, "create_learning_plan", () => this.repository.createPlan({ ...payload, ownerId: command.context.ownerId, stages }));
      return result(plan, "学习计划草案已保存", plan.planId, plan.version, plan.status === "draft" ? "draft_created" : "applied");
    } catch (error) { return rejected(error); }
  }

  async updateTaskStatus(command: UpdateTaskStatusCommand) {
    try {
      this.requireVersion(command.expectedVersion);
      const payload = updateTaskStatusSchema.parse(command.payload);
      const task = await this.withIdempotency(command, "update_learning_task", () => this.repository.updateTaskStatus(command.context.ownerId, payload.taskId, payload.status, payload.actualMinutes, command.expectedVersion));
      if (!task) throw new LearningError("NOT_FOUND", "学习任务不存在");
      return result(task, "学习任务状态已更新", task.taskId);
    } catch (error) { return rejected(error); }
  }

  async recordLearningFeedback(command: RecordLearningFeedbackCommand) {
    try {
      this.requireVersion(command.expectedVersion);
      const payload = recordLearningFeedbackSchema.parse(command.payload);
      const feedback = await this.withIdempotency(command, "record_learning_feedback", () => this.repository.recordFeedback(command.context.ownerId, payload, command.expectedVersion));
      if (!feedback) throw new LearningError("NOT_FOUND", "学习计划或任务不存在");
      return result(feedback, "学习反馈已记录", feedback.feedbackId);
    } catch (error) { return rejected(error); }
  }

  async adjustLearningPlan(command: AdjustLearningPlanCommand) {
    try {
      this.requireVersion(command.expectedVersion);
      const payload = adjustLearningPlanSchema.parse(command.payload);
      const current = await this.repository.getPlan(command.context.ownerId, payload.planId, false);
      if (!current) throw new LearningError("NOT_FOUND", "学习计划不存在");
      const adjusted = await this.withIdempotency(command, "adjust_learning_plan", () => this.repository.adjustPlan(command.context.ownerId, current.planId, command.expectedVersion, current.mode, payload.trigger, payload.reason, payload.operations));
      if (!adjusted) throw new LearningError("NOT_FOUND", "学习计划不存在");
      return result(adjusted.plan, "学习计划已按结构化操作调整", adjusted.plan.planId, adjusted.toVersion);
    } catch (error) { return rejected(error); }
  }

  async confirmLearningPlan(command: ConfirmLearningPlanCommand) {
    try {
      const payload = confirmLearningPlanSchema.parse(command.payload);
      const plan = await this.withIdempotency(command, "confirm_learning_plan", () => this.repository.confirmPlan(command.context.ownerId, payload.planId, payload.expectedPlanVersion, payload.keepUnfinishedTasks));
      if (!plan) throw new LearningError("NOT_FOUND", "试验学习计划不存在");
      return result(plan, "试验学习计划已确认并激活正式计划", plan.planId, plan.version);
    } catch (error) { return rejected(error); }
  }

  getTaskContext(ctx: ModuleContext, input: { taskId: string }) { return this.repository.getTaskContext(ctx.ownerId, input.taskId); }
  getStageContext(ctx: ModuleContext, input: { stageId: string }) { return this.repository.getStageContext(ctx.ownerId, input.stageId); }
  getCompletedCapabilityKeys(ctx: ModuleContext, input: { planId?: string }) { return this.repository.getCompletedCapabilityKeys(ctx.ownerId, input.planId); }

  private async withIdempotency<T>(command: DomainCommand<unknown>, commandName: string, operation: () => Promise<T>): Promise<T> {
    if (!command.idempotencyKey?.trim()) throw new LearningError("INVALID_ARGUMENT", "写操作必须提供幂等键", false, ["idempotencyKey"]);
    const requestHash = hashCommand(command);
    const previous = await this.repository.getIdempotency(command.context.ownerId, command.idempotencyKey);
    if (previous) {
      if (previous.commandName !== commandName || previous.requestHash !== requestHash) throw new LearningError("DUPLICATE_REQUEST", "相同幂等键对应了不同的请求参数");
      return clone(previous.result as T);
    }
    const output = await operation();
    await this.repository.saveIdempotency(command.context.ownerId, command.idempotencyKey, commandName, command.context.requestId ?? "unknown", requestHash, output);
    return output;
  }

  private requireVersion(version?: number) { if (version === undefined) throw new LearningError("INVALID_ARGUMENT", "写入已有学习计划时必须提供 expectedVersion", false, ["expectedVersion"]); }
}

export function emptyContext(ownerId: string): ModuleContext { return { ownerId, requestId: randomUUID() }; }
