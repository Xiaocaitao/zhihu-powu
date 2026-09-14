import type { DomainCommand } from "../../contracts/capability.ts";
import type { CareerContext, CareerPlan, CreateCareerPlanDraftInput, GetCareerPlanInput, GetTargetJobsInput, SaveTargetJobInput, AnalyzeJobGapInput, SelectTargetJobInput, ConfirmCareerPlanInput, CareerCapabilityResult, TargetJob, JobGapAnalysis } from "./contracts.ts";
export interface CareerApplication {
  getCareerPlan(ctx: CareerContext, input: GetCareerPlanInput): Promise<CareerPlan | null>;
  createCareerPlanDraft(command: DomainCommand<CreateCareerPlanDraftInput>): Promise<CareerCapabilityResult>;
  getTargetJobs(ctx: CareerContext, input: GetTargetJobsInput): Promise<{ items: TargetJob[]; nextCursor: string | null }>;
  saveTargetJob(command: DomainCommand<SaveTargetJobInput>): Promise<CareerCapabilityResult>;
  selectTargetJob(command: DomainCommand<SelectTargetJobInput>): Promise<CareerCapabilityResult>;
  confirmCareerPlan(command: DomainCommand<ConfirmCareerPlanInput>): Promise<CareerCapabilityResult>;
  analyzeJobGap(command: DomainCommand<AnalyzeJobGapInput>): Promise<CareerCapabilityResult>;
  getLatestJobGapAnalysis(ctx: CareerContext, input: { jobId: string }): Promise<JobGapAnalysis | null>;
  getCareerDashboard(ctx: CareerContext, input?: { includeLearningProgress?: boolean }): Promise<unknown>;
  compareTargetJobs(ctx: CareerContext, input: { leftJobId: string; rightJobId: string }): Promise<CareerCapabilityResult>;
}
