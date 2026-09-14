import type { DomainCommand } from "../../contracts/capability.ts";
import type { CareerActionProgress, CareerCapabilityResult, CareerContext, CareerDashboard, CareerPlan, CompareTargetJobsInput, ConfirmCareerPlanInput, CreateCareerPlanDraftInput, GetCareerPlanInput, GetTargetJobsInput, JobGapAnalysis, ListJobCatalogInput, SaveTargetJobInput, SelectTargetJobInput, TargetJob, AnalyzeJobGapInput } from "./contracts.ts";
export interface CareerApplication {
  getCareerPlan(ctx: CareerContext, input: GetCareerPlanInput): Promise<CareerPlan | null>;
  createCareerPlanDraft(command: DomainCommand<CreateCareerPlanDraftInput>): Promise<CareerCapabilityResult>;
  getTargetJobs(ctx: CareerContext, input: GetTargetJobsInput): Promise<{ items: TargetJob[]; nextCursor: string | null }>;
  listJobCatalog(ctx: CareerContext, input: ListJobCatalogInput): Promise<{ items: TargetJob[]; nextCursor: string | null }>;
  getTargetJob(ctx: CareerContext, input: { jobId: string }): Promise<TargetJob | null>;
  saveTargetJob(command: DomainCommand<SaveTargetJobInput>): Promise<CareerCapabilityResult>;
  selectTargetJob(command: DomainCommand<SelectTargetJobInput>): Promise<CareerCapabilityResult>;
  confirmCareerPlan(command: DomainCommand<ConfirmCareerPlanInput>): Promise<CareerCapabilityResult>;
  analyzeJobGap(command: DomainCommand<AnalyzeJobGapInput>): Promise<CareerCapabilityResult>;
  getLatestJobGapAnalysis(ctx: CareerContext, input: { jobId: string }): Promise<JobGapAnalysis | null>;
  getCareerDashboard(ctx: CareerContext, input?: { includeLearningProgress?: boolean }): Promise<CareerDashboard>;
  compareTargetJobs(ctx: CareerContext, input: CompareTargetJobsInput): Promise<CareerCapabilityResult>;
}
