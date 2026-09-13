import type { EvidenceService } from "./service.ts";
import type { EvidenceContext } from "./contracts.ts";

export function createEvidenceCapabilities(service: EvidenceService) {
  return [
    { name: "get_learning_records", description: "查询当前用户学习记录", execute: (ctx: EvidenceContext, input: any) => service.getLearningRecords(ctx, input) },
    { name: "record_learning_evidence", description: "保存学习活动或项目成果", execute: (ctx: EvidenceContext, input: any) => service.recordLearningEvidence(ctx, input) },
    { name: "update_learning_evidence", description: "补充、修正或撤回学习成果", execute: (ctx: EvidenceContext, input: any) => service.updateLearningEvidence(ctx, input.recordId, input.changes) },
    { name: "get_skill_evidence", description: "查询能力证据", execute: (ctx: EvidenceContext, input: any) => service.getSkillEvidence(ctx, input.skillId) },
    { name: "evaluate_learning_evidence", description: "评估成果支持的能力", execute: (ctx: EvidenceContext, input: any) => service.evaluateLearningEvidence(ctx, input.evidenceIds, input.skillIds) },
    { name: "generate_learning_review", description: "生成阶段复盘", execute: (ctx: EvidenceContext, input: any) => service.generateLearningReview(ctx, input.from, input.to) },
    { name: "get_learning_reviews", description: "查询阶段复盘", execute: (ctx: EvidenceContext) => service.getLearningReviews(ctx) },
    { name: "start_interview", description: "开始文字模拟面试", execute: (ctx: EvidenceContext, input: any) => service.startInterview(ctx, input.target, input.questionCount) },
    { name: "get_interview_session", description: "读取面试会话", execute: (ctx: EvidenceContext, input: any) => service.getInterviewSession(ctx, input.interviewId) },
    { name: "submit_interview_answer", description: "提交面试回答", execute: (ctx: EvidenceContext, input: any) => service.submitInterviewAnswer(ctx, input.interviewId, input.questionId, input.answer) },
    { name: "finish_interview", description: "结束模拟面试", execute: (ctx: EvidenceContext, input: any) => service.finishInterview(ctx, input.interviewId) },
    { name: "get_interview_feedback", description: "读取面试反馈", execute: (ctx: EvidenceContext, input: any) => service.getInterviewFeedback(ctx, input.interviewId) },
    { name: "get_interview_records", description: "查询历史面试", execute: (ctx: EvidenceContext) => service.getInterviewRecords(ctx) },
  ];
}
