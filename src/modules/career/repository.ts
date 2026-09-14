import { createHash, randomUUID } from "node:crypto";
import type {
  CareerCapabilityResult,
  CareerContext,
  CareerIdempotencyRecord,
  CareerPlan,
  GetIndustryTrendsInput,
  IndustryTrend,
  JobGapAnalysis,
  JobRequirement,
  ListTargetCompaniesInput,
  TargetCompany,
  TargetJob,
} from "./contracts.ts";

export interface CareerRepository {
  getPlan(ownerId: string, status?: CareerPlan["status"]): Promise<CareerPlan | null>;
  savePlan(plan: CareerPlan, expectedVersion?: number): Promise<boolean>;
  listJobs(ownerId: string, input: { directionCode?: string; keyword?: string; limit?: number }): Promise<TargetJob[]>;
  getJob(ownerId: string, jobId: string): Promise<TargetJob | null>;
  saveJob(job: TargetJob): Promise<void>;
  saveGap(gap: JobGapAnalysis): Promise<void>;
  getLatestGap(ownerId: string, jobId: string): Promise<JobGapAnalysis | null>;
  listCompanies(ownerId: string, input: ListTargetCompaniesInput): Promise<TargetCompany[]>;
  getCompany(ownerId: string, companyId: string): Promise<TargetCompany | null>;
  listTrends(input: GetIndustryTrendsInput): Promise<IndustryTrend[]>;
  getIdempotency(ownerId: string, idempotencyKey: string): Promise<CareerIdempotencyRecord | null>;
  saveIdempotency(record: CareerIdempotencyRecord): Promise<void>;
}

export function companyIdForName(name: string) {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, " ");
  return `company:${createHash("sha256").update(normalized).digest("hex").slice(0, 24)}`;
}

export class MemoryCareerRepository implements CareerRepository {
  private readonly plans = new Map<string, CareerPlan>();
  private readonly jobs = new Map<string, TargetJob>();
  private readonly gaps = new Map<string, JobGapAnalysis[]>();
  private readonly trends: IndustryTrend[];
  private readonly idempotency = new Map<string, CareerIdempotencyRecord>();

  constructor(options: { trends?: IndustryTrend[] } = {}) {
    this.trends = structuredClone(options.trends ?? []);
  }

  async getPlan(ownerId: string, status?: CareerPlan["status"]) {
    return [...this.plans.values()]
      .filter(plan => plan.ownerId === ownerId && (!status || plan.status === status))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
  }

  async savePlan(plan: CareerPlan, expectedVersion?: number) {
    const current = this.plans.get(plan.id);
    if (expectedVersion !== undefined && (!current || current.ownerId !== plan.ownerId || current.version !== expectedVersion)) return false;
    this.plans.set(plan.id, structuredClone(plan));
    return true;
  }

  async listJobs(ownerId: string, input: { directionCode?: string; keyword?: string; limit?: number }) {
    const keyword = input.keyword?.toLowerCase();
    return [...this.jobs.values()]
      .filter(job => job.ownerId === ownerId)
      .filter(job => !input.directionCode || job.directionCode === input.directionCode)
      .filter(job => !keyword || `${job.title} ${job.companyName ?? ""} ${job.description}`.toLowerCase().includes(keyword))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, input.limit ?? 20)
      .map(job => structuredClone(job));
  }

  async getJob(ownerId: string, jobId: string) {
    const job = this.jobs.get(jobId);
    return job?.ownerId === ownerId ? structuredClone(job) : null;
  }

  async saveJob(job: TargetJob) { this.jobs.set(job.id, structuredClone(job)); }
  async saveGap(gap: JobGapAnalysis) { this.gaps.set(gap.jobId, [structuredClone(gap), ...(this.gaps.get(gap.jobId) ?? [])]); }
  async getLatestGap(ownerId: string, jobId: string) {
    const gap = (this.gaps.get(jobId) ?? []).find(item => item.ownerId === ownerId);
    return gap ? structuredClone(gap) : null;
  }

  async listCompanies(ownerId: string, input: ListTargetCompaniesInput) {
    const keyword = input.keyword?.toLowerCase();
    const grouped = new Map<string, TargetCompany>();
    for (const job of this.jobs.values()) {
      if (job.ownerId !== ownerId || !job.companyName) continue;
      if (input.directionCode && job.directionCode !== input.directionCode) continue;
      if (input.city && job.city !== input.city) continue;
      if (keyword && !`${job.companyName} ${job.title} ${job.description}`.toLowerCase().includes(keyword)) continue;
      const id = job.companyId ?? companyIdForName(job.companyName);
      const current = grouped.get(id);
      if (current) {
        if (!current.relatedJobIds.includes(job.id)) current.relatedJobIds.push(job.id);
        current.updatedAt = job.updatedAt ?? job.createdAt;
      } else {
        grouped.set(id, {
          id,
          ownerId,
          name: job.companyName,
          city: job.city,
          relatedJobIds: [job.id],
          selectionStatus: "candidate",
          updatedAt: job.updatedAt ?? job.createdAt,
        });
      }
    }
    return [...grouped.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, input.limit ?? 20)
      .map(item => structuredClone(item));
  }

  async getCompany(ownerId: string, companyId: string) {
    const companies = await this.listCompanies(ownerId, { limit: Number.MAX_SAFE_INTEGER });
    return companies.find(company => company.id === companyId) ?? null;
  }

  async listTrends(input: GetIndustryTrendsInput) {
    const periodDays = input.periodDays ?? 90;
    const codes = input.directionCodes ? new Set(input.directionCodes) : undefined;
    return this.trends
      .filter(item => item.periodDays === periodDays && (!codes || codes.has(item.directionCode)))
      .map(item => structuredClone(item));
  }

  async getIdempotency(ownerId: string, idempotencyKey: string) {
    const record = this.idempotency.get(`${ownerId}:${idempotencyKey}`);
    return record ? structuredClone(record) : null;
  }

  async saveIdempotency(record: CareerIdempotencyRecord) {
    this.idempotency.set(`${record.ownerId}:${record.idempotencyKey}`, structuredClone(record));
  }
}

export function emptyCareerJob(ctx: CareerContext, input: { title: string; description: string; companyId?: string; companyName?: string; directionCode?: string; city?: string; employmentType?: TargetJob["employmentType"]; salaryText?: string; source?: TargetJob["source"]; requirements?: JobRequirement[] }): TargetJob {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    ownerId: ctx.ownerId,
    title: input.title,
    companyId: input.companyId ?? (input.companyName ? companyIdForName(input.companyName) : undefined),
    companyName: input.companyName,
    directionCode: input.directionCode,
    city: input.city,
    employmentType: input.employmentType ?? "unknown",
    salaryText: input.salaryText,
    description: input.description,
    requirements: input.requirements ?? [],
    source: input.source ?? "manual",
    createdAt: now,
    updatedAt: now,
  };
}

export function idempotencyKeyFor(ctx: CareerContext) { return ctx.operationKey ?? ctx.requestId ?? randomUUID(); }
export function resultHash(value: unknown) { return JSON.stringify(value); }
export type StoredCareerResult = CareerCapabilityResult;
