import { randomUUID } from "node:crypto";
import type { CareerPlan, CareerContext, JobGapAnalysis, TargetJob } from "./contracts.ts";

export interface CareerRepository {
  getPlan(ownerId: string, status?: CareerPlan["status"]): Promise<CareerPlan | null>;
  savePlan(plan: CareerPlan): Promise<void>;
  listJobs(ownerId: string, input: { directionCode?: string; keyword?: string; limit?: number }): Promise<TargetJob[]>;
  getJob(ownerId: string, jobId: string): Promise<TargetJob | null>;
  saveJob(job: TargetJob): Promise<void>;
  saveGap(gap: JobGapAnalysis): Promise<void>;
  getLatestGap(ownerId: string, jobId: string): Promise<JobGapAnalysis | null>;
}

export class MemoryCareerRepository implements CareerRepository {
  private readonly plans = new Map<string, CareerPlan>();
  private readonly jobs = new Map<string, TargetJob>();
  private readonly gaps = new Map<string, JobGapAnalysis[]>();
  async getPlan(ownerId: string, status?: CareerPlan["status"]) { return [...this.plans.values()].find(x => x.ownerId === ownerId && (!status || x.status === status)) ?? null; }
  async savePlan(plan: CareerPlan) { this.plans.set(plan.id, plan); }
  async listJobs(ownerId: string, input: { directionCode?: string; keyword?: string; limit?: number }) { const keyword = input.keyword?.toLowerCase(); return [...this.jobs.values()].filter(j => j.ownerId === ownerId).filter(j => !input.directionCode || j.directionCode === input.directionCode).filter(j => !keyword || `${j.title} ${j.companyName ?? ""} ${j.description}`.toLowerCase().includes(keyword)).slice(0, input.limit ?? 20); }
  async getJob(ownerId: string, jobId: string) { const job = this.jobs.get(jobId); return job?.ownerId === ownerId ? job : null; }
  async saveJob(job: TargetJob) { this.jobs.set(job.id, job); }
  async saveGap(gap: JobGapAnalysis) { this.gaps.set(gap.jobId, [gap, ...(this.gaps.get(gap.jobId) ?? [])]); }
  async getLatestGap(ownerId: string, jobId: string) { return (this.gaps.get(jobId) ?? []).find(x => x.ownerId === ownerId) ?? null; }
}

export function emptyCareerJob(ctx: CareerContext, input: { title: string; description: string; companyName?: string; directionCode?: string; city?: string; employmentType?: TargetJob["employmentType"]; salaryText?: string; source?: TargetJob["source"] }): TargetJob {
  return { id: randomUUID(), ownerId: ctx.ownerId, title: input.title, description: input.description, companyName: input.companyName, directionCode: input.directionCode, city: input.city, employmentType: input.employmentType ?? "unknown", salaryText: input.salaryText, requirements: [], source: input.source ?? "manual", createdAt: new Date().toISOString() };
}
