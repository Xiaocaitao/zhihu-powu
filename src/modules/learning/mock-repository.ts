import { randomUUID } from "node:crypto";
import type { AdjustmentOperation, LearningFeedbackDTO, LearningPlanDTO, LearningStageContext, LearningTaskContext, LearningTaskDTO, PlanMode, RecordLearningFeedbackInput, TaskStatus } from "./contracts.ts";
import { LearningError } from "./contracts.ts";
import { clone, stageProgress, type AdjustmentHistory, type AdjustmentResult, type IdempotencyRecord, type LearningRepository, type NewPlan } from "./repository.ts";

export class InMemoryLearningRepository implements LearningRepository {
  private readonly plans = new Map<string, LearningPlanDTO>();
  private readonly feedback = new Map<string, LearningFeedbackDTO>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly adjustments: AdjustmentHistory[] = [];
  private readonly clock: () => Date;

  constructor(clock: () => Date = () => new Date()) { this.clock = clock; }

  async getActivePlan(ownerId: string, includeTasks: boolean) {
    const plans = [...this.plans.values()].filter(plan => plan.ownerId === ownerId && plan.status !== "archived" && plan.status !== "completed");
    const plan = plans.sort((a, b) => Number(b.mode === "final") - Number(a.mode === "final") || b.updatedAt.localeCompare(a.updatedAt))[0];
    return plan ? this.view(plan, includeTasks) : null;
  }

  async getPlan(ownerId: string, planId: string, includeTasks: boolean) {
    const plan = this.plans.get(planId);
    return plan?.ownerId === ownerId ? this.view(plan, includeTasks) : null;
  }

  async getTodayTasks(ownerId: string, date: string) {
    const plans = [...this.plans.values()].filter(plan => plan.ownerId === ownerId && plan.status !== "archived" && plan.status !== "completed");
    return plans.flatMap(plan => plan.stages.flatMap(stage => (stage.tasks ?? []).filter(task => task.schedules.some(schedule => schedule.scheduleDate === date)).map(clone)));
  }

  async createPlan(input: NewPlan) {
    if (input.mode === "final" && [...this.plans.values()].some(plan => plan.ownerId === input.ownerId && plan.mode === "final" && plan.status === "active")) throw new LearningError("INVALID_STATE", "当前用户已有 active final 学习计划");
    const now = this.clock().toISOString();
    const planId = randomUUID();
    const stages = input.stages.map((stage, stageIndex) => {
      const stageId = randomUUID();
      const tasks = stage.tasks.map((inputTask, taskIndex) => {
        const taskId = randomUUID();
        const scheduleId = randomUUID();
        return {
          taskId, planId, stageId, title: inputTask.title, description: inputTask.description, taskType: inputTask.taskType,
          status: "todo" as const, priority: taskIndex + 1, estimatedMinutes: inputTask.estimatedMinutes, actualMinutes: 0,
          capabilityKey: inputTask.capabilityKey, evidenceRequired: inputTask.evidenceRequired ?? false,
          schedules: [{ id: scheduleId, taskId, scheduleDate: stage.startDate, durationMinutes: inputTask.estimatedMinutes, status: "scheduled" as const }],
          createdAt: now, updatedAt: now,
        } satisfies LearningTaskDTO;
      });
      return { stageId, planId, stageOrder: stageIndex + 1, title: stage.title, objective: stage.objective, startDate: stage.startDate, endDate: stage.endDate, status: stageIndex === 0 ? "active" : "planned", assessmentRequired: false, progressPercent: 0, tasks };
    });
    const plan: LearningPlanDTO = { planId, ownerId: input.ownerId, mode: input.mode, status: input.mode === "trial" ? "draft" : "active", sourceProfileVersion: input.sourceProfileVersion, sourceCareerPlanVersion: input.sourceCareerPlanVersion, targetJobId: input.targetJobId, startDate: input.startDate, endDate: input.endDate, weeklyMinutes: input.weeklyMinutes, version: 1, stages, learningGoals: input.learningGoals, createdAt: now, updatedAt: now };
    this.plans.set(planId, plan);
    return clone(plan);
  }

  async updateTaskStatus(ownerId: string, taskId: string, status: TaskStatus, actualMinutes: number | undefined, expectedPlanVersion?: number) {
    const found = this.findTask(ownerId, taskId);
    if (!found) return null;
    this.assertPlanWritable(found.plan, expectedPlanVersion);
    if (!this.validTransition(found.task.status, status)) throw new LearningError("INVALID_STATE", `任务不能从 ${found.task.status} 变更为 ${status}`);
    found.task.status = status;
    if (status === "completed") for (const schedule of found.task.schedules) schedule.status = "done";
    if (actualMinutes !== undefined) found.task.actualMinutes = actualMinutes;
    found.task.updatedAt = this.clock().toISOString();
    this.bump(found.plan);
    this.refreshStages(found.plan);
    return clone(found.task);
  }

  async recordFeedback(ownerId: string, input: RecordLearningFeedbackInput, expectedPlanVersion?: number) {
    const plan = this.plans.get(input.planId);
    if (!plan || plan.ownerId !== ownerId) return null;
    this.assertPlanWritable(plan, expectedPlanVersion, false);
    if (input.taskId) {
      const task = this.findTask(ownerId, input.taskId);
      if (!task || task.plan.planId !== input.planId) throw new LearningError("NOT_FOUND", "反馈任务不属于该计划");
    }
    const feedback: LearningFeedbackDTO = { feedbackId: randomUUID(), planId: input.planId, taskId: input.taskId, difficulty: input.difficulty, reason: input.reason, actualMinutes: input.actualMinutes, availableMinutes: input.availableMinutes, confidenceScore: input.confidenceScore, note: input.note, createdAt: this.clock().toISOString() };
    this.feedback.set(feedback.feedbackId, feedback);
    return clone(feedback);
  }

  async adjustPlan(ownerId: string, planId: string, expectedVersion: number | undefined, _mode: PlanMode, trigger: string, reason: string, operations: AdjustmentOperation[]): Promise<AdjustmentResult | null> {
    const plan = this.plans.get(planId);
    if (!plan || plan.ownerId !== ownerId) return null;
    this.assertPlanWritable(plan, expectedVersion);
    const fromVersion = plan.version;
    const summary: unknown[] = [];
    for (const operation of operations) {
      if (operation.type === "change_order") {
        const found = operation.taskIds.map(taskId => this.findTask(ownerId, taskId));
        if (found.some(item => !item || item.plan.planId !== planId)) throw new LearningError("NOT_FOUND", "调整操作包含不属于当前计划的任务");
        const stageIds = new Set(found.map(item => item!.stage.stageId));
        if (stageIds.size !== 1) throw new LearningError("INVALID_ARGUMENT", "调整顺序的任务必须属于同一阶段");
        found.forEach((item, index) => { item!.task.priority = index + 1; item!.task.updatedAt = this.clock().toISOString(); });
        summary.push({ type: operation.type, taskIds: operation.taskIds });
      } else {
        const found = this.findTask(ownerId, operation.taskId);
        if (!found || found.plan.planId !== planId) throw new LearningError("NOT_FOUND", "调整操作包含不属于当前计划的任务");
        if (operation.type === "split_task") {
          if (found.task.status === "completed") throw new LearningError("INVALID_STATE", "已完成任务不能拆分");
          const date = found.task.schedules[0]?.scheduleDate ?? plan.startDate;
          const created = operation.newTasks.map((inputTask, index) => {
            const taskId = randomUUID();
            return { taskId, planId, stageId: found.stage.stageId, parentTaskId: found.task.taskId, title: inputTask.title, description: inputTask.description ?? "", taskType: inputTask.taskType ?? "practice", status: "todo" as const, priority: found.task.priority + index + 1, estimatedMinutes: inputTask.estimatedMinutes, actualMinutes: 0, capabilityKey: found.task.capabilityKey, evidenceRequired: found.task.evidenceRequired, schedules: [{ id: randomUUID(), taskId, scheduleDate: date, durationMinutes: inputTask.estimatedMinutes, status: "scheduled" as const }], createdAt: this.clock().toISOString(), updatedAt: this.clock().toISOString() } satisfies LearningTaskDTO;
          });
          found.task.status = "paused";
          found.stage.tasks = [...(found.stage.tasks ?? []), ...created];
          summary.push({ type: operation.type, taskId: operation.taskId, createdTaskIds: created.map(task => task.taskId) });
        } else if (operation.type === "reschedule") {
          const schedule = found.task.schedules[0];
          if (schedule) { schedule.scheduleDate = operation.scheduleDate; schedule.status = "rescheduled"; } else found.task.schedules.push({ id: randomUUID(), taskId: found.task.taskId, scheduleDate: operation.scheduleDate, durationMinutes: found.task.estimatedMinutes, status: "rescheduled" });
          summary.push({ type: operation.type, taskId: operation.taskId, scheduleDate: operation.scheduleDate });
        } else {
          found.task.description = `${found.task.description}\n资源：${operation.resource}`.trim();
          summary.push({ type: operation.type, taskId: operation.taskId });
        }
        found.task.updatedAt = this.clock().toISOString();
      }
    }
    this.bump(plan);
    this.refreshStages(plan);
    this.adjustments.push({ id: randomUUID(), planId, fromVersion, toVersion: plan.version, trigger, reason, changeSummary: clone(summary) });
    return { plan: clone(plan), fromVersion, toVersion: plan.version, changeSummary: summary };
  }

  async confirmPlan(ownerId: string, planId: string, expectedVersion: number, keepUnfinishedTasks: boolean) {
    const plan = this.plans.get(planId);
    if (!plan || plan.ownerId !== ownerId) return null;
    if (plan.mode !== "trial") throw new LearningError("INVALID_STATE", "只有 trial 计划可以确认");
    this.assertPlanWritable(plan, expectedVersion);
    for (const existing of this.plans.values()) if (existing.ownerId === ownerId && existing.mode === "final" && existing.status === "active") existing.status = "archived";
    if (!keepUnfinishedTasks) for (const task of plan.stages.flatMap(stage => stage.tasks ?? [])) if (task.status !== "completed") task.status = "paused";
    plan.mode = "final";
    plan.status = "active";
    this.bump(plan);
    return clone(plan);
  }

  async getTaskContext(ownerId: string, taskId: string) {
    const found = this.findTask(ownerId, taskId);
    return found ? { taskId, planId: found.plan.planId, stageId: found.stage.stageId, title: found.task.title, capabilityKey: found.task.capabilityKey, evidenceRequired: found.task.evidenceRequired } satisfies LearningTaskContext : null;
  }

  async getStageContext(ownerId: string, stageId: string) {
    for (const plan of this.plans.values()) for (const stage of plan.stages) if (plan.ownerId === ownerId && stage.stageId === stageId) return { stageId, planId: plan.planId, title: stage.title, objective: stage.objective, stageOrder: stage.stageOrder } satisfies LearningStageContext;
    return null;
  }

  async getCompletedCapabilityKeys(ownerId: string, planId?: string) {
    const plans = [...this.plans.values()].filter(plan => plan.ownerId === ownerId && (!planId || plan.planId === planId));
    return [...new Set(plans.flatMap(plan => plan.stages.flatMap(stage => (stage.tasks ?? []).filter(task => task.status === "completed" && task.capabilityKey).map(task => task.capabilityKey!))))];
  }

  async getIdempotency(ownerId: string, key: string) { return this.idempotency.get(`${ownerId}:${key}`) ? clone(this.idempotency.get(`${ownerId}:${key}`)!) : null; }
  async saveIdempotency(ownerId: string, key: string, commandName: string, requestId: string, requestHash: string, result: unknown) { this.idempotency.set(`${ownerId}:${key}`, { commandName, requestId, requestHash, result: clone(result) }); }
  async listAdjustments(ownerId: string, planId: string) { const plan = this.plans.get(planId); return plan?.ownerId === ownerId ? clone(this.adjustments.filter(item => item.planId === planId)) : []; }

  private view(plan: LearningPlanDTO, includeTasks: boolean) { const copy = clone(plan); if (!includeTasks) copy.stages = copy.stages.map(stage => ({ ...stage, tasks: undefined })); return copy; }
  private findTask(ownerId: string, taskId: string) { for (const plan of this.plans.values()) for (const stage of plan.stages) for (const task of stage.tasks ?? []) if (plan.ownerId === ownerId && task.taskId === taskId) return { plan, stage, task }; return null; }
  private assertPlanWritable(plan: LearningPlanDTO, expectedVersion?: number, allowPaused = true) { if (expectedVersion !== undefined && plan.version !== expectedVersion) throw new LearningError("VERSION_CONFLICT", "学习计划版本已变化，请刷新后重试", true); if (!["draft", "active", ...(allowPaused ? ["paused"] : [])].includes(plan.status)) throw new LearningError("INVALID_STATE", "当前学习计划状态不允许此操作"); }
  private validTransition(from: TaskStatus, to: TaskStatus) { return from === to || from === "todo" && ["in_progress", "completed", "paused"].includes(to) || from === "in_progress" && ["todo", "completed", "paused"].includes(to) || from === "paused" && ["todo", "in_progress"].includes(to); }
  private bump(plan: LearningPlanDTO) { plan.version += 1; plan.updatedAt = this.clock().toISOString(); }
  private refreshStages(plan: LearningPlanDTO) { for (const stage of plan.stages) { const tasks = stage.tasks ?? []; stage.progressPercent = stageProgress(tasks); stage.status = tasks.length && tasks.every(task => task.status === "completed") ? "completed" : tasks.some(task => task.status === "in_progress") ? "active" : stage.status === "completed" ? "active" : stage.status; } const current = plan.stages.find(stage => stage.status !== "completed"); if (current?.status === "planned") current.status = "active"; else if (!current && plan.stages.length) plan.status = "completed"; }
}
