import { z } from "zod";
import type { CapabilityResult, DomainCommand, ModuleContext } from "../../contracts/capability.ts";

export const planModes = ["trial", "final"] as const;
export const planStatuses = ["draft", "active", "paused", "completed", "archived"] as const;
export const taskStatuses = ["todo", "in_progress", "completed", "paused"] as const;
export const taskTypes = ["reading", "practice", "project", "review"] as const;
export const scheduleStatuses = ["scheduled", "done", "missed", "rescheduled"] as const;

export type PlanMode = typeof planModes[number];
export type PlanStatus = typeof planStatuses[number];
export type TaskStatus = typeof taskStatuses[number];
export type TaskType = typeof taskTypes[number];
export type ScheduleStatus = typeof scheduleStatuses[number];

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期必须使用 YYYY-MM-DD 格式");
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "时间必须使用 HH:mm 格式");
const text = (max: number) => z.string().trim().min(1).max(max);

export const availableSlotSchema = z.strictObject({
  weekday: z.number().int().min(0).max(6),
  startTime: timeSchema,
  endTime: timeSchema,
}).superRefine((slot, ctx) => {
  if (slot.startTime >= slot.endTime) ctx.addIssue({ code: "custom", message: "学习时间段必须有正时长", path: ["endTime"] });
});

export const planTaskInputSchema = z.strictObject({
  title: text(200),
  description: text(4000),
  taskType: z.enum(taskTypes),
  estimatedMinutes: z.number().int().min(1).max(24 * 60),
  capabilityKey: z.string().trim().min(1).max(200).optional(),
  evidenceRequired: z.boolean().optional().default(false),
});

export const planStageInputSchema = z.strictObject({
  title: text(200),
  objective: text(4000),
  tasks: z.array(planTaskInputSchema).min(1).max(100),
});

export const createLearningPlanSchema = z.strictObject({
  mode: z.enum(planModes),
  sourceProfileVersion: z.number().int().positive(),
  sourceCareerPlanVersion: z.number().int().positive().optional(),
  targetJobId: z.string().uuid().optional(),
  startDate: dateSchema,
  endDate: dateSchema,
  weeklyMinutes: z.number().int().min(1).max(7 * 24 * 60),
  availableSlots: z.array(availableSlotSchema).max(7).optional(),
  learningGoals: z.array(text(500)).min(1).max(20),
  stages: z.array(planStageInputSchema).min(1).max(20),
}).superRefine((input, ctx) => {
  if (input.startDate > input.endDate) ctx.addIssue({ code: "custom", message: "计划结束日期不能早于开始日期", path: ["endDate"] });
});

export const getActivePlanSchema = z.strictObject({ includeTasks: z.boolean().optional().default(false) });
export const getTodayTasksSchema = z.strictObject({ date: dateSchema.optional() });
export const getLearningProgressSchema = z.strictObject({ planId: z.string().uuid().optional() });

export const updateTaskStatusSchema = z.strictObject({
  taskId: z.string().uuid(),
  status: z.enum(taskStatuses),
  actualMinutes: z.number().int().min(0).max(24 * 60).optional(),
  note: z.string().trim().max(2000).optional(),
});

const feedbackReasons = ["missing_prerequisite", "unclear_first_step", "cannot_apply", "too_much_content", "insufficient_time", "lack_of_feedback", "other"] as const;
export const recordLearningFeedbackSchema = z.strictObject({
  planId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  difficulty: z.enum(["too_easy", "appropriate", "too_hard"]),
  reason: z.enum(feedbackReasons).optional(),
  actualMinutes: z.number().int().min(0).max(24 * 60).optional(),
  availableMinutes: z.number().int().min(0).max(24 * 60).optional(),
  confidenceScore: z.number().int().min(0).max(100).optional(),
  note: z.string().trim().max(4000).optional(),
});

const adjustmentTriggers = ["user_feedback", "time_change", "task_delay", "assessment_result", "goal_change"] as const;
const adjustmentModes = ["reduce_scope", "split_task", "change_order", "reschedule", "add_prerequisite", "replace_resource"] as const;
const splitOperationSchema = z.strictObject({
  type: z.literal("split_task"),
  taskId: z.string().uuid(),
  newTasks: z.array(z.strictObject({
    title: text(200),
    description: z.string().trim().max(4000).optional(),
    taskType: z.enum(taskTypes).optional(),
    estimatedMinutes: z.number().int().min(1).max(24 * 60),
  })).min(1).max(20),
});
const adjustmentOperationSchema = z.discriminatedUnion("type", [
  splitOperationSchema,
  z.strictObject({ type: z.literal("reschedule"), taskId: z.string().uuid(), scheduleDate: dateSchema }),
  z.strictObject({ type: z.literal("change_order"), taskIds: z.array(z.string().uuid()).min(1).max(100) }),
  z.strictObject({ type: z.literal("replace_resource"), taskId: z.string().uuid(), resource: text(4000) }),
]);
export const adjustLearningPlanSchema = z.strictObject({
  planId: z.string().uuid(),
  trigger: z.enum(adjustmentTriggers),
  assessmentId: z.string().uuid().optional(),
  reason: text(4000),
  adjustmentMode: z.enum(adjustmentModes),
  operations: z.array(adjustmentOperationSchema).min(1).max(100),
});

export const confirmLearningPlanSchema = z.strictObject({
  planId: z.string().uuid(),
  expectedPlanVersion: z.number().int().positive(),
  keepUnfinishedTasks: z.boolean().optional().default(true),
});

export type AvailableSlot = z.infer<typeof availableSlotSchema>;
export type CreateLearningPlanInput = z.infer<typeof createLearningPlanSchema>;
export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusSchema>;
export type RecordLearningFeedbackInput = z.infer<typeof recordLearningFeedbackSchema>;
export type AdjustLearningPlanInput = z.infer<typeof adjustLearningPlanSchema>;
export type ConfirmLearningPlanInput = z.infer<typeof confirmLearningPlanSchema>;
export type AdjustmentOperation = z.infer<typeof adjustmentOperationSchema>;

export type CreateLearningPlanCommand = DomainCommand<CreateLearningPlanInput>;
export type UpdateTaskStatusCommand = DomainCommand<UpdateTaskStatusInput>;
export type RecordLearningFeedbackCommand = DomainCommand<RecordLearningFeedbackInput>;
export type AdjustLearningPlanCommand = DomainCommand<AdjustLearningPlanInput>;
export type ConfirmLearningPlanCommand = DomainCommand<ConfirmLearningPlanInput>;

export type LearningScheduleDTO = {
  id: string;
  taskId: string;
  scheduleDate: string;
  startAt?: string;
  endAt?: string;
  durationMinutes: number;
  status: ScheduleStatus;
};

export type LearningTaskDTO = {
  taskId: string;
  planId: string;
  stageId: string;
  parentTaskId?: string;
  title: string;
  description: string;
  taskType: TaskType;
  status: TaskStatus;
  priority: number;
  estimatedMinutes: number;
  actualMinutes: number;
  capabilityKey?: string;
  evidenceRequired: boolean;
  schedules: LearningScheduleDTO[];
  createdAt: string;
  updatedAt: string;
};

export type LearningStageDTO = {
  stageId: string;
  planId: string;
  stageOrder: number;
  title: string;
  objective: string;
  startDate?: string;
  endDate?: string;
  status: string;
  assessmentRequired: boolean;
  assessmentId?: string;
  progressPercent: number;
  tasks?: LearningTaskDTO[];
};

export type LearningPlanDTO = {
  planId: string;
  ownerId?: string;
  mode: PlanMode;
  status: PlanStatus;
  sourceProfileVersion: number;
  sourceCareerPlanVersion?: number;
  targetJobId?: string;
  startDate: string;
  endDate: string;
  weeklyMinutes: number;
  version: number;
  stages: LearningStageDTO[];
  learningGoals?: string[];
  createdAt: string;
  updatedAt: string;
};

export type LearningFeedbackDTO = {
  feedbackId: string;
  planId: string;
  taskId?: string;
  difficulty: "too_easy" | "appropriate" | "too_hard";
  reason?: (typeof feedbackReasons)[number];
  actualMinutes?: number;
  availableMinutes?: number;
  confidenceScore?: number;
  note?: string;
  createdAt: string;
};

export type LearningProgressDTO = {
  planId: string;
  planVersion: number;
  totalTasks: number;
  completedTasks: number;
  progressPercent: number;
  currentStageId?: string;
  currentStageProgressPercent?: number;
};

export type LearningTaskContext = {
  taskId: string;
  planId: string;
  stageId: string;
  title: string;
  capabilityKey?: string;
  evidenceRequired: boolean;
};

export type LearningStageContext = {
  stageId: string;
  planId: string;
  title: string;
  objective: string;
  stageOrder: number;
};

export type LearningCapabilityResult<T> = CapabilityResult<T> & { domain: "learning"; data?: T };

export class LearningError extends Error {
  readonly code: NonNullable<CapabilityResult["error"]>["code"];
  readonly retryable: boolean;
  readonly fields?: string[];
  constructor(code: NonNullable<CapabilityResult["error"]>["code"], message: string, retryable = false, fields?: string[]) {
    super(message);
    this.name = "LearningError";
    this.code = code;
    this.retryable = retryable;
    this.fields = fields;
  }
}

export interface LearningApplication {
  getActivePlan(ctx: ModuleContext, input: { includeTasks?: boolean }): Promise<LearningPlanDTO | null>;
  getTodayTasks(ctx: ModuleContext, input: { date?: string }): Promise<LearningTaskDTO[]>;
  getLearningProgress(ctx: ModuleContext, input: { planId?: string }): Promise<LearningProgressDTO>;
  getPlanProgress(ctx: ModuleContext, input: { planId?: string }): Promise<LearningProgressDTO>;
  createLearningPlan(command: CreateLearningPlanCommand): Promise<LearningCapabilityResult<LearningPlanDTO>>;
  updateTaskStatus(command: UpdateTaskStatusCommand): Promise<LearningCapabilityResult<LearningTaskDTO>>;
  recordLearningFeedback(command: RecordLearningFeedbackCommand): Promise<LearningCapabilityResult<LearningFeedbackDTO>>;
  adjustLearningPlan(command: AdjustLearningPlanCommand): Promise<LearningCapabilityResult<LearningPlanDTO>>;
  confirmLearningPlan(command: ConfirmLearningPlanCommand): Promise<LearningCapabilityResult<LearningPlanDTO>>;
  getTaskContext(ctx: ModuleContext, input: { taskId: string }): Promise<LearningTaskContext | null>;
  getStageContext(ctx: ModuleContext, input: { stageId: string }): Promise<LearningStageContext | null>;
  getCompletedCapabilityKeys(ctx: ModuleContext, input: { planId?: string }): Promise<string[]>;
}
