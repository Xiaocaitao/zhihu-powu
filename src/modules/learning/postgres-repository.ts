import type { Pool, PoolClient } from "pg";
import type { LearningAdjustment, LearningFeedback, LearningPlan, LearningStage, LearningTask, LearningTaskSchedule } from "./contracts.ts";
import type { LearningIdempotencyRecord, LearningRepository } from "./repository.ts";

type Row = Record<string, any>;

export class PostgresLearningRepository implements LearningRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async getPlan(ownerId: string, planId?: string) {
    const result = await this.pool.query<Row>(`
      SELECT id, owner_id AS "ownerId", mode, status,
        source_profile_version AS "sourceProfileVersion",
        source_career_plan_version AS "sourceCareerPlanVersion",
        target_job_id AS "targetJobId", start_date::text AS "startDate",
        end_date::text AS "endDate", weekly_minutes AS "weeklyMinutes",
        version, learning_goals AS "learningGoals",
        available_slots AS "availableSlots", sources,
        updated_at::text AS "updatedAt"
      FROM learning_plans
      WHERE owner_id = $1 AND ($2::uuid IS NULL OR id = $2::uuid)
      ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1`, [ownerId, planId ?? null]);
    if (!result.rowCount) return null;
    return this.hydratePlan(result.rows[0]);
  }

  async listPlans(ownerId: string) {
    const result = await this.pool.query<Row>(`
      SELECT id, owner_id AS "ownerId", mode, status,
        source_profile_version AS "sourceProfileVersion",
        source_career_plan_version AS "sourceCareerPlanVersion",
        target_job_id AS "targetJobId", start_date::text AS "startDate",
        end_date::text AS "endDate", weekly_minutes AS "weeklyMinutes",
        version, learning_goals AS "learningGoals",
        available_slots AS "availableSlots", sources,
        updated_at::text AS "updatedAt"
      FROM learning_plans
      WHERE owner_id = $1 AND status <> 'archived'
      ORDER BY updated_at DESC`, [ownerId]);
    return Promise.all(result.rows.map(row => this.hydratePlan(row)));
  }

  async savePlan(plan: LearningPlan) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.savePlanTx(client, plan);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async savePlanChange(plan: LearningPlan, adjustment?: LearningAdjustment) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.savePlanTx(client, plan);
      if (adjustment) await this.saveAdjustmentTx(client, adjustment);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async savePlanAndFeedback(plan: LearningPlan, feedback: LearningFeedback) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.savePlanTx(client, plan);
      await this.saveFeedbackTx(client, feedback);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async savePlans(plans: LearningPlan[]) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const plan of plans) await this.savePlanTx(client, plan);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async saveFeedback(feedback: LearningFeedback) {
    await this.pool.query(
      `INSERT INTO learning_feedback
        (id, owner_id, plan_id, task_id, difficulty, reason, actual_minutes,
         available_minutes, confidence_score, note, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [feedback.id, feedback.ownerId, feedback.planId, feedback.taskId ?? null,
        feedback.difficulty, feedback.reason ?? null, feedback.actualMinutes ?? null,
        feedback.availableMinutes ?? null, feedback.confidenceScore ?? null,
        feedback.note ?? null, feedback.createdAt],
    );
  }

  async listFeedback(ownerId: string, planId: string) {
    const result = await this.pool.query<Row>(
      `SELECT id, owner_id AS "ownerId", plan_id AS "planId", task_id AS "taskId",
        difficulty, reason, actual_minutes AS "actualMinutes",
        available_minutes AS "availableMinutes", confidence_score AS "confidenceScore",
        note, created_at::text AS "createdAt"
       FROM learning_feedback
       WHERE owner_id=$1 AND plan_id=$2
       ORDER BY created_at DESC`, [ownerId, planId]);
    return result.rows as LearningFeedback[];
  }

  async saveAdjustment(adjustment: LearningAdjustment) {
    await this.pool.query(
      `INSERT INTO learning_plan_adjustments
        (id, owner_id, plan_id, from_version, to_version, trigger, reason,
         change_summary, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
      [adjustment.id, adjustment.ownerId, adjustment.planId, adjustment.fromVersion,
        adjustment.toVersion, adjustment.trigger, adjustment.reason,
        JSON.stringify(adjustment.changeSummary), adjustment.createdAt],
    );
  }

  async listAdjustments(ownerId: string, planId: string) {
    const result = await this.pool.query<Row>(
      `SELECT id, owner_id AS "ownerId", plan_id AS "planId",
        from_version AS "fromVersion", to_version AS "toVersion", trigger,
        reason, change_summary AS "changeSummary", created_at::text AS "createdAt"
       FROM learning_plan_adjustments
       WHERE owner_id=$1 AND plan_id=$2
       ORDER BY to_version DESC`, [ownerId, planId]);
    return result.rows as LearningAdjustment[];
  }

  async getIdempotency(ownerId: string, key: string) {
    const result = await this.pool.query<Row>(
      `SELECT command_name AS "commandName", request_hash AS "requestHash",
        result_json AS result
       FROM learning_idempotency_records
       WHERE owner_id=$1 AND idempotency_key=$2`, [ownerId, key]);
    return result.rowCount ? result.rows[0] as LearningIdempotencyRecord : null;
  }

  async saveIdempotency(ownerId: string, key: string, record: LearningIdempotencyRecord) {
    await this.pool.query(
      `INSERT INTO learning_idempotency_records
        (owner_id, idempotency_key, command_name, request_id, request_hash, result_json)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT (owner_id, idempotency_key) DO NOTHING`,
      [ownerId, key, record.commandName, "learning", record.requestHash, JSON.stringify(record.result)],
    );
  }

  private async hydratePlan(row: Row): Promise<LearningPlan> {
    const stagesResult = await this.pool.query<Row>(
      `SELECT id, plan_id AS "planId", stage_order AS "order", title, objective,
        status, start_date::text AS "startDate", end_date::text AS "endDate",
        assessment_required AS "assessmentRequired", assessment_id AS "assessmentId",
        progress_percent AS "progressPercent"
       FROM learning_stages WHERE plan_id=$1 ORDER BY stage_order`, [row.id]);
    const stages = stagesResult.rows as LearningStage[];
    const stageIds = stages.map(stage => stage.id);
    const tasksResult = stageIds.length ? await this.pool.query<Row>(
      `SELECT id, stage_id AS "stageId", title, description, task_type AS "taskType",
        status, priority, estimated_minutes AS "estimatedMinutes",
        actual_minutes AS "actualMinutes", capability_key AS "capabilityKey",
        evidence_required AS "evidenceRequired", parent_task_id AS "parentTaskId",
        created_at::text AS "createdAt", updated_at::text AS "updatedAt"
       FROM learning_tasks WHERE stage_id = ANY($1::uuid[]) ORDER BY stage_id, priority, created_at`, [stageIds]) : { rows: [] as Row[] };
    const taskIds = tasksResult.rows.map(task => task.id);
    const schedulesResult = taskIds.length ? await this.pool.query<Row>(
      `SELECT id, task_id AS "taskId", schedule_date::text AS "scheduleDate",
        start_at::text AS "startAt", end_at::text AS "endAt",
        duration_minutes AS "durationMinutes", status
       FROM learning_task_schedules WHERE task_id = ANY($1::uuid[])
       ORDER BY schedule_date, start_at NULLS LAST`, [taskIds]) : { rows: [] as Row[] };
    const schedulesByTask = new Map<string, LearningTaskSchedule[]>();
    for (const schedule of schedulesResult.rows as LearningTaskSchedule[]) {
      const list = schedulesByTask.get(schedule.taskId) ?? [];
      list.push(schedule);
      schedulesByTask.set(schedule.taskId, list);
    }
    for (const stage of stages) {
      stage.tasks = tasksResult.rows.filter(task => task.stageId === stage.id).map(task => ({
        ...task,
        schedules: schedulesByTask.get(task.id) ?? [],
        scheduleDate: schedulesByTask.get(task.id)?.[0]?.scheduleDate,
      } as LearningTask));
    }
    return {
      ...row,
      learningGoals: row.learningGoals ?? [],
      availableSlots: row.availableSlots ?? [],
      sources: row.sources ?? [],
      stages,
    } as LearningPlan;
  }

  private async savePlanTx(client: PoolClient, plan: LearningPlan) {
    const existing = await client.query<{ version: number }>(
      `SELECT version FROM learning_plans WHERE owner_id=$1 AND id=$2 FOR UPDATE`, [plan.ownerId, plan.id]);
    if (!existing.rowCount) {
      await client.query(
        `INSERT INTO learning_plans
          (id, owner_id, mode, status, source_profile_version,
           source_career_plan_version, target_job_id, start_date, end_date,
           weekly_minutes, version, learning_goals, available_slots, sources,
           created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15,$15)`,
        [plan.id, plan.ownerId, plan.mode, plan.status, plan.sourceProfileVersion,
          plan.sourceCareerPlanVersion ?? null, plan.targetJobId ?? null, plan.startDate,
          plan.endDate, plan.weeklyMinutes, plan.version, JSON.stringify(plan.learningGoals),
          JSON.stringify(plan.availableSlots ?? []), JSON.stringify(plan.sources ?? []), plan.updatedAt],
      );
    } else {
      const updated = await client.query(
        `UPDATE learning_plans SET mode=$3, status=$4, source_profile_version=$5,
          source_career_plan_version=$6, target_job_id=$7, start_date=$8, end_date=$9,
          weekly_minutes=$10, version=$11, learning_goals=$12::jsonb,
          available_slots=$13::jsonb, sources=$14::jsonb, updated_at=$15
         WHERE owner_id=$1 AND id=$2 AND version=$16`,
        [plan.ownerId, plan.id, plan.mode, plan.status, plan.sourceProfileVersion,
          plan.sourceCareerPlanVersion ?? null, plan.targetJobId ?? null, plan.startDate,
          plan.endDate, plan.weeklyMinutes, plan.version, JSON.stringify(plan.learningGoals),
          JSON.stringify(plan.availableSlots ?? []), JSON.stringify(plan.sources ?? []),
          plan.updatedAt, plan.version - 1],
      );
      if (!updated.rowCount) throw new Error("VERSION_CONFLICT");
    }
    await client.query("DELETE FROM learning_stages WHERE plan_id=$1", [plan.id]);
    for (const stage of plan.stages) {
      await client.query(
        `INSERT INTO learning_stages
          (id, plan_id, stage_order, title, objective, start_date, end_date,
           status, assessment_required, assessment_id, progress_percent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [stage.id, plan.id, stage.order, stage.title, stage.objective,
          stage.startDate ?? plan.startDate, stage.endDate ?? plan.endDate,
          stage.status, stage.assessmentRequired ?? false, stage.assessmentId ?? null,
          stage.progressPercent ?? 0],
      );
    }
    const tasks = plan.stages.flatMap(stage => stage.tasks);
    for (const task of tasks) {
      await client.query(
        `INSERT INTO learning_tasks
          (id, stage_id, parent_task_id, title, description, task_type, status,
           priority, estimated_minutes, actual_minutes, capability_key,
           evidence_required, created_at, updated_at)
         VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
        [task.id, task.stageId, task.title, task.description, task.taskType, task.status,
          task.priority, task.estimatedMinutes, task.actualMinutes ?? null,
          task.capabilityKey ?? null, task.evidenceRequired, task.updatedAt ?? plan.updatedAt],
      );
    }
    for (const task of tasks) {
      if (task.parentTaskId) await client.query("UPDATE learning_tasks SET parent_task_id=$2 WHERE id=$1", [task.id, task.parentTaskId]);
      for (const schedule of task.schedules ?? []) {
        await client.query(
          `INSERT INTO learning_task_schedules
            (id, task_id, schedule_date, start_at, end_at, duration_minutes, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [schedule.id, task.id, schedule.scheduleDate, schedule.startAt ?? null,
            schedule.endAt ?? null, schedule.durationMinutes, schedule.status],
        );
      }
    }
  }

  private async saveAdjustmentTx(client: PoolClient, adjustment: LearningAdjustment) {
    await client.query(
      `INSERT INTO learning_plan_adjustments
        (id, owner_id, plan_id, from_version, to_version, trigger, reason,
         change_summary, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
      [adjustment.id, adjustment.ownerId, adjustment.planId, adjustment.fromVersion,
        adjustment.toVersion, adjustment.trigger, adjustment.reason,
        JSON.stringify(adjustment.changeSummary), adjustment.createdAt],
    );
  }

  private async saveFeedbackTx(client: PoolClient, feedback: LearningFeedback) {
    await client.query(
      `INSERT INTO learning_feedback
        (id, owner_id, plan_id, task_id, difficulty, reason, actual_minutes,
         available_minutes, confidence_score, note, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [feedback.id, feedback.ownerId, feedback.planId, feedback.taskId ?? null,
        feedback.difficulty, feedback.reason ?? null, feedback.actualMinutes ?? null,
        feedback.availableMinutes ?? null, feedback.confidenceScore ?? null,
        feedback.note ?? null, feedback.createdAt],
    );
  }
}
