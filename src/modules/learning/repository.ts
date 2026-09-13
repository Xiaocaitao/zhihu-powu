import type { AdjustmentOperation, AvailableSlot, CreateLearningPlanInput, LearningFeedbackDTO, LearningPlanDTO, LearningStageContext, LearningTaskContext, LearningTaskDTO, PlanMode, PlanStatus, RecordLearningFeedbackInput, TaskStatus } from "./contracts.ts";

export type NewPlan = Omit<CreateLearningPlanInput, "stages"> & {
  ownerId: string;
  stages: Array<{
    title: string;
    objective: string;
    startDate: string;
    endDate: string;
    tasks: CreateLearningPlanInput["stages"][number]["tasks"];
  }>;
};

export type IdempotencyRecord = {
  commandName: string;
  requestId?: string;
  requestHash: string;
  result: unknown;
};

export type AdjustmentResult = {
  plan: LearningPlanDTO;
  fromVersion: number;
  toVersion: number;
  changeSummary: unknown;
};

export type AdjustmentHistory = {
  id: string;
  planId: string;
  fromVersion: number;
  toVersion: number;
  trigger: string;
  reason: string;
  changeSummary: unknown;
};

export interface LearningRepository {
  getActivePlan(ownerId: string, includeTasks: boolean): Promise<LearningPlanDTO | null>;
  getPlan(ownerId: string, planId: string, includeTasks: boolean): Promise<LearningPlanDTO | null>;
  getTodayTasks(ownerId: string, date: string): Promise<LearningTaskDTO[]>;
  createPlan(input: NewPlan): Promise<LearningPlanDTO>;
  updateTaskStatus(ownerId: string, taskId: string, status: TaskStatus, actualMinutes: number | undefined, expectedPlanVersion?: number): Promise<LearningTaskDTO | null>;
  recordFeedback(ownerId: string, input: RecordLearningFeedbackInput, expectedPlanVersion?: number): Promise<LearningFeedbackDTO | null>;
  adjustPlan(ownerId: string, planId: string, expectedVersion: number | undefined, mode: PlanMode, trigger: string, reason: string, operations: AdjustmentOperation[]): Promise<AdjustmentResult | null>;
  confirmPlan(ownerId: string, planId: string, expectedVersion: number, keepUnfinishedTasks: boolean): Promise<LearningPlanDTO | null>;
  getTaskContext(ownerId: string, taskId: string): Promise<LearningTaskContext | null>;
  getStageContext(ownerId: string, stageId: string): Promise<LearningStageContext | null>;
  getCompletedCapabilityKeys(ownerId: string, planId?: string): Promise<string[]>;
  getIdempotency(ownerId: string, key: string): Promise<IdempotencyRecord | null>;
  saveIdempotency(ownerId: string, key: string, commandName: string, requestId: string, requestHash: string, result: unknown): Promise<void>;
  listAdjustments?(ownerId: string, planId: string): Promise<AdjustmentHistory[]>;
}

export function clone<T>(value: T): T { return structuredClone(value); }

export function stageProgress(tasks: readonly LearningTaskDTO[]): number {
  if (!tasks.length) return 0;
  return Math.round(tasks.filter(task => task.status === "completed").length / tasks.length * 100);
}

export function planProgress(plan: LearningPlanDTO) {
  const tasks = plan.stages.flatMap(stage => stage.tasks ?? []);
  const completed = tasks.filter(task => task.status === "completed").length;
  return { totalTasks: tasks.length, completedTasks: completed, progressPercent: tasks.length ? Math.round(completed / tasks.length * 100) : 0 };
}

export function taskBelongsToPlan(plan: LearningPlanDTO, taskId: string): boolean {
  return plan.stages.some(stage => (stage.tasks ?? []).some(task => task.taskId === taskId));
}

export function unusedAvailableSlots(_slots?: AvailableSlot[]): void {
  // The fixed C schema stores available slots only as a creation snapshot input.
}
