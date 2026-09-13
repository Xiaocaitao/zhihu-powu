import type { CapabilityContext, DomainCapability, DomainCommand } from "../../contracts/capability.ts";
import { adjustPlanSchema, confirmPlanSchema, createPlanSchema, feedbackSchema, updateTaskSchema } from "./contracts.ts";
import type { LearningApplication } from "./types.ts";
const command = <T>(ctx: CapabilityContext, payload: T): DomainCommand<T> => ({ context: ctx, payload, idempotencyKey: ctx.operationKey });
export function createLearningCapabilities(service: LearningApplication): DomainCapability[] { return [
  { name: "get_active_learning_plan", description: "读取当前有效学习计划、阶段和任务。", inputSchema: { type: "object", properties: { includeTasks: { type: "boolean" } }, additionalProperties: false }, execute: (ctx, input) => service.getActivePlan(ctx, (input ?? {}) as { includeTasks?: boolean }) as Promise<any> },
  { name: "get_today_learning_tasks", description: "按日期读取当前用户学习任务。", inputSchema: { type: "object", properties: { date: { type: "string" } }, additionalProperties: false }, execute: (ctx, input) => service.getTodayTasks(ctx, (input ?? {}) as { date?: string }) as Promise<any> },
  { name: "get_learning_progress", description: "读取学习计划和阶段完成进度。", inputSchema: { type: "object", properties: { planId: { type: "string" } }, additionalProperties: false }, execute: (ctx, input) => service.getLearningProgress(ctx, (input ?? {}) as { planId?: string }) as Promise<any> },
  { name: "create_learning_plan", description: "保存 Agent 生成的结构化试验或正式学习计划。", inputSchema: createPlanSchema, execute: (ctx, input) => service.createLearningPlan(command(ctx, createPlanSchema.parse(input))) },
  { name: "update_learning_task", description: "更新当前用户学习任务状态和实际用时。", inputSchema: updateTaskSchema, execute: (ctx, input) => service.updateTaskStatus(command(ctx, updateTaskSchema.parse(input))) },
  { name: "record_learning_feedback", description: "记录用户对学习任务的难度、用时和困难反馈。", inputSchema: feedbackSchema, execute: (ctx, input) => service.recordLearningFeedback(command(ctx, feedbackSchema.parse(input))) },
  { name: "adjust_learning_plan", description: "按明确调整操作修改学习计划并保留版本。", inputSchema: adjustPlanSchema, execute: (ctx, input) => service.adjustLearningPlan(command(ctx, adjustPlanSchema.parse(input) as any)) },
  { name: "confirm_learning_plan", description: "在用户明确确认后激活试验学习计划。", inputSchema: confirmPlanSchema, execute: (ctx, input) => service.confirmLearningPlan(command(ctx, confirmPlanSchema.parse(input))), requiresConfirmation: true },
]; }
