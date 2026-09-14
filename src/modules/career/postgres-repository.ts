import type { Pool } from "pg";
import type { CareerRepository } from "./repository.ts";
import type { CareerIdempotencyRecord, CareerPlan, JobGapAnalysis, TargetJob } from "./contracts.ts";

const jobColumns = `id,owner_id AS "ownerId",title,company_name AS "companyName",direction_code AS "directionCode",city,employment_type AS "employmentType",salary_text AS "salaryText",description,requirements,source,created_at::text AS "createdAt",updated_at::text AS "updatedAt"`;

export class PostgresCareerRepository implements CareerRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async getPlan(ownerId: string, status?: CareerPlan["status"]) {
    const result = await this.pool.query<CareerPlan>(`SELECT id,owner_id AS "ownerId",status,version,direction_codes AS "directionCodes",target_job_id AS "targetJobId",target_company_name AS "targetCompanyName",target_city AS "targetCity",target_salary_text AS "targetSalaryText",rationale,updated_at::text AS "updatedAt" FROM career_plans WHERE owner_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY updated_at DESC LIMIT 1`, [ownerId, status ?? null]);
    return result.rows[0] ?? null;
  }

  async savePlan(plan: CareerPlan, expectedVersion?: number) {
    if (expectedVersion !== undefined) {
      const result = await this.pool.query(`UPDATE career_plans SET status=$1,version=$2,direction_codes=$3::jsonb,target_job_id=$4,target_company_name=$5,target_city=$6,target_salary_text=$7,rationale=$8,updated_at=$9 WHERE owner_id=$10 AND id=$11 AND version=$12`, [plan.status, plan.version, JSON.stringify(plan.directionCodes), plan.targetJobId ?? null, plan.targetCompanyName ?? null, plan.targetCity ?? null, plan.targetSalaryText ?? null, plan.rationale ?? null, plan.updatedAt, plan.ownerId, plan.id, expectedVersion]);
      return result.rowCount === 1;
    }
    await this.pool.query(`INSERT INTO career_plans (id,owner_id,status,version,direction_codes,target_job_id,target_company_name,target_city,target_salary_text,rationale,updated_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,version=EXCLUDED.version,direction_codes=EXCLUDED.direction_codes,target_job_id=EXCLUDED.target_job_id,target_company_name=EXCLUDED.target_company_name,target_city=EXCLUDED.target_city,target_salary_text=EXCLUDED.target_salary_text,rationale=EXCLUDED.rationale,updated_at=EXCLUDED.updated_at WHERE career_plans.owner_id=EXCLUDED.owner_id`, [plan.id, plan.ownerId, plan.status, plan.version, JSON.stringify(plan.directionCodes), plan.targetJobId ?? null, plan.targetCompanyName ?? null, plan.targetCity ?? null, plan.targetSalaryText ?? null, plan.rationale ?? null, plan.updatedAt]);
    return true;
  }

  async listJobs(ownerId: string, input: { directionCode?: string; keyword?: string; limit?: number }) {
    const result = await this.pool.query<TargetJob>(`SELECT ${jobColumns} FROM career_target_jobs WHERE owner_id=$1 AND ($2::text IS NULL OR direction_code=$2) AND ($3::text IS NULL OR (title||' '||coalesce(company_name,'')||' '||description) ILIKE '%'||$3||'%') ORDER BY created_at DESC LIMIT $4`, [ownerId, input.directionCode ?? null, input.keyword ?? null, input.limit ?? 20]);
    return result.rows;
  }

  async getJob(ownerId: string, jobId: string) {
    const result = await this.pool.query<TargetJob>(`SELECT ${jobColumns} FROM career_target_jobs WHERE owner_id=$1 AND id=$2`, [ownerId, jobId]);
    return result.rows[0] ?? null;
  }

  async saveJob(job: TargetJob) {
    await this.pool.query(`INSERT INTO career_target_jobs (id,owner_id,title,company_name,direction_code,city,employment_type,salary_text,description,requirements,source,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,company_name=EXCLUDED.company_name,direction_code=EXCLUDED.direction_code,city=EXCLUDED.city,employment_type=EXCLUDED.employment_type,salary_text=EXCLUDED.salary_text,description=EXCLUDED.description,requirements=EXCLUDED.requirements,source=EXCLUDED.source,updated_at=EXCLUDED.updated_at WHERE career_target_jobs.owner_id=EXCLUDED.owner_id`, [job.id, job.ownerId, job.title, job.companyName ?? null, job.directionCode ?? null, job.city ?? null, job.employmentType, job.salaryText ?? null, job.description, JSON.stringify(job.requirements), job.source, job.createdAt, job.updatedAt ?? job.createdAt]);
  }

  async saveGap(gap: JobGapAnalysis) {
    await this.pool.query(`INSERT INTO career_gap_analyses (id,owner_id,job_id,plan_id,match_score,possessed,partial,missing,unknown,recommended_actions,evidence_snapshot_at,created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12)`, [gap.id, gap.ownerId, gap.jobId, gap.planId ?? null, gap.matchScore, JSON.stringify(gap.possessed), JSON.stringify(gap.partial), JSON.stringify(gap.missing), JSON.stringify(gap.unknown), JSON.stringify(gap.recommendedActions), gap.evidenceSnapshotAt, gap.createdAt]);
  }

  async getLatestGap(ownerId: string, jobId: string) {
    const result = await this.pool.query<JobGapAnalysis>(`SELECT id,owner_id AS "ownerId",job_id AS "jobId",plan_id AS "planId",match_score AS "matchScore",possessed,partial,missing,unknown,recommended_actions AS "recommendedActions",evidence_snapshot_at::text AS "evidenceSnapshotAt",created_at::text AS "createdAt" FROM career_gap_analyses WHERE owner_id=$1 AND job_id=$2 ORDER BY created_at DESC LIMIT 1`, [ownerId, jobId]);
    return result.rows[0] ?? null;
  }

  async getIdempotency(ownerId: string, idempotencyKey: string) {
    const result = await this.pool.query<CareerIdempotencyRecord>(`SELECT owner_id AS "ownerId",idempotency_key AS "idempotencyKey",operation,request_hash AS "requestHash",result,created_at::text AS "createdAt" FROM career_idempotency_records WHERE owner_id=$1 AND idempotency_key=$2`, [ownerId, idempotencyKey]);
    return result.rows[0] ?? null;
  }

  async saveIdempotency(record: CareerIdempotencyRecord) {
    await this.pool.query(`INSERT INTO career_idempotency_records (owner_id,idempotency_key,operation,request_hash,result,created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT (owner_id,idempotency_key) DO NOTHING`, [record.ownerId, record.idempotencyKey, record.operation, record.requestHash, JSON.stringify(record.result), record.createdAt]);
  }
}
