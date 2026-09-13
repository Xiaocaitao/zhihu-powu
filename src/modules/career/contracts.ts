export type ModuleContext = {
  ownerId: string;
  sessionId?: string;
  requestId?: string;
  signal?: AbortSignal;
};

export type CapabilityContext = ModuleContext & {
  sessionId: string;
  requestId: string;
  sourceMessageId?: string;
  signal: AbortSignal;
};

export type DomainCommand<T> = {
  context: CapabilityContext;
  payload: T;
  expectedVersion?: number;
  idempotencyKey: string;
};

export type CapabilityResult = {
  ok: boolean;
  changed: boolean;
  domain: "career";
  entityId?: string;
  version?: number;
  status:
    | "read"
    | "applied"
    | "draft_created"
    | "confirmation_required"
    | "rejected";
  summary: string;
  data?: unknown;
};

export type PaginatedResult<T> = {
  items: T[];
  nextCursor?: string;
};

export type CareerErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_ARGUMENT"
  | "INVALID_STATE"
  | "VERSION_CONFLICT"
  | "DUPLICATE_REQUEST"
  | "CONFIRMATION_REQUIRED"
  | "DEPENDENCY_UNAVAILABLE";

export class CareerError extends Error {
  public readonly code: CareerErrorCode;

  constructor(code: CareerErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "CareerError";
  }
}

export type JobRequirementDTO = {
  id: string;
  skillCode: string;
  skillName: string;
  description?: string;
  importance: "required" | "preferred";
  expectedLevel?: 1 | 2 | 3 | 4 | 5;
  evidenceHints: string[];
  sourceText?: string;
};

export type TargetJobDTO = {
  id: string;
  ownerId: string;
  title: string;
  companyName?: string;
  directionCode?: string;
  city?: string;
  employmentType?: "internship" | "full_time" | "unknown";
  salaryText?: string;
  description: string;
  requirements: JobRequirementDTO[];
  source: "manual" | "seed" | "imported";
  createdAt: string;
  updatedAt: string;
};

export type CareerDirectionDTO = {
  code: string;
  name: string;
  summary: string;
  fitReasons: string[];
  entryBarriers: string[];
  trialAction?: string;
  fitScore?: number;
};

export type CareerMilestoneDTO = {
  id: string;
  title: string;
  description: string;
  skillCodes: string[];
  expectedEvidence: string[];
  order: number;
};

export type CareerPlanDTO = {
  id: string;
  ownerId: string;
  version: number;
  status: "draft" | "confirmed" | "archived";
  directions: CareerDirectionDTO[];
  primaryDirectionCode?: string;
  targetJobId?: string;
  targetCompanyName?: string;
  targetCity?: string;
  targetSalaryText?: string;
  rationale: string;
  milestones: CareerMilestoneDTO[];
  latestGapAnalysis?: JobGapAnalysisDTO;
  createdAt: string;
  updatedAt: string;
};

export type CareerActionDTO = {
  id: string;
  title: string;
  description: string;
  type:
    | "learn_skill"
    | "complete_task"
    | "submit_project"
    | "verify_evidence"
    | "clarify_requirement";
  priority: "high" | "medium" | "low";
  skillCodes: string[];
  estimatedHours?: number;
  linkedTaskId?: string;
};

export type CareerGapItemDTO = {
  requirement: JobRequirementDTO;
  status: "possessed" | "partial" | "missing" | "unknown";
  currentLevel?: 1 | 2 | 3 | 4 | 5;
  evidenceIds: string[];
  reason: string;
  nextAction?: CareerActionDTO;
};

export type JobGapAnalysisDTO = {
  id: string;
  ownerId: string;
  jobId: string;
  planId?: string;
  matchScore: number;
  possessed: CareerGapItemDTO[];
  partial: CareerGapItemDTO[];
  missing: CareerGapItemDTO[];
  unknown: CareerGapItemDTO[];
  recommendedActions: CareerActionDTO[];
  evidenceSnapshotAt: string;
  createdAt: string;
};

export type CareerActionProgressDTO = CareerActionDTO & {
  learningPlanStatus: "not_linked" | "planned" | "in_progress" | "completed";
  linkedTaskId?: string;
};

export type IndustryTrendDTO = {
  directionCode: string;
  directionName: string;
  periodDays: 30 | 90 | 180;
  signal: "rising" | "stable" | "cooling";
  summary: string;
  skillKeywords: string[];
};

export type TargetCompanyDTO = {
  id: string;
  name: string;
  directionCodes: string[];
  cities: string[];
  selectionStatus: "selected" | "available";
};

export type CareerDashboardDTO = {
  activePlan: CareerPlanDTO | null;
  activeJob: TargetJobDTO | null;
  activeGapAnalysis: JobGapAnalysisDTO | null;
  trends: IndustryTrendDTO[];
  targetCompanies: TargetCompanyDTO[];
  recommendedActions: CareerActionProgressDTO[];
  refreshedAt: string;
};

export type GetCareerPlanInput = {
  status?: CareerPlanDTO["status"];
  includeGapAnalysis?: boolean;
};

export type CreateCareerPlanDraftInput = {
  directionCodes?: string[];
  targetJobId?: string;
  targetCompanyName?: string;
  targetCity?: string;
  targetSalaryText?: string;
  userNotes?: string;
};

export type GetTargetJobsInput = {
  directionCode?: string;
  keyword?: string;
  limit?: number;
  cursor?: string;
};

export type AnalyzeJobGapInput = {
  jobId: string;
  planId?: string;
  includeUnknown?: boolean;
};

export type ConfirmCareerPlanInput = {
  planId: string;
  expectedVersion: number;
};

export type SaveTargetJobInput = {
  title: string;
  companyName?: string;
  directionCode?: string;
  city?: string;
  employmentType?: "internship" | "full_time" | "unknown";
  salaryText?: string;
  description: string;
  source?: "manual" | "imported";
};

export type ListJobCatalogInput = GetTargetJobsInput & {
  companyId?: string;
  city?: string;
  employmentType?: "internship" | "full_time";
};

export type SelectTargetJobInput = {
  planId: string;
  jobId: string;
  expectedVersion: number;
};

export type GetCareerDashboardInput = {
  trendPeriodDays?: 30 | 90 | 180;
  includeCompanies?: boolean;
  includeLearningProgress?: boolean;
};

export type CompareTargetJobsInput = {
  leftJobId: string;
  rightJobId: string;
};

export type SkillEvidenceSnapshot = {
  skillCode: string;
  level?: 1 | 2 | 3 | 4 | 5;
  evidenceIds: string[];
  evidenceCount: number;
};

export type ProfileSnapshot = {
  directionHints: string[];
  interests: string[];
  currentSkills: Array<{ skillCode: string; level?: number }>;
  weeklyAvailableHours?: number;
  goalText?: string;
};

export interface ProfileQuery {
  getProfileSnapshot(ctx: ModuleContext): Promise<ProfileSnapshot | null>;
}

export interface EvidenceQuery {
  getSkillEvidenceSnapshot(
    ctx: ModuleContext,
    input: { skillCodes: string[] },
  ): Promise<SkillEvidenceSnapshot[]>;
}

export interface LearningProgressQuery {
  getActionProgress(
    ctx: ModuleContext,
    input: { actionIds: string[] },
  ): Promise<Array<{
    actionId: string;
    status: CareerActionProgressDTO["learningPlanStatus"];
    linkedTaskId?: string;
  }>>;
}

export interface CareerApplication {
  getCareerPlan(ctx: ModuleContext, input: GetCareerPlanInput): Promise<CareerPlanDTO | null>;
  createCareerPlanDraft(command: DomainCommand<CreateCareerPlanDraftInput>): Promise<CapabilityResult>;
  getTargetJobs(ctx: ModuleContext, input: GetTargetJobsInput): Promise<PaginatedResult<TargetJobDTO>>;
  analyzeJobGap(command: DomainCommand<AnalyzeJobGapInput>): Promise<CapabilityResult>;
  confirmCareerPlan(command: DomainCommand<ConfirmCareerPlanInput>): Promise<CapabilityResult>;
  saveTargetJob(command: DomainCommand<SaveTargetJobInput>): Promise<CapabilityResult>;
  listJobCatalog(ctx: ModuleContext, input: ListJobCatalogInput): Promise<PaginatedResult<TargetJobDTO>>;
  selectTargetJob(command: DomainCommand<SelectTargetJobInput>): Promise<CapabilityResult>;
  getLatestJobGapAnalysis(ctx: ModuleContext, input: { jobId: string }): Promise<JobGapAnalysisDTO | null>;
  getCareerDashboard(ctx: ModuleContext, input: GetCareerDashboardInput): Promise<CareerDashboardDTO>;
  compareTargetJobs(ctx: ModuleContext, input: CompareTargetJobsInput): Promise<JobComparisonDTO>;
}

export type JobComparisonDTO = {
  left: TargetJobDTO;
  right: TargetJobDTO;
  sharedSkills: string[];
  leftOnlySkills: string[];
  rightOnlySkills: string[];
};

