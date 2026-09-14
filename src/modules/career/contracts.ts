import { z } from "zod";
import type { CapabilityErrorCode } from "../../contracts/capability.ts";

export type PlanStatus = "draft" | "confirmed" | "archived";
export type EmploymentType = "internship" | "full_time" | "unknown";
export type JobRequirement = { skillCode: string; skillName: string; importance: "required" | "preferred" };
export type TargetJob = { id: string; ownerId: string; title: string; companyName?: string; directionCode?: string; city?: string; employmentType: EmploymentType; salaryText?: string; description: string; requirements: JobRequirement[]; source: "manual" | "imported"; createdAt: string };
export type CareerPlan = { id: string; ownerId: string; status: PlanStatus; version: number; directionCodes: string[]; targetJobId?: string; targetCompanyName?: string; targetCity?: string; targetSalaryText?: string; rationale?: string; updatedAt: string };
export type JobGapAnalysis = { id: string; ownerId: string; jobId: string; planId?: string; matchScore: number | null; possessed: string[]; partial: string[]; missing: string[]; unknown: string[]; evidenceSnapshotAt: string; createdAt: string };
export type CareerCapabilityResult<T = unknown> = { ok: boolean; changed: boolean; domain: "career"; entityId?: string; version?: number; status: "read" | "applied" | "draft_created" | "confirmation_required" | "rejected"; summary: string; data?: T; error?: { code: CapabilityErrorCode; message: string; retryable: boolean } };
export type GetCareerPlanInput = { status?: PlanStatus; includeGapAnalysis?: boolean };
export type CreateCareerPlanDraftInput = { directionCodes?: string[]; targetJobId?: string; targetCompanyName?: string; targetCity?: string; targetSalaryText?: string; userNotes?: string };
export type GetTargetJobsInput = { directionCode?: string; keyword?: string; limit?: number; cursor?: string };
export type SaveTargetJobInput = { title: string; companyName?: string; directionCode?: string; city?: string; employmentType?: EmploymentType; salaryText?: string; description: string; source?: "manual" | "imported" };
export type AnalyzeJobGapInput = { jobId: string; planId?: string; includeUnknown?: boolean };
export type SelectTargetJobInput = { planId: string; jobId: string; expectedVersion: number };
export type ConfirmCareerPlanInput = { planId: string; expectedVersion: number };
export type CareerContext = { ownerId: string; requestId?: string; operationKey?: string };

export const getCareerPlanSchema = z.object({ status: z.enum(["draft", "confirmed", "archived"]).optional(), includeGapAnalysis: z.boolean().optional() }).strict();
export const createCareerPlanDraftSchema = z.object({ directionCodes: z.array(z.string().trim().min(1)).max(3).optional(), targetJobId: z.string().min(1).optional(), targetCompanyName: z.string().trim().max(120).optional(), targetCity: z.string().trim().max(80).optional(), targetSalaryText: z.string().trim().max(80).optional(), userNotes: z.string().trim().max(2000).optional() }).strict();
export const getTargetJobsSchema = z.object({ directionCode: z.string().trim().min(1).optional(), keyword: z.string().trim().min(1).optional(), limit: z.number().int().min(1).max(50).optional(), cursor: z.string().optional() }).strict();
export const saveTargetJobSchema = z.object({ title: z.string().trim().min(1).max(160), companyName: z.string().trim().max(120).optional(), directionCode: z.string().trim().max(64).optional(), city: z.string().trim().max(80).optional(), employmentType: z.enum(["internship", "full_time", "unknown"]).optional(), salaryText: z.string().trim().max(80).optional(), description: z.string().trim().min(20).max(20000), source: z.enum(["manual", "imported"]).optional() }).strict();
export const analyzeJobGapSchema = z.object({ jobId: z.string().min(1).max(128), planId: z.string().max(128).optional(), includeUnknown: z.boolean().optional() }).strict();
export const selectTargetJobSchema = z.object({ planId: z.string().min(1), jobId: z.string().min(1), expectedVersion: z.number().int().positive() }).strict();
export const confirmCareerPlanSchema = z.object({ planId: z.string().min(1), expectedVersion: z.number().int().positive() }).strict();
