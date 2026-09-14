import type { EvidenceContext } from "./contracts.ts";
import type { SkillDefinition, SkillRef, SkillResolution } from "../skills/contracts.ts";

export type Coverage = {
  complete: boolean;
  missing: { source: string; reason: string }[];
  observedAt: string;
};
export type ExternalResult<T> = { value: T | null; coverage: Coverage };
export type MaterialRef = { documentId: string; itemId?: string; label?: string };
export type MaterialContent = {
  reference: MaterialRef;
  state: "available" | "partial" | "unavailable";
  revision: string | null;
  excerpts: { locator: string; text: string }[];
  reason: string | null;
};
export type TaskContext = {
  taskId: string;
  stageId: string;
  title: string;
  status: string;
  expectedOutcome: string;
  criteria: string[] | null;
  revision: string;
};
export type StageContext = {
  stageId: string;
  title: string;
  objective: string;
  from: string | null;
  to: string | null;
  taskIds: string[];
  revision: string;
};
export type SourceChange = {
  sourceDomain: "learning";
  sourceEventId: string;
  sourceEntityId: string;
  sourceRevision: number;
  occurredAt: string;
  kind: "task_change" | "learning_feedback" | "plan_adjustment" | "assessment_result";
  change: "created" | "amended" | "withdrawn";
  snapshot: { title: string; content: string; taskId?: string; skillIds?: string[] };
  activityRef?: string;
  durationMinutes?: number;
};

export interface LearningQueryPort {
  getTask(ctx: EvidenceContext, taskId: string): Promise<ExternalResult<TaskContext>>;
  getStage(ctx: EvidenceContext, stageId: string): Promise<ExternalResult<StageContext>>;
  listHistory(ctx: EvidenceContext, range: { from: string; to: string; cursor?: string }): Promise<ExternalResult<{
    items: SourceChange[]; nextCursor: string | null;
  }>>;
  getAssessmentResult(ctx: EvidenceContext, resultId: string): Promise<ExternalResult<{
    resultId: string; content: string; criteria: string[]; skillRefs: SkillRef[]; revision: string;
  }>>;
}

export interface CareerQueryPort {
  getJobRequirements(ctx: EvidenceContext, jobId: string): Promise<ExternalResult<{
    jobId: string; title: string; requirements: string; skillRefs: SkillRef[]; revision: string;
  }>>;
}

export interface ProfileQueryPort {
  getLearningContext(ctx: EvidenceContext): Promise<ExternalResult<{
    baseline: unknown | null; goals: unknown[]; timeZone: string | null;
  }>>;
}

export interface KnowledgeQueryPort {
  resolveMaterials(ctx: EvidenceContext, refs: MaterialRef[]): Promise<ExternalResult<MaterialContent[]>>;
}

export interface SharedSkillsPort {
  get(skillIds: string[]): Promise<{ items: SkillDefinition[]; missingIds: string[] }>;
  resolve(terms: string[]): Promise<SkillResolution[]>;
}

export type EvidencePorts = {
  learning?: LearningQueryPort;
  career?: CareerQueryPort;
  profile?: ProfileQueryPort;
  knowledge?: KnowledgeQueryPort;
  skills?: SharedSkillsPort;
};

export function unavailable<T>(source: string, reason: string): ExternalResult<T> {
  return { value: null, coverage: { complete: false, missing: [{ source, reason }], observedAt: new Date().toISOString() } };
}
