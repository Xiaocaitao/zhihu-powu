import { z } from "zod";
import type { SkillRef } from "../skills/contracts.ts";
import type { Coverage, MaterialRef } from "./ports.ts";

/* ------------------------------------------------------------------ *
 * Trusted execution context. Identity never comes from model payload. *
 * ------------------------------------------------------------------ */
export const evidenceContextSchema = z.object({
  ownerId: z.string().trim().min(1).max(200),
  sessionId: z.string().trim().min(1).max(200).optional(),
  requestId: z.string().trim().min(1).max(200).optional(),
  operationKey: z.string().trim().min(1).max(200).optional(),
  timeZone: z.string().trim().min(1).max(100).optional(),
  expectedVersion: z.number().int().positive().optional(),
}).strict();
export type EvidenceContext = z.infer<typeof evidenceContextSchema> & { signal?: AbortSignal };

/* ------------------------------- enums ---------------------------- */
export type GenerationStatus = "not_started" | "running" | "succeeded" | "failed";
export type RecordKind =
  | "activity" | "project_outcome" | "task_change" | "learning_feedback"
  | "plan_adjustment" | "assessment_result" | "interview_result";
export type SourceRef = {
  domain: "evidence" | "learning";
  entityId: string;
  revision: string;
  locator?: string;
};
export type MaterialState = "none" | "pending" | "available" | "partial" | "unavailable";
export type SourceState = "current" | "superseded" | "withdrawn" | "unavailable";

/* ------------------------------ records --------------------------- */
const idSchema = z.string().trim().min(1).max(200);
const uuidSchema = z.string().uuid();
const instantSchema = z.string().datetime({ offset: true });
const uniqueIds = (items: string[]) => new Set(items).size === items.length;
const skillIdsSchema = z.array(idSchema).max(20).refine(uniqueIds, "能力标识不能重复");
const materialRefsSchema = z.array(
  z.object({ documentId: idSchema, itemId: idSchema.optional(), label: z.string().trim().max(200).optional() }).strict(),
).max(20).refine(items => new Set(items.map(item => JSON.stringify([item.documentId, item.itemId]))).size === items.length, "材料引用不能重复");

export const recordKindSchema = z.enum([
  "activity", "project_outcome", "task_change", "learning_feedback",
  "plan_adjustment", "assessment_result", "interview_result",
]);
export const modelRecordKindSchema = z.enum(["activity", "project_outcome"]);

export const projectInputSchema = z.union([
  z.object({ projectId: uuidSchema, contribution: z.string().trim().min(1).max(2000).optional(), contributionPending: z.boolean().optional() }).strict(),
  z.object({
    title: z.string().trim().min(1).max(200),
    goal: z.string().trim().min(1).max(2000),
    contribution: z.string().trim().min(1).max(2000).optional(),
    contributionPending: z.boolean(),
  }).strict().refine(value => value.contributionPending || Boolean(value.contribution), "未明确本人贡献时必须标记贡献待补充"),
]);
export type ProjectInput = z.infer<typeof projectInputSchema>;

export const recordCreateSchema = z.object({
  kind: modelRecordKindSchema,
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(20000),
  occurredAt: instantSchema,
  durationMinutes: z.number().int().min(0).max(10080).nullable().optional(),
  taskId: idSchema.optional(),
  skillIds: skillIdsSchema.optional(),
  materialRefs: materialRefsSchema.optional(),
  project: projectInputSchema.optional(),
  completion: z.enum(["partial", "completed"]).optional(),
  materialsPending: z.boolean().optional(),
}).strict().refine(value => value.kind !== "project_outcome" || Boolean(value.project), "项目成果必须提供项目及本人贡献信息");
export type RecordInput = z.infer<typeof recordCreateSchema>;

export const recordListSchema = z.object({
  mode: z.literal("list").optional(),
  from: instantSchema.optional(),
  to: instantSchema.optional(),
  kinds: z.array(recordKindSchema).min(1).max(7).optional(),
  kind: recordKindSchema.optional(),
  taskId: idSchema.optional(),
  skillId: idSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(4000).optional(),
  weekOf: instantSchema.optional(),
}).strict()
  .refine(value => Boolean(value.from) === Boolean(value.to), "起止时间必须同时提供")
  .refine(value => !value.from || Date.parse(value.from) < Date.parse(value.to!), "起始时间必须早于结束时间")
  .refine(value => !value.kind || !value.kinds, "kind 与 kinds 不可同时提供");
export const recordQuerySchema = z.union([
  z.object({ mode: z.literal("detail"), recordId: uuidSchema }).strict(),
  recordListSchema,
]);
export type RecordQuery = z.infer<typeof recordQuerySchema>;
export type RecordListQuery = z.infer<typeof recordListSchema>;

export const recordChangesSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().trim().min(1).max(20000).optional(),
  occurredAt: instantSchema.optional(),
  durationMinutes: z.number().int().min(0).max(10080).nullable().optional(),
  taskId: idSchema.nullable().optional(),
  skillIds: skillIdsSchema.optional(),
  materialRefs: materialRefsSchema.optional(),
  contribution: z.string().trim().min(1).max(2000).optional(),
  completion: z.enum(["partial", "completed"]).optional(),
  materialsPending: z.boolean().optional(),
  durationUnknown: z.literal(true).optional(),
}).strict().refine(value => Object.keys(value).length > 0, "至少提供一项修正");
export type RecordChanges = z.infer<typeof recordChangesSchema>;

export const updateRecordSchema = z.discriminatedUnion("action", [
  // expectedVersion is the version the caller actually read; the host may also
  // supply it through trusted context. It is a precondition, not a new version.
  z.object({
    action: z.literal("amend"), recordId: uuidSchema,
    expectedVersion: z.number().int().positive(), changes: recordChangesSchema,
  }).strict(),
  z.object({
    action: z.literal("withdraw"), recordId: uuidSchema,
    expectedVersion: z.number().int().positive(), reason: z.string().trim().min(1).max(2000),
  }).strict(),
]);

/* --------------------------- assessments -------------------------- */
export const assessmentInputSchema = z.object({
  evidenceIds: z.array(uuidSchema).min(1).max(20).refine(uniqueIds, "证据标识不能重复"),
  skillIds: skillIdsSchema.refine(items => items.length > 0, "至少指定一项能力"),
  criteria: z.union([
    z.object({ kind: z.literal("job"), jobId: idSchema }).strict(),
    z.object({ kind: z.literal("task"), taskId: idSchema }).strict(),
  ]).optional(),
  focus: z.string().trim().min(1).max(2000).optional(),
}).strict();

export const skillCardQuerySchema = z.object({
  skillIds: z.array(idSchema).max(20).optional(),
  from: instantSchema.optional(),
  to: instantSchema.optional(),
  sources: z.array(z.enum(["evidence", "learning"])).max(2).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(4000).optional(),
}).strict()
  .refine(value => Boolean(value.from) === Boolean(value.to), "起止时间必须同时提供")
  .refine(value => !value.from || Date.parse(value.from) < Date.parse(value.to!), "起始时间必须早于结束时间");

/* ----------------------------- reviews ---------------------------- */
export const reviewGenerateSchema = z.object({
  from: instantSchema.optional(),
  to: instantSchema.optional(),
  stageId: idSchema.optional(),
  taskIds: z.array(idSchema).max(50).optional(),
  projectIds: z.array(uuidSchema).max(50).optional(),
  skillIds: z.array(idSchema).max(20).optional(),
  focus: z.string().trim().min(1).max(2000).optional(),
}).strict()
  .refine(value => (Boolean(value.from) && Boolean(value.to)) || Boolean(value.stageId), "需要时间段或阶段标识")
  .refine(value => !value.from || Date.parse(value.from) < Date.parse(value.to!), "起始时间必须早于结束时间");
export const reviewListSchema = z.object({
  mode: z.literal("list").optional(),
  from: instantSchema.optional(),
  to: instantSchema.optional(),
  stageId: idSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(4000).optional(),
}).strict()
  .refine(value => Boolean(value.from) === Boolean(value.to), "起止时间必须同时提供");
export const reviewQuerySchema = z.union([
  z.object({ mode: z.literal("detail"), reviewId: uuidSchema }).strict(),
  reviewListSchema,
]);

/* ---------------------------- interviews -------------------------- */
const inlineProjectSchema = z.object({
  title: z.string().trim().min(1).max(200), goal: z.string().trim().min(1).max(2000),
  contribution: z.string().trim().min(1).max(2000).optional(),
}).strict();
const projectContext = { projectId: uuidSchema.optional(), project: inlineProjectSchema.optional() };
export const interviewTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("job"), jobId: idSchema, skillIds: skillIdsSchema.optional(), ...projectContext }).strict(),
  z.object({ kind: z.literal("skills"), skillIds: skillIdsSchema.refine(ids => ids.length > 0), ...projectContext }).strict(),
  z.object({ kind: z.literal("project"), skillIds: skillIdsSchema.optional(), ...projectContext }).strict(),
]).refine(value => !(value.projectId && value.project), "已有项目与手填项目不能同时提供")
  .refine(value => value.kind !== "project" || Boolean(value.projectId || value.project), "项目训练必须选择已有项目或填写项目资料");
export type InterviewTarget = z.infer<typeof interviewTargetSchema>;

export const startInterviewSchema = z.object({
  target: interviewTargetSchema,
  difficulty: z.enum(["introductory", "intermediate", "advanced"]).optional(),
  questionCount: z.number().int().min(1).max(20).optional(),
  focus: z.string().trim().min(1).max(2000).optional(),
  startNew: z.boolean().optional(),
}).strict();
export const interviewIdSchema = z.object({ interviewId: uuidSchema }).strict();
export const submitAnswerSchema = z.object({
  interviewId: uuidSchema,
  questionId: uuidSchema,
  answer: z.string().max(20000).refine(value => value.trim().length > 0, "回答不能为空"),
}).strict();
export const finishInterviewSchema = z.object({
  interviewId: uuidSchema,
  reason: z.string().trim().min(1).max(2000).optional(),
}).strict();
export const interviewFeedbackSchema = z.object({
  interviewId: uuidSchema,
  questionId: uuidSchema.optional(),
}).strict();
export const interviewListSchema = z.object({
  from: instantSchema.optional(),
  to: instantSchema.optional(),
  jobId: idSchema.optional(),
  skillId: idSchema.optional(),
  statuses: z.array(z.enum(["preparing", "active", "completed", "ended_early", "preparation_failed"])).min(1).max(5).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(4000).optional(),
}).strict()
  .refine(value => Boolean(value.from) === Boolean(value.to), "起止时间必须同时提供")
  .refine(value => !value.from || Date.parse(value.from) < Date.parse(value.to!), "起始时间必须早于结束时间");
export const emptySchema = z.object({}).strict();

/* ------------------------------ DTOs ------------------------------ */
export type Citation = { source: SourceRef; excerpt: string };
export type SkillFinding = {
  skill: SkillRef;
  support: "insufficient" | "partial" | "supported";
  performance: "exposed" | "explain" | "apply" | "consistent" | null;
  rationale: string;
  citations: Citation[];
  limitations: string[];
  nextChecks: string[];
};
export type RecordDTO = {
  recordId: string;
  version: number;
  kind: RecordKind;
  status: "active" | "withdrawn";
  title: string;
  content: string;
  occurredAt: string;
  durationMinutes: number | null;
  projectId: string | null;
  taskId: string | null;
  skillRefs: SkillRef[];
  evidenceId: string | null;
  materials: MaterialRef[];
  source: SourceRef;
  materialState: MaterialState;
  sourceState: SourceState;
  completion: "partial" | "completed" | null;
  contribution: string | null;
  contributionPending: boolean;
  createdAt: string;
  updatedAt: string;
};
export type AssessmentDTO = {
  assessmentId: string;
  version: number;
  evidenceIds: string[];
  skillIds: string[];
  status: GenerationStatus;
  validity: "current" | "stale" | "withdrawn";
  findings: SkillFinding[];
  criteriaSummary: string;
  assessedAt: string | null;
  coverage: Coverage;
  sourceVersions: Record<string, number>;
  createdAt: string;
};
export type SkillCardDTO = {
  skill: SkillRef;
  evidenceIds: string[];
  assessments: AssessmentDTO[];
  verification: "no_evidence" | "pending" | "available" | "needs_review";
};
export type ReviewDTO = {
  reviewId: string;
  version: number;
  ownerId: string;
  status: GenerationStatus;
  range: { from: string; to: string; timeZone: string };
  stageId: string | null;
  progress: { text: string; citations: Citation[] }[];
  blockers: { observation: string; hypothesis: string | null; citations: Citation[] }[];
  suggestions: { text: string; skillIds: string[]; taskIds: string[] }[];
  sourceChanged: boolean;
  coverage: Coverage;
  sourceVersions: Record<string, number>;
  createdAt: string;
};
export type QuestionDTO = {
  questionId: string;
  ordinal: number;
  category: "knowledge" | "project" | "expression";
  prompt: string;
  skillRefs: SkillRef[];
};
export type AnswerFeedbackDTO = {
  questionId: string;
  answerId: string;
  status: GenerationStatus;
  strengths: string[];
  issues: { dimension: "knowledge" | "project" | "expression"; text: string; quote: string }[];
  suggestions: string[];
  limitations: string[];
  updatedAt: string;
};
export type InterviewAnswer = { answerId: string; questionId: string; text: string; feedback: AnswerFeedbackDTO | null; createdAt: string };
export type ReportDTO = {
  reportId: string;
  version: number;
  interviewId: string;
  status: GenerationStatus;
  answeredCount: number;
  totalQuestions: number;
  summary: string;
  findings: SkillFinding[];
  recommendations: string[];
  limitations: string[];
  createdAt: string;
};
export type InterviewStatus = "preparing" | "active" | "completed" | "ended_early" | "preparation_failed";
export type InterviewDifficulty = "introductory" | "intermediate" | "advanced";
export type InterviewDTO = {
  interviewId: string;
  version: number;
  ownerId: string;
  target: InterviewTarget;
  status: InterviewStatus;
  difficulty: InterviewDifficulty | null;
  totalQuestions: number | null;
  answeredCount: number;
  currentQuestion: QuestionDTO | null;
  questions: QuestionDTO[];
  answers: InterviewAnswer[];
  report: ReportDTO | null;
  reportStatus: GenerationStatus;
  coverage: Coverage;
  targetSnapshot: { revision: string; requirements: string | null; skillRefs: SkillRef[]; title?: string; project?: { title: string; goal: string; contribution: string | null } | null } | null;
  focus: string | null;
  createdAt: string;
  endedAt: string | null;
  endedEarly: boolean;
  recovery: RecoveryHint | null;
};
export type RecoveryHint = { toolName: string; entityId: string; action: string; retryable: boolean };
export type InterviewSummary = {
  interviewId: string;
  target: InterviewTarget;
  difficulty: InterviewDifficulty | null;
  status: InterviewStatus;
  answeredCount: number;
  totalQuestions: number | null;
  createdAt: string;
  endedAt: string | null;
  reportStatus: GenerationStatus;
  summary: string | null;
};
export type ReviewSummary = {
  reviewId: string;
  version: number;
  status: GenerationStatus;
  range: { from: string; to: string; timeZone: string };
  stageId: string | null;
  createdAt: string;
  sourceChanged: boolean;
};
export type RecordRevision = { ownerId: string; recordId: string; version: number; snapshot: RecordDTO; createdAt: string };
export type Project = { projectId: string; ownerId: string; title: string; goal: string; version: number; createdAt: string; updatedAt: string };
export type Page<T> = { items: T[]; hasMore: boolean; nextCursor: string | null };

/* --------------------------- result shape ------------------------- */
export type CapabilityErrorCode =
  | "NOT_FOUND" | "FORBIDDEN" | "INVALID_ARGUMENT" | "INVALID_STATE"
  | "VERSION_CONFLICT" | "DUPLICATE_REQUEST" | "CONFIRMATION_REQUIRED"
  | "DEPENDENCY_UNAVAILABLE" | "GENERATION_FAILED";
export type CapabilityResult<T> = {
  ok: boolean;
  changed: boolean;
  domain: "evidence";
  entityId?: string;
  version?: number;
  status: "read" | "applied" | "draft_created" | "confirmation_required" | "rejected";
  summary: string;
  data?: T;
  error?: { code: CapabilityErrorCode; message: string; retryable?: boolean; fields?: string[] };
};

/** Compatibility alias used by the persisted record store. */
export type LearningRecord = RecordDTO & {
  ownerId: string;
  activityRef?: string;
  pendingAssociations: { source: string; id: string; reason: string }[];
  missingInformation: string[];
  coverage: Coverage;
  withdrawalReason: string | null;
};
export type LearningRecordFilter = {
  from?: string;
  to?: string;
  kind?: RecordKind;
  kinds?: RecordKind[];
  taskId?: string;
  skillId?: string;
  limit?: number;
  cursor?: string;
  includeWithdrawn?: boolean;
};
export type Assessment = AssessmentDTO & { ownerId: string };
export type Review = ReviewDTO;
export type Interview = InterviewDTO;
