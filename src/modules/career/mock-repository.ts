import type {
  CareerPlanDTO,
  JobGapAnalysisDTO,
  TargetJobDTO,
} from "./contracts.ts";
import type { CareerRepository } from "./repository.ts";

const clone = <T>(value: T): T => structuredClone(value);

const seedJobs: TargetJobDTO[] = [
  {
    id: "seed-backend-intern",
    ownerId: "__seed__",
    title: "后端开发实习生",
    companyName: "示例科技",
    directionCode: "backend_engineering",
    city: "杭州",
    employmentType: "internship",
    salaryText: "面议",
    description: "参与服务端功能开发、接口设计和线上问题排查，配合团队完成稳定性建设。",
    requirements: [
      { id: "req-backend-1", skillCode: "typescript", skillName: "TypeScript", importance: "required", expectedLevel: 3, evidenceHints: ["项目代码", "接口开发"] },
      { id: "req-backend-2", skillCode: "sql", skillName: "SQL 数据库", importance: "required", expectedLevel: 3, evidenceHints: ["数据建模", "查询优化"] },
      { id: "req-backend-3", skillCode: "system_design", skillName: "系统设计", importance: "preferred", expectedLevel: 2, evidenceHints: ["架构图", "技术方案"] },
    ],
    source: "seed",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  },
  {
    id: "seed-data-platform",
    ownerId: "__seed__",
    title: "数据平台工程实习生",
    companyName: "示例数据实验室",
    directionCode: "data_platform",
    city: "上海",
    employmentType: "internship",
    salaryText: "面议",
    description: "参与数据处理链路、任务编排和平台工具建设，关注可观测性与数据质量。",
    requirements: [
      { id: "req-data-1", skillCode: "python", skillName: "Python", importance: "required", expectedLevel: 3, evidenceHints: ["数据脚本", "自动化任务"] },
      { id: "req-data-2", skillCode: "sql", skillName: "SQL 数据库", importance: "required", expectedLevel: 3, evidenceHints: ["数据查询", "数据建模"] },
      { id: "req-data-3", skillCode: "llm_orchestration", skillName: "LLM 应用编排", importance: "preferred", expectedLevel: 2, evidenceHints: ["Agent 流程", "工具调用"] },
    ],
    source: "seed",
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
  },
];

export class MockCareerRepository implements CareerRepository {
  private readonly plans = new Map<string, CareerPlanDTO>();
  private readonly jobs = new Map<string, TargetJobDTO>();
  private readonly analyses = new Map<string, JobGapAnalysisDTO>();
  private readonly idempotency = new Map<string, unknown>();

  async getPlan(ownerId: string, planId?: string): Promise<CareerPlanDTO | null> {
    const plan = planId ? this.plans.get(planId) : [...this.plans.values()].find((item) => item.ownerId === ownerId && item.status !== "archived");
    return plan && plan.ownerId === ownerId ? clone(plan) : null;
  }

  async savePlan(plan: CareerPlanDTO): Promise<void> {
    this.plans.set(plan.id, clone(plan));
  }

  async listJobs(ownerId: string): Promise<TargetJobDTO[]> {
    const ownJobs = [...this.jobs.values()].filter((job) => job.ownerId === ownerId);
    const seeds = seedJobs.map((job) => ({ ...clone(job), ownerId }));
    return [...seeds, ...ownJobs.map(clone)];
  }

  async getJob(ownerId: string, jobId: string): Promise<TargetJobDTO | null> {
    const own = this.jobs.get(jobId);
    if (own && own.ownerId === ownerId) return clone(own);
    const seed = seedJobs.find((job) => job.id === jobId);
    return seed ? { ...clone(seed), ownerId } : null;
  }

  async saveJob(job: TargetJobDTO): Promise<void> {
    this.jobs.set(job.id, clone(job));
  }

  async getLatestGapAnalysis(ownerId: string, jobId: string): Promise<JobGapAnalysisDTO | null> {
    const item = this.analyses.get(`${ownerId}:${jobId}`);
    return item ? clone(item) : null;
  }

  async saveGapAnalysis(analysis: JobGapAnalysisDTO): Promise<void> {
    this.analyses.set(`${analysis.ownerId}:${analysis.jobId}`, clone(analysis));
  }

  async getIdempotentResult(ownerId: string, key: string): Promise<unknown | null> {
    return this.idempotency.get(`${ownerId}:${key}`) ?? null;
  }

  async saveIdempotentResult(ownerId: string, key: string, result: unknown): Promise<void> {
    this.idempotency.set(`${ownerId}:${key}`, clone(result));
  }
}
