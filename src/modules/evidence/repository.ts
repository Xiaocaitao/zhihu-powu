import type {
  Assessment, CapabilityResult, Interview, LearningRecord, LearningRecordFilter, Project, RecordRevision, Review,
} from "./contracts.ts";

export type StoredOperation = {
  ownerId: string;
  capability: string;
  operationKey: string;
  payloadHash: string;
  result: CapabilityResult<unknown>;
};

export interface EvidenceRepository {
  /** One owner-scoped transaction for a short mutation; no model or network call inside. */
  transaction<T>(ownerId: string, run: (repository: EvidenceRepository) => Promise<T>): Promise<T>;

  getOperation(ownerId: string, capability: string, operationKey: string): Promise<StoredOperation | null>;
  saveOperation(operation: StoredOperation): Promise<void>;

  createRecord(record: LearningRecord): Promise<void>;
  getRecord(ownerId: string, recordId: string): Promise<LearningRecord | null>;
  listRecords(ownerId: string, filter: LearningRecordFilter): Promise<LearningRecord[]>;
  updateRecord(record: LearningRecord): Promise<void>;
  getSourceRecord(ownerId: string, sourceDomain: string, sourceEntityId: string): Promise<LearningRecord | null>;
  saveRevision(revision: RecordRevision): Promise<void>;
  listRevisions(ownerId: string, recordId: string): Promise<RecordRevision[]>;

  saveProject(project: Project): Promise<void>;
  getProject(ownerId: string, projectId: string): Promise<Project | null>;
  listProjects(ownerId: string): Promise<Project[]>;

  saveAssessment(assessment: Assessment): Promise<void>;
  listAssessments(ownerId: string): Promise<Assessment[]>;

  saveReview(review: Review): Promise<void>;
  listReviews(ownerId: string): Promise<Review[]>;

  /** Persists header, questions, answers, feedback and report atomically. */
  saveInterview(interview: Interview): Promise<void>;
  getInterview(ownerId: string, interviewId: string): Promise<Interview | null>;
  listInterviews(ownerId: string): Promise<Interview[]>;
}
