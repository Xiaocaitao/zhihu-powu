import { randomUUID } from "node:crypto";
import type { SkillDefinition, SkillRef } from "../skills/contracts.ts";
import type {
  Assessment, CapabilityResult, EvidenceContext, Interview, InterviewTarget, LearningRecord, Page, Project,
  RecordChanges, RecordDTO, RecordInput, RecordQuery, RecordRevision, RecoveryHint, Review, ReviewDTO,
  ReviewSummary, SkillCardDTO, SkillFinding, SourceRef, InterviewSummary, MaterialState,
} from "./contracts.ts";
import {
  GenerationError, type EvidenceGenerationPort, type EvidenceItemInput, type InterviewPlanInput,
  type ReportContent, type ReviewContent, type ReviewInput,
} from "./generation.ts";
import type { Coverage, EvidencePorts, MaterialContent, SourceChange } from "./ports.ts";
import { currentWeek, encodeCursor, scopeHash, validateCursor } from "./pagination.ts";

export type EvidenceState = {
  records: LearningRecord[];
  projects: Project[];
  interviews: Interview[];
  assessments: Assessment[];
  reviews: Review[];
};

export type EvidenceDependencies = {
  generation: EvidenceGenerationPort;
  ports: EvidencePorts;
  now?: () => Date;
};

const DEFAULT_QUESTION_COUNT = 5;
const MAX_REVIEW_DAYS = 366;

function ok<T>(data: T, summary: string, extra: Partial<CapabilityResult<T>> = {}): CapabilityResult<T> {
  return { ok: true, changed: false, domain: "evidence", status: "read", summary, data, ...extra };
}
function fail<T = never>(code: NonNullable<CapabilityResult<T>["error"]>["code"], message: string, retryable = false): CapabilityResult<T> {
  return { ok: false, changed: false, domain: "evidence", status: "rejected", summary: message,
    error: { code, message, retryable } };
}

export class EvidenceService {
  private readonly generation: EvidenceGenerationPort;
  private readonly ports: EvidencePorts;
  private readonly clock: () => Date;
  constructor(dependencies: EvidenceDependencies) {
    this.generation = dependencies.generation;
    this.ports = dependencies.ports;
    this.clock = dependencies.now ?? (() => new Date());
  }
  private now() { return this.clock().toISOString(); }

  /* ----------------------------- records ---------------------------- */
  async createRecord(ctx: EvidenceContext, state: EvidenceState, input: RecordInput): Promise<CapabilityResult<{
    record: LearningRecord;
    project: Project | null;
    pendingAssociations: { source: string; id: string; reason: string }[];
    missingInformation: string[];
  }>> {
    const recordId = randomUUID();
    const now = this.now();
    const source: SourceRef = { domain: "evidence", entityId: recordId, revision: "1" };
    const pendingAssociations: { source: string; id: string; reason: string }[] = [];
    const missingInformation: string[] = [];
    const coverage: Coverage = { complete: true, missing: [], observedAt: now };
    const addMissing = (sourceName: string, reason: string) => {
      coverage.complete = false;
      coverage.missing.push({ source: sourceName, reason });
    };

    let project: Project | null = null;
    let projectId: string | null = null;
    let contribution: string | null = null;
    let contributionPending = false;
    const projectInput = input.project;
    if (projectInput) {
      if ("projectId" in projectInput) {
        const existing = state.projects.find(item => item.projectId === projectInput.projectId);
        if (!existing) return fail("NOT_FOUND", "关联的项目不存在或不可访问");
        projectId = existing.projectId;
        project = existing;
      } else {
        project = {
          projectId: randomUUID(), ownerId: ctx.ownerId, title: projectInput.title, goal: projectInput.goal,
          version: 1, createdAt: now, updatedAt: now,
        };
        projectId = project.projectId;
        contribution = projectInput.contribution ?? null;
        contributionPending = projectInput.contributionPending;
        if (contributionPending) {
          missingInformation.push("尚未说明本人在项目中的具体贡献，该成果暂不能作为个人能力证据");
          addMissing("project.contribution", "缺少本人贡献说明");
        }
      }
    }
    if (input.kind === "project_outcome" && !projectId) return fail("INVALID_ARGUMENT", "项目成果必须提供项目及本人贡献信息");

    if (input.taskId) {
      const task = await this.ports.learning?.getTask(ctx, input.taskId);
      if (!task?.value) {
        const reason = task?.coverage.missing[0]?.reason ?? "学习计划模块查询不可用";
        pendingAssociations.push({ source: "learning", id: input.taskId, reason });
        addMissing("learning.task", "任务关联未确认，记录已保存");
      }
    }

    const materials = input.materialRefs ?? [];
    let materialState: MaterialState = materials.length ? "pending" : "none";
    if (materials.length) {
      const resolved = await this.ports.knowledge?.resolveMaterials(ctx, materials);
      if (!resolved?.value) {
        const reason = resolved?.coverage.missing[0]?.reason ?? "材料服务不可用，已先保存记录";
        pendingAssociations.push({ source: "knowledge", id: materials.map(item => item.documentId).join(","), reason });
        addMissing("knowledge.material", "材料引用尚未核对");
      } else {
        const unusable = resolved.value.filter(item => item.state !== "available");
        materialState = !unusable.length ? "available" : unusable.length === resolved.value.length ? "unavailable" : "partial";
        for (const item of unusable) {
          const reason = item.reason ?? "材料不可用";
          addMissing("knowledge.material", reason);
          pendingAssociations.push({ source: "knowledge", id: item.reference.documentId, reason });
        }
      }
    }
    if (input.materialsPending && materialState === "none") materialState = "pending";

    const skillIds = input.skillIds ?? [];
    const resolvedSkills = await this.resolveSkills(skillIds);
    if (resolvedSkills.missingIds.length) {
      missingInformation.push(`以下能力标识不在共享目录中：${resolvedSkills.missingIds.join("、")}`);
      addMissing("skills", "能力标识未统一");
    }
    if (input.durationMinutes === undefined) missingInformation.push("未提供实际用时，时间线不会以预计用时代替");

    const record: LearningRecord = {
      recordId, ownerId: ctx.ownerId, version: 1, kind: input.kind, status: "active",
      title: input.title, content: input.content, occurredAt: input.occurredAt,
      durationMinutes: input.durationMinutes ?? null, projectId, taskId: input.taskId ?? null,
      skillRefs: resolvedSkills.items.map(({ skillId, name }) => ({ skillId, name })),
      evidenceId: randomUUID(), materials, source, materialState, sourceState: "current",
      completion: input.completion ?? null, contribution, contributionPending,
      createdAt: now, updatedAt: now, pendingAssociations, missingInformation, coverage, withdrawalReason: null,
    };
    return ok({ record, project, pendingAssociations, missingInformation },
      coverage.complete ? "学习记录已保存" : "学习记录已保存，部分关联待补充",
      { changed: true, status: "applied", entityId: recordId, version: 1 });
  }

  async amendRecord(ctx: EvidenceContext, state: EvidenceState, recordId: string, changes: RecordChanges): Promise<CapabilityResult<{
    record: LearningRecord; revision: RecordRevision; invalidatedAssessmentIds: string[]; affectedReviewIds: string[];
  }>> {
    const record = state.records.find(item => item.recordId === recordId);
    if (!record) return fail("NOT_FOUND", "记录不存在");
    if (record.status === "withdrawn") return fail("INVALID_STATE", "已撤回的记录不能修改，请重新记录并引用原记录");
    if (ctx.expectedVersion !== record.version) {
      return fail("VERSION_CONFLICT", `记录已被更新（当前版本 ${record.version}），请重新读取后再修改`);
    }
    if (changes.taskId) {
      const task = await this.ports.learning?.getTask(ctx, changes.taskId);
      if (!task?.value) return fail("INVALID_ARGUMENT", "关联的学习任务不存在或不可访问");
    }
    const revision: RecordRevision = {
      ownerId: ctx.ownerId, recordId, version: record.version, snapshot: toDto(record), createdAt: this.now(),
    };
    const updated: LearningRecord = { ...record, version: record.version + 1, updatedAt: this.now() };
    if (changes.title !== undefined) updated.title = changes.title;
    if (changes.content !== undefined) updated.content = changes.content;
    if (changes.occurredAt !== undefined) updated.occurredAt = changes.occurredAt;
    if (changes.durationMinutes !== undefined) updated.durationMinutes = changes.durationMinutes;
    if (changes.durationUnknown) updated.durationMinutes = null;
    if (changes.taskId !== undefined) updated.taskId = changes.taskId;
    if (changes.completion !== undefined) updated.completion = changes.completion;
    if (changes.contribution !== undefined) {
      updated.contribution = changes.contribution;
      updated.contributionPending = false;
      updated.missingInformation = updated.missingInformation.filter(item => !item.includes("贡献"));
    }
    if (changes.skillIds !== undefined) {
      const resolved = await this.resolveSkills(changes.skillIds);
      if (resolved.missingIds.length) return fail("INVALID_ARGUMENT", `以下能力标识不在共享目录中：${resolved.missingIds.join("、")}`);
      updated.skillRefs = resolved.items.map(({ skillId, name }) => ({ skillId, name }));
    }
    if (changes.materialRefs !== undefined) {
      updated.materials = changes.materialRefs;
      updated.materialState = changes.materialRefs.length ? "pending" : "none";
      if (changes.materialRefs.length) {
        const resolved = await this.ports.knowledge?.resolveMaterials(ctx, changes.materialRefs);
        if (resolved?.value) {
          const unusable = resolved.value.filter(item => item.state !== "available");
          updated.materialState = !unusable.length ? "available" : unusable.length === resolved.value.length ? "unavailable" : "partial";
        }
      }
    }
    if (changes.materialsPending && updated.materialState === "none") updated.materialState = "pending";
    updated.source = { ...record.source, revision: String(updated.version) };
    const invalidated = this.staleAssessments(state, recordId);
    const affectedReviews = this.affectedReviews(state, record);
    return ok({
      record: updated, revision,
      invalidatedAssessmentIds: invalidated.map(item => item.assessmentId),
      affectedReviewIds: affectedReviews.map(item => item.reviewId),
    }, invalidated.length ? "记录已修正，相关评估已标记为需要重新评估" : "记录已修正",
    { changed: true, status: "applied", entityId: recordId, version: updated.version });
  }

  async withdrawRecord(ctx: EvidenceContext, state: EvidenceState, recordId: string, reason: string): Promise<CapabilityResult<{
    record: LearningRecord; revision: RecordRevision; invalidatedAssessmentIds: string[]; affectedReviewIds: string[];
  }>> {
    const record = state.records.find(item => item.recordId === recordId);
    if (!record) return fail("NOT_FOUND", "记录不存在");
    if (record.status === "withdrawn") {
      return ok({
        record, revision: { ownerId: ctx.ownerId, recordId, version: record.version, snapshot: toDto(record), createdAt: record.updatedAt },
        invalidatedAssessmentIds: [], affectedReviewIds: [],
      }, "该记录此前已撤回");
    }
    if (ctx.expectedVersion !== record.version) {
      return fail("VERSION_CONFLICT", `记录已被更新（当前版本 ${record.version}），请重新读取后再撤回`);
    }
    const revision: RecordRevision = {
      ownerId: ctx.ownerId, recordId, version: record.version, snapshot: toDto(record), createdAt: this.now(),
    };
    const updated: LearningRecord = {
      ...record, status: "withdrawn", sourceState: "withdrawn", withdrawalReason: reason,
      version: record.version + 1, updatedAt: this.now(),
    };
    updated.source = { ...record.source, revision: String(updated.version) };
    const invalidated = this.staleAssessments(state, recordId);
    const affectedReviews = this.affectedReviews(state, record);
    return ok({
      record: updated, revision,
      invalidatedAssessmentIds: invalidated.map(item => item.assessmentId),
      affectedReviewIds: affectedReviews.map(item => item.reviewId),
    }, "记录已撤回，相关评估不再有效", { changed: true, status: "applied", entityId: recordId, version: updated.version });
  }

  /** Trusted source modules push confirmed changes; the same fact is never counted twice. */
  async applySourceChange(ctx: EvidenceContext, state: EvidenceState, change: SourceChange): Promise<CapabilityResult<{
    record: LearningRecord; duplicate: boolean;
  }>> {
    const existing = state.records.find(record =>
      record.source.domain === change.sourceDomain && record.source.entityId === change.sourceEntityId);
    if (existing && Number(existing.source.revision) >= change.sourceRevision) {
      return ok({ record: existing, duplicate: true }, "同一来源修订已同步，未重复计数");
    }
    const now = this.now();
    const withdrawn = change.change === "withdrawn";
    if (existing) {
      const updated: LearningRecord = {
        ...existing, title: change.snapshot.title, content: change.snapshot.content,
        occurredAt: change.occurredAt, taskId: change.snapshot.taskId ?? existing.taskId,
        durationMinutes: change.durationMinutes ?? existing.durationMinutes,
        kind: change.kind as LearningRecord["kind"], status: withdrawn ? "withdrawn" : "active",
        sourceState: withdrawn ? "withdrawn" : "current",
        version: existing.version + 1, updatedAt: now,
        source: { ...existing.source, revision: String(change.sourceRevision) },
      };
      if (change.activityRef) updated.activityRef = change.activityRef;
      return ok({ record: updated, duplicate: false }, "来源变化已同步",
        { changed: true, status: "applied", entityId: updated.recordId, version: updated.version });
    }
    const recordId = randomUUID();
    const resolved = await this.resolveSkills(change.snapshot.skillIds ?? []);
    const record: LearningRecord = {
      recordId, ownerId: ctx.ownerId, version: 1, kind: change.kind as LearningRecord["kind"],
      status: withdrawn ? "withdrawn" : "active",
      title: change.snapshot.title, content: change.snapshot.content, occurredAt: change.occurredAt,
      durationMinutes: change.durationMinutes ?? null, projectId: null, taskId: change.snapshot.taskId ?? null,
      skillRefs: resolved.items.map(({ skillId, name }) => ({ skillId, name })),
      evidenceId: null, materials: [],
      source: { domain: change.sourceDomain, entityId: change.sourceEntityId, revision: String(change.sourceRevision) },
      materialState: "none", sourceState: withdrawn ? "withdrawn" : "current",
      completion: null, contribution: null, contributionPending: false,
      createdAt: now, updatedAt: now, pendingAssociations: [], missingInformation: [],
      coverage: { complete: true, missing: [], observedAt: now }, withdrawalReason: null,
      ...(change.activityRef ? { activityRef: change.activityRef } : {}),
    };
    return ok({ record, duplicate: false }, "来源变化已记录",
      { changed: true, status: "applied", entityId: recordId, version: 1 });
  }

  async queryRecords(ctx: EvidenceContext, state: EvidenceState, query: RecordQuery): Promise<CapabilityResult<
    | { record: RecordDTO; coverage: Coverage }
    | { page: Page<RecordDTO>; range: { from: string | null; to: string | null; timeZone: string }; coverage: Coverage }
  >> {
    if ("mode" in query && query.mode === "detail") {
      const record = state.records.find(item => item.recordId === query.recordId);
      if (!record) return fail("NOT_FOUND", "记录不存在");
      return ok({ record: toDto(record), coverage: record.coverage }, "已读取记录详情");
    }
    const list = query as Exclude<RecordQuery, { mode: "detail" }>;
    const timeZone = ctx.timeZone ?? "Asia/Shanghai";
    let from = list.from ?? null;
    let to = list.to ?? null;
    if (list.weekOf) {
      const week = currentWeek(timeZone, new Date(list.weekOf));
      from = week.from; to = week.to;
    }
    const kinds = list.kinds ?? (list.kind ? [list.kind] : undefined);
    const scope = scopeHash(ctx.ownerId, { from, to, kinds, taskId: list.taskId, skillId: list.skillId, timeZone });
    try { validateCursor(list.cursor, scope); }
    catch { return fail("INVALID_ARGUMENT", "分页游标无效或不属于当前筛选范围"); }
    const limit = list.limit ?? 20;
    const filtered = state.records
      .filter(record => record.ownerId === ctx.ownerId && record.status === "active")
      // 时间比较一律按时刻（epoch）而不是字符串：ISO 允许携带不同偏移量，
      // 字符串比较会把 +08:00 与 Z 的同一时刻排错。
      .filter(record => !from || Date.parse(record.occurredAt) >= Date.parse(from))
      .filter(record => !to || Date.parse(record.occurredAt) < Date.parse(to))
      .filter(record => !kinds || kinds.includes(record.kind))
      .filter(record => !list.taskId || record.taskId === list.taskId)
      .filter(record => !list.skillId || record.skillRefs.some(skill => skill.skillId === list.skillId))
      .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || b.recordId.localeCompare(a.recordId));
    const after = list.cursor ? filtered.filter(record => {
      const cursor = decodeCursorPayload(list.cursor!);
      const at = Date.parse(record.occurredAt);
      const cursorAt = Date.parse(cursor.at);
      return at < cursorAt || (at === cursorAt && record.recordId < cursor.id);
    }) : filtered;
    const items = after.slice(0, limit).map(toDto);
    const hasMore = after.length > limit;
    const last = items.at(-1);
    const coverage: Coverage = { complete: true, missing: [], observedAt: this.now() };
    for (const name of ["learning", "knowledge"] as const) {
      if (this.ports[name]) continue;
      coverage.complete = false;
      coverage.missing.push({ source: name, reason: `${name} 查询未接入，时间线可能缺少该来源的历史变化` });
    }
    return ok({
      page: { items, hasMore, nextCursor: hasMore && last ? encodeCursor(last.occurredAt, last.recordId, scope) : null },
      range: { from, to, timeZone }, coverage,
    }, "已读取学习记录");
  }

  /* --------------------------- assessments -------------------------- */
  async assessEvidence(ctx: EvidenceContext, state: EvidenceState, input: {
    evidenceIds: string[]; skillIds: string[];
    criteria?: { kind: "job"; jobId: string } | { kind: "task"; taskId: string };
    focus?: string;
  }): Promise<CapabilityResult<{ assessment: Assessment; recovery?: RecoveryHint }>> {
    const missingIds = input.evidenceIds.filter(id => !state.records.some(record => record.recordId === id && record.status === "active"));
    if (missingIds.length) return fail("NOT_FOUND", "部分证据不存在或已撤回，无法评估");
    const records = input.evidenceIds.map(id => state.records.find(record => record.recordId === id)!);
    const skills = await this.resolveSkills(input.skillIds);
    if (skills.missingIds.length) return fail("INVALID_ARGUMENT", `以下能力标识不在共享目录中：${skills.missingIds.join("、")}`);
    const coverage: Coverage = { complete: true, missing: [], observedAt: this.now() };
    let criteria: { summary: string; requirements: string | null } | null = null;
    if (input.criteria?.kind === "job") {
      const job = await this.ports.career?.getJobRequirements(ctx, input.criteria.jobId);
      if (!job?.value) {
        coverage.complete = false;
        coverage.missing.push({ source: "career", reason: job?.coverage.missing[0]?.reason ?? "岗位要求不可用" });
      } else criteria = { summary: `${job.value.title} 岗位要求`, requirements: job.value.requirements };
    } else if (input.criteria?.kind === "task") {
      const task = await this.ports.learning?.getTask(ctx, input.criteria.taskId);
      if (!task?.value) {
        coverage.complete = false;
        coverage.missing.push({ source: "learning", reason: task?.coverage.missing[0]?.reason ?? "任务验收要求不可用" });
      } else criteria = { summary: `${task.value.title} 验收要求`, requirements: task.value.criteria?.join("；") ?? null };
    }
    const items = await this.evidenceItems(ctx, records, coverage);
    let findings: SkillFinding[];
    try {
      findings = await this.generation.assessEvidence({
        skills: skills.items.map(({ skillId, name }) => ({ skillId, name })),
        criteria, focus: input.focus ?? null, items, coverageNote: coverage.missing.map(item => item.reason),
      });
    } catch (error) {
      const failure = asGenerationFailure(error);
      return fail(failure.code, failure.message, failure.retryable);
    }
    const now = this.now();
    const assessment: Assessment = {
      ownerId: ctx.ownerId, assessmentId: randomUUID(), version: 1, evidenceIds: input.evidenceIds,
      skillIds: input.skillIds, status: "succeeded", validity: "current", findings,
      criteriaSummary: criteria?.summary ?? (input.focus ?? "未指定评价标准，仅依据记录自述"),
      assessedAt: now, coverage,
      sourceVersions: Object.fromEntries(records.map(record => [record.recordId, record.version])),
      createdAt: now,
    };
    return ok({ assessment }, "能力证据评估已保存",
      { changed: true, status: "applied", entityId: assessment.assessmentId, version: 1 });
  }

  async querySkillCards(ctx: EvidenceContext, state: EvidenceState, query: {
    skillIds?: string[]; from?: string; to?: string; sources?: ("evidence" | "learning")[];
    limit?: number; cursor?: string;
  }): Promise<CapabilityResult<{ page: Page<SkillCardDTO>; coverage: Coverage }>> {
    const coverage: Coverage = { complete: true, missing: [], observedAt: this.now() };
    const wanted = query.skillIds?.length ? query.skillIds : unique(state.assessments.map(item => item.skillIds).flat());
    const resolved = await this.resolveSkills(wanted);
    for (const id of resolved.missingIds) {
      coverage.complete = false;
      coverage.missing.push({ source: "skills", reason: `能力标识未收录或目录不可用：${id}` });
    }
    const relevantRecords = state.records.filter(record => {
      if (record.ownerId !== ctx.ownerId || record.status !== "active") return false;
      if (query.from && Date.parse(record.occurredAt) < Date.parse(query.from)) return false;
      if (query.to && Date.parse(record.occurredAt) >= Date.parse(query.to)) return false;
      if (query.sources && !query.sources.includes(record.source.domain)) return false;
      return true;
    });
    const cards: SkillCardDTO[] = resolved.items.map(skill => {
      const assessments = state.assessments
        .filter(item => item.ownerId === ctx.ownerId && item.skillIds.includes(skill.skillId))
        .filter(item => !query.from || item.createdAt >= query.from)
        .filter(item => !query.to || item.createdAt < query.to)
        .map(item => this.withValidity(state, item));
      const evidenceIds = unique(assessments.flatMap(item => item.evidenceIds))
        .filter(id => relevantRecords.some(record => record.recordId === id));
      const verification: SkillCardDTO["verification"] = !evidenceIds.length ? "no_evidence"
        : assessments.some(item => item.validity === "current" && item.status === "succeeded") ? "available"
          : assessments.some(item => item.validity === "stale") ? "needs_review" : "pending";
      return { skill: { skillId: skill.skillId, name: skill.name }, evidenceIds, assessments, verification };
    });
    const scope = scopeHash(ctx.ownerId, { query: { ...query, cursor: undefined } });
    try { validateCursor(query.cursor, scope); }
    catch { return fail("INVALID_ARGUMENT", "分页游标无效或不属于当前筛选范围"); }
    const limit = query.limit ?? 20;
    const sorted = cards.sort((a, b) => a.skill.skillId.localeCompare(b.skill.skillId));
    const start = query.cursor ? sorted.findIndex(card => card.skill.skillId === decodeCursorPayload(query.cursor!).id) + 1 : 0;
    const items = sorted.slice(start, start + limit);
    const hasMore = sorted.length > start + limit;
    const last = items.at(-1);
    const at = items.flatMap(card => card.assessments.map(item => item.createdAt)).sort().at(-1) ?? this.now();
    return ok({
      page: { items, hasMore, nextCursor: hasMore && last ? encodeCursor(at, last.skill.skillId, scope) : null },
      coverage,
    }, "已读取能力证据");
  }

  /* ----------------------------- reviews ---------------------------- */
  async generateReview(ctx: EvidenceContext, state: EvidenceState, input: {
    from?: string; to?: string; stageId?: string; taskIds?: string[]; projectIds?: string[];
    skillIds?: string[]; focus?: string;
  }): Promise<CapabilityResult<{ review: Review; recovery?: RecoveryHint }>> {
    const timeZone = ctx.timeZone ?? "Asia/Shanghai";
    let from = input.from ?? null;
    let to = input.to ?? null;
    let stage: { stageId: string; title: string; objective: string } | null = null;
    if (input.stageId) {
      const result = await this.ports.learning?.getStage(ctx, input.stageId);
      if (!result?.value) return fail("NOT_FOUND", result?.coverage.missing[0]?.reason ?? "阶段不存在或不可访问");
      stage = { stageId: result.value.stageId, title: result.value.title, objective: result.value.objective };
      if (!from && result.value.from && result.value.to) { from = result.value.from; to = result.value.to; }
      if (!from || !to) return fail("INVALID_ARGUMENT", "该阶段没有明确起止时间，请补充复盘时间段");
    }
    if (!from || !to) return fail("INVALID_ARGUMENT", "需要时间段或阶段标识");
    if (Date.parse(to) - Date.parse(from) > MAX_REVIEW_DAYS * 86400000) {
      return fail("INVALID_ARGUMENT", `单次复盘范围不能超过 ${MAX_REVIEW_DAYS} 天`);
    }
    const records = state.records.filter(record =>
      record.ownerId === ctx.ownerId && record.status === "active" &&
      Date.parse(record.occurredAt) >= Date.parse(from) && Date.parse(record.occurredAt) < Date.parse(to) &&
      (!input.taskIds?.length || (record.taskId ? input.taskIds.includes(record.taskId) : false)) &&
      (!input.projectIds?.length || (record.projectId ? input.projectIds.includes(record.projectId) : false)) &&
      (!input.skillIds?.length || record.skillRefs.some(skill => input.skillIds!.includes(skill.skillId))));
    if (!records.length) return fail("INVALID_ARGUMENT", "该时间范围内没有可复盘的学习记录，暂不生成结论");
    const coverage: Coverage = { complete: true, missing: [], observedAt: this.now() };
    const items = await this.evidenceItems(ctx, records, coverage);
    let content: ReviewContent;
    try {
      const generationInput: ReviewInput = {
        range: { from, to, timeZone }, stage, focus: input.focus ?? null, items,
        coverageNote: coverage.missing.map(item => item.reason),
      };
      content = await this.generation.reviewLearning(generationInput);
    } catch (error) {
      const failure = asGenerationFailure(error);
      return fail(failure.code, failure.message, failure.retryable);
    }
    const review: Review = {
      reviewId: randomUUID(), version: 1, ownerId: ctx.ownerId, status: "succeeded",
      range: { from, to, timeZone }, stageId: input.stageId ?? null,
      progress: content.progress, blockers: content.blockers, suggestions: content.suggestions,
      sourceChanged: false, coverage,
      sourceVersions: Object.fromEntries(records.map(record => [record.recordId, record.version])),
      createdAt: this.now(),
    };
    return ok({ review }, "阶段复盘已生成",
      { changed: true, status: "applied", entityId: review.reviewId, version: 1 });
  }

  queryReviews(ctx: EvidenceContext, state: EvidenceState, query: {
    from?: string; to?: string; stageId?: string; limit?: number;
  }, detailId?: string): CapabilityResult<{ review: ReviewDTO } | { page: Page<ReviewSummary> }> {
    if (detailId) {
      const review = state.reviews.find(item => item.reviewId === detailId && item.ownerId === ctx.ownerId);
      if (!review) return fail("NOT_FOUND", "复盘不存在");
      return ok({ review: this.withReviewFreshness(state, review) }, "已读取复盘详情");
    }
    const scoped = state.reviews
      .filter(review => review.ownerId === ctx.ownerId)
      .filter(review => !query.stageId || review.stageId === query.stageId)
      .filter(review => !query.from || review.range.to > query.from)
      .filter(review => !query.to || review.range.from < query.to)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const items: ReviewSummary[] = scoped.map(review => ({
      reviewId: review.reviewId, version: review.version, status: review.status, range: review.range,
      stageId: review.stageId, createdAt: review.createdAt,
      sourceChanged: this.withReviewFreshness(state, review).sourceChanged,
    }));
    return ok({ page: { items, hasMore: false, nextCursor: null } }, "已读取阶段复盘列表");
  }

  /* ---------------------------- interviews -------------------------- */
  async startInterview(ctx: EvidenceContext, state: EvidenceState, input: {
    target: InterviewTarget; difficulty?: "introductory" | "intermediate" | "advanced";
    questionCount?: number; focus?: string; startNew?: boolean;
  }): Promise<CapabilityResult<{ interview: Interview; reused: boolean; recovery?: RecoveryHint }>> {
    if (!input.startNew) {
      const active = state.interviews.find(item => item.status === "active" || item.status === "preparing");
      if (active) return ok({ interview: active, reused: true }, "已返回进行中的面试会话");
    }
    const resolved = await this.resolveTarget(ctx, state, input.target);
    if (!resolved.ok) return fail(resolved.code, resolved.message);
    const questionCount = input.questionCount ?? DEFAULT_QUESTION_COUNT;
    const now = this.now();
    const interview: Interview = {
      interviewId: randomUUID(), version: 1, ownerId: ctx.ownerId, target: input.target,
      status: "preparing", difficulty: input.difficulty ?? null, totalQuestions: questionCount, answeredCount: 0,
      currentQuestion: null, questions: [], answers: [], report: null, reportStatus: "not_started",
      coverage: { complete: true, missing: [], observedAt: now },
      targetSnapshot: { revision: resolved.revision, requirements: resolved.requirements, skillRefs: resolved.skills },
      focus: input.focus ?? null, createdAt: now, endedAt: null, endedEarly: false, recovery: null,
    };
    const planInput: InterviewPlanInput = {
      target: input.target, difficulty: input.difficulty ?? null, questionCount, focus: input.focus ?? null,
      skills: resolved.skills, requirements: resolved.requirements, project: resolved.project, baseline: resolved.baseline,
    };
    try {
      const plan = await this.generation.buildInterview(planInput);
      interview.questions = plan.questions.map((question, index) => ({
        questionId: randomUUID(), ordinal: index + 1, category: question.category, prompt: question.prompt,
        skillRefs: resolved.skills.filter(skill => question.skillIds.includes(skill.skillId)),
      }));
      interview.totalQuestions = interview.questions.length;
      interview.status = "active";
      interview.currentQuestion = interview.questions[0] ?? null;
      return ok({ interview, reused: false }, "模拟面试已开始",
        { changed: true, status: "applied", entityId: interview.interviewId, version: 1 });
    } catch (error) {
      const failure = asGenerationFailure(error);
      interview.status = "preparation_failed";
      interview.recovery = { toolName: "start_interview", entityId: interview.interviewId, action: "重新生成题目", retryable: failure.retryable };
      interview.coverage.complete = false;
      interview.coverage.missing.push({ source: "generation", reason: failure.message });
      return ok({ interview, reused: false, recovery: interview.recovery }, "面试已创建，但题目生成失败",
        { changed: true, status: "applied", entityId: interview.interviewId, version: 1 });
    }
  }

  /**
   * Pure precondition check for answering a question. Safe to call inside a
   * transaction because it never touches the generator: a concurrent writer
   * may have advanced the session since the answer was prepared outside it.
   */
  checkAnswer(state: EvidenceState, interviewId: string, questionId: string, text: string):
    | { ok: true; interview: Interview; replay: Interview["answers"][number] | null }
    | { ok: false; result: CapabilityResult<never> } {
    const interview = state.interviews.find(item => item.interviewId === interviewId);
    if (!interview) return { ok: false, result: fail("NOT_FOUND", "面试不存在") };
    const existing = interview.answers.find(answer => answer.questionId === questionId);
    if (existing) {
      if (existing.text.trim() !== text.trim()) {
        return { ok: false, result: fail("INVALID_STATE", "该题已有回答且已提交内容不可改写；请刷新后查看最新状态，或开始新的训练") };
      }
      return { ok: true, interview, replay: existing };
    }
    if (interview.status !== "active") {
      return { ok: false, result: fail("INVALID_STATE", interview.status === "preparation_failed" ? "题目尚未生成完成" : "面试已结束") };
    }
    const question = interview.questions.find(item => item.questionId === questionId);
    if (!question) return { ok: false, result: fail("NOT_FOUND", "题目不存在") };
    if (question.ordinal !== interview.answeredCount + 1) {
      return { ok: false, result: fail("INVALID_STATE", "只能回答当前题目") };
    }
    return { ok: true, interview, replay: null };
  }

  /** Pure aggregate update; the generated feedback and report are passed in. */
  applyAnswer(
    interview: Interview, questionId: string, text: string,
    feedback: Interview["answers"][number]["feedback"], createdAt: string,
    summary: Pick<Interview, "report" | "reportStatus" | "recovery"> | null,
  ): { interview: Interview; answer: Interview["answers"][number] } {
    const answer = { answerId: feedback?.answerId ?? randomUUID(), questionId, text, feedback, createdAt };
    const updated: Interview = {
      ...interview,
      answers: [...interview.answers, answer],
      answeredCount: interview.answeredCount + 1,
      version: interview.version + 1,
    };
    const answeredAll = updated.answeredCount >= (updated.totalQuestions ?? 0);
    if (answeredAll) {
      updated.status = "completed";
      updated.currentQuestion = null;
      if (summary) Object.assign(updated, summary);
    } else {
      updated.currentQuestion = updated.questions[updated.answeredCount] ?? null;
    }
    return { interview: updated, answer: updated.answers.at(-1)! };
  }

  checkFinish(state: EvidenceState, interviewId: string):
    | { ok: true; interview: Interview }
    | { ok: false; result: CapabilityResult<never> } {
    const interview = state.interviews.find(item => item.interviewId === interviewId);
    if (!interview) return { ok: false, result: fail("NOT_FOUND", "面试不存在") };
    if (interview.status === "preparing" || interview.status === "preparation_failed") {
      return { ok: false, result: fail("INVALID_STATE", "该面试还没有可用题目，无法结束") };
    }
    return { ok: true, interview };
  }

  applyFinish(
    interview: Interview, reason: string | undefined,
    summary: Pick<Interview, "report" | "reportStatus" | "recovery"> | null,
  ): { interview: Interview } {
    const ended: Interview = {
      ...interview, status: "ended_early", endedEarly: true, endedAt: this.now(),
      version: interview.version + 1, currentQuestion: null,
      focus: reason ? `${interview.focus ? `${interview.focus}；` : ""}结束原因：${reason}` : interview.focus,
    };
    if (summary) {
      Object.assign(ended, summary);
    } else {
      ended.reportStatus = "not_started";
      ended.coverage = {
        ...ended.coverage, complete: false,
        missing: [...ended.coverage.missing, { source: "interview", reason: "本场没有已回答题目，未生成整场报告" }],
      };
    }
    return { interview: ended };
  }

  async submitAnswer(ctx: EvidenceContext, state: EvidenceState, interviewId: string, questionId: string, text: string): Promise<CapabilityResult<{
    interview: Interview; answer: Interview["answers"][number]; feedback: Interview["answers"][number]["feedback"];
    nextQuestion: Interview["questions"][number] | null; report: Interview["report"]; recovery?: RecoveryHint;
  }>> {
    const check = this.checkAnswer(state, interviewId, questionId, text);
    if (!check.ok) return check.result;
    if (check.replay) {
      return ok({ interview: check.interview, answer: check.replay, feedback: check.replay.feedback, nextQuestion: null, report: check.interview.report },
        "重复提交，返回已有回答");
    }
    const interview = check.interview;
    const question = interview.questions.find(item => item.questionId === questionId)!;
    const answerId = randomUUID();
    const createdAt = this.now();
    let feedback: Interview["answers"][number]["feedback"];
    let recovery: RecoveryHint | undefined;
    try {
      const content = await this.generation.assessAnswer({
        question, answer: text, difficulty: interview.difficulty, target: interview.target,
      });
      feedback = { questionId, answerId, status: "succeeded", ...content, updatedAt: createdAt };
    } catch (error) {
      const failure = asGenerationFailure(error);
      feedback = {
        questionId, answerId, status: "failed", strengths: [], issues: [], suggestions: [],
        limitations: [failure.message], updatedAt: createdAt,
      };
      recovery = { toolName: "get_interview_feedback", entityId: interviewId, action: "重新生成该题反馈", retryable: failure.retryable };
    }
    const pending: Interview = {
      ...interview,
      answers: [...interview.answers, { answerId, questionId, text, feedback, createdAt }],
      answeredCount: interview.answeredCount + 1,
      version: interview.version + 1,
    };
    const answeredAll = pending.answeredCount >= (pending.totalQuestions ?? 0);
    const summary = answeredAll ? await this.buildReport(pending) : null;
    const applied = this.applyAnswer(interview, questionId, text, feedback, createdAt, summary);
    return ok({
      interview: applied.interview, answer: applied.answer, feedback: applied.answer.feedback,
      nextQuestion: applied.interview.currentQuestion, report: applied.interview.report, ...(recovery ? { recovery } : {}),
    }, recovery ? "回答已保存，但本题反馈生成失败" : "回答已保存",
    { changed: true, status: "applied", entityId: answerId, version: applied.interview.version });
  }

  async finishInterview(ctx: EvidenceContext, state: EvidenceState, interviewId: string, reason?: string): Promise<CapabilityResult<{
    interview: Interview; report: Interview["report"]; recovery?: RecoveryHint;
  }>> {
    const check = this.checkFinish(state, interviewId);
    if (!check.ok) return check.result;
    const interview = check.interview;
    if (interview.status === "completed" || interview.status === "ended_early") {
      return ok({ interview, report: interview.report }, "面试此前已结束");
    }
    let summary: Pick<Interview, "report" | "reportStatus" | "recovery"> | null = null;
    let recovery: RecoveryHint | undefined;
    if (interview.answers.length) {
      summary = await this.buildReport(interview);
      if (summary.reportStatus === "failed") {
        recovery = { toolName: "finish_interview", entityId: interviewId, action: "重新生成整场报告", retryable: true };
      }
    }
    const applied = this.applyFinish(interview, reason, summary);
    return ok({ interview: applied.interview, report: applied.interview.report, ...(recovery ? { recovery } : {}) }, "模拟面试已结束",
      { changed: true, status: "applied", entityId: interviewId, version: applied.interview.version });
  }

  getFeedback(ctx: EvidenceContext, state: EvidenceState, interviewId: string, questionId?: string): CapabilityResult<
    { feedback: Interview["answers"][number]["feedback"] } | { report: Interview["report"]; reportStatus: Interview["reportStatus"] }
  > {
    const interview = state.interviews.find(item => item.interviewId === interviewId && item.ownerId === ctx.ownerId);
    if (!interview) return fail("NOT_FOUND", "面试不存在");
    if (questionId) {
      const answer = interview.answers.find(item => item.questionId === questionId);
      if (!answer) return fail("NOT_FOUND", "该题尚未作答，暂无反馈");
      return ok({ feedback: answer.feedback }, "已读取本题反馈");
    }
    return ok({ report: interview.report, reportStatus: interview.reportStatus },
      interview.report ? "已读取面试报告" : "整场报告尚未生成");
  }

  queryInterviews(ctx: EvidenceContext, state: EvidenceState, query: {
    from?: string; to?: string; jobId?: string; skillId?: string;
    statuses?: Interview["status"][]; limit?: number; cursor?: string;
  }): CapabilityResult<{ page: Page<InterviewSummary>; session: Interview | null }> {
    const scope = scopeHash(ctx.ownerId, { query: { ...query, cursor: undefined } });
    try { validateCursor(query.cursor, scope); }
    catch { return fail("INVALID_ARGUMENT", "分页游标无效或不属于当前筛选范围"); }
    const limit = query.limit ?? 20;
    const filtered = state.interviews
      .filter(item => item.ownerId === ctx.ownerId)
      .filter(item => !query.statuses || query.statuses.includes(item.status))
      .filter(item => !query.jobId || (item.target.kind === "job" && item.target.jobId === query.jobId))
      .filter(item => !query.skillId || (item.target.skillIds ?? []).includes(query.skillId) ||
        item.questions.some(question => question.skillRefs.some(skill => skill.skillId === query.skillId)))
      .filter(item => !query.from || item.createdAt >= query.from)
      .filter(item => !query.to || item.createdAt < query.to)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.interviewId.localeCompare(a.interviewId));
    const after = query.cursor ? filtered.filter(item => {
      const cursor = decodeCursorPayload(query.cursor!);
      return item.createdAt < cursor.at || (item.createdAt === cursor.at && item.interviewId < cursor.id);
    }) : filtered;
    const items: InterviewSummary[] = after.slice(0, limit).map(item => ({
      interviewId: item.interviewId, target: item.target, difficulty: item.difficulty, status: item.status,
      answeredCount: item.answeredCount, totalQuestions: item.totalQuestions, createdAt: item.createdAt,
      endedAt: item.endedAt, reportStatus: item.reportStatus, summary: item.report?.summary ?? null,
    }));
    const hasMore = after.length > limit;
    const last = items.at(-1);
    const session = state.interviews.find(item => item.ownerId === ctx.ownerId && (item.status === "active" || item.status === "preparing")) ?? null;
    return ok({
      page: { items, hasMore, nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.interviewId, scope) : null },
      session,
    }, "已读取面试历史");
  }

  /* ----------------------------- helpers ---------------------------- */
  private staleAssessments(state: EvidenceState, recordId: string) {
    return state.assessments.filter(item => item.evidenceIds.includes(recordId) && item.validity !== "withdrawn");
  }
  private affectedReviews(state: EvidenceState, record: LearningRecord) {
    return state.reviews.filter(review =>
      review.ownerId === record.ownerId &&
      Date.parse(review.range.from) <= Date.parse(record.occurredAt) &&
      Date.parse(record.occurredAt) < Date.parse(review.range.to));
  }
  private withValidity(state: EvidenceState, assessment: Assessment): Assessment {
    const stale = assessment.evidenceIds.some(id => {
      const record = state.records.find(candidate => candidate.recordId === id);
      if (!record || record.status !== "active") return true;
      return (assessment.sourceVersions?.[id] ?? record.version) !== record.version;
    });
    return { ...assessment, validity: stale ? "stale" : assessment.validity };
  }
  private withReviewFreshness(state: EvidenceState, review: Review): ReviewDTO {
    const sourceChanged = Object.entries(review.sourceVersions ?? {}).some(([recordId, version]) => {
      const record = state.records.find(item => item.recordId === recordId);
      return !record || record.status !== "active" || record.version !== version;
    });
    return { ...review, sourceChanged };
  }

  private async buildReport(interview: Interview): Promise<Pick<Interview, "report" | "reportStatus" | "recovery">> {
    const answers = interview.answers.map(answer => ({
      questionId: answer.questionId,
      question: interview.questions.find(question => question.questionId === answer.questionId)?.prompt ?? "",
      answer: answer.text,
      feedback: answer.feedback,
    }));
    try {
      const content: ReportContent = await this.generation.summarizeInterview({
        target: interview.target, difficulty: interview.difficulty, questions: interview.questions,
        answers, skills: interview.targetSnapshot?.skillRefs ?? [],
      });
      return {
        report: {
          reportId: randomUUID(), version: 1, interviewId: interview.interviewId, status: "succeeded",
          answeredCount: interview.answeredCount, totalQuestions: interview.totalQuestions ?? interview.questions.length,
          ...content,
          limitations: unique([...content.limitations, ...interview.coverage.missing.map(item => item.reason)]),
          createdAt: this.now(),
        },
        reportStatus: "succeeded", recovery: null,
      };
    } catch (error) {
      const failure = asGenerationFailure(error);
      return {
        report: null, reportStatus: "failed",
        recovery: { toolName: "finish_interview", entityId: interview.interviewId, action: failure.message, retryable: failure.retryable },
      };
    }
  }

  private async resolveTarget(ctx: EvidenceContext, state: EvidenceState, target: InterviewTarget): Promise<
    | { ok: true; skills: SkillRef[]; requirements: string | null; revision: string; project: { title: string; goal: string; contribution: string | null } | null; baseline: unknown }
    | { ok: false; code: "INVALID_ARGUMENT" | "NOT_FOUND"; message: string }
  > {
    let requirements: string | null = null;
    let revision = "1";
    let skillIds = target.skillIds ?? [];
    if (target.kind === "job") {
      const job = await this.ports.career?.getJobRequirements(ctx, target.jobId);
      if (!job?.value) return { ok: false, code: "NOT_FOUND", message: job?.coverage.missing[0]?.reason ?? "岗位不存在或不可访问" };
      requirements = job.value.requirements;
      revision = job.value.revision;
      skillIds = unique([...skillIds, ...job.value.skillRefs.map(skill => skill.skillId)]);
    }
    let project: { title: string; goal: string; contribution: string | null } | null = target.project
      ? { title: target.project.title, goal: target.project.goal, contribution: target.project.contribution ?? null }
      : null;
    const projectId = target.projectId;
    if (projectId) {
      const found = state.projects.find(item => item.projectId === projectId && item.ownerId === ctx.ownerId);
      if (!found) return { ok: false, code: "NOT_FOUND", message: "项目不存在或不可访问" };
      const record = state.records.find(item => item.projectId === projectId && item.contribution);
      project = { title: found.title, goal: found.goal, contribution: record?.contribution ?? null };
      if (!project.contribution) return { ok: false, code: "INVALID_ARGUMENT", message: "该项目缺少本人贡献说明，请先补充项目成果" };
    }
    // 岗位要求或项目资料可能只有自然语言，仍允许通用训练；专项能力模式
    // 的 schema 已保证至少有一个 skillId。
    const skills = await this.resolveSkills(skillIds);
    if (skills.missingIds.length) {
      return { ok: false, code: "INVALID_ARGUMENT", message: `以下能力标识不在共享目录中：${skills.missingIds.join("、")}` };
    }
    let baseline: unknown = null;
    const profile = await this.ports.profile?.getLearningContext(ctx);
    if (profile?.value) baseline = profile.value.baseline;
    return { ok: true, requirements, revision, project, baseline, skills: skills.items.map(({ skillId, name }) => ({ skillId, name })) };
  }

  private async resolveSkills(skillIds: string[]): Promise<{ items: SkillDefinition[]; missingIds: string[] }> {
    if (!skillIds.length) return { items: [], missingIds: [] };
    if (!this.ports.skills) return { items: [], missingIds: skillIds };
    return this.ports.skills.get(skillIds);
  }

  private async evidenceItems(ctx: EvidenceContext, records: LearningRecord[], coverage: Coverage): Promise<EvidenceItemInput[]> {
    const items: EvidenceItemInput[] = [];
    for (const record of records) {
      let materials: EvidenceItemInput["materials"] = [];
      if (record.materials.length) {
        const resolved = await this.ports.knowledge?.resolveMaterials(ctx, record.materials);
        if (!resolved?.value) {
          coverage.complete = false;
          coverage.missing.push({ source: "knowledge", reason: resolved?.coverage.missing[0]?.reason ?? "材料不可读取，本次仅依据自述内容" });
        } else {
          materials = flattenMaterials(resolved.value);
          for (const item of resolved.value.filter(entry => entry.state !== "available")) {
            coverage.complete = false;
            coverage.missing.push({ source: "knowledge", reason: item.reason ?? "部分材料不可读取" });
          }
        }
      }
      if (record.contributionPending) {
        coverage.complete = false;
        coverage.missing.push({ source: "project", reason: "项目成果缺少本人贡献说明" });
      }
      for (const item of record.pendingAssociations) {
        coverage.complete = false;
        coverage.missing.push({ source: item.source, reason: item.reason });
      }
      items.push({
        recordId: record.recordId, kind: record.kind, title: record.title, content: record.content,
        occurredAt: record.occurredAt, durationMinutes: record.durationMinutes, source: record.source,
        skillIds: record.skillRefs.map(skill => skill.skillId), contribution: record.contribution,
        materials, materialState: record.materialState,
      });
    }
    return items;
  }
}

function unique<T>(items: T[]): T[] { return [...new Set(items)]; }

function decodeCursorPayload(cursor: string): { at: string; id: string } {
  return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { at: string; id: string };
}

function flattenMaterials(values: MaterialContent[]) {
  return values.flatMap(value => value.excerpts.map(excerpt => ({
    documentId: value.reference.documentId,
    ...(value.reference.itemId ? { itemId: value.reference.itemId } : {}),
    locator: excerpt.locator,
    text: excerpt.text,
  })));
}

function asGenerationFailure(error: unknown) {
  if (error instanceof GenerationError) return { code: error.code, message: error.message, retryable: error.retryable };
  return { code: "GENERATION_FAILED" as const, message: "生成服务暂时不可用，请稍后重试", retryable: true };
}

export function toDto(record: LearningRecord): RecordDTO {
  const {
    ownerId, activityRef, pendingAssociations, missingInformation, coverage, withdrawalReason, ...dto
  } = record;
  void ownerId; void activityRef; void pendingAssociations; void missingInformation;
  void coverage; void withdrawalReason;
  return dto;
}
