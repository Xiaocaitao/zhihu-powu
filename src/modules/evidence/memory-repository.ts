import type {
  Assessment, Interview, LearningRecord, LearningRecordFilter, Project, RecordRevision, Review,
} from "./contracts.ts";
import type { EvidenceRepository, StoredOperation } from "./repository.ts";
import { decodeCursor } from "./pagination.ts";

type State = {
  records: Map<string, LearningRecord>;
  projects: Map<string, Project>;
  revisions: Map<string, RecordRevision>;
  assessments: Map<string, Assessment>;
  reviews: Map<string, Review>;
  interviews: Map<string, Interview>;
  operations: Map<string, StoredOperation>;
};

const emptyState = (): State => ({
  records: new Map(), projects: new Map(), revisions: new Map(), assessments: new Map(),
  reviews: new Map(), interviews: new Map(), operations: new Map(),
});

/** Test/development repository with rollback and independent read copies. No user fixtures. */
export class MemoryEvidenceRepository implements EvidenceRepository {
  private state: State = emptyState();
  private queue: Promise<void> = Promise.resolve();
  private inTransaction = false;

  async transaction<T>(_ownerId: string, run: (repository: EvidenceRepository) => Promise<T>): Promise<T> {
    if (this.inTransaction) return run(this);
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const isolated = new MemoryEvidenceRepository();
    isolated.state = structuredClone(this.state);
    isolated.inTransaction = true;
    try {
      const result = await run(isolated);
      this.state = isolated.state;
      return structuredClone(result);
    } finally { release(); }
  }

  private key(ownerId: string, capability: string, operationKey: string) {
    return JSON.stringify([ownerId, capability, operationKey]);
  }
  async getOperation(ownerId: string, capability: string, operationKey: string) {
    return structuredClone(this.state.operations.get(this.key(ownerId, capability, operationKey)) ?? null);
  }
  async saveOperation(operation: StoredOperation) {
    this.state.operations.set(this.key(operation.ownerId, operation.capability, operation.operationKey), structuredClone(operation));
  }

  async createRecord(record: LearningRecord) {
    if (this.state.records.has(record.recordId)) throw new Error("Duplicate record");
    this.state.records.set(record.recordId, structuredClone(record));
  }
  async getRecord(ownerId: string, recordId: string) {
    const record = this.state.records.get(recordId);
    return record?.ownerId === ownerId ? structuredClone(record) : null;
  }
  async getSourceRecord(ownerId: string, sourceDomain: string, sourceEntityId: string) {
    return structuredClone([...this.state.records.values()].find(record => record.ownerId === ownerId &&
      record.source.domain === sourceDomain && record.source.entityId === sourceEntityId) ?? null);
  }
  async listRecords(ownerId: string, filter: LearningRecordFilter) {
    const cursor = filter.cursor ? decodeCursor(filter.cursor) : null;
    const records = [...this.state.records.values()]
      .filter(record => record.ownerId === ownerId)
      .filter(record => (filter.includeWithdrawn ? true : record.status === "active"))
      .filter(record => !filter.kind || record.kind === filter.kind)
      .filter(record => !filter.kinds || filter.kinds.includes(record.kind))
      .filter(record => !filter.from || record.occurredAt >= filter.from)
      .filter(record => !filter.to || record.occurredAt < filter.to)
      .filter(record => !filter.taskId || record.taskId === filter.taskId)
      .filter(record => !filter.skillId || record.skillRefs.some(skill => skill.skillId === filter.skillId))
      .filter(record => !cursor || record.occurredAt < cursor.at ||
        (record.occurredAt === cursor.at && record.recordId < cursor.id))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.recordId.localeCompare(a.recordId));
    return structuredClone(records.slice(0, filter.limit ?? 100));
  }
  async updateRecord(record: LearningRecord) {
    const existing = this.state.records.get(record.recordId);
    if (existing?.ownerId !== record.ownerId) throw new Error("Record not found");
    this.state.records.set(record.recordId, structuredClone(record));
  }
  async saveRevision(revision: RecordRevision) {
    const key = JSON.stringify([revision.ownerId, revision.recordId, revision.version]);
    if (!this.state.revisions.has(key)) this.state.revisions.set(key, structuredClone(revision));
  }
  async listRevisions(ownerId: string, recordId: string) {
    return structuredClone([...this.state.revisions.values()]
      .filter(item => item.ownerId === ownerId && item.recordId === recordId)
      .sort((a, b) => a.version - b.version));
  }

  async saveProject(project: Project) { this.state.projects.set(project.projectId, structuredClone(project)); }
  async getProject(ownerId: string, projectId: string) {
    const project = this.state.projects.get(projectId);
    return project?.ownerId === ownerId ? structuredClone(project) : null;
  }
  async listProjects(ownerId: string) {
    return structuredClone([...this.state.projects.values()].filter(item => item.ownerId === ownerId));
  }

  async saveAssessment(assessment: Assessment) {
    this.state.assessments.set(assessment.assessmentId, structuredClone(assessment));
  }
  async listAssessments(ownerId: string) {
    return structuredClone([...this.state.assessments.values()].filter(item => item.ownerId === ownerId));
  }

  async saveReview(review: Review) { this.state.reviews.set(review.reviewId, structuredClone(review)); }
  async listReviews(ownerId: string) {
    return structuredClone([...this.state.reviews.values()].filter(item => item.ownerId === ownerId));
  }

  async saveInterview(interview: Interview) {
    this.state.interviews.set(interview.interviewId, structuredClone(interview));
  }
  async getInterview(ownerId: string, interviewId: string) {
    const interview = this.state.interviews.get(interviewId);
    return interview?.ownerId === ownerId ? structuredClone(interview) : null;
  }
  async listInterviews(ownerId: string) {
    return structuredClone([...this.state.interviews.values()].filter(item => item.ownerId === ownerId));
  }
}
