import type { Assessment, Interview, LearningRecord, Review } from "./contracts.ts";

export interface EvidenceRepository {
  createRecord(record: LearningRecord): Promise<void>;
  getRecord(ownerId: string, recordId: string): Promise<LearningRecord | null>;
  listRecords(ownerId: string, filter: { from?: string; to?: string; taskId?: string; skillId?: string }): Promise<LearningRecord[]>;
  updateRecord(record: LearningRecord): Promise<void>;
  saveAssessment(assessment: Assessment): Promise<void>;
  saveReview(review: Review): Promise<void>;
  saveInterview(interview: Interview): Promise<void>;
  getInterview(ownerId: string, interviewId: string): Promise<Interview | null>;
  listInterviews?(ownerId: string): Promise<Pick<Interview, "interviewId" | "status" | "answeredCount" | "totalQuestions" | "target">[]>;
  saveAnswer?(input: { answerId: string; ownerId: string; interviewId: string; questionId: string; text: string }): Promise<void>;
  saveAnswerFeedback?(input: { answerId: string; ownerId: string; status: "succeeded" | "failed"; result?: unknown }): Promise<void>;
}

/** Used by local previews and tests when PostgreSQL is not configured. */
export class MemoryEvidenceRepository implements EvidenceRepository {
  private readonly records = new Map<string, LearningRecord>();
  private readonly assessments = new Map<string, Assessment>();
  private readonly reviews = new Map<string, Review>();
  private readonly interviews = new Map<string, Interview>();
  async createRecord(record: LearningRecord) { this.records.set(record.recordId, record); }
  async getRecord(ownerId: string, recordId: string) { const record = this.records.get(recordId); return record?.ownerId === ownerId ? record : null; }
  async listRecords(ownerId: string, filter: { from?: string; to?: string; taskId?: string; skillId?: string }) { return [...this.records.values()].filter(r => r.ownerId === ownerId && r.status === "active").filter(r => !filter.from || r.occurredAt >= filter.from).filter(r => !filter.to || r.occurredAt < filter.to).filter(r => !filter.taskId || r.taskId === filter.taskId).filter(r => !filter.skillId || (r.skillIds ?? []).includes(filter.skillId)); }
  async updateRecord(record: LearningRecord) { this.records.set(record.recordId, record); }
  async saveAssessment(assessment: Assessment) { this.assessments.set(assessment.assessmentId, assessment); }
  async saveReview(review: Review) { this.reviews.set(review.reviewId, review); }
  async saveInterview(interview: Interview) { this.interviews.set(interview.interviewId, structuredClone(interview)); }
  async getInterview(ownerId: string, interviewId: string) { const interview = this.interviews.get(interviewId); return interview?.ownerId === ownerId ? structuredClone(interview) : null; }
  async listInterviews(ownerId: string) { return [...this.interviews.values()].filter(i => i.ownerId === ownerId).map(({ interviewId, status, answeredCount, totalQuestions, target }) => ({ interviewId, status, answeredCount, totalQuestions, target })); }
  async saveAnswer(input: { answerId: string; ownerId: string; interviewId: string; questionId: string; text: string }) { const interview = this.interviews.get(input.interviewId); if (!interview || interview.ownerId !== input.ownerId) return; if (!interview.answers.some(answer => answer.questionId === input.questionId)) interview.answers.push({ answerId: input.answerId, questionId: input.questionId, text: input.text }); }
}
