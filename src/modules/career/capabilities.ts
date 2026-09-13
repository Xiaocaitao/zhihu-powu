import type { CapabilityContext, DomainCapability, DomainCommand } from "../../contracts/capability.ts";
import { analyzeJobGapSchema, confirmCareerPlanSchema, createCareerPlanDraftSchema, getCareerPlanSchema, getTargetJobsSchema, saveTargetJobSchema, selectTargetJobSchema } from "./contracts.ts";
import type { CareerApplication } from "./types.ts";
const command = <T>(ctx: CapabilityContext, payload: T): DomainCommand<T> => ({ context: ctx, payload, idempotencyKey: ctx.operationKey });
const read = <T>(data: T, summary: string) => ({ ok: true, changed: false, domain: "career" as const, status: "read" as const, summary, data });
export function createCareerCapabilities(service: CareerApplication): DomainCapability[] {
  return [
    { name: "get_career_plan", description: "读取当前用户职业规划。", inputSchema: getCareerPlanSchema, execute: async (ctx, input) => read(await service.getCareerPlan(ctx, getCareerPlanSchema.parse(input)), "已读取职业规划") },
    { name: "create_career_plan_draft", description: "保存用户明确要求创建的职业规划草稿。", inputSchema: createCareerPlanDraftSchema, execute: (ctx, input) => service.createCareerPlanDraft(command(ctx, createCareerPlanDraftSchema.parse(input))) },
    { name: "get_target_jobs", description: "读取当前用户保存的目标岗位。", inputSchema: getTargetJobsSchema, execute: async (ctx, input) => read(await service.getTargetJobs(ctx, getTargetJobsSchema.parse(input)), "已读取目标岗位") },
    { name: "save_target_job", description: "保存用户提供的原始岗位 JD，不自动改变当前目标。", inputSchema: saveTargetJobSchema, execute: (ctx, input) => service.saveTargetJob(command(ctx, saveTargetJobSchema.parse(input))) },
    { name: "select_target_job", description: "在用户明确选择后设置当前目标岗位。", inputSchema: selectTargetJobSchema, execute: (ctx, input) => service.selectTargetJob(command(ctx, selectTargetJobSchema.parse(input))), requiresConfirmation: true },
    { name: "analyze_job_gap", description: "保存岗位差距分析快照；证据不足时返回待验证项。", inputSchema: analyzeJobGapSchema, execute: (ctx, input) => service.analyzeJobGap(command(ctx, analyzeJobGapSchema.parse(input))) },
    { name: "confirm_career_plan", description: "在用户明确确认后激活职业规划。", inputSchema: confirmCareerPlanSchema, execute: (ctx, input) => service.confirmCareerPlan(command(ctx, confirmCareerPlanSchema.parse(input))), requiresConfirmation: true },
    { name: "get_career_dashboard", description: "读取职业规划页所需的聚合上下文。", inputSchema: { type: "object", additionalProperties: false }, execute: async ctx => read(await service.getCareerDashboard(ctx), "已读取职业规划聚合上下文") },
    { name: "compare_target_jobs", description: "比较两个当前用户可访问的岗位。", inputSchema: { type: "object", required: ["leftJobId", "rightJobId"], additionalProperties: false }, execute: (ctx, input) => service.compareTargetJobs(ctx, input as { leftJobId: string; rightJobId: string }) },
  ];
}
