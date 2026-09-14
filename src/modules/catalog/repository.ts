import type { Pool } from "pg";
import type { CatalogFilter, CatalogInterview, CatalogJob } from "./contracts.ts";

export class PostgresCatalogRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }
  async listJobs(filter: CatalogFilter = {}) {
    const values: unknown[] = []; const where: string[] = [];
    if (filter.keyword) { values.push(filter.keyword); where.push(`to_tsvector('simple', title || ' ' || coalesce(company_name,'') || ' ' || description) @@ plainto_tsquery('simple', $${values.length})`); }
    if (filter.city) { values.push(filter.city); where.push(`city ILIKE '%' || $${values.length} || '%'`); }
    if (filter.tag) { values.push(filter.tag); where.push(`tags ? $${values.length}`); }
    values.push(Math.min(filter.limit ?? 20, 100));
    const result = await this.pool.query<CatalogJob>(`SELECT id,source_id AS "sourceId",title,company_name AS "companyName",city,employment_type AS "employmentType",salary_text AS "salaryText",description,requirements,responsibilities,tags,source_url AS "sourceUrl",collected_at::text AS "collectedAt" FROM career_catalog_jobs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY collected_at DESC NULLS LAST,id LIMIT $${values.length}`, values);
    return result.rows;
  }
  async listInterviews(filter: CatalogFilter = {}) {
    const values: unknown[] = []; const where: string[] = [];
    if (filter.keyword) { values.push(filter.keyword); where.push(`to_tsvector('simple', title || ' ' || content) @@ plainto_tsquery('simple', $${values.length})`); }
    if (filter.tag) { values.push(filter.tag); where.push(`tags ? $${values.length}`); }
    values.push(Math.min(filter.limit ?? 20, 100));
    const result = await this.pool.query<CatalogInterview>(`SELECT id,source_id AS "sourceId",title,content,company_name AS "companyName",job_title AS "jobTitle",city,interview_round AS "interviewRound",result,question_count AS "questionCount",tags,source_url AS "sourceUrl",collected_at::text AS "collectedAt" FROM career_catalog_interviews ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY collected_at DESC NULLS LAST,id LIMIT $${values.length}`, values);
    return result.rows;
  }
}
