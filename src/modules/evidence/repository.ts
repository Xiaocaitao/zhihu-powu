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
}
