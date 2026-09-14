import type { z } from "zod";
import type { CapabilityContext, DomainCapability } from "../../contracts/capability.ts";
import type { EvidenceApplication } from "./application.ts";
import {
  assessmentInputSchema, finishInterviewSchema, interviewFeedbackSchema, interviewIdSchema, interviewListSchema,
  recordCreateSchema, recordQuerySchema, reviewGenerateSchema, reviewQuerySchema, skillCardQuerySchema,
  startInterviewSchema, submitAnswerSchema, updateRecordSchema,
} from "./contracts.ts";

type Tool = {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  execute: (ctx: CapabilityContext, input: unknown) => Promise<unknown>;
};

function tool<S extends z.ZodType, R>(
  name: string,
  description: string,
  inputSchema: S,
  run: (ctx: CapabilityContext, input: z.infer<S>) => Promise<R>,
): Tool {
  return { name, description, inputSchema, execute: (ctx, input) => run(ctx, inputSchema.parse(input)) };
}

/**
 * The 13 Evidence & Interview capabilities. They only validate input shape and
 * delegate to the application service; no business rule lives in this file.
 */
export function createEvidenceCapabilities(app: EvidenceApplication): Tool[] {
  return [
    tool("get_learning_records", "查询当前用户的学习记录：列表模式可按本周、时间段、类型、任务或能力筛选；详情模式按记录标识读取单条记录及其覆盖说明。",
      recordQuerySchema, (ctx, input) => app.getLearningRecords(ctx, input)),

    tool("record_learning_evidence", "保存用户已经发生的学习活动或项目成果，可附实际用时、材料引用和项目贡献。只有用户明确描述已经完成的学习事实时才调用；未来计划、假设或提问不能记录。",
      recordCreateSchema, (ctx, input) => app.recordLearningEvidence(ctx, input)),

    tool("update_learning_evidence", "补充、修正或撤回本模块保存的学习记录。修正需要提供用户实际读到的记录版本；材料或能力关联变化后，旧评估会被标记为需要重新评估。",
      updateRecordSchema, (ctx, input) => app.updateLearningEvidence(
        { ...ctx, expectedVersion: input.expectedVersion },
        input.action === "amend"
          ? { recordId: input.recordId, action: "amend", changes: input.changes }
          : { recordId: input.recordId, action: "withdraw", reason: input.reason },
      )),

    tool("evaluate_learning_evidence", "评估指定学习记录对具体能力的支持程度，返回有依据的判断、局限和下一步验证方式。结果只覆盖所引用的证据与标准，不代表综合掌握度。",
      assessmentInputSchema, (ctx, input) => app.evaluateLearningEvidence(ctx, input)),

    tool("get_skill_evidence", "查询已有能力证据卡片与历史评估结论，包含证据有效性。查询本身不会生成新的评估，也不会计算综合等级。",
      skillCardQuerySchema, (ctx, input) => app.getSkillEvidence(ctx, input)),

    tool("generate_learning_review", "对指定时间段或学习阶段生成阶段复盘，包含进展、卡点观察与下一步建议。复盘只回看已有记录，不创建或调整学习任务；阶段测验由学习计划模块负责。",
      reviewGenerateSchema, (ctx, input) => app.generateLearningReview(ctx, input)),

    tool("get_learning_reviews", "查询历史阶段复盘：列表模式返回摘要与来源变化状态，详情模式返回完整复盘内容。查询不会重新生成结论。",
      reviewQuerySchema, (ctx, input) => app.getLearningReviews(ctx,
        "mode" in input && input.mode === "detail" ? { reviewId: input.reviewId } : input)),

    tool("start_interview", "开始一次文字模拟面试。训练范围必须由用户明确给出：岗位、能力标识或本模块项目。已有进行中的会话会复用，除非用户明确要求重新开始。",
      startInterviewSchema, (ctx, input) => app.startInterview(ctx, input)),

    tool("get_interview_session", "读取一场模拟面试的当前题目、已答内容和报告状态，用于恢复进行中的训练。",
      interviewIdSchema, (ctx, input) => app.getInterviewSession(ctx, input.interviewId)),

    tool("submit_interview_answer", "提交用户对当前题目的回答并保存逐题反馈。只能回答当前题，已提交的回答不可改写；反馈生成失败时回答仍然保存。",
      submitAnswerSchema, (ctx, input) => app.submitInterviewAnswer(ctx, input)),

    tool("finish_interview", "结束或提前结束一场模拟面试，并生成整场报告。报告可以给出改进建议，但不会直接创建或修改学习任务。",
      finishInterviewSchema, (ctx, input) => app.finishInterview(ctx, input)),

    tool("get_interview_feedback", "读取反馈：指定题目时返回该题反馈，否则返回整场报告及其生成状态。查询不会触发结束、重评或重试。",
      interviewFeedbackSchema, (ctx, input) => app.getInterviewFeedback(ctx, input)),

    tool("get_interview_records", "查询历史模拟面试，可按时间、岗位、能力或状态筛选，并返回进行中的会话。",
      interviewListSchema, (ctx, input) => app.getInterviewRecords(ctx, input)),
  ];
}
