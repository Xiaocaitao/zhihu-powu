import { z } from "zod";
import type { CapabilityContext, CapabilityErrorCode } from "../../contracts/capability.ts";

export type PlanStatus = "draft" | "confirmed" | "archived";
export type EmploymentType = "internship" | "full_time" | "unknown";
export type JobRequirement = { skillCode: string; skillName: string; importance: "required" | "preferred" };
export type TargetCompany = { id: string; ownerId: string; name: string; industry?: string; city?: string; summary?: string; relatedJobIds: string[]; matchScore?: number; selectionStatus: "selected" | "candidate" | "comparable"; updatedAt: string };
export type IndustryTrend = { id: string; directionCode: string; directionName: string; metric: "demand_heat" | "growth" | "skill_change"; value: number; title: string; summary: string; periodDays: 30 | 90 | 180; sampleSize?: number; sourceLabel: string; asOf: string };
export type TargetJob = { id: string; ownerId: string; title: string; companyId?: string; companyName?: string; directionCode?: string; city?: string; employmentType: EmploymentType; salaryText?: string; description: string; requirements: JobRequirement[]; source: "manual" | "imported"; createdAt: string; updatedAt?: string };
export type CareerPlan = { id: string; ownerId: string; status: PlanStatus; version: number; directionCodes: string[]; targetJobId?: string; targetCompanyId?: string; targetCompanyName?: string; targetCity?: string; targetSalaryText?: string; rationale?: string; updatedAt: string };
export type CareerGapStatus = "possessed" | "partial" | "missing" | "unknown";
export type CareerActionType = "learn_skill" | "complete_task" | "submit_project" | "verify_evidence" | "clarify_requirement";
export type CareerAction = { id: string; title: string; description: string; type: CareerActionType; priority: "high" | "medium" | "low"; skillCodes: string[]; estimatedHours?: number; linkedTaskId?: string };
export type CareerGapItem = { requirement: JobRequirement; status: CareerGapStatus; evidenceIds: string[]; reason: string; currentLevel?: 1 | 2 | 3 | 4 | 5; nextAction?: CareerAction };
export type JobGapAnalysis = { id: string; ownerId: string; jobId: string; planId?: string; matchScore: number | null; possessed: CareerGapItem[]; partial: CareerGapItem[]; missing: CareerGapItem[]; unknown: CareerGapItem[]; recommendedActions: CareerAction[]; evidenceSnapshotAt: string; createdAt: string };
export type LearningActionStatus = "not_linked" | "planned" | "in_progress" | "completed";
export type CareerActionProgress = CareerAction & { learningPlanStatus: LearningActionStatus };
export type CareerDashboard = { plan: CareerPlan | null; activeJob: TargetJob | null; latestGapAnalysis: JobGapAnalysis | null; targetCompanies: TargetCompany[]; trends: IndustryTrend[]; recommendedActions: CareerActionProgress[]; refreshedAt: string };
export type JobComparison = { left: TargetJob; right: TargetJob; commonSkills: JobRequirement[]; leftOnlySkills: JobRequirement[]; rightOnlySkills: JobRequirement[] };
export type ProfileSnapshot = { directionHints: string[]; interests: string[]; currentSkills: Array<{ skillCode: string; level?: number }>; weeklyAvailableHours?: number; goalText?: string };
export type SkillEvidenceSnapshot = { skillCode: string; level?: 1 | 2 | 3 | 4 | 5; evidenceIds: string[]; evidenceCount: number; support?: "insufficient" | "partial" | "supported" };
export interface ProfileQuery { getProfileSnapshot(ctx: CareerContext): Promise<ProfileSnapshot | null> }
export interface EvidenceQuery { getSkillEvidenceSnapshot(ctx: CareerContext, input: { skillCodes: string[] }): Promise<SkillEvidenceSnapshot[]> }
export interface LearningProgressQuery { getActionProgress(ctx: CareerContext, input: { actionIds: string[] }): Promise<Array<{ actionId: string; status: LearningActionStatus; linkedTaskId?: string }>> }
export type CareerIdempotencyRecord = { ownerId: string; idempotencyKey: string; operation: string; requestHash: string; result: CareerCapabilityResult; createdAt: string };
export type CareerCapabilityResult<T = unknown> = { ok: boolean; changed: boolean; domain: "career"; entityId?: string; version?: number; status: "read" | "applied" | "draft_created" | "confirmation_required" | "rejected"; summary: string; data?: T; error?: { code: CapabilityErrorCode; message: string; retryable: boolean } };
export type GetCareerPlanInput = { status?: PlanStatus; includeGapAnalysis?: boolean };
export type CreateCareerPlanDraftInput = { directionCodes?: string[]; targetJobId?: string; targetCompanyId?: string; targetCompanyName?: string; targetCity?: string; targetSalaryText?: string; userNotes?: string };
export type GetTargetJobsInput = { directionCode?: string; keyword?: string; limit?: number; cursor?: string };
export type ListJobCatalogInput = GetTargetJobsInput;
export type SaveTargetJobInput = { title: string; companyId?: string; companyName?: string; directionCode?: string; city?: string; employmentType?: EmploymentType; salaryText?: string; description: string; source?: "manual" | "imported"; requirements?: JobRequirement[] };
export type AnalyzeJobGapInput = { jobId: string; planId?: string; includeUnknown?: boolean };
export type SelectTargetJobInput = { planId: string; jobId: string; expectedVersion: number };
export type ConfirmCareerPlanInput = { planId: string; expectedVersion: number };
export type CompareTargetJobsInput = { leftJobId: string; rightJobId: string };
export type ListTargetCompaniesInput = { keyword?: string; directionCode?: string; city?: string; limit?: number; cursor?: string };
export type SelectTargetCompanyInput = { planId: string; companyId: string; expectedVersion: number };
export type CompareTargetCompaniesInput = { leftCompanyId: string; rightCompanyId: string };
export type GetIndustryTrendsInput = { directionCodes?: string[]; periodDays?: 30 | 90 | 180 };
export type CompanyComparison = { leftCompany: TargetCompany; rightCompany: TargetCompany; comparableJobPairs: Array<{ leftJobId: string; rightJobId: string; comparison: JobComparison }>; summary: string };
export type GetCareerDashboardInput = { trendPeriodDays?: 30 | 90 | 180; includeCompanies?: boolean; includeLearningProgress?: boolean };
export type CareerContext = Pick<CapabilityContext, "ownerId" | "requestId" | "operationKey" | "sessionId" | "signal">;

export const getCareerPlanSchema = z.object({ status: z.enum(["draft", "confirmed", "archived"]).optional(), includeGapAnalysis: z.boolean().optional() }).strict();
export const createCareerPlanDraftSchema = z.object({ directionCodes: z.array(z.string().trim().min(1)).max(3).optional(), targetJobId: z.string().min(1).optional(), targetCompanyId: z.string().min(1).optional(), targetCompanyName: z.string().trim().max(120).optional(), targetCity: z.string().trim().max(80).optional(), targetSalaryText: z.string().trim().max(80).optional(), userNotes: z.string().trim().max(2000).optional() }).strict();
export const getTargetJobsSchema = z.object({ directionCode: z.string().trim().min(1).optional(), keyword: z.string().trim().min(1).optional(), limit: z.number().int().min(1).max(50).optional(), cursor: z.string().optional() }).strict();
export const listJobCatalogSchema = getTargetJobsSchema;
const requirementSchema = z.object({ skillCode: z.string().trim().min(1).max(100), skillName: z.string().trim().min(1).max(160), importance: z.enum(["required", "preferred"]) }).strict();
export const saveTargetJobSchema = z.object({ title: z.string().trim().min(1).max(160), companyId: z.string().trim().min(1).max(128).optional(), companyName: z.string().trim().max(120).optional(), directionCode: z.string().trim().max(64).optional(), city: z.string().trim().max(80).optional(), employmentType: z.enum(["internship", "full_time", "unknown"]).optional(), salaryText: z.string().trim().max(80).optional(), description: z.string().trim().min(20).max(20000), source: z.enum(["manual", "imported"]).optional(), requirements: z.array(requirementSchema).max(100).optional() }).strict();
export const analyzeJobGapSchema = z.object({ jobId: z.string().min(1).max(128), planId: z.string().max(128).optional(), includeUnknown: z.boolean().optional() }).strict();
export const selectTargetJobSchema = z.object({ planId: z.string().min(1), jobId: z.string().min(1), expectedVersion: z.number().int().positive() }).strict();
export const confirmCareerPlanSchema = z.object({ planId: z.string().min(1), expectedVersion: z.number().int().positive() }).strict();
export const compareTargetJobsSchema = z.object({ leftJobId: z.string().min(1), rightJobId: z.string().min(1) }).strict();
export const listTargetCompaniesSchema = z.object({ keyword: z.string().trim().min(1).optional(), directionCode: z.string().trim().min(1).optional(), city: z.string().trim().min(1).optional(), limit: z.number().int().min(1).max(50).optional(), cursor: z.string().optional() }).strict();
export const selectTargetCompanySchema = z.object({ planId: z.string().min(1), companyId: z.string().min(1), expectedVersion: z.number().int().positive() }).strict();
export const compareTargetCompaniesSchema = z.object({ leftCompanyId: z.string().min(1), rightCompanyId: z.string().min(1) }).strict();
export const getIndustryTrendsSchema = z.object({ directionCodes: z.array(z.string().trim().min(1)).max(10).optional(), periodDays: z.union([z.literal(30), z.literal(90), z.literal(180)]).optional() }).strict();

export const getCareerDashboardSchema = z.object({ trendPeriodDays: z.union([z.literal(30), z.literal(90), z.literal(180)]).optional(), includeCompanies: z.boolean().optional(), includeLearningProgress: z.boolean().optional() }).strict();
