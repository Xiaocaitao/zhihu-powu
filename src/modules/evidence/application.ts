import { createHash } from "node:crypto";
import type {
  Assessment, CapabilityResult, EvidenceContext, Interview, InterviewTarget, LearningRecord, Page, Project, RecordChanges,
  RecordDTO, RecordInput, RecordQuery, RecordRevision, RecoveryHint, Review, ReviewDTO, ReviewSummary, SkillCardDTO,
  InterviewSummary,
} from "./contracts.ts";
import type { Coverage, SourceChange } from "./ports.ts";
import { EvidenceService, type EvidenceState } from "./service.ts";
import type { EvidenceRepository } from "./repository.ts";

const STATE_LIMIT = 500;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

function conflict<T>(message: string): CapabilityResult<T> {
  return { ok: false, changed: false, domain: "evidence", status: "rejected", summary: message,
    error: { code: "DUPLICATE_REQUEST", message, retryable: false } };
}

/**
 * Orchestration only: hydrates state from the repository, runs the domain service
 * (which may call external query ports and the generation port) and then persists
 * the resulting aggregate inside one short, owner-scoped transaction.
 */
export class EvidenceApplication {
  private readonly repository: EvidenceRepository;
  private readonly service: EvidenceService;
  constructor(repository: EvidenceRepository, service: EvidenceService) {
    this.repository = repository;
    this.service = service;
  }

  private async loadState(repository: EvidenceRepository, ownerId: string): Promise<EvidenceState> {
    const [records, projects, interviews, assessments, reviews] = await Promise.all([
      repository.listRecords(ownerId, { limit: STATE_LIMIT, includeWithdrawn: true }),
      repository.listProjects(ownerId),
      repository.listInterviews(ownerId),
      repository.listAssessments(ownerId),
      repository.listReviews(ownerId),
    ]);
    return { records, projects, interviews, assessments, reviews };
  }

  /** Persist prepared effects, deduplicating by the trusted operation key. */
  private async commit<T>(
    ctx: EvidenceContext,
    capability: string,
    payload: unknown,
    result: CapabilityResult<T>,
    persist: (repository: EvidenceRepository, state: EvidenceState) => Promise<void>,
  ): Promise<CapabilityResult<T>> {
    const operationKey = ctx.operationKey ?? ctx.requestId;
    const payloadHash = createHash("sha256").update(JSON.stringify(canonical(payload))).digest("hex");
    return this.repository.transaction(ctx.ownerId, async repository => {
      if (operationKey) {
        const previous = await repository.getOperation(ctx.ownerId, capability, operationKey);
        if (previous) {
          if (previous.payloadHash !== payloadHash) return conflict<T>("同一操作标识不能用于不同内容");
          return { ...(previous.result as CapabilityResult<T>), changed: false, status: "read",
            summary: "重复请求，返回已提交结果" };
        }
      }
      await persist(repository, await this.loadState(repository, ctx.ownerId));
      if (operationKey) {
        await repository.saveOperation({ ownerId: ctx.ownerId, capability, operationKey, payloadHash, result });
      }
      return result;
    });
  }

  private async read<T>(ctx: EvidenceContext, run: (state: EvidenceState) => T | Promise<T>): Promise<T> {
    return run(await this.loadState(this.repository, ctx.ownerId));
  }

  /* ----------------------------- records ---------------------------- */
  async recordLearningEvidence(ctx: EvidenceContext, input: RecordInput) {
    const prepared = await this.service.createRecord(ctx, await this.loadState(this.repository, ctx.ownerId), input);
    if (!prepared.ok || !prepared.data) return prepared;
    const { record, project } = prepared.data;
    return this.commit(ctx, "record_learning_evidence", input, prepared, async (repository, state) => {
      // Re-creating a fact already recorded from the same trusted source must not duplicate it.
      const existing = state.records.find(item =>
        item.source.domain === record.source.domain && item.source.entityId === record.source.entityId);
      if (existing) throw new Error("DUPLICATE_SOURCE_FACT");
      if (project) await repository.saveProject(project);
      await repository.createRecord(record);
    });
  }

  async getLearningRecords(ctx: EvidenceContext, query: RecordQuery) {
    return this.read(ctx, state => this.service.queryRecords(ctx, state, query));
  }

  async updateLearningEvidence(ctx: EvidenceContext, input:
    | { recordId: string; action: "amend"; changes: RecordChanges }
    | { recordId: string; action: "withdraw"; reason: string }
  ): Promise<CapabilityResult<{
    record: LearningRecord; revision: RecordRevision; invalidatedAssessmentIds: string[]; affectedReviewIds: string[];
  }>> {
    const state = await this.loadState(this.repository, ctx.ownerId);
    const prepared = input.action === "amend"
      ? await this.service.amendRecord(ctx, state, input.recordId, input.changes)
      : await this.service.withdrawRecord(ctx, state, input.recordId, input.reason);
    if (!prepared.ok || !prepared.data) return prepared;
    return this.commit(ctx, "update_learning_evidence", input, prepared, async repository => {
      await repository.updateRecord(prepared.data!.record);
      await repository.saveRevision(prepared.data!.revision);
    });
  }

  /**
   * Public query boundary used by Career's gap analysis; Career never reads
   * Evidence storage. Support values come from stored assessments when they
   * exist. Without one they fall back to record count only because Career's
   * gap flow needs a first-pass signal, and `verified` states that the number
   * is not yet backed by an assessment.
   */
  async getSkillEvidenceSnapshot(ctx: EvidenceContext, input: { skillCodes: string[] }) {
    const state = await this.loadState(this.repository, ctx.ownerId);
    return input.skillCodes.map(skillCode => {
      const matching = state.records.filter(record => record.status === "active" &&
        record.skillRefs.some(skill => skill.skillId === skillCode));
      const findings = state.assessments
        .filter(item => item.skillIds.includes(skillCode) && !this.assessmentIsStale(state, item))
        .flatMap(item => item.findings)
        .filter(finding => finding.skill.skillId === skillCode);
      const support = findings.some(finding => finding.support === "supported") ? "supported" as const
        : findings.some(finding => finding.support === "partial") ? "partial" as const
          : findings.length ? "insufficient" as const
            : matching.length >= 2 ? "supported" as const
              : matching.length === 1 ? "partial" as const
                : "insufficient" as const;
      return {
        skillCode,
        evidenceIds: matching.map(record => record.recordId),
        evidenceCount: matching.length,
        support,
        assessed: findings.length > 0,
      };
    });
  }

  private assessmentIsStale(state: EvidenceState, assessment: Assessment): boolean {
    if (assessment.validity === "withdrawn") return true;
    return assessment.evidenceIds.some(id => {
      const record = state.records.find(candidate => candidate.recordId === id);
      return !record || record.status !== "active" || (assessment.sourceVersions?.[id] ?? record.version) !== record.version;
    });
  }

  async getSkillEvidence(ctx: EvidenceContext, query: {
    skillIds?: string[]; from?: string; to?: string; sources?: ("evidence" | "learning")[];
    limit?: number; cursor?: string;
  }): Promise<CapabilityResult<{ page: Page<SkillCardDTO>; coverage: Coverage }>> {
    return this.read(ctx, state => this.service.querySkillCards(ctx, state, query));
  }

  async evaluateLearningEvidence(ctx: EvidenceContext, input: {
    evidenceIds: string[]; skillIds: string[];
    criteria?: { kind: "job"; jobId: string } | { kind: "task"; taskId: string };
    focus?: string;
  }): Promise<CapabilityResult<{ assessment: import("./contracts.ts").Assessment; recovery?: RecoveryHint }>> {
    const prepared = await this.service.assessEvidence(ctx, await this.loadState(this.repository, ctx.ownerId), input);
    if (!prepared.ok || !prepared.data) return prepared;
    return this.commit(ctx, "evaluate_learning_evidence", input, prepared,
      (repository) => repository.saveAssessment(prepared.data!.assessment));
  }

  async generateLearningReview(ctx: EvidenceContext, input: {
    from?: string; to?: string; stageId?: string; taskIds?: string[]; projectIds?: string[];
    skillIds?: string[]; focus?: string;
  }): Promise<CapabilityResult<{ review: Review; recovery?: RecoveryHint }>> {
    const prepared = await this.service.generateReview(ctx, await this.loadState(this.repository, ctx.ownerId), input);
    if (!prepared.ok || !prepared.data) return prepared;
    return this.commit(ctx, "generate_learning_review", input, prepared,
      (repository) => repository.saveReview(prepared.data!.review));
  }

  async getLearningReviews(ctx: EvidenceContext, query: {
    from?: string; to?: string; stageId?: string; limit?: number; reviewId?: string;
  }): Promise<CapabilityResult<{ review: ReviewDTO } | { page: Page<ReviewSummary> }>> {
    return this.read(ctx, state => this.service.queryReviews(ctx, state, query, query.reviewId));
  }

  /**
   * Trusted host entry point for confirmed changes from other modules.
   * Not exposed as a Agent tool, so a model cannot fabricate "another module said so".
   */
  async syncSourceChange(ctx: EvidenceContext, change: SourceChange) {
    const prepared = await this.service.applySourceChange(ctx, await this.loadState(this.repository, ctx.ownerId), change);
    if (!prepared.ok || !prepared.data) return prepared;
    if (prepared.data.duplicate) return { ...prepared, changed: false, status: "read" as const };
    const record = prepared.data.record;
    const isNew = !state2Has(await this.loadState(this.repository, ctx.ownerId), record.recordId);
    return this.commit(ctx, "sync_source_change", change, prepared, async repository => {
      if (isNew) await repository.createRecord(record); else await repository.updateRecord(record);
    });
  }

  /* --------------------------- interviews --------------------------- */
  async startInterview(ctx: EvidenceContext, input: {
    target: InterviewTarget; difficulty?: "introductory" | "intermediate" | "advanced";
    questionCount?: number; focus?: string; startNew?: boolean;
  }): Promise<CapabilityResult<{ interview: Interview; reused: boolean; recovery?: RecoveryHint }>> {
    const prepared = await this.service.startInterview(ctx, await this.loadState(this.repository, ctx.ownerId), input);
    if (!prepared.ok || !prepared.data) return prepared;
    if (prepared.data.reused) return prepared;
    return this.commit(ctx, "start_interview", input, prepared,
      (repository) => repository.saveInterview(prepared.data!.interview));
  }

  async getInterviewSession(ctx: EvidenceContext, interviewId: string) {
    const interview = await this.repository.getInterview(ctx.ownerId, interviewId);
    if (!interview) return notFound<{ interview: Interview }>("面试不存在");
    return { ok: true, changed: false, domain: "evidence" as const, status: "read" as const,
      summary: "已读取面试会话", data: { interview } };
  }

  async submitInterviewAnswer(ctx: EvidenceContext, input: { interviewId: string; questionId: string; answer: string }) {
    const prepared = await this.service.submitAnswer(
      ctx, await this.loadState(this.repository, ctx.ownerId), input.interviewId, input.questionId, input.answer);
    if (!prepared.ok || !prepared.data) return prepared;
    if (!prepared.changed) return prepared;
    return this.commit(ctx, "submit_interview_answer", input, prepared,
      (repository) => repository.saveInterview(prepared.data!.interview));
  }

  async finishInterview(ctx: EvidenceContext, input: { interviewId: string; reason?: string }) {
    const prepared = await this.service.finishInterview(
      ctx, await this.loadState(this.repository, ctx.ownerId), input.interviewId, input.reason);
    if (!prepared.ok || !prepared.data) return prepared;
    if (!prepared.changed) return prepared;
    return this.commit(ctx, "finish_interview", input, prepared,
      (repository) => repository.saveInterview(prepared.data!.interview));
  }

  async getInterviewFeedback(ctx: EvidenceContext, input: { interviewId: string; questionId?: string }) {
    return this.read(ctx, state => this.service.getFeedback(ctx, state, input.interviewId, input.questionId));
  }

  async getInterviewRecords(ctx: EvidenceContext, query: {
    from?: string; to?: string; jobId?: string; skillId?: string;
    statuses?: Interview["status"][]; limit?: number; cursor?: string;
  }): Promise<CapabilityResult<{ page: Page<InterviewSummary>; session: Interview | null }>> {
    return this.read(ctx, state => this.service.queryInterviews(ctx, state, query));
  }
}

function state2Has(state: EvidenceState, recordId: string) { return state.records.some(item => item.recordId === recordId); }

function notFound<T>(message: string): CapabilityResult<T> {
  return { ok: false, changed: false, domain: "evidence", status: "rejected", summary: message,
    error: { code: "NOT_FOUND", message, retryable: false } };
}

export type { Project, RecordDTO };
