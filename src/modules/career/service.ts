import {
  CareerError,
  type CareerActionDTO,
  type CareerApplication,
  type CareerDashboardDTO,
  type CareerPlanDTO,
  type CapabilityResult,
  type CompareTargetJobsInput,
  type ConfirmCareerPlanInput,
  type CreateCareerPlanDraftInput,
  type DomainCommand,
  type EvidenceQuery,
  type GetCareerDashboardInput,
  type GetCareerPlanInput,
  type GetTargetJobsInput,
  type IndustryTrendDTO,
  type JobGapAnalysisDTO,
  type ListJobCatalogInput,
  type ModuleContext,
  type PaginatedResult,
  type ProfileQuery,
  type SaveTargetJobInput,
  type SelectTargetJobInput,
  type TargetCompanyDTO,
  type TargetJobDTO,
  type JobComparisonDTO,
} from "./contracts.ts";
import type { CareerRepository } from "./repository.ts";

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const clone = <T>(value: T): T => structuredClone(value);

const result = (
  data: Omit<CapabilityResult, "ok" | "changed" | "domain"> & Partial<Pick<CapabilityResult, "changed">>,
): CapabilityResult => ({ ok: true, changed: data.changed ?? true, domain: "career", ...data });

export type CareerServiceDependencies = {
  repository: CareerRepository;
  profileQuery?: ProfileQuery;
  evidenceQuery?: EvidenceQuery;
  trends?: IndustryTrendDTO[];
  companies?: TargetCompanyDTO[];
};

export class MockCareerService implements CareerApplication {
  private readonly deps: CareerServiceDependencies;

  constructor(deps: CareerServiceDependencies) {
    this.deps = deps;
  }

  async getCareerPlan(ctx: ModuleContext, input: GetCareerPlanInput): Promise<CareerPlanDTO | null> {
    const plan = await this.deps.repository.getPlan(ctx.ownerId);
    if (!plan || (input.status && plan.status !== input.status)) return null;
    if (input.includeGapAnalysis && plan.targetJobId) {
      plan.latestGapAnalysis = await this.deps.repository.getLatestGapAnalysis(ctx.ownerId, plan.targetJobId) ?? undefined;
    } else {
      delete plan.latestGapAnalysis;
    }
    return plan;
  }

  async createCareerPlanDraft(command: DomainCommand<CreateCareerPlanDraftInput>): Promise<CapabilityResult> {
    const ctx = command.context;
    const replay = await this.replay(ctx.ownerId, command.idempotencyKey);
    if (replay) return replay;
    const existing = await this.deps.repository.getPlan(ctx.ownerId);
    const profile = this.deps.profileQuery ? await this.deps.profileQuery.getProfileSnapshot(ctx) : null;
    if (!profile && this.deps.profileQuery) throw new CareerError("DEPENDENCY_UNAVAILABLE", "Profile snapshot is unavailable");
    const directionCodes = [...new Set(command.payload.directionCodes ?? profile?.directionHints ?? ["backend_engineering"])].slice(0, 3);
    const plan: CareerPlanDTO = {
      id: id("plan"), ownerId: ctx.ownerId, version: 1, status: "draft",
      directions: directionCodes.map((code, index) => ({
        code, name: directionName(code), summary: `${directionName(code)} 的阶段性探索方向`,
        fitReasons: profile?.interests.length ? [`与当前兴趣「${profile.interests[0]}」相关`] : ["待结合画像进一步验证"],
        entryBarriers: ["需要补充可验证的项目证据"], trialAction: "完成一个小型实践并复盘", fitScore: Math.max(60, 82 - index * 8),
      })),
      primaryDirectionCode: directionCodes[0], targetJobId: command.payload.targetJobId,
      targetCompanyName: command.payload.targetCompanyName, targetCity: command.payload.targetCity,
      targetSalaryText: command.payload.targetSalaryText,
      rationale: command.payload.userNotes || "基于画像兴趣和当前能力，先通过小步实践验证方向。",
      milestones: [
        { id: id("milestone"), title: "完成方向验证", description: "完成一个可展示的小项目", skillCodes: [directionCodes[0]], expectedEvidence: ["项目仓库", "项目复盘"], order: 1 },
        { id: id("milestone"), title: "形成岗位证据", description: "将项目成果整理为岗位相关证据", skillCodes: [directionCodes[0]], expectedEvidence: ["作品说明", "面试复盘"], order: 2 },
      ], createdAt: now(), updatedAt: now(),
    };
    if (existing && existing.ownerId === ctx.ownerId) plan.version = existing.version + 1;
    await this.deps.repository.savePlan(plan);
    const response = result({ entityId: plan.id, version: plan.version, status: "draft_created", summary: "职业规划草稿已创建", data: plan });
    await this.remember(ctx.ownerId, command.idempotencyKey, response);
    return response;
  }

  async getTargetJobs(ctx: ModuleContext, input: GetTargetJobsInput): Promise<PaginatedResult<TargetJobDTO>> {
    return this.filterJobs(await this.deps.repository.listJobs(ctx.ownerId), input);
  }

  async listJobCatalog(ctx: ModuleContext, input: ListJobCatalogInput): Promise<PaginatedResult<TargetJobDTO>> {
    return this.filterJobs(await this.deps.repository.listJobs(ctx.ownerId), input);
  }

  async saveTargetJob(command: DomainCommand<SaveTargetJobInput>): Promise<CapabilityResult> {
    const ctx = command.context;
    const replay = await this.replay(ctx.ownerId, command.idempotencyKey);
    if (replay) return replay;
    if (command.payload.title.trim().length === 0 || command.payload.description.trim().length < 20) throw new CareerError("INVALID_ARGUMENT", "岗位标题和至少 20 字的 JD 描述不能为空");
    const job: TargetJobDTO = {
      ...command.payload, id: id("job"), ownerId: ctx.ownerId, source: command.payload.source ?? "manual",
      requirements: [], createdAt: now(), updatedAt: now(),
    };
    await this.deps.repository.saveJob(job);
    const response = result({ entityId: job.id, status: "applied", summary: "目标岗位已保存", data: job });
    await this.remember(ctx.ownerId, command.idempotencyKey, response);
    return response;
  }

  async selectTargetJob(command: DomainCommand<SelectTargetJobInput>): Promise<CapabilityResult> {
    const ctx = command.context;
    const replay = await this.replay(ctx.ownerId, command.idempotencyKey);
    if (replay) return replay;
    const plan = await this.deps.repository.getPlan(ctx.ownerId, command.payload.planId);
    if (!plan) throw new CareerError("NOT_FOUND", "职业规划不存在");
    this.assertVersion(plan, command.payload.expectedVersion);
    const job = await this.deps.repository.getJob(ctx.ownerId, command.payload.jobId);
    if (!job) throw new CareerError("NOT_FOUND", "目标岗位不存在");
    plan.targetJobId = job.id; plan.version += 1; plan.updatedAt = now();
    await this.deps.repository.savePlan(plan);
    const response = result({ entityId: plan.id, version: plan.version, status: "applied", summary: "目标岗位已设为当前岗位", data: plan });
    await this.remember(ctx.ownerId, command.idempotencyKey, response);
    return response;
  }

  async confirmCareerPlan(command: DomainCommand<ConfirmCareerPlanInput>): Promise<CapabilityResult> {
    const ctx = command.context;
    const replay = await this.replay(ctx.ownerId, command.idempotencyKey);
    if (replay) return replay;
    const plan = await this.deps.repository.getPlan(ctx.ownerId, command.payload.planId);
    if (!plan) throw new CareerError("NOT_FOUND", "职业规划不存在");
    this.assertVersion(plan, command.payload.expectedVersion);
    if (plan.status !== "draft") throw new CareerError("INVALID_STATE", "只有草稿状态的规划可以确认");
    plan.status = "confirmed"; plan.version += 1; plan.updatedAt = now();
    await this.deps.repository.savePlan(plan);
    const response = result({ entityId: plan.id, version: plan.version, status: "applied", summary: "职业规划已确认", data: plan });
    await this.remember(ctx.ownerId, command.idempotencyKey, response);
    return response;
  }

  async analyzeJobGap(command: DomainCommand<{ jobId: string; planId?: string; includeUnknown?: boolean }>): Promise<CapabilityResult> {
    const ctx = command.context;
    const replay = await this.replay(ctx.ownerId, command.idempotencyKey);
    if (replay) return replay;
    const job = await this.deps.repository.getJob(ctx.ownerId, command.payload.jobId);
    if (!job) throw new CareerError("NOT_FOUND", "目标岗位不存在");
    if (!this.deps.evidenceQuery) throw new CareerError("DEPENDENCY_UNAVAILABLE", "Evidence snapshot is unavailable");
    const snapshots = await this.deps.evidenceQuery.getSkillEvidenceSnapshot(ctx, { skillCodes: job.requirements.map((item) => item.skillCode) });
    const evidenceBySkill = new Map(snapshots.map((item) => [item.skillCode, item]));
    const groups: Record<"possessed" | "partial" | "missing" | "unknown", JobGapAnalysisDTO["possessed"]> = { possessed: [], partial: [], missing: [], unknown: [] };
    for (const requirement of job.requirements) {
      const evidence = evidenceBySkill.get(requirement.skillCode);
      const status: "possessed" | "partial" | "missing" | "unknown" = evidence ? evidence.evidenceCount === 0 ? "missing" : (evidence.level ?? 0) >= (requirement.expectedLevel ?? 3) ? "possessed" : "partial" : "unknown";
      const item = { requirement, status, currentLevel: evidence?.level, evidenceIds: evidence?.evidenceIds ?? [], reason: reasonFor(status, requirement.skillName) };
      groups[status].push(item);
    }
    if (command.payload.includeUnknown === false) groups.unknown = [];
    const total = job.requirements.length || 1;
    const score = Math.round(((groups.possessed.length + groups.partial.length * 0.5) / total) * 100);
    const recommendedActions: CareerActionDTO[] = [...groups.missing, ...groups.partial, ...groups.unknown].slice(0, 3).map((item, index) => ({
      id: id("action"), title: `${item.requirement.skillName} 能力补齐`, description: `围绕「${item.requirement.skillName}」完成一次可验证实践，并补充证据。`, type: item.status === "unknown" ? "clarify_requirement" : "learn_skill", priority: index === 0 ? "high" : "medium", skillCodes: [item.requirement.skillCode], estimatedHours: 8 + index * 4,
    }));
    const analysis: JobGapAnalysisDTO = { id: id("gap"), ownerId: ctx.ownerId, jobId: job.id, planId: command.payload.planId, matchScore: score, ...groups, recommendedActions, evidenceSnapshotAt: now(), createdAt: now() };
    await this.deps.repository.saveGapAnalysis(analysis);
    const response = result({ entityId: analysis.id, status: "applied", summary: "岗位差距分析已完成", data: analysis });
    await this.remember(ctx.ownerId, command.idempotencyKey, response);
    return response;
  }

  async getLatestJobGapAnalysis(ctx: ModuleContext, input: { jobId: string }): Promise<JobGapAnalysisDTO | null> {
    const job = await this.deps.repository.getJob(ctx.ownerId, input.jobId);
    if (!job) return null;
    return this.deps.repository.getLatestGapAnalysis(ctx.ownerId, input.jobId);
  }

  async getCareerDashboard(ctx: ModuleContext, input: GetCareerDashboardInput): Promise<CareerDashboardDTO> {
    const plan = await this.getCareerPlan(ctx, { includeGapAnalysis: true });
    const activeJob = plan?.targetJobId ? await this.deps.repository.getJob(ctx.ownerId, plan.targetJobId) : null;
    const activeGapAnalysis = activeJob ? await this.getLatestJobGapAnalysis(ctx, { jobId: activeJob.id }) : null;
    const actions = activeGapAnalysis?.recommendedActions ?? [];
    return { activePlan: plan, activeJob, activeGapAnalysis, trends: (this.deps.trends ?? []).filter((trend) => trend.periodDays === (input.trendPeriodDays ?? 90)), targetCompanies: input.includeCompanies === false ? [] : clone(this.deps.companies ?? []), recommendedActions: actions.map((action) => ({ ...action, learningPlanStatus: "not_linked" as const })), refreshedAt: now() };
  }

  async compareTargetJobs(ctx: ModuleContext, input: CompareTargetJobsInput): Promise<JobComparisonDTO> {
    const left = await this.deps.repository.getJob(ctx.ownerId, input.leftJobId);
    const right = await this.deps.repository.getJob(ctx.ownerId, input.rightJobId);
    if (!left || !right) throw new CareerError("NOT_FOUND", "待比较岗位不存在");
    const leftSkills = left.requirements.map((item) => item.skillCode);
    const rightSkills = right.requirements.map((item) => item.skillCode);
    return { left, right, sharedSkills: leftSkills.filter((skill) => rightSkills.includes(skill)), leftOnlySkills: leftSkills.filter((skill) => !rightSkills.includes(skill)), rightOnlySkills: rightSkills.filter((skill) => !leftSkills.includes(skill)) };
  }

  private async filterJobs(jobs: TargetJobDTO[], input: GetTargetJobsInput): Promise<PaginatedResult<TargetJobDTO>> {
    const keyword = input.keyword?.trim().toLowerCase();
    const filtered = jobs.filter((job) => (!input.directionCode || job.directionCode === input.directionCode) && (!keyword || `${job.title} ${job.companyName ?? ""}`.toLowerCase().includes(keyword)));
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
    return { items: filtered.slice(0, limit), ...(filtered.length > limit ? { nextCursor: String(limit) } : {}) };
  }

  private assertVersion(plan: CareerPlanDTO, expectedVersion?: number) {
    if (expectedVersion === undefined || expectedVersion !== plan.version) throw new CareerError("VERSION_CONFLICT", `规划版本已变更，当前版本为 ${plan.version}`);
  }

  private async replay(ownerId: string, key: string): Promise<CapabilityResult | null> {
    if (!key.trim()) throw new CareerError("INVALID_ARGUMENT", "写操作必须提供幂等键");
    return (await this.deps.repository.getIdempotentResult(ownerId, key)) as CapabilityResult | null;
  }

  private remember(ownerId: string, key: string, response: CapabilityResult) { return this.deps.repository.saveIdempotentResult(ownerId, key, response); }
}

const directionName = (code: string) => ({ backend_engineering: "后端工程", data_platform: "数据平台", frontend_engineering: "前端工程" }[code] ?? code);
const reasonFor = (status: string, skillName: string) => ({ possessed: `已有证据支持 ${skillName} 达到岗位要求`, partial: `${skillName} 已有基础，但证据或熟练度仍需补强`, missing: `暂未找到 ${skillName} 的能力证据`, unknown: `当前没有足够证据判断 ${skillName}` }[status] ?? "待确认");
