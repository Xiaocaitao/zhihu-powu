import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AdjustmentOperation, LearningFeedbackDTO, LearningPlanDTO, LearningStageContext, LearningTaskContext, LearningTaskDTO, PlanMode, RecordLearningFeedbackInput, ScheduleStatus, TaskStatus } from "./contracts.ts";
import { LearningError } from "./contracts.ts";
import { clone, type AdjustmentHistory, type AdjustmentResult, type IdempotencyRecord, type LearningRepository, type NewPlan } from "./repository.ts";

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;
type PlanRow = { id: string; owner_id: string; mode: PlanMode; status: LearningPlanDTO["status"]; source_profile_version: number; source_career_plan_version: number | null; target_job_id: string | null; start_date: string; end_date: string; weekly_minutes: number; version: number; created_at: string; updated_at: string };
type StageRow = { id: string; plan_id: string; stage_order: number; title: string; objective: string; start_date: string | null; end_date: string | null; status: string; assessment_required: boolean; assessment_id: string | null; progress_percent: number };
type TaskRow = { id: string; plan_id: string; stage_id: string; parent_task_id: string | null; title: string; description: string; task_type: LearningTaskDTO["taskType"]; status: TaskStatus; priority: number; estimated_minutes: number; actual_minutes: number; capability_key: string | null; evidence_required: boolean; created_at: string; updated_at: string };
type ScheduleRow = { id: string; task_id: string; schedule_date: string; start_at: string | null; end_at: string | null; duration_minutes: number; status: ScheduleStatus };
type TaskContextRow = { task_id: string; plan_id: string; stage_id: string; title: string; capability_key: string | null; evidence_required: boolean };
type StageContextRow = { stage_id: string; plan_id: string; title: string; objective: string; stage_order: number };
type FeedbackRow = { feedback_id: string; plan_id: string; task_id: string | null; difficulty: LearningFeedbackDTO["difficulty"]; reason: LearningFeedbackDTO["reason"] | null; actual_minutes: number | null; available_minutes: number | null; confidence_score: number | null; note: string | null; created_at: string };

export class PostgresLearningRepository implements LearningRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async getActivePlan(ownerId: string, includeTasks: boolean) {
    const result = await this.pool.query<{ id: string }>(`SELECT id FROM learning_plans WHERE owner_id=$1 AND status IN ('draft','active','paused') ORDER BY (mode='final' AND status='active') DESC, (status='active') DESC, updated_at DESC LIMIT 1`, [ownerId]);
    return result.rows[0] ? this.getPlan(ownerId, result.rows[0].id, includeTasks) : null;
  }

  async getPlan(ownerId: string, planId: string, includeTasks: boolean) {
    return this.readPlan(this.pool, ownerId, planId, includeTasks);
  }

  async getTodayTasks(ownerId: string, date: string) {
    const rows = await this.pool.query<TaskRow & { schedule_id: string; schedule_date: string; start_at: string | null; end_at: string | null; duration_minutes: number; schedule_status: ScheduleStatus }>(`SELECT t.id,t.stage_id,s.plan_id,t.parent_task_id,t.title,t.description,t.task_type,t.status,t.priority,t.estimated_minutes,t.actual_minutes,t.capability_key,t.evidence_required,t.created_at::text,t.updated_at::text, ts.id AS schedule_id,ts.schedule_date::text,ts.start_at::text,ts.end_at::text,ts.duration_minutes,ts.status AS schedule_status FROM learning_task_schedules ts JOIN learning_tasks t ON t.id=ts.task_id JOIN learning_stages s ON s.id=t.stage_id JOIN learning_plans p ON p.id=s.plan_id WHERE p.owner_id=$1 AND p.status IN ('draft','active','paused') AND ts.schedule_date=$2 ORDER BY ts.schedule_date,t.priority,t.id`, [ownerId, date]);
    return rows.rows.map(row => this.taskFromRow(row, [{ id: row.schedule_id, task_id: row.id, schedule_date: row.schedule_date, start_at: row.start_at, end_at: row.end_at, duration_minutes: row.duration_minutes, status: row.schedule_status }]));
  }

  async createPlan(input: NewPlan) {
    const db = await this.pool.connect();
    const planId = randomUUID();
    try {
      await db.query("BEGIN");
      if (input.mode === "final") {
        const existing = await db.query("SELECT 1 FROM learning_plans WHERE owner_id=$1 AND mode='final' AND status='active' FOR UPDATE", [input.ownerId]);
        if (existing.rowCount) throw new LearningError("INVALID_STATE", "当前用户已有 active final 学习计划");
      }
      await db.query(`INSERT INTO learning_plans (id,owner_id,mode,status,source_profile_version,source_career_plan_version,target_job_id,start_date,end_date,weekly_minutes,version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1)`, [planId, input.ownerId, input.mode, input.mode === "trial" ? "draft" : "active", input.sourceProfileVersion, input.sourceCareerPlanVersion ?? null, input.targetJobId ?? null, input.startDate, input.endDate, input.weeklyMinutes]);
      for (const [stageIndex, stage] of input.stages.entries()) {
        const stageId = randomUUID();
        await db.query(`INSERT INTO learning_stages (id,plan_id,stage_order,title,objective,start_date,end_date,status,assessment_required,progress_percent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,0)`, [stageId, planId, stageIndex + 1, stage.title, stage.objective, stage.startDate, stage.endDate, stageIndex === 0 ? "active" : "planned"]);
        for (const [taskIndex, task] of stage.tasks.entries()) {
          const taskId = randomUUID();
          await db.query(`INSERT INTO learning_tasks (id,stage_id,title,description,task_type,status,priority,estimated_minutes,actual_minutes,capability_key,evidence_required) VALUES ($1,$2,$3,$4,$5,'todo',$6,$7,0,$8,$9)`, [taskId, stageId, task.title, task.description, task.taskType, taskIndex + 1, task.estimatedMinutes, task.capabilityKey ?? null, task.evidenceRequired ?? false]);
          await db.query(`INSERT INTO learning_task_schedules (id,task_id,schedule_date,duration_minutes,status) VALUES ($1,$2,$3,$4,'scheduled')`, [randomUUID(), taskId, stage.startDate, task.estimatedMinutes]);
        }
      }
      await db.query("COMMIT");
      const plan = await this.getPlan(input.ownerId, planId, true);
      if (!plan) throw new Error("created learning plan could not be read");
      return plan;
    } catch (error) { await db.query("ROLLBACK").catch(() => undefined); throw error; } finally { db.release(); }
  }

  async updateTaskStatus(ownerId: string, taskId: string, status: TaskStatus, actualMinutes: number | undefined, expectedPlanVersion?: number) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const current = await db.query<TaskRow & { plan_version: number; plan_status: LearningPlanDTO["status"] }>(`SELECT t.*,p.id AS plan_id,p.version AS plan_version,p.status AS plan_status FROM learning_tasks t JOIN learning_stages s ON s.id=t.stage_id JOIN learning_plans p ON p.id=s.plan_id WHERE t.id=$1 AND p.owner_id=$2 FOR UPDATE`, [taskId, ownerId]);
      const row = current.rows[0];
      if (!row) { await db.query("ROLLBACK"); return null; }
      this.assertVersion(row.plan_version, expectedPlanVersion);
      this.assertWritable(row.plan_status);
      if (!validTaskTransition(row.status, status)) throw new LearningError("INVALID_STATE", `任务不能从 ${row.status} 变更为 ${status}`);
      await db.query(`UPDATE learning_tasks SET status=$2,actual_minutes=COALESCE($3,actual_minutes),updated_at=now() WHERE id=$1`, [taskId, status, actualMinutes ?? null]);
      if (status === "completed") await db.query("UPDATE learning_task_schedules SET status='done' WHERE task_id=$1", [taskId]);
      await this.bumpPlan(db, row.plan_id);
      await this.refreshStage(db, row.stage_id);
      await this.refreshPlanState(db, row.plan_id);
      await db.query("COMMIT");
      const plan = await this.getPlan(ownerId, row.plan_id, true);
      return plan?.stages.flatMap(stage => stage.tasks ?? []).find(task => task.taskId === taskId) ?? null;
    } catch (error) { await db.query("ROLLBACK").catch(() => undefined); throw error; } finally { db.release(); }
  }

  async recordFeedback(ownerId: string, input: RecordLearningFeedbackInput, expectedPlanVersion?: number) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const plan = await db.query<{ id: string; version: number; status: LearningPlanDTO["status"] }>("SELECT id,version,status FROM learning_plans WHERE id=$1 AND owner_id=$2 FOR UPDATE", [input.planId, ownerId]);
      if (!plan.rows[0]) { await db.query("ROLLBACK"); return null; }
      this.assertVersion(plan.rows[0].version, expectedPlanVersion);
      this.assertWritable(plan.rows[0].status, false);
      if (input.taskId) { const task = await db.query("SELECT t.id FROM learning_tasks t JOIN learning_stages s ON s.id=t.stage_id WHERE t.id=$1 AND s.plan_id=$2", [input.taskId, input.planId]); if (!task.rowCount) throw new LearningError("NOT_FOUND", "反馈任务不属于该计划"); }
      const id = randomUUID();
      const inserted = await db.query<FeedbackRow>(`INSERT INTO learning_feedback (id,plan_id,task_id,difficulty,reason,actual_minutes,available_minutes,confidence_score,note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id AS feedback_id,plan_id,task_id,difficulty,reason,actual_minutes,available_minutes,confidence_score,note,created_at::text AS created_at`, [id, input.planId, input.taskId ?? null, input.difficulty, input.reason ?? null, input.actualMinutes ?? null, input.availableMinutes ?? null, input.confidenceScore ?? null, input.note ?? null]);
      await db.query("COMMIT");
      return this.feedbackFromRow(inserted.rows[0]);
    } catch (error) { await db.query("ROLLBACK").catch(() => undefined); throw error; } finally { db.release(); }
  }

  async adjustPlan(ownerId: string, planId: string, expectedVersion: number | undefined, _mode: PlanMode, trigger: string, reason: string, operations: AdjustmentOperation[]): Promise<AdjustmentResult | null> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const planResult = await db.query<{ id: string; version: number; status: LearningPlanDTO["status"] }>("SELECT id,version,status FROM learning_plans WHERE id=$1 AND owner_id=$2 FOR UPDATE", [planId, ownerId]);
      const plan = planResult.rows[0];
      if (!plan) { await db.query("ROLLBACK"); return null; }
      this.assertVersion(plan.version, expectedVersion);
      this.assertWritable(plan.status);
      const summary: unknown[] = [];
      for (const operation of operations) {
        const task = await db.query<TaskRow & { stage_plan_id: string; stage_id: string }>(`SELECT t.*,s.plan_id AS stage_plan_id,s.id AS stage_id FROM learning_tasks t JOIN learning_stages s ON s.id=t.stage_id WHERE t.id=$1 AND s.plan_id=$2 FOR UPDATE`, [operation.type === "change_order" ? operation.taskIds[0] : operation.taskId, planId]);
        if (!task.rows[0]) throw new LearningError("NOT_FOUND", "调整操作包含不属于当前计划的任务");
        if (operation.type === "split_task") {
          if (task.rows[0].status === "completed") throw new LearningError("INVALID_STATE", "已完成任务不能拆分");
          const schedule = await db.query<{ schedule_date: string }>("SELECT schedule_date::text FROM learning_task_schedules WHERE task_id=$1 ORDER BY schedule_date,id LIMIT 1", [operation.taskId]);
          const date = schedule.rows[0]?.schedule_date;
          const createdTaskIds: string[] = [];
          for (const [index, newTask] of operation.newTasks.entries()) {
            const newId = randomUUID(); createdTaskIds.push(newId);
            await db.query(`INSERT INTO learning_tasks (id,stage_id,parent_task_id,title,description,task_type,status,priority,estimated_minutes,actual_minutes,capability_key,evidence_required) VALUES ($1,$2,$3,$4,$5,$6,'todo',$7,$8,0,$9,$10)`, [newId, task.rows[0].stage_id, operation.taskId, newTask.title, newTask.description ?? "", newTask.taskType ?? "practice", task.rows[0].priority + index + 1, newTask.estimatedMinutes, task.rows[0].capability_key, task.rows[0].evidence_required]);
            if (date) await db.query(`INSERT INTO learning_task_schedules (id,task_id,schedule_date,duration_minutes,status) VALUES ($1,$2,$3,$4,'scheduled')`, [randomUUID(), newId, date, newTask.estimatedMinutes]);
          }
          await db.query("UPDATE learning_tasks SET status='paused',updated_at=now() WHERE id=$1", [operation.taskId]);
          summary.push({ type: operation.type, taskId: operation.taskId, createdTaskIds });
        } else if (operation.type === "reschedule") {
          const updated = await db.query("UPDATE learning_task_schedules SET schedule_date=$2,status='rescheduled' WHERE task_id=$1", [operation.taskId, operation.scheduleDate]);
          if (!updated.rowCount) await db.query(`INSERT INTO learning_task_schedules (id,task_id,schedule_date,duration_minutes,status) VALUES ($1,$2,$3,$4,'rescheduled')`, [randomUUID(), operation.taskId, operation.scheduleDate, task.rows[0].estimated_minutes]);
          summary.push({ type: operation.type, taskId: operation.taskId, scheduleDate: operation.scheduleDate });
        } else if (operation.type === "replace_resource") {
          await db.query("UPDATE learning_tasks SET description=trim(description || E'\\n资源：' || $2),updated_at=now() WHERE id=$1", [operation.taskId, operation.resource]);
          summary.push({ type: operation.type, taskId: operation.taskId });
        } else {
          const tasks = await db.query<{ id: string; stage_id: string }>(`SELECT t.id,t.stage_id FROM learning_tasks t JOIN learning_stages s ON s.id=t.stage_id WHERE s.plan_id=$1 AND t.id = ANY($2::uuid[])`, [planId, operation.taskIds]);
          if (tasks.rowCount !== operation.taskIds.length || new Set(tasks.rows.map(item => item.stage_id)).size !== 1) throw new LearningError("INVALID_ARGUMENT", "调整顺序的任务必须属于同一阶段");
          for (const [index, id] of operation.taskIds.entries()) await db.query("UPDATE learning_tasks SET priority=$2,updated_at=now() WHERE id=$1", [id, index + 1]);
          summary.push({ type: operation.type, taskIds: operation.taskIds });
        }
      }
      const toVersion = plan.version + 1;
      await db.query("UPDATE learning_stages SET progress_percent=COALESCE((SELECT round(100.0 * COUNT(*) FILTER (WHERE status='completed') / NULLIF(COUNT(*),0))::int FROM learning_tasks WHERE stage_id=learning_stages.id),0),status=CASE WHEN NOT EXISTS (SELECT 1 FROM learning_tasks WHERE stage_id=learning_stages.id AND status <> 'completed') THEN 'completed' WHEN status='completed' THEN 'active' ELSE status END WHERE plan_id=$1", [planId]);
      await this.refreshPlanState(db, planId);
      await db.query("UPDATE learning_plans SET version=$2,updated_at=now() WHERE id=$1", [planId, toVersion]);
      await db.query("INSERT INTO learning_plan_adjustments (id,plan_id,from_version,to_version,trigger,reason,change_summary) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)", [randomUUID(), planId, plan.version, toVersion, trigger, reason, JSON.stringify(summary)]);
      await db.query("COMMIT");
      const adjusted = await this.getPlan(ownerId, planId, true);
      if (!adjusted) throw new Error("adjusted learning plan could not be read");
      return { plan: adjusted, fromVersion: plan.version, toVersion, changeSummary: summary };
    } catch (error) { await db.query("ROLLBACK").catch(() => undefined); throw error; } finally { db.release(); }
  }

  async confirmPlan(ownerId: string, planId: string, expectedVersion: number, keepUnfinishedTasks: boolean) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const current = await db.query<{ id: string; mode: PlanMode; status: LearningPlanDTO["status"]; version: number }>("SELECT id,mode,status,version FROM learning_plans WHERE id=$1 AND owner_id=$2 FOR UPDATE", [planId, ownerId]);
      const plan = current.rows[0];
      if (!plan) { await db.query("ROLLBACK"); return null; }
      if (plan.mode !== "trial") throw new LearningError("INVALID_STATE", "只有 trial 计划可以确认");
      this.assertVersion(plan.version, expectedVersion); this.assertWritable(plan.status);
      await db.query("UPDATE learning_plans SET status='archived',updated_at=now() WHERE owner_id=$1 AND mode='final' AND status='active'", [ownerId]);
      if (!keepUnfinishedTasks) await db.query("UPDATE learning_tasks t SET status='paused',updated_at=now() FROM learning_stages s WHERE t.stage_id=s.id AND s.plan_id=$1 AND t.status <> 'completed'", [planId]);
      const nextVersion = plan.version + 1;
      await db.query("UPDATE learning_plans SET mode='final',status='active',version=$2,updated_at=now() WHERE id=$1", [planId, nextVersion]);
      await db.query("COMMIT");
      return this.getPlan(ownerId, planId, true);
    } catch (error) { await db.query("ROLLBACK").catch(() => undefined); throw error; } finally { db.release(); }
  }

  async getTaskContext(ownerId: string, taskId: string) {
    const result = await this.pool.query<TaskContextRow>(`SELECT t.id AS task_id,s.plan_id,t.stage_id,t.title,t.capability_key,t.evidence_required FROM learning_tasks t JOIN learning_stages s ON s.id=t.stage_id JOIN learning_plans p ON p.id=s.plan_id WHERE t.id=$1 AND p.owner_id=$2`, [taskId, ownerId]);
    const row = result.rows[0];
    return row ? { taskId: row.task_id, planId: row.plan_id, stageId: row.stage_id, title: row.title, capabilityKey: row.capability_key ?? undefined, evidenceRequired: row.evidence_required } : null;
  }

  async getStageContext(ownerId: string, stageId: string) {
    const result = await this.pool.query<StageContextRow>(`SELECT s.id AS stage_id,s.plan_id,s.title,s.objective,s.stage_order FROM learning_stages s JOIN learning_plans p ON p.id=s.plan_id WHERE s.id=$1 AND p.owner_id=$2`, [stageId, ownerId]);
    const row = result.rows[0];
    return row ? { stageId: row.stage_id, planId: row.plan_id, title: row.title, objective: row.objective, stageOrder: row.stage_order } : null;
  }

  async getCompletedCapabilityKeys(ownerId: string, planId?: string) {
    const result = await this.pool.query<{ capability_key: string }>(`SELECT DISTINCT t.capability_key FROM learning_tasks t JOIN learning_stages s ON s.id=t.stage_id JOIN learning_plans p ON p.id=s.plan_id WHERE p.owner_id=$1 AND t.status='completed' AND t.capability_key IS NOT NULL AND ($2::uuid IS NULL OR p.id=$2)`, [ownerId, planId ?? null]);
    return result.rows.map(row => row.capability_key);
  }

  async listAdjustments(ownerId: string, planId: string): Promise<AdjustmentHistory[]> {
    const result = await this.pool.query<{ id: string; plan_id: string; from_version: number; to_version: number; trigger: string; reason: string; change_summary: unknown }>(`SELECT a.id,a.plan_id,a.from_version,a.to_version,a.trigger,a.reason,a.change_summary FROM learning_plan_adjustments a JOIN learning_plans p ON p.id=a.plan_id WHERE a.plan_id=$1 AND p.owner_id=$2 ORDER BY a.created_at,a.id`, [planId, ownerId]);
    return result.rows.map(row => ({ id: row.id, planId: row.plan_id, fromVersion: row.from_version, toVersion: row.to_version, trigger: row.trigger, reason: row.reason, changeSummary: clone(row.change_summary) }));
  }

  async getIdempotency(ownerId: string, key: string) {
    const result = await this.pool.query<{ command_name: string; request_hash: string; result_json: unknown }>("SELECT command_name,request_hash,result_json FROM learning_idempotency_records WHERE owner_id=$1 AND idempotency_key=$2", [ownerId, key]);
    const row = result.rows[0]; return row ? { commandName: row.command_name, requestHash: row.request_hash, result: clone(row.result_json) } : null;
  }

  async saveIdempotency(ownerId: string, key: string, commandName: string, requestId: string, requestHash: string, result: unknown) {
    const inserted = await this.pool.query("INSERT INTO learning_idempotency_records (owner_id,idempotency_key,command_name,request_id,request_hash,result_json) VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT (owner_id,idempotency_key) DO NOTHING", [ownerId, key, commandName, requestId, requestHash, JSON.stringify(result)]);
    if (!inserted.rowCount) {
      const previous = await this.getIdempotency(ownerId, key);
      if (previous && (previous.commandName !== commandName || previous.requestHash !== requestHash)) throw new LearningError("DUPLICATE_REQUEST", "相同幂等键对应了不同的请求参数");
    }
  }

  private async readPlan(db: Queryable, ownerId: string, planId: string, includeTasks: boolean): Promise<LearningPlanDTO | null> {
    const planResult = await db.query<PlanRow>("SELECT id,owner_id,mode,status,source_profile_version,source_career_plan_version,target_job_id,start_date::text,end_date::text,weekly_minutes,version,created_at::text,updated_at::text FROM learning_plans WHERE id=$1 AND owner_id=$2", [planId, ownerId]);
    const row = planResult.rows[0]; if (!row) return null;
    const stageResult = await db.query<StageRow>("SELECT id,plan_id,stage_order,title,objective,start_date::text,end_date::text,status,assessment_required,assessment_id,progress_percent FROM learning_stages WHERE plan_id=$1 ORDER BY stage_order", [planId]);
    const stages = stageResult.rows.map(stage => ({ stageId: stage.id, planId: stage.plan_id, stageOrder: stage.stage_order, title: stage.title, objective: stage.objective, startDate: stage.start_date ?? undefined, endDate: stage.end_date ?? undefined, status: stage.status, assessmentRequired: stage.assessment_required, assessmentId: stage.assessment_id ?? undefined, progressPercent: stage.progress_percent, tasks: undefined as LearningTaskDTO[] | undefined }));
    if (includeTasks) {
      const taskResult = await db.query<TaskRow>("SELECT t.id,t.stage_id,s.plan_id,t.parent_task_id,t.title,t.description,t.task_type,t.status,t.priority,t.estimated_minutes,t.actual_minutes,t.capability_key,t.evidence_required,t.created_at::text,t.updated_at::text FROM learning_tasks t JOIN learning_stages s ON s.id=t.stage_id WHERE s.plan_id=$1 ORDER BY s.stage_order,t.priority,t.id", [planId]);
      const scheduleResult = await db.query<ScheduleRow>("SELECT ts.id,ts.task_id,ts.schedule_date::text,ts.start_at::text,ts.end_at::text,ts.duration_minutes,ts.status FROM learning_task_schedules ts JOIN learning_tasks t ON t.id=ts.task_id JOIN learning_stages s ON s.id=t.stage_id WHERE s.plan_id=$1 ORDER BY ts.schedule_date,ts.id", [planId]);
      const schedules = new Map<string, ScheduleRow[]>(); for (const schedule of scheduleResult.rows) schedules.set(schedule.task_id, [...(schedules.get(schedule.task_id) ?? []), schedule]);
      for (const stage of stages) stage.tasks = taskResult.rows.filter(task => task.stage_id === stage.stageId).map(task => this.taskFromRow(task, schedules.get(task.id) ?? []));
    }
    return { planId: row.id, ownerId: row.owner_id, mode: row.mode, status: row.status, sourceProfileVersion: row.source_profile_version, sourceCareerPlanVersion: row.source_career_plan_version ?? undefined, targetJobId: row.target_job_id ?? undefined, startDate: row.start_date, endDate: row.end_date, weeklyMinutes: row.weekly_minutes, version: row.version, stages, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  private taskFromRow(task: TaskRow, schedules: ScheduleRow[]): LearningTaskDTO { return { taskId: task.id, planId: task.plan_id, stageId: task.stage_id, parentTaskId: task.parent_task_id ?? undefined, title: task.title, description: task.description, taskType: task.task_type, status: task.status, priority: task.priority, estimatedMinutes: task.estimated_minutes, actualMinutes: task.actual_minutes, capabilityKey: task.capability_key ?? undefined, evidenceRequired: task.evidence_required, schedules: schedules.map(schedule => ({ id: schedule.id, taskId: schedule.task_id, scheduleDate: schedule.schedule_date, startAt: schedule.start_at ?? undefined, endAt: schedule.end_at ?? undefined, durationMinutes: schedule.duration_minutes, status: schedule.status })), createdAt: task.created_at, updatedAt: task.updated_at }; }
  private feedbackFromRow(row: FeedbackRow): LearningFeedbackDTO { return { feedbackId: row.feedback_id, planId: row.plan_id, taskId: row.task_id ?? undefined, difficulty: row.difficulty, reason: row.reason ?? undefined, actualMinutes: row.actual_minutes ?? undefined, availableMinutes: row.available_minutes ?? undefined, confidenceScore: row.confidence_score ?? undefined, note: row.note ?? undefined, createdAt: row.created_at }; }
  private assertVersion(actual: number, expected?: number) { if (expected !== undefined && actual !== expected) throw new LearningError("VERSION_CONFLICT", "学习计划版本已变化，请刷新后重试", true); }
  private assertWritable(status: LearningPlanDTO["status"], allowPaused = true) { if (!["draft", "active", ...(allowPaused ? ["paused"] : [])].includes(status)) throw new LearningError("INVALID_STATE", "当前学习计划状态不允许此操作"); }
  private async bumpPlan(db: Queryable, planId: string) { await db.query("UPDATE learning_plans SET version=version+1,updated_at=now() WHERE id=$1", [planId]); }
  private async refreshStage(db: Queryable, stageId: string) { await db.query("UPDATE learning_stages SET progress_percent=COALESCE((SELECT round(100.0 * COUNT(*) FILTER (WHERE status='completed') / NULLIF(COUNT(*),0))::int FROM learning_tasks WHERE stage_id=$1),0),status=CASE WHEN NOT EXISTS (SELECT 1 FROM learning_tasks WHERE stage_id=$1 AND status <> 'completed') THEN 'completed' ELSE status END WHERE id=$1", [stageId]); }
  private async refreshPlanState(db: Queryable, planId: string) { const remaining = await db.query("SELECT 1 FROM learning_tasks t JOIN learning_stages s ON s.id=t.stage_id WHERE s.plan_id=$1 AND t.status <> 'completed' LIMIT 1", [planId]); if (!remaining.rowCount) await db.query("UPDATE learning_plans SET status='completed',updated_at=now() WHERE id=$1", [planId]); else await db.query("UPDATE learning_stages SET status='active' WHERE id=(SELECT id FROM learning_stages WHERE plan_id=$1 AND status <> 'completed' ORDER BY stage_order LIMIT 1) AND status='planned'", [planId]); }
}

function validTaskTransition(from: TaskStatus, to: TaskStatus) { return from === to || from === "todo" && ["in_progress", "completed", "paused"].includes(to) || from === "in_progress" && ["todo", "completed", "paused"].includes(to) || from === "paused" && ["todo", "in_progress"].includes(to); }
