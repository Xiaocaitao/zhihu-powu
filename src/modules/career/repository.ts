import type {
  CareerPlanDTO,
  JobGapAnalysisDTO,
  TargetJobDTO,
} from "./contracts.ts";

export interface CareerRepository {
  getPlan(ownerId: string, planId?: string): Promise<CareerPlanDTO | null>;
  savePlan(plan: CareerPlanDTO): Promise<void>;
  listJobs(ownerId: string): Promise<TargetJobDTO[]>;
  getJob(ownerId: string, jobId: string): Promise<TargetJobDTO | null>;
  saveJob(job: TargetJobDTO): Promise<void>;
  getLatestGapAnalysis(ownerId: string, jobId: string): Promise<JobGapAnalysisDTO | null>;
  saveGapAnalysis(analysis: JobGapAnalysisDTO): Promise<void>;
  getIdempotentResult(ownerId: string, key: string): Promise<unknown | null>;
  saveIdempotentResult(ownerId: string, key: string, result: unknown): Promise<void>;
}
