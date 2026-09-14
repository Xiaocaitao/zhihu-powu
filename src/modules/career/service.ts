import { createHash, randomUUID } from "node:crypto";
import type { CapabilityErrorCode, DomainCommand } from "../../contracts/capability.ts";
import type { CareerApplication } from "./types.ts";
import type { CareerAction, CareerActionProgress, CareerCapabilityResult, CareerContext, CareerDashboard, CareerGapItem, CareerPlan, CreateCareerPlanDraftInput, EvidenceQuery, GetCareerPlanInput, GetTargetJobsInput, JobGapAnalysis, LearningProgressQuery, ListJobCatalogInput, ProfileQuery, SaveTargetJobInput, SelectTargetJobInput, TargetJob, AnalyzeJobGapInput, ConfirmCareerPlanInput, CompareTargetJobsInput, SkillEvidenceSnapshot, ListTargetCompaniesInput, SelectTargetCompanyInput, CompareTargetCompaniesInput, GetIndustryTrendsInput, TargetCompany, CompanyComparison, IndustryTrend, GetCareerDashboardInput } from "./contracts.ts";
import type { CareerRepository } from "./repository.ts";
import { emptyCareerJob } from "./repository.ts";

export class CareerService implements CareerApplication {
  private readonly repo: CareerRepository;
  private readonly profileQuery?: ProfileQuery;
  private readonly evidenceQuery?: EvidenceQuery;
  private readonly learningProgressQuery?: LearningProgressQuery;
  private readonly profileDependencyRequired: boolean;
  constructor(repo: CareerRepository, dependencies: { profileQuery?: ProfileQuery; evidenceQuery?: EvidenceQuery; learningProgressQuery?: LearningProgressQuery } = {}) {
    this.repo = repo;
    this.profileDependencyRequired = Object.keys(dependencies).length > 0 && !dependencies.profileQuery;
    this.profileQuery = dependencies.profileQuery;
    this.evidenceQuery = dependencies.evidenceQuery;
    this.learningProgressQuery = dependencies.learningProgressQuery;
  }

  async getCareerPlan(ctx: CareerContext, input: GetCareerPlanInput) {
    const plan = await this.repo.getPlan(ctx.ownerId, input.status);
    if (!plan || !input.includeGapAnalysis || !plan.targetJobId) return plan;
    const gap = await this.repo.getLatestGap(ctx.ownerId, plan.targetJobId);
    return gap ? { ...plan, latestGapAnalysis: gap } as CareerPlan : plan;
  }

  async createCareerPlanDraft(command: DomainCommand<CreateCareerPlanDraftInput>): Promise<CareerCapabilityResult> {
    return this.write(command, "create_career_plan_draft", async () => {
      const profile = await this.getProfile(command.context);
      if (!profile && this.profileDependencyRequired) return this.reject("Profile 画像不可用，无法创建职业规划", "DEPENDENCY_UNAVAILABLE");
      const profileForDraft = profile ?? { directionHints: [], interests: [], currentSkills: [] };
      const current = await this.repo.getPlan(command.context.ownerId, "draft");
      if (current) return this.result({ plan: current }, "已有职业规划草稿", false, current.id, current.version, "draft_created");
      if (command.payload.targetJobId && !(await this.repo.getJob(command.context.ownerId, command.payload.targetJobId))) return this.reject("目标岗位不存在", "NOT_FOUND");
      if (command.payload.targetCompanyId && !(await this.repo.getCompany(command.context.ownerId, command.payload.targetCompanyId))) return this.reject("目标企业不存在", "NOT_FOUND");
      const now = new Date().toISOString();
      const plan: CareerPlan = { id: randomUUID(), ownerId: command.context.ownerId, status: "draft", version: 1, directionCodes: command.payload.directionCodes ?? profileForDraft.directionHints.slice(0, 3), targetJobId: command.payload.targetJobId, targetCompanyId: command.payload.targetCompanyId, targetCompanyName: command.payload.targetCompanyName, targetCity: command.payload.targetCity, targetSalaryText: command.payload.targetSalaryText, rationale: command.payload.userNotes ?? profileForDraft.goalText, updatedAt: now };
      if (!await this.repo.savePlan(plan)) return this.reject("职业规划版本已变化", "VERSION_CONFLICT");
      return this.result({ plan }, "职业规划草稿已创建", true, plan.id, plan.version, "draft_created");
    });
  }

  async getTargetJobs(ctx: CareerContext, input: GetTargetJobsInput) { return { items: await this.repo.listJobs(ctx.ownerId, input), nextCursor: null }; }
  async listJobCatalog(ctx: CareerContext, input: ListJobCatalogInput) { return { items: await this.repo.listJobs(ctx.ownerId, input), nextCursor: null }; }
  async getTargetJob(ctx: CareerContext, input: { jobId: string }) { return this.repo.getJob(ctx.ownerId, input.jobId); }

  async saveTargetJob(command: DomainCommand<SaveTargetJobInput>): Promise<CareerCapabilityResult> {
    return this.write(command, "save_target_job", async () => {
      const job = emptyCareerJob(command.context, command.payload);
      await this.repo.saveJob(job);
      return this.result({ job }, "目标岗位已保存", true, job.id, undefined, "applied");
    });
  }

  async selectTargetJob(command: DomainCommand<SelectTargetJobInput>): Promise<CareerCapabilityResult> {
    return this.write(command, "select_target_job", async () => {
      const plan = await this.repo.getPlan(command.context.ownerId);
      const job = await this.repo.getJob(command.context.ownerId, command.payload.jobId);
      if (!plan || plan.id !== command.payload.planId) return this.reject("职业规划不存在", "NOT_FOUND");
      if (!job) return this.reject("岗位不存在", "NOT_FOUND");
      if (plan.version !== command.payload.expectedVersion) return this.reject("职业规划版本已变化", "VERSION_CONFLICT");
      if (plan.status === "archived") return this.reject("当前规划不可修改", "INVALID_STATE");
      const next = { ...plan, targetJobId: job.id, version: plan.version + 1, updatedAt: new Date().toISOString() };
      if (!await this.repo.savePlan(next, plan.version)) return this.reject("职业规划版本已变化", "VERSION_CONFLICT");
      return this.result({ plan: next, job }, "目标岗位已更新", true, plan.id, next.version, "applied");
    });
  }

  async confirmCareerPlan(command: DomainCommand<ConfirmCareerPlanInput>): Promise<CareerCapabilityResult> {
    return this.write(command, "confirm_career_plan", async () => {
      const plan = await this.repo.getPlan(command.context.ownerId);
      if (!plan || plan.id !== command.payload.planId) return this.reject("职业规划不存在", "NOT_FOUND");
      if (plan.version !== command.payload.expectedVersion) return this.reject("职业规划版本已变化", "VERSION_CONFLICT");
      if (plan.status !== "draft") return this.reject("当前规划不可确认", "INVALID_STATE");
      const next = { ...plan, status: "confirmed" as const, version: plan.version + 1, updatedAt: new Date().toISOString() };
      if (!await this.repo.savePlan(next, plan.version)) return this.reject("职业规划版本已变化", "VERSION_CONFLICT");
      return this.result({ plan: next }, "职业规划已确认", true, next.id, next.version, "applied");
    });
  }

  async analyzeJobGap(command: DomainCommand<AnalyzeJobGapInput>): Promise<CareerCapabilityResult> {
    return this.write(command, "analyze_job_gap", async () => {
      const job = await this.repo.getJob(command.context.ownerId, command.payload.jobId);
      if (!job) return this.reject("岗位不存在", "NOT_FOUND");
      if (!this.evidenceQuery) return this.reject("Evidence 依赖不可用，无法分析岗位差距", "DEPENDENCY_UNAVAILABLE");
      const profile = await this.getProfile(command.context);
      if (!profile) return this.reject("Profile 依赖不可用，无法分析岗位差距", "DEPENDENCY_UNAVAILABLE");
      if (command.payload.planId) {
        const plan = await this.repo.getPlan(command.context.ownerId);
        if (!plan || plan.id !== command.payload.planId) return this.reject("职业规划不存在", "NOT_FOUND");
      }
      const requirements = job.requirements;
      if (!requirements.length) return this.reject("岗位缺少结构化能力要求，无法可靠分析差距", "INVALID_ARGUMENT");
      let evidence: SkillEvidenceSnapshot[];
      try { evidence = await this.evidenceQuery.getSkillEvidenceSnapshot(command.context, { skillCodes: requirements.map(x => x.skillCode) }); } catch { return this.reject("Evidence 依赖不可用，无法分析岗位差距", "DEPENDENCY_UNAVAILABLE"); }
      const evidenceBySkill = new Map(evidence.map(x => [x.skillCode, x]));
      const profileSkills = new Map(profile.currentSkills.map(x => [x.skillCode, x]));
      const allGroups: Record<"possessed" | "partial" | "missing" | "unknown", CareerGapItem[]> = { possessed: [], partial: [], missing: [], unknown: [] };
      for (const requirement of requirements) {
        const snapshot = evidenceBySkill.get(requirement.skillCode);
        const profileSkill = profileSkills.get(requirement.skillCode);
        const item = this.classifyRequirement(requirement, snapshot, profileSkill);
        allGroups[item.status].push(item);
      }
      const groups: Record<"possessed" | "partial" | "missing" | "unknown", CareerGapItem[]> = {
        possessed: command.payload.includeUnknown === false ? allGroups.possessed : allGroups.possessed,
        partial: command.payload.includeUnknown === false ? allGroups.partial : allGroups.partial,
        missing: command.payload.includeUnknown === false ? allGroups.missing : allGroups.missing,
        unknown: command.payload.includeUnknown === false ? [] : allGroups.unknown,
      };
      const hasUnknown = allGroups.unknown.length > 0;
      const score = requirements.length && !hasUnknown ? Math.round(((allGroups.possessed.length + allGroups.partial.length * 0.5) / requirements.length) * 100) : null;
      const gap: JobGapAnalysis = { id: randomUUID(), ownerId: command.context.ownerId, jobId: job.id, planId: command.payload.planId, matchScore: score, possessed: groups.possessed, partial: groups.partial, missing: groups.missing, unknown: groups.unknown, recommendedActions: this.recommendActions(allGroups), evidenceSnapshotAt: new Date().toISOString(), createdAt: new Date().toISOString() };
      await this.repo.saveGap(gap);
      return this.result({ gap }, "岗位差距分析已保存", true, gap.id, undefined, "applied");
    });
  }

  async getLatestJobGapAnalysis(ctx: CareerContext, input: { jobId: string }) { return this.repo.getLatestGap(ctx.ownerId, input.jobId); }

  async getCareerDashboard(ctx: CareerContext, input: GetCareerDashboardInput = {}): Promise<CareerDashboard> {
    const plan = await this.repo.getPlan(ctx.ownerId);
    const activeJob = plan?.targetJobId ? await this.repo.getJob(ctx.ownerId, plan.targetJobId) : null;
    const latestGapAnalysis = activeJob ? await this.repo.getLatestGap(ctx.ownerId, activeJob.id) : null;
    const actions = latestGapAnalysis?.recommendedActions ?? [];
    const recommendedActions: CareerActionProgress[] = actions.map(action => ({ ...action, learningPlanStatus: "not_linked" as const }));
    if (input.includeLearningProgress && this.learningProgressQuery && actions.length) {
      try {
        const progress = await this.learningProgressQuery.getActionProgress(ctx, { actionIds: actions.map(x => x.id) });
        const byId = new Map(progress.map(x => [x.actionId, x]));
        for (const action of recommendedActions) { const current = byId.get(action.id); if (current) { action.learningPlanStatus = current.status; action.linkedTaskId = current.linkedTaskId; } }
      } catch {
        // Learning is an optional enrichment. Keep the Career dashboard usable.
      }
    }
    const targetCompanies = input.includeCompanies === false ? [] : await this.listTargetCompanies(ctx, { directionCode: plan?.directionCodes[0], limit: 20 }).then(result => result.items.map(company => ({ ...company, selectionStatus: company.id === plan?.targetCompanyId ? "selected" as const : "candidate" as const })));
    const trends = await this.getIndustryTrends(ctx, { directionCodes: plan?.directionCodes, periodDays: input.trendPeriodDays ?? 90 });
    return { plan, activeJob, latestGapAnalysis, targetCompanies, trends, recommendedActions, refreshedAt: new Date().toISOString() };
  }

  async listTargetCompanies(ctx: CareerContext, input: ListTargetCompaniesInput) {
    const plan = await this.repo.getPlan(ctx.ownerId);
    const items = await this.repo.listCompanies(ctx.ownerId, input);
    return { items: items.map(company => ({ ...company, selectionStatus: company.id === plan?.targetCompanyId ? "selected" as const : "candidate" as const })), nextCursor: null };
  }

  async selectTargetCompany(command: DomainCommand<SelectTargetCompanyInput>): Promise<CareerCapabilityResult> {
    return this.write(command, "select_target_company", async () => {
      const plan = await this.repo.getPlan(command.context.ownerId);
      const company = await this.repo.getCompany(command.context.ownerId, command.payload.companyId);
      if (!plan || plan.id !== command.payload.planId) return this.reject("职业规划不存在", "NOT_FOUND");
      if (!company) return this.reject("目标企业不存在", "NOT_FOUND");
      if (plan.version !== command.payload.expectedVersion) return this.reject("职业规划版本已变化", "VERSION_CONFLICT");
      if (plan.status === "archived") return this.reject("当前规划不可修改", "INVALID_STATE");
      const next = { ...plan, targetCompanyId: company.id, targetCompanyName: company.name, targetCity: company.city ?? plan.targetCity, version: plan.version + 1, updatedAt: new Date().toISOString() };
      if (!await this.repo.savePlan(next, plan.version)) return this.reject("职业规划版本已变化", "VERSION_CONFLICT");
      return this.result({ plan: next, company: { ...company, selectionStatus: "selected" as const } }, "目标企业已更新", true, plan.id, next.version, "applied");
    });
  }

  async compareTargetCompanies(ctx: CareerContext, input: CompareTargetCompaniesInput): Promise<CareerCapabilityResult<CompanyComparison>> {
    const leftCompany = await this.repo.getCompany(ctx.ownerId, input.leftCompanyId);
    const rightCompany = await this.repo.getCompany(ctx.ownerId, input.rightCompanyId);
    if (!leftCompany || !rightCompany) return this.reject("企业不存在", "NOT_FOUND");
    if (leftCompany.id === rightCompany.id) return this.reject("需要选择两个不同企业", "INVALID_ARGUMENT");
    const leftJobs = (await Promise.all(leftCompany.relatedJobIds.map(jobId => this.repo.getJob(ctx.ownerId, jobId)))).filter((job): job is TargetJob => Boolean(job));
    const rightJobs = (await Promise.all(rightCompany.relatedJobIds.map(jobId => this.repo.getJob(ctx.ownerId, jobId)))).filter((job): job is TargetJob => Boolean(job));
    const comparableJobPairs: CompanyComparison["comparableJobPairs"] = [];
    for (const left of leftJobs) {
      const right = rightJobs.find(candidate => candidate.directionCode === left.directionCode) ?? rightJobs[0];
      if (!right) continue;
      const rightByCode = new Map(right.requirements.map(item => [item.skillCode, item]));
      const leftByCode = new Map(left.requirements.map(item => [item.skillCode, item]));
      comparableJobPairs.push({ leftJobId: left.id, rightJobId: right.id, comparison: { left, right, commonSkills: left.requirements.filter(item => rightByCode.has(item.skillCode)), leftOnlySkills: left.requirements.filter(item => !rightByCode.has(item.skillCode)), rightOnlySkills: right.requirements.filter(item => !leftByCode.has(item.skillCode)) } });
    }
    const data: CompanyComparison = { leftCompany: { ...leftCompany, selectionStatus: "comparable" }, rightCompany: { ...rightCompany, selectionStatus: "comparable" }, comparableJobPairs, summary: `已比较${leftCompany.name}与${rightCompany.name}的${comparableJobPairs.length}组关联岗位。` };
    return this.result(data, "已完成企业对比");
  }

  async getIndustryTrends(_ctx: CareerContext, input: GetIndustryTrendsInput): Promise<IndustryTrend[]> {
    return this.repo.listTrends({
      ...input,
      directionCodes: input.directionCodes?.length ? input.directionCodes : undefined,
    });
  }

  async compareTargetJobs(ctx: CareerContext, input: CompareTargetJobsInput): Promise<CareerCapabilityResult> {
    const left = await this.repo.getJob(ctx.ownerId, input.leftJobId);
    const right = await this.repo.getJob(ctx.ownerId, input.rightJobId);
    if (!left || !right) return this.reject("岗位不存在", "NOT_FOUND");
    if (left.id === right.id) return this.reject("需要选择两个不同岗位", "INVALID_ARGUMENT");
    const rightByCode = new Map(right.requirements.map(x => [x.skillCode, x]));
    const leftByCode = new Map(left.requirements.map(x => [x.skillCode, x]));
    const commonSkills = left.requirements.filter(x => rightByCode.has(x.skillCode));
    return this.result({ left, right, commonSkills, leftOnlySkills: left.requirements.filter(x => !rightByCode.has(x.skillCode)), rightOnlySkills: right.requirements.filter(x => !leftByCode.has(x.skillCode)) }, "已完成岗位对比");
  }

  private classifyRequirement(requirement: JobGapAnalysis["missing"][number]["requirement"], evidence: SkillEvidenceSnapshot | undefined, profileSkill: { skillCode: string; level?: number } | undefined): CareerGapItem {
    const evidenceIds = evidence?.evidenceIds ?? [];
    const currentLevel = evidence?.level ?? (profileSkill?.level as CareerGapItem["currentLevel"] | undefined);
    let status: CareerGapItem["status"] = "unknown";
    let reason = "当前没有足够证据确认该能力。";
    if (evidence?.support === "supported" || (evidence && evidence.evidenceCount >= 2)) { status = "possessed"; reason = "已有能力证据支持该岗位要求。"; }
    else if (evidence?.support === "partial" || (profileSkill && evidence?.evidenceCount)) { status = "partial"; reason = "已有部分证据，但仍需补充材料或验证能力等级。"; }
    else if (profileSkill) { status = "unknown"; reason = "画像中提到相关能力，但缺少可核验的能力证据。"; }
    else if (requirement.importance === "required") { status = "missing"; reason = "岗位要求该能力，但当前没有相关能力证据。"; }
    const nextAction = this.actionFor(status, requirement);
    return { requirement, status, currentLevel, evidenceIds, reason, ...(nextAction ? { nextAction } : {}) };
  }

  private actionFor(status: CareerGapItem["status"], requirement: CareerGapItem["requirement"]): CareerAction | undefined { return this.actionsFor(status, requirement)[0]; }
  private actionsFor(status: CareerGapItem["status"], requirement: CareerGapItem["requirement"]): CareerAction[] {
    const skill = requirement.skillCode;
    if (status === "missing") return [
      { id: `learn:${skill}`, title: `学习${requirement.skillName}`, description: `围绕${requirement.skillName}完成一次有目标的学习。`, type: "learn_skill", priority: requirement.importance === "required" ? "high" : "medium", skillCodes: [skill], estimatedHours: 4 },
      { id: `task:${skill}`, title: `完成${requirement.skillName}任务`, description: `完成一个能验证${requirement.skillName}的练习任务，并记录过程。`, type: "complete_task", priority: "medium", skillCodes: [skill], estimatedHours: 2 },
      { id: `project:${skill}`, title: `提交${requirement.skillName}项目`, description: `提交一个包含${requirement.skillName}成果的项目或作品，形成可核验材料。`, type: "submit_project", priority: "medium", skillCodes: [skill], estimatedHours: 6 },
    ];
    if (status === "partial") return [{ id: `verify:${skill}`, title: `验证${requirement.skillName}`, description: `补充${requirement.skillName}的项目成果、练习记录或面试证据。`, type: "verify_evidence", priority: "medium", skillCodes: [skill], estimatedHours: 2 }];
    if (status === "unknown") return [{ id: `clarify:${skill}`, title: `澄清${requirement.skillName}要求`, description: `确认岗位对${requirement.skillName}的具体范围和等级，再决定学习或验证路径。`, type: "clarify_requirement", priority: "low", skillCodes: [skill] }];
    return [];
  }

  private recommendActions(groups: Record<"possessed" | "partial" | "missing" | "unknown", CareerGapItem[]>) {
    const items = [...groups.missing, ...groups.partial, ...groups.unknown];
    const unique = new Map<string, CareerAction>();
    for (const item of items) for (const action of this.actionsFor(item.status, item.requirement)) unique.set(action.id, action);
    return [...unique.values()];
  }
  private async getProfile(ctx: CareerContext) { try { return this.profileQuery ? await this.profileQuery.getProfileSnapshot(ctx) : null; } catch { return null; } }

  private async write(command: DomainCommand<any>, operation: string, action: () => Promise<CareerCapabilityResult>): Promise<CareerCapabilityResult> {
    const key = command.idempotencyKey;
    if (!key?.trim()) return this.reject("缺少幂等键", "INVALID_ARGUMENT");
    const requestHash = createHash("sha256").update(JSON.stringify({ operation, payload: command.payload, expectedVersion: command.expectedVersion })).digest("hex");
    const existing = await this.repo.getIdempotency(command.context.ownerId, key);
    if (existing) {
      if (existing.operation !== operation || existing.requestHash !== requestHash) return this.reject("幂等键已用于其他请求", "DUPLICATE_REQUEST");
      return existing.result;
    }
    const result = await action();
    if (result.ok || result.error?.code !== "DEPENDENCY_UNAVAILABLE") await this.repo.saveIdempotency({ ownerId: command.context.ownerId, idempotencyKey: key, operation, requestHash, result, createdAt: new Date().toISOString() });
    return result;
  }

  private result<T>(data: T, summary: string, changed = false, entityId?: string, version?: number, status: CareerCapabilityResult["status"] = changed ? "applied" : "read"): CareerCapabilityResult<T> { return { ok: true, changed, domain: "career", status, summary, data, ...(entityId ? { entityId } : {}), ...(version !== undefined ? { version } : {}) }; }
  private reject(summary: string, code: CapabilityErrorCode): CareerCapabilityResult<never> { return { ok: false, changed: false, domain: "career", status: "rejected", summary, error: { code, message: summary, retryable: code === "DEPENDENCY_UNAVAILABLE" } }; }
}
