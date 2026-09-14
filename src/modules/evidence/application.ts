import type { EvidenceContext, RecordInput, CapabilityResult } from "./contracts.ts";
import { EvidenceService } from "./service.ts";
import type { EvidenceRepository } from "./repository.ts";

/** Bridges the deterministic domain service to a durable repository. */
export class EvidenceApplication {
  private readonly service: EvidenceService;
  private readonly repository: EvidenceRepository;
  constructor(service: EvidenceService, repository: EvidenceRepository) { this.service = service; this.repository = repository; }

  async recordLearningEvidence(ctx: EvidenceContext, input: RecordInput) {
    const result = this.service.recordLearningEvidence(ctx, input);
    if (result.ok && result.changed && result.data?.record) {
      try { await this.repository.createRecord(result.data.record); }
      catch (error) { this.service.discardUnsavedRecord(result.data.record.recordId); throw error; }
    }
    return result;
  }

  async getLearningRecords(ctx: EvidenceContext, filter: { from?: string; to?: string; taskId?: string; skillId?: string } = {}) {
    const records = await this.repository.listRecords(ctx.ownerId, filter);
    return { ok: true, changed: false, domain: "evidence" as const, status: "read" as const, summary: "已读取学习记录", data: { items: records } };
  }

  /** Public query boundary used by Career; Career does not read Evidence storage. */
  async getSkillEvidenceSnapshot(ctx: EvidenceContext, input: { skillCodes: string[] }) {
    const records = await this.repository.listRecords(ctx.ownerId, {});
    return input.skillCodes.map(skillCode => {
      const matching = records.filter(record => (record.skillIds ?? []).includes(skillCode));
      const count = matching.length;
      return {
        skillCode,
        evidenceIds: matching.map(record => record.recordId),
        evidenceCount: count,
        support: count >= 2 ? "supported" as const : count === 1 ? "partial" as const : "insufficient" as const,
      };
    });
  }

  async updateLearningEvidence(ctx: EvidenceContext, recordId: string, changes: Parameters<EvidenceService["updateLearningEvidence"]>[2]) {
    const existing = await this.repository.getRecord(ctx.ownerId, recordId);
    if (existing) this.service.hydrateRecord(existing);
    const result = this.service.updateLearningEvidence(ctx, recordId, changes);
    if (result.ok && result.changed && result.data?.record) await this.repository.updateRecord(result.data.record);
    return result;
  }

  async getSkillEvidence(ctx: EvidenceContext, skillId?: string) {
    const records = await this.repository.listRecords(ctx.ownerId, skillId ? { skillId } : {});
    const groups = new Map<string, string[]>();
    for (const record of records) for (const skill of record.skillIds ?? []) groups.set(skill, [...(groups.get(skill) ?? []), record.recordId]);
    return { ok: true, changed: false, domain: "evidence" as const, status: "read" as const, summary: "已读取能力证据", data: { items: [...groups].map(([skillId, recordIds]) => ({ skillId, support: recordIds.length > 1 ? "supported" : "partial", rationale: "基于已保存记录，仍需结合具体材料验证", recordIds })) } };
  }
  async evaluateLearningEvidence(ctx: EvidenceContext, evidenceIds: string[], skillIds: string[]) {
    const records = await this.repository.listRecords(ctx.ownerId, {});
    records.filter(record => evidenceIds.includes(record.recordId)).forEach(record => this.service.hydrateRecord(record));
    const result = this.service.evaluateLearningEvidence(ctx, evidenceIds, skillIds);
    if (result.ok && result.data?.assessment) await this.repository.saveAssessment(result.data.assessment);
    return result;
  }
  async generateLearningReview(ctx: EvidenceContext, from: string, to: string) {
    const records = await this.repository.listRecords(ctx.ownerId, { from, to });
    records.forEach(record => this.service.hydrateRecord(record));
    const result = this.service.generateLearningReview(ctx, from, to);
    if (result.ok && result.data?.review) await this.repository.saveReview(result.data.review);
    return result;
  }
  async getLearningReviews(ctx: EvidenceContext) { return this.service.getLearningReviews(ctx); }

  async saveAssessment(assessment: Parameters<EvidenceRepository["saveAssessment"]>[0]) { await this.repository.saveAssessment(assessment); return { ok: true, changed: true, domain: "evidence" as const, status: "applied" as const, summary: "能力评估已保存", data: { assessment } }; }
  async saveReview(review: Parameters<EvidenceRepository["saveReview"]>[0]) { await this.repository.saveReview(review); return { ok: true, changed: true, domain: "evidence" as const, status: "applied" as const, summary: "阶段复盘已保存", data: { review } }; }

  async startInterview(ctx: EvidenceContext, target: Parameters<EvidenceService["startInterview"]>[1], totalQuestions?: number) {
    const result = this.service.startInterview(ctx, target, totalQuestions);
    if (result.ok && result.changed && result.data?.interview) await this.repository.saveInterview(result.data.interview);
    return result;
  }

  async getInterviewSession(ctx: EvidenceContext, interviewId: string) {
    const interview = await this.repository.getInterview(ctx.ownerId, interviewId);
    if (!interview) return { ok: false, changed: false, domain: "evidence" as const, status: "rejected" as const, summary: "面试不存在", error: { code: "NOT_FOUND", message: "面试不存在" } };
    return { ok: true, changed: false, domain: "evidence" as const, status: "read" as const, summary: "已读取面试会话", data: { interview } };
  }

  async submitInterviewAnswer(ctx: EvidenceContext, interviewId: string, questionId: string, answer: string) {
    const interview = await this.repository.getInterview(ctx.ownerId, interviewId);
    if (!interview) return this.getInterviewSession(ctx, interviewId);
    this.service.hydrateInterview(interview);
    const result = this.service.submitInterviewAnswer(ctx, interviewId, questionId, answer);
    if (result.ok && result.changed && result.data?.interview) await this.repository.saveInterview(result.data.interview);
    return result;
  }
  async finishInterview(ctx: EvidenceContext, interviewId: string) {
    const interview = await this.repository.getInterview(ctx.ownerId, interviewId);
    if (!interview) return this.getInterviewSession(ctx, interviewId);
    this.service.hydrateInterview(interview);
    const result = this.service.finishInterview(ctx, interviewId);
    if (result.ok && result.changed && result.data?.interview) await this.repository.saveInterview(result.data.interview);
    return result;
  }
  async getInterviewFeedback(ctx: EvidenceContext, interviewId: string) { const session = await this.getInterviewSession(ctx, interviewId); if (!session.ok || !session.data) return session; this.service.hydrateInterview(session.data.interview); return this.service.getInterviewFeedback(ctx, interviewId); }
  async getInterviewRecords(ctx: EvidenceContext) { const sessions = this.repository.listInterviews ? await this.repository.listInterviews(ctx.ownerId) : []; return { ok: true, changed: false, domain: "evidence" as const, status: "read" as const, summary: "已读取面试历史", data: { items: sessions, session: sessions.find(item => item.status === "active") ?? null } }; }
}
