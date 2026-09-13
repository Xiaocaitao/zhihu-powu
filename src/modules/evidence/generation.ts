import type { SkillEvidence } from "./contracts.ts";

export type InterviewPlan = { questions: { ordinal: number; category: "knowledge" | "project" | "expression"; prompt: string }[] };
export type ReviewContent = { progress: string[]; blockers: string[]; suggestions: string[] };
export type AnswerFeedbackContent = { strengths: string[]; issues: string[]; suggestions: string[] };
export type ReportContent = { summary: string; findings: SkillEvidence[]; recommendations: string[] };
export interface EvidenceGenerationPort { buildInterview(input: { target: unknown; questionCount: number }): Promise<InterviewPlan>; assessEvidence(input: { records: unknown[]; skillIds: string[] }): Promise<SkillEvidence[]>; reviewLearning(input: { records: unknown[] }): Promise<ReviewContent>; assessAnswer(input: { question: string; answer: string }): Promise<AnswerFeedbackContent>; summarizeInterview(input: { answers: unknown[] }): Promise<ReportContent>; }

/** Deterministic mock for contract tests; production must inject the team's LlmInvoker adapter. */
export class MockEvidenceGeneration implements EvidenceGenerationPort {
  async buildInterview(input: { target: unknown; questionCount: number }) { return { questions: Array.from({ length: input.questionCount }, (_, index) => ({ ordinal: index + 1, category: "project" as const, prompt: `训练问题占位（第 ${index + 1} 题）` })) }; }
  async assessEvidence(input: { records: unknown[]; skillIds: string[] }) { return input.skillIds.map(skillId => ({ skillId, support: input.records.length ? "partial" : "insufficient", rationale: "mock 评估：需要结合材料进一步验证", recordIds: [] } as SkillEvidence)); }
  async reviewLearning(input: { records: unknown[] }) { return { progress: input.records.length ? ["已有学习记录"] : [], blockers: [], suggestions: input.records.length ? ["继续补充成果材料"] : ["先记录一次学习活动"] }; }
  async assessAnswer(_input: { question: string; answer: string }) { return { strengths: ["已提交回答"], issues: [], suggestions: ["补充具体背景、行动和结果"] }; }
  async summarizeInterview(input: { answers: unknown[] }) { return { summary: `已完成 ${input.answers.length} 项回答的 mock 总结`, findings: [], recommendations: ["根据逐题反馈继续练习"] }; }
}
