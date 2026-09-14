import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  Assessment, Interview, LearningRecord, LearningRecordFilter, Project, RecordRevision, Review,
} from "./contracts.ts";
import type { EvidenceRepository, StoredOperation } from "./repository.ts";
import { decodeCursor } from "./pagination.ts";

const recordColumns = `id AS "recordId", owner_id AS "ownerId", kind, status, title, content,
  occurred_at AS "occurredAt", duration_minutes AS "durationMinutes", task_id AS "taskId",
  skill_ids AS "skillIds", version, created_at AS "createdAt", updated_at AS "updatedAt",
  project_id AS "projectId", details,
  jsonb_build_object('domain', source_domain, 'entityId', source_entity_id, 'revision', source_revision) AS source`;

const json = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;

function recordFromRow(raw: Record<string, unknown>): LearningRecord {
  // The JSON document written in the same transaction is authoritative for the
  // aggregate; the columns exist for ownership, ordering and filtering.
  const { details, source, status, version } = raw as { details: object; source: object; status: string; version: number };
  return json<LearningRecord>({ ...details, source, status, version });
}

function interviewFromRow(raw: { details: Interview | null; status?: string; answeredCount?: number; version?: number; endedAt?: string | null }): Interview {
  const details = raw.details ?? ({} as Interview);
  return json<Interview>({ ...details,
    ...(raw.status ? { status: raw.status as Interview["status"] } : {}),
    ...(raw.version !== undefined ? { version: raw.version } : {}) });
}

/** PostgreSQL adapter. Business validation and owner checks stay in EvidenceService. */
export class PostgresEvidenceRepository implements EvidenceRepository {
  private readonly pool: Pool;
  private readonly client?: PoolClient;
  constructor(pool: Pool, client?: PoolClient) { this.pool = pool; this.client = client; }
  private get db() { return this.client ?? this.pool; }

  async transaction<T>(ownerId: string, run: (repository: EvidenceRepository) => Promise<T>): Promise<T> {
    if (this.client) return run(this);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Serialize mutations of the same owner's aggregates across processes.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`evidence:${ownerId}`]);
      const result = await run(new PostgresEvidenceRepository(this.pool, client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async getOperation(ownerId: string, capability: string, operationKey: string) {
    const result = await this.db.query<StoredOperation>(
      `SELECT owner_id AS "ownerId", capability, operation_key AS "operationKey", payload_hash AS "payloadHash", result
       FROM ei_operations WHERE owner_id=$1 AND capability=$2 AND operation_key=$3`,
      [ownerId, capability, operationKey],
    );
    return result.rows[0] ? json<StoredOperation>(result.rows[0]) : null;
  }
  async saveOperation(operation: StoredOperation) {
    await this.db.query(
      `INSERT INTO ei_operations (id, owner_id, capability, operation_key, payload_hash, entity_id, phase, result)
       VALUES ($1,$2,$3,$4,$5,$6,'committed',$7::jsonb)`,
      [randomUUID(), operation.ownerId, operation.capability, operation.operationKey,
        operation.payloadHash, operation.result.entityId ?? null, JSON.stringify(operation.result)],
    );
  }

  async createRecord(record: LearningRecord) {
    await this.db.query(
      `INSERT INTO ei_records (id,owner_id,kind,status,title,content,occurred_at,duration_minutes,
        task_id,skill_ids,version,source_domain,source_entity_id,source_revision,created_at,updated_at,project_id,details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)`,
      [record.recordId, record.ownerId, record.kind, record.status, record.title, record.content,
        record.occurredAt, record.durationMinutes, record.taskId ?? null,
        JSON.stringify(record.skillRefs.map(skill => skill.skillId)), record.version,
        record.source.domain, record.source.entityId, record.source.revision,
        record.createdAt, record.updatedAt, record.projectId ?? null, JSON.stringify(record)],
    );
  }
  async getRecord(ownerId: string, recordId: string) {
    const result = await this.db.query(`SELECT ${recordColumns} FROM ei_records WHERE owner_id=$1 AND id=$2`, [ownerId, recordId]);
    return result.rows[0] ? recordFromRow(result.rows[0]) : null;
  }
  async getSourceRecord(ownerId: string, sourceDomain: string, sourceEntityId: string) {
    const result = await this.db.query(
      `SELECT ${recordColumns} FROM ei_records WHERE owner_id=$1 AND source_domain=$2 AND source_entity_id=$3`,
      [ownerId, sourceDomain, sourceEntityId],
    );
    return result.rows[0] ? recordFromRow(result.rows[0]) : null;
  }
  async listRecords(ownerId: string, filter: LearningRecordFilter) {
    const values: unknown[] = [ownerId];
    const where = ["owner_id=$1"];
    if (!filter.includeWithdrawn) where.push("status='active'");
    if (filter.from) { values.push(filter.from); where.push(`occurred_at >= $${values.length}`); }
    if (filter.to) { values.push(filter.to); where.push(`occurred_at < $${values.length}`); }
    if (filter.kind) { values.push(filter.kind); where.push(`kind = $${values.length}`); }
    if (filter.kinds?.length) { values.push(filter.kinds); where.push(`kind = ANY($${values.length}::text[])`); }
    if (filter.taskId) { values.push(filter.taskId); where.push(`task_id = $${values.length}`); }
    if (filter.skillId) { values.push(filter.skillId); where.push(`skill_ids ? $${values.length}`); }
    if (filter.cursor) {
      const cursor = decodeCursor(filter.cursor);
      values.push(cursor.at, cursor.id);
      where.push(`(occurred_at,id) < ($${values.length - 1}::timestamptz,$${values.length}::uuid)`);
    }
    values.push(Math.min(Math.max(filter.limit ?? 100, 1), 101));
    const result = await this.db.query(
      `SELECT ${recordColumns} FROM ei_records WHERE ${where.join(" AND ")}
       ORDER BY occurred_at DESC,id DESC LIMIT $${values.length}`,
      values,
    );
    return result.rows.map(recordFromRow);
  }
  async updateRecord(record: LearningRecord) {
    await this.db.query(
      `UPDATE ei_records SET status=$3,title=$4,content=$5,occurred_at=$6,duration_minutes=$7,task_id=$8,
       skill_ids=$9::jsonb,version=$10,updated_at=$11,details=$12::jsonb,source_revision=$13
       WHERE owner_id=$1 AND id=$2`,
      [record.ownerId, record.recordId, record.status, record.title, record.content, record.occurredAt,
        record.durationMinutes, record.taskId ?? null, JSON.stringify(record.skillRefs.map(skill => skill.skillId)),
        record.version, record.updatedAt, JSON.stringify(record), record.source.revision],
    );
  }
  async saveRevision(revision: RecordRevision) {
    await this.db.query(
      `INSERT INTO ei_record_revisions (owner_id,record_id,version,snapshot,created_at)
       VALUES ($1,$2,$3,$4::jsonb,$5) ON CONFLICT (owner_id,record_id,version) DO NOTHING`,
      [revision.ownerId, revision.recordId, revision.version, JSON.stringify(revision.snapshot), revision.createdAt],
    );
  }
  async listRevisions(ownerId: string, recordId: string) {
    const result = await this.db.query(
      `SELECT owner_id AS "ownerId",record_id AS "recordId",version,snapshot,created_at AS "createdAt"
       FROM ei_record_revisions WHERE owner_id=$1 AND record_id=$2 ORDER BY version`,
      [ownerId, recordId],
    );
    return json<RecordRevision[]>(result.rows);
  }

  async saveProject(project: Project) {
    await this.db.query(
      `INSERT INTO ei_projects (id,owner_id,title,goal,version,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (owner_id,id) DO UPDATE SET title=EXCLUDED.title,goal=EXCLUDED.goal,
       version=EXCLUDED.version,updated_at=EXCLUDED.updated_at`,
      [project.projectId, project.ownerId, project.title, project.goal, project.version, project.createdAt, project.updatedAt],
    );
  }
  async getProject(ownerId: string, projectId: string) {
    const result = await this.db.query<Project>(
      `SELECT id AS "projectId",owner_id AS "ownerId",title,goal,version,created_at AS "createdAt",updated_at AS "updatedAt"
       FROM ei_projects WHERE owner_id=$1 AND id=$2`,
      [ownerId, projectId],
    );
    return result.rows[0] ?? null;
  }
  async listProjects(ownerId: string) {
    const result = await this.db.query<Project>(
      `SELECT id AS "projectId",owner_id AS "ownerId",title,goal,version,created_at AS "createdAt",updated_at AS "updatedAt"
       FROM ei_projects WHERE owner_id=$1 ORDER BY created_at DESC,id DESC`,
      [ownerId],
    );
    return result.rows;
  }

  async saveAssessment(assessment: Assessment) {
    await this.db.query(
      `INSERT INTO ei_assessments (id,owner_id,evidence_ids,skill_ids,status,findings,operation_key,details)
       VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6::jsonb,$7,$8::jsonb)
       ON CONFLICT (owner_id,id) DO UPDATE SET status=EXCLUDED.status,findings=EXCLUDED.findings,details=EXCLUDED.details`,
      [assessment.assessmentId, assessment.ownerId, JSON.stringify(assessment.evidenceIds),
        JSON.stringify(assessment.skillIds), assessment.status, JSON.stringify(assessment.findings),
        assessment.assessmentId, JSON.stringify(assessment)],
    );
  }
  async listAssessments(ownerId: string) {
    const result = await this.db.query<{ details: Assessment }>(
      `SELECT details FROM ei_assessments WHERE owner_id=$1 ORDER BY created_at DESC,id DESC`,
      [ownerId],
    );
    return result.rows.map(row => json<Assessment>(row.details));
  }

  async saveReview(review: Review) {
    await this.db.query(
      `INSERT INTO ei_reviews (id,owner_id,range_from,range_to,time_zone,status,result,operation_key,details,stage_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10)
       ON CONFLICT (owner_id,id) DO UPDATE SET status=EXCLUDED.status,result=EXCLUDED.result,
       details=EXCLUDED.details,stage_id=EXCLUDED.stage_id`,
      [review.reviewId, review.ownerId, review.range.from, review.range.to, review.range.timeZone,
        review.status, JSON.stringify(review), review.reviewId, JSON.stringify(review), review.stageId],
    );
  }
  async listReviews(ownerId: string) {
    const result = await this.db.query<{ details: Review }>(
      `SELECT details FROM ei_reviews WHERE owner_id=$1 ORDER BY created_at DESC,id DESC`,
      [ownerId],
    );
    return result.rows.map(row => json<Review>(row.details));
  }

  async saveInterview(interview: Interview): Promise<void> {
    if (!this.client) return this.transaction(interview.ownerId, repository => repository.saveInterview(interview));
    // Refuse a stale aggregate: if a question is already stored under another
    // answer id, this snapshot was computed before a concurrent write and must
    // not overwrite the header, details or feedback.
    for (const answer of interview.answers) {
      const existing = await this.db.query<{ id: string }>(
        "SELECT id FROM ei_answers WHERE owner_id=$1 AND interview_id=$2 AND question_id=$3",
        [interview.ownerId, interview.interviewId, answer.questionId],
      );
      if (existing.rows[0] && existing.rows[0].id !== answer.answerId) {
        throw new Error("STALE_INTERVIEW_AGGREGATE");
      }
    }
    await this.db.query(
      `INSERT INTO ei_interviews (id,owner_id,target,status,total_questions,answered_count,version,operation_key,ended_at,details)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10::jsonb)
       ON CONFLICT (owner_id,id) DO UPDATE SET status=EXCLUDED.status,total_questions=EXCLUDED.total_questions,
       answered_count=EXCLUDED.answered_count,version=EXCLUDED.version,ended_at=EXCLUDED.ended_at,details=EXCLUDED.details`,
      [interview.interviewId, interview.ownerId, JSON.stringify(interview.target), interview.status,
        interview.totalQuestions, interview.answeredCount, interview.version, interview.interviewId,
        interview.endedAt, JSON.stringify(interview)],
    );
    for (const question of interview.questions) {
      await this.db.query(
        `INSERT INTO ei_questions (id,owner_id,interview_id,ordinal,category,prompt,skill_ids,details)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
         ON CONFLICT (owner_id,interview_id,ordinal) DO NOTHING`,
        [question.questionId, interview.ownerId, interview.interviewId, question.ordinal, question.category,
          question.prompt, JSON.stringify(question.skillRefs.map(skill => skill.skillId)), JSON.stringify(question)],
      );
    }
    for (const answer of interview.answers) {
      const inserted = await this.db.query(
        `INSERT INTO ei_answers (id,owner_id,interview_id,question_id,text,text_hash,details)
         VALUES ($1,$2,$3,$4,$5,md5($5),$6::jsonb)
         ON CONFLICT (owner_id,interview_id,question_id) DO NOTHING
         RETURNING id`,
        [answer.answerId, interview.ownerId, interview.interviewId, answer.questionId, answer.text, JSON.stringify(answer)],
      );
      // A concurrent writer may already own this question with another answer
      // row; writing feedback for a row that was not inserted would violate the
      // answer foreign key, so the feedback is skipped in that case.
      let ownsAnswer = Boolean(inserted.rowCount);
      if (!ownsAnswer) {
        const existing = await this.db.query<{ id: string }>(
          "SELECT id FROM ei_answers WHERE owner_id=$1 AND interview_id=$2 AND question_id=$3",
          [interview.ownerId, interview.interviewId, answer.questionId],
        );
        ownsAnswer = existing.rows[0]?.id === answer.answerId;
      }
      if (ownsAnswer && answer.feedback) {
        await this.db.query(
          `INSERT INTO ei_answer_feedback (id,owner_id,answer_id,status,result,operation_key)
           VALUES (gen_random_uuid(),$1,$2::uuid,$3,$4::jsonb,$2::uuid::text)
           ON CONFLICT (owner_id,answer_id) DO UPDATE SET status=EXCLUDED.status,result=EXCLUDED.result,updated_at=now()`,
          [interview.ownerId, answer.answerId, answer.feedback.status === "succeeded" ? "succeeded" : "failed",
            JSON.stringify(answer.feedback)],
        );
      }
    }
    if (interview.report) {
      await this.db.query(
        `INSERT INTO ei_interview_reports (id,owner_id,interview_id,status,result,operation_key,details)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$5::jsonb)
         ON CONFLICT (owner_id,interview_id) DO UPDATE SET status=EXCLUDED.status,result=EXCLUDED.result,details=EXCLUDED.details`,
        [interview.report.reportId, interview.ownerId, interview.interviewId, interview.report.status,
          JSON.stringify(interview.report), interview.report.reportId],
      );
    }
  }

  async getInterview(ownerId: string, interviewId: string) {
    const result = await this.db.query(
      `SELECT details,status,answered_count AS "answeredCount",version,ended_at AS "endedAt"
       FROM ei_interviews WHERE owner_id=$1 AND id=$2`,
      [ownerId, interviewId],
    );
    return result.rows[0] ? interviewFromRow(result.rows[0]) : null;
  }
  async listInterviews(ownerId: string) {
    const result = await this.db.query(
      `SELECT details,status,answered_count AS "answeredCount",version,ended_at AS "endedAt"
       FROM ei_interviews WHERE owner_id=$1 ORDER BY created_at DESC,id DESC`,
      [ownerId],
    );
    return result.rows.map(interviewFromRow);
  }
}
