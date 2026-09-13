import type { EvidenceService } from "./service.ts";
import type { EvidenceContext } from "./contracts.ts";
import { z } from "zod";
import { recordInputSchema } from "./contracts.ts";

const id = z.string().trim().min(1);
const listSchema = z.object({ from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional(), taskId: id.optional(), skillId: id.optional() }).strict();
const evidenceSchema = z.object({ evidenceIds: z.array(id).min(1).max(20), skillIds: z.array(id).min(1).max(20) }).strict();
const reviewSchema = z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }).strict();
const interviewTarget = z.object({ kind: z.enum(["job", "skills", "project"]), id }).strict();
const interviewId = z.object({ interviewId: id }).strict();
const answerSchema = z.object({ interviewId: id, questionId: id, answer: z.string().trim().min(1).max(20000) }).strict();
const updateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("amend"), recordId: id, changes: z.object({ title: z.string().trim().min(1).max(200).optional(), content: z.string().trim().min(1).max(20000).optional(), occurredAt: z.string().datetime({ offset: true }).optional(), durationMinutes: z.number().int().min(0).nullable().optional(), taskId: id.nullable().optional(), skillIds: z.array(id).max(20).optional() }).strict().refine(value => Object.keys(value).length > 0, "至少提供一项修正") }).strict(),
  z.object({ action: z.literal("withdraw"), recordId: id, reason: z.string().trim().min(1).max(2000) }).strict(),
]);
function validated<T extends z.ZodType>(schema: T, run: (ctx: EvidenceContext, input: z.infer<T>) => unknown) { return (ctx: EvidenceContext, input: unknown) => run(ctx, schema.parse(input)); }

export function createEvidenceCapabilities(service: EvidenceService) {
  return [
    { name: "get_learning_records", description: "查询当前用户学习记录", inputSchema: listSchema, execute: validated(listSchema, (ctx, input) => service.getLearningRecords(ctx, input)) },
    { name: "record_learning_evidence", description: "保存学习活动或项目成果", inputSchema: recordInputSchema, execute: validated(recordInputSchema, (ctx, input) => service.recordLearningEvidence(ctx, input)) },
    { name: "update_learning_evidence", description: "补充、修正或撤回学习成果", inputSchema: updateSchema, execute: validated(updateSchema, (ctx, input) => service.updateLearningEvidence(ctx, input.recordId, input.action === "withdraw" ? { withdraw: input.reason } : input.changes as any)) },
    { name: "get_skill_evidence", description: "查询能力证据", inputSchema: z.object({ skillId: id.optional() }).strict(), execute: validated(z.object({ skillId: id.optional() }).strict(), (ctx, input) => service.getSkillEvidence(ctx, input.skillId)) },
    { name: "evaluate_learning_evidence", description: "评估成果支持的能力", inputSchema: evidenceSchema, execute: validated(evidenceSchema, (ctx, input) => service.evaluateLearningEvidence(ctx, input.evidenceIds, input.skillIds)) },
    { name: "generate_learning_review", description: "生成阶段复盘", inputSchema: reviewSchema, execute: validated(reviewSchema, (ctx, input) => service.generateLearningReview(ctx, input.from, input.to)) },
    { name: "get_learning_reviews", description: "查询阶段复盘", inputSchema: z.object({}).strict(), execute: (ctx: EvidenceContext) => service.getLearningReviews(ctx) },
    { name: "start_interview", description: "开始文字模拟面试", inputSchema: z.object({ target: interviewTarget, questionCount: z.number().int().min(1).max(20).optional() }).strict(), execute: validated(z.object({ target: interviewTarget, questionCount: z.number().int().min(1).max(20).optional() }).strict(), (ctx, input) => service.startInterview(ctx, input.target, input.questionCount)) },
    { name: "get_interview_session", description: "读取面试会话", inputSchema: interviewId, execute: validated(interviewId, (ctx, input) => service.getInterviewSession(ctx, input.interviewId)) },
    { name: "submit_interview_answer", description: "提交面试回答", inputSchema: answerSchema, execute: validated(answerSchema, (ctx, input) => service.submitInterviewAnswer(ctx, input.interviewId, input.questionId, input.answer)) },
    { name: "finish_interview", description: "结束模拟面试", inputSchema: interviewId, execute: validated(interviewId, (ctx, input) => service.finishInterview(ctx, input.interviewId)) },
    { name: "get_interview_feedback", description: "读取面试反馈", inputSchema: interviewId, execute: validated(interviewId, (ctx, input) => service.getInterviewFeedback(ctx, input.interviewId)) },
    { name: "get_interview_records", description: "查询历史面试", inputSchema: z.object({}).strict(), execute: (ctx: EvidenceContext) => service.getInterviewRecords(ctx) },
  ];
}
