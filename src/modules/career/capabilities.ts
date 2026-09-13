import type {
  AnalyzeJobGapInput,
  CapabilityContext,
  ConfirmCareerPlanInput,
  CreateCareerPlanDraftInput,
  DomainCommand,
  SaveTargetJobInput,
  SelectTargetJobInput,
} from "./contracts.ts";
import type { CareerApplication, CapabilityResult } from "./contracts.ts";

export type CareerCapability = {
  name: string;
  description: string;
  execute: (input: unknown, commandContext: CapabilityContext) => Promise<CapabilityResult | unknown>;
};

const command = <T>(input: T, context: CapabilityContext, idempotencyKey: string): DomainCommand<T> => ({ context, payload: input, idempotencyKey });

export const createCareerCapabilities = (service: CareerApplication): CareerCapability[] => [
  { name: "get_career_plan", description: "读取当前职业规划", execute: (input, ctx) => service.getCareerPlan(ctx, input as never) },
  { name: "create_career_plan_draft", description: "创建职业规划草稿", execute: (input, ctx) => service.createCareerPlanDraft(command(input as CreateCareerPlanDraftInput, ctx, `career-plan-${ctx.requestId}`)) },
  { name: "get_target_jobs", description: "读取已保存岗位", execute: (input, ctx) => service.getTargetJobs(ctx, input as never) },
  { name: "analyze_job_gap", description: "分析岗位能力差距", execute: (input, ctx) => service.analyzeJobGap(command(input as AnalyzeJobGapInput, ctx, `career-gap-${ctx.requestId}`)) },
  { name: "confirm_career_plan", description: "确认职业规划", execute: (input, ctx) => service.confirmCareerPlan(command(input as ConfirmCareerPlanInput, ctx, `career-confirm-${ctx.requestId}`)) },
  { name: "get_career_dashboard", description: "读取职业成长页聚合数据", execute: (input, ctx) => service.getCareerDashboard(ctx, input as never) },
  { name: "list_job_catalog", description: "查询岗位目录", execute: (input, ctx) => service.listJobCatalog(ctx, input as never) },
  { name: "save_target_job", description: "保存用户提供的岗位信息", execute: (input, ctx) => service.saveTargetJob(command(input as SaveTargetJobInput, ctx, `career-save-job-${ctx.requestId}`)) },
  { name: "select_target_job", description: "设置当前目标岗位", execute: (input, ctx) => service.selectTargetJob(command(input as SelectTargetJobInput, ctx, `career-select-job-${ctx.requestId}`)) },
  { name: "compare_target_jobs", description: "比较两个岗位", execute: (input, ctx) => service.compareTargetJobs(ctx, input as never) },
];
