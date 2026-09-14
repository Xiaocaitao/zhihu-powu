import { z } from "zod";
import type { CapabilityErrorCode } from "../../contracts/capability.ts";

export type PlanMode = "trial" | "final";
export type PlanStatus = "draft" | "active" | "paused" | "completed" | "archived";
export type TaskStatus = "todo" | "in_progress" | "completed" | "paused";
export type TaskType = "reading" | "practice" | "project" | "review";
export type ScheduleStatus = "scheduled" | "done" | "missed" | "rescheduled";
export type FeedbackDifficulty = "too_easy" | "appropriate" | "too_hard";
export type FeedbackReason = "missing_prerequisite" | "unclear_first_step" | "cannot_apply" | "too_much_content" | "insufficient_time" | "lack_of_feedback" | "other";
export type AdjustmentTrigger = "user_feedback" | "time_change" | "task_delay" | "assessment_result" | "goal_change";
export type AdjustmentMode = "reduce_scope" | "split_task" | "change_order" | "reschedule" | "add_prerequisite" | "replace_resource";

export type AvailableSlot = { weekday: number; startTime: string; endTime: string };
export type LearningTaskSchedule = { id: string; taskId: string; scheduleDate: string; startAt?: string; endAt?: string; durationMinutes: number; status: ScheduleStatus };
export type LearningTask = { id: string; planId: string; stageId: string; parentTaskId?: string; title: string; description: string; taskType: TaskType; status: TaskStatus; priority: number; estimatedMinutes: number; actualMinutes: number | null; capabilityKey?: string; evidenceRequired: boolean; scheduleDate?: string; schedules?: LearningTaskSchedule[]; updatedAt?: string };
export type LearningStage = { id: string; planId: string; order: number; title: string; objective: string; status: "todo" | "in_progress" | "completed"; startDate?: string; endDate?: string; assessmentRequired?: boolean; assessmentId?: string; progressPercent?: number; tasks: LearningTask[] };
export type LearningSource = { title: string; author?: string; url: string; query?: string };
export type LearningPlan = { id: string; ownerId: string; mode: PlanMode; status: PlanStatus; sourceProfileVersion: number; sourceCareerPlanVersion?: number; targetJobId?: string; startDate: string; endDate: string; weeklyMinutes: number; version: number; learningGoals: string[]; availableSlots?: AvailableSlot[]; sources?: LearningSource[]; stages: LearningStage[]; updatedAt: string };
export type LearningFeedback = { id: string; ownerId: string; planId: string; taskId?: string; difficulty: FeedbackDifficulty; reason?: FeedbackReason; actualMinutes?: number; availableMinutes?: number; confidenceScore?: number; note?: string; createdAt: string };
export type LearningProgress = { planId: string; planVersion: number; totalTasks: number; completedTasks: number; progressPercent: number; currentStageId?: string; currentStageProgressPercent?: number };
export type LearningPlanDTO = LearningPlan;
export type LearningTaskDTO = LearningTask;
export type LearningFeedbackDTO = LearningFeedback;
export type LearningProgressDTO = LearningProgress;
export type LearningTaskContext = { taskId: string; planId: string; stageId: string; title: string; capabilityKey?: string; evidenceRequired: boolean };
export type LearningStageContext = { stageId: string; planId: string; title: string; objective: string; stageOrder: number };
export type AdjustmentOperation =
  | { type: "split_task"; taskId: string; newTasks: Array<{ title: string; description?: string; taskType?: TaskType; estimatedMinutes: number }> }
  | { type: "reschedule"; taskId: string; scheduleDate: string }
  | { type: "change_order"; taskIds: string[] }
  | { type: "replace_resource"; taskId: string; resource: string };
export type LearningAdjustment = { id: string; ownerId: string; planId: string; fromVersion: number; toVersion: number; trigger: AdjustmentTrigger; reason: string; changeSummary: unknown; createdAt: string };
export type LearningResult<T = unknown> = { ok: boolean; changed: boolean; domain: "learning"; entityId?: string; version?: number; status: "read" | "applied" | "draft_created" | "confirmation_required" | "rejected"; summary: string; data?: T; error?: { code: CapabilityErrorCode; message: string; retryable: boolean; fields?: string[] } };
export type LearningContext = { ownerId: string; requestId?: string; operationKey?: string };
export type CreatePlanInput = { mode: PlanMode; sourceProfileVersion: number; sourceCareerPlanVersion?: number; targetJobId?: string; startDate: string; endDate: string; weeklyMinutes: number; availableSlots?: AvailableSlot[]; learningGoals: string[]; sources?: LearningSource[]; stages: Array<{ title: string; objective: string; tasks: Array<{ title: string; description: string; taskType: TaskType; estimatedMinutes: number; capabilityKey?: string; evidenceRequired?: boolean }> }> };
export type UpdateTaskInput = { taskId: string; status: TaskStatus; actualMinutes?: number; note?: string };
export type FeedbackInput = { planId: string; taskId?: string; difficulty: FeedbackDifficulty; reason?: FeedbackReason; actualMinutes?: number; availableMinutes?: number; confidenceScore?: number; note?: string };
export type AdjustPlanInput = { planId: string; trigger: AdjustmentTrigger; assessmentId?: string; reason: string; adjustmentMode: AdjustmentMode; operations: AdjustmentOperation[] };

const dateRange = <T extends z.ZodTypeAny>(schema: T) => schema.superRefine((value, context) => {
  const input = value as { startDate?: string; endDate?: string };
  if (input.startDate && input.endDate && input.endDate < input.startDate) context.addIssue({ code: "custom", path: ["endDate"], message: "结束日期不能早于开始日期" });
});
const time = z.string().regex(/^([01]\\d|2[0-3]):[0-5]\\d$/, "时间必须使用 HH:mm 格式");
const slotSchema = z.object({ weekday: z.number().int().min(1).max(7), startTime: time, endTime: time }).superRefine((slot, context) => { if (slot.endTime <= slot.startTime) context.addIssue({ code: "custom", path: ["endTime"], message: "结束时间必须晚于开始时间" }); });
const taskInputSchema = z.object({ title: z.string().trim().min(1).max(160), description: z.string().trim().min(1).max(4000), taskType: z.enum(["reading", "practice", "project", "review"]), estimatedMinutes: z.number().int().min(1).max(1440), capabilityKey: z.string().trim().max(160).optional(), evidenceRequired: z.boolean().optional() }).strict();

export const createPlanSchema = dateRange(z.object({ mode: z.enum(["trial", "final"]), sourceProfileVersion: z.number().int().positive(), sourceCareerPlanVersion: z.number().int().positive().optional(), targetJobId: z.string().min(1).optional(), startDate: z.string().date(), endDate: z.string().date(), weeklyMinutes: z.number().int().min(1).max(10080), availableSlots: z.array(slotSchema).max(28).optional(), learningGoals: z.array(z.string().trim().min(1).max(300)).min(1).max(20), sources: z.array(z.object({ title: z.string().trim().min(1).max(300), author: z.string().trim().max(160).optional(), url: z.string().url(), query: z.string().trim().max(500).optional() }).strict()).max(20).optional(), stages: z.array(z.object({ title: z.string().trim().min(1).max(160), objective: z.string().trim().min(1).max(2000), tasks: z.array(taskInputSchema).min(1).max(100) }).strict()).min(1).max(30) }).strict());
export const updateTaskSchema = z.object({ taskId: z.string().min(1).max(128), status: z.enum(["todo", "in_progress", "completed", "paused"]), actualMinutes: z.number().int().min(0).max(1440).optional(), note: z.string().trim().max(1000).optional(), expectedVersion: z.number().int().positive().optional() }).strict();
export const feedbackSchema = z.object({ planId: z.string().min(1).max(128), taskId: z.string().min(1).max(128).optional(), difficulty: z.enum(["too_easy", "appropriate", "too_hard"]), reason: z.enum(["missing_prerequisite", "unclear_first_step", "cannot_apply", "too_much_content", "insufficient_time", "lack_of_feedback", "other"]).optional(), actualMinutes: z.number().int().min(0).max(1440).optional(), availableMinutes: z.number().int().min(0).max(1440).optional(), confidenceScore: z.number().int().min(0).max(100).optional(), note: z.string().trim().max(2000).optional(), expectedVersion: z.number().int().positive().optional() }).strict();
const splitOperation = z.object({ type: z.literal("split_task"), taskId: z.string().min(1), newTasks: z.array(z.object({ title: z.string().trim().min(1).max(160), description: z.string().trim().max(4000).optional(), taskType: z.enum(["reading", "practice", "project", "review"]).optional(), estimatedMinutes: z.number().int().min(1).max(1440) }).strict()).min(1).max(20) }).strict();
const rescheduleOperation = z.object({ type: z.literal("reschedule"), taskId: z.string().min(1), scheduleDate: z.string().date() }).strict();
const orderOperation = z.object({ type: z.literal("change_order"), taskIds: z.array(z.string().min(1)).min(1).max(100) }).strict();
const resourceOperation = z.object({ type: z.literal("replace_resource"), taskId: z.string().min(1), resource: z.string().trim().min(1).max(4000) }).strict();
export const adjustPlanSchema = z.object({ planId: z.string().min(1).max(128), trigger: z.enum(["user_feedback", "time_change", "task_delay", "assessment_result", "goal_change"]), assessmentId: z.string().min(1).optional(), reason: z.string().trim().min(1).max(2000), adjustmentMode: z.enum(["reduce_scope", "split_task", "change_order", "reschedule", "add_prerequisite", "replace_resource"]), operations: z.array(z.discriminatedUnion("type", [splitOperation, rescheduleOperation, orderOperation, resourceOperation])).min(1).max(30), expectedVersion: z.number().int().positive().optional() }).strict();
export const confirmPlanSchema = z.object({ planId: z.string().min(1).max(128), expectedPlanVersion: z.number().int().positive(), keepUnfinishedTasks: z.boolean().optional() }).strict();
