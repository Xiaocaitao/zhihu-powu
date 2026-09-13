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
    if (result.ok && result.changed && result.data?.record) await this.repository.createRecord(result.data.record);
    return result;
  }

  async getLearningRecords(ctx: EvidenceContext, filter: { from?: string; to?: string; taskId?: string; skillId?: string } = {}) {
    const records = await this.repository.listRecords(ctx.ownerId, filter);
    return { ok: true, changed: false, domain: "evidence" as const, status: "read" as const, summary: "已读取学习记录", data: { items: records } };
  }

  async updateLearningEvidence(ctx: EvidenceContext, recordId: string, changes: Parameters<EvidenceService["updateLearningEvidence"]>[2]) {
    const result = this.service.updateLearningEvidence(ctx, recordId, changes);
    if (result.ok && result.changed && result.data?.record) await this.repository.updateRecord(result.data.record);
    return result;
  }

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

  async finishInterview(ctx: EvidenceContext, interviewId: string) {
    const existing = await this.repository.getInterview(ctx.ownerId, interviewId);
    if (!existing) return { ok: false, changed: false, domain: "evidence" as const, status: "rejected" as const, summary: "面试不存在", error: { code: "NOT_FOUND", message: "面试不存在" } };
    const result = this.service.finishInterview(ctx, interviewId);
    if (result.ok && result.data?.interview) await this.repository.saveInterview(result.data.interview);
    return result;
  }
}
