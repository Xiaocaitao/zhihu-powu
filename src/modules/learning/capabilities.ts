import { ZodError, z } from "zod";
import type { CapabilityContext, CapabilityResult, DomainCapability } from "../../contracts/capability.ts";
import { adjustLearningPlanSchema, confirmLearningPlanSchema, createLearningPlanSchema, getActivePlanSchema, getLearningProgressSchema, getTodayTasksSchema, recordLearningFeedbackSchema, updateTaskStatusSchema, type LearningApplication, LearningError } from "./contracts.ts";

const command = <T extends z.ZodRawShape>(payload: T, versionRequired = false) => z.strictObject({ ...payload, expectedVersion: versionRequired ? z.number().int().positive() : z.number().int().positive().optional() });
export const learningCapabilitySchemas = {
  get_active_learning_plan: getActivePlanSchema,
  get_today_learning_tasks: getTodayTasksSchema,
  get_learning_progress: getLearningProgressSchema,
  create_learning_plan: command(createLearningPlanSchema.shape),
  update_learning_task: command(updateTaskStatusSchema.shape, true),
  record_learning_feedback: command(recordLearningFeedbackSchema.shape, true),
  adjust_learning_plan: command(adjustLearningPlanSchema.shape, true),
  confirm_learning_plan: command(confirmLearningPlanSchema.shape),
};

export function createLearningCapabilities(service: LearningApplication): DomainCapability[] {
  return [
    {
      name: "get_active_learning_plan",
      description: "获取当前用户的有效学习计划、阶段和任务",
      inputSchema: learningCapabilitySchemas.get_active_learning_plan,
      execute: async (ctx, input) => readResult(() => service.getActivePlan(ctx, getActivePlanSchema.parse(input as unknown)))
    },
    {
      name: "get_today_learning_tasks",
      description: "获取当前用户指定日期的学习任务",
      inputSchema: learningCapabilitySchemas.get_today_learning_tasks,
      execute: async (ctx, input) => readResult(() => service.getTodayTasks(ctx, getTodayTasksSchema.parse(input as unknown)))
    },
    {
      name: "get_learning_progress",
      description: "获取当前用户学习计划和阶段完成进度",
      inputSchema: learningCapabilitySchemas.get_learning_progress,
      execute: async (ctx, input) => readResult(() => service.getLearningProgress(ctx, getLearningProgressSchema.parse(input as unknown)))
    },
    commandCapability(service, "create_learning_plan", "保存 Agent 生成的学习计划草案或正式计划", createLearningPlanSchema, false, (service, ctx, payload, expectedVersion) => service.createLearningPlan({ context: ctx, payload, expectedVersion, idempotencyKey: ctx.requestId })),
    commandCapability(service, "update_learning_task", "更新当前用户学习任务的状态和实际用时", updateTaskStatusSchema, true, (service, ctx, payload, expectedVersion) => service.updateTaskStatus({ context: ctx, payload, expectedVersion, idempotencyKey: ctx.requestId })),
    commandCapability(service, "record_learning_feedback", "记录当前用户对学习任务的难度和执行反馈", recordLearningFeedbackSchema, true, (service, ctx, payload, expectedVersion) => service.recordLearningFeedback({ context: ctx, payload, expectedVersion, idempotencyKey: ctx.requestId })),
    commandCapability(service, "adjust_learning_plan", "按结构化操作调整当前用户的学习计划", adjustLearningPlanSchema, true, (service, ctx, payload, expectedVersion) => service.adjustLearningPlan({ context: ctx, payload, expectedVersion, idempotencyKey: ctx.requestId })),
    {
      ...commandCapability(service, "confirm_learning_plan", "确认当前用户的试验学习计划并激活正式计划", confirmLearningPlanSchema, false, (service, ctx, payload, expectedVersion) => service.confirmLearningPlan({ context: ctx, payload, expectedVersion: expectedVersion ?? payload.expectedPlanVersion, idempotencyKey: ctx.requestId })),
      requiresConfirmation: true,
    },
  ];
}

function commandCapability<T extends z.ZodTypeAny>(service: LearningApplication, name: string, description: string, schema: T, versionRequired: boolean, executeCommand: (service: LearningApplication, ctx: CapabilityContext, payload: z.infer<T>, expectedVersion?: number) => Promise<CapabilityResult>): DomainCapability {
  const inputSchema = command(schema instanceof z.ZodObject ? schema.shape : {}, versionRequired);
  return { name, description, inputSchema, execute: async (ctx, input) => { try { const parsed = inputSchema.parse(input) as z.infer<T> & { expectedVersion?: number }; const { expectedVersion, ...payload } = parsed; return await executeCommand(service, ctx, payload as z.infer<T>, expectedVersion); } catch (error) { return errorResult(error); } } };
}

async function readResult<T>(read: () => Promise<T>): Promise<CapabilityResult<T>> {
  try { return { ok: true, changed: false, domain: "learning", status: "read", summary: "学习数据查询完成", data: await read() }; }
  catch (error) { return errorResult(error) as CapabilityResult<T>; }
}

function errorResult(error: unknown): CapabilityResult {
  if (error instanceof ZodError) return { ok: false, changed: false, domain: "learning", status: "rejected", summary: "学习计划请求参数无效", error: { code: "INVALID_ARGUMENT", message: error.message, retryable: false } };
  const failure = error instanceof LearningError ? error : new LearningError("INVALID_ARGUMENT", error instanceof Error ? error.message : "学习计划操作失败");
  return { ok: false, changed: false, domain: "learning", status: "rejected", summary: failure.message, error: { code: failure.code, message: failure.message, retryable: failure.retryable, fields: failure.fields } };
}
