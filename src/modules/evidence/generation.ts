import { z } from "zod";
import type { LlmInvoker } from "../../llm/invoker.ts";
import type { SkillRef } from "../skills/contracts.ts";
import type {
  AnswerFeedbackDTO, Citation, InterviewDifficulty, InterviewTarget, QuestionDTO, SkillFinding, SourceRef,
} from "./contracts.ts";

/** Generation failures are classified so callers can offer an honest recovery action. */
export class GenerationError extends Error {
  readonly code: "DEPENDENCY_UNAVAILABLE" | "GENERATION_FAILED";
  readonly retryable: boolean;
  constructor(code: "DEPENDENCY_UNAVAILABLE" | "GENERATION_FAILED", message: string, retryable = true) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

export type EvidenceItemInput = {
  recordId: string;
  kind: string;
  title: string;
  content: string;
  occurredAt: string;
  durationMinutes: number | null;
  source: SourceRef;
  skillIds: string[];
  contribution: string | null;
  materials: { documentId: string; itemId?: string; locator: string; text: string }[];
  materialState: string;
};

export type InterviewPlanInput = {
  target: InterviewTarget;
  difficulty: InterviewDifficulty | null;
  questionCount: number;
  focus: string | null;
  skills: SkillRef[];
  requirements: string | null;
  project: { title: string; goal: string; contribution: string | null } | null;
  baseline: unknown;
};
export type InterviewPlan = {
  questions: { category: "knowledge" | "project" | "expression"; prompt: string; skillIds: string[] }[];
};
export type EvidenceAssessmentInput = {
  skills: SkillRef[];
  criteria: { summary: string; requirements: string | null } | null;
  focus: string | null;
  items: EvidenceItemInput[];
  coverageNote: string[];
};
export type ReviewInput = {
  range: { from: string; to: string; timeZone: string };
  stage: { stageId: string; title: string; objective: string } | null;
  focus: string | null;
  items: EvidenceItemInput[];
  coverageNote: string[];
};
export type ReviewContent = {
  progress: { text: string; citations: Citation[] }[];
  blockers: { observation: string; hypothesis: string | null; citations: Citation[] }[];
  suggestions: { text: string; skillIds: string[]; taskIds: string[] }[];
};
export type AnswerAssessmentInput = {
  question: QuestionDTO;
  answer: string;
  difficulty: InterviewDifficulty | null;
  target: InterviewTarget;
};
export type AnswerFeedbackContent = Omit<AnswerFeedbackDTO, "questionId" | "answerId" | "status" | "updatedAt">;
export type ReportInput = {
  target: InterviewTarget;
  difficulty: InterviewDifficulty | null;
  questions: QuestionDTO[];
  answers: { questionId: string; question: string; answer: string; feedback: AnswerFeedbackDTO | null }[];
  skills: SkillRef[];
};
export type ReportContent = {
  summary: string;
  findings: SkillFinding[];
  recommendations: string[];
  limitations: string[];
};

export interface EvidenceGenerationPort {
  buildInterview(input: InterviewPlanInput): Promise<InterviewPlan>;
  assessEvidence(input: EvidenceAssessmentInput): Promise<SkillFinding[]>;
  reviewLearning(input: ReviewInput): Promise<ReviewContent>;
  assessAnswer(input: AnswerAssessmentInput): Promise<AnswerFeedbackContent>;
  summarizeInterview(input: ReportInput): Promise<ReportContent>;
}

/* --------------------------- output schemas ----------------------- */
const citationSchema = z.object({
  recordId: z.string().min(1),
  excerpt: z.string().trim().min(1).max(1000),
}).strict();
const findingSchema = z.object({
  skillId: z.string().min(1),
  support: z.enum(["insufficient", "partial", "supported"]),
  performance: z.enum(["exposed", "explain", "apply", "consistent"]).nullable().default(null),
  rationale: z.string().trim().min(1).max(2000),
  citations: z.array(citationSchema).max(20).default([]),
  limitations: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
  nextChecks: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
}).strict();
const planSchema = z.object({
  questions: z.array(z.object({
    category: z.enum(["knowledge", "project", "expression"]),
    prompt: z.string().trim().min(1).max(2000),
    skillIds: z.array(z.string().min(1)).max(10).default([]),
  }).strict()).min(1).max(20),
}).strict();
const reviewSchema = z.object({
  progress: z.array(z.object({ text: z.string().trim().min(1).max(2000), citations: z.array(citationSchema).max(20).default([]) }).strict()).max(30).default([]),
  blockers: z.array(z.object({
    observation: z.string().trim().min(1).max(2000), hypothesis: z.string().trim().min(1).max(2000).nullable().default(null),
    citations: z.array(citationSchema).max(20).default([]),
  }).strict()).max(30).default([]),
  suggestions: z.array(z.object({
    text: z.string().trim().min(1).max(2000),
    skillIds: z.array(z.string().min(1)).max(10).default([]),
    taskIds: z.array(z.string().min(1)).max(10).default([]),
  }).strict()).max(30).default([]),
}).strict();
const feedbackSchema = z.object({
  strengths: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
  issues: z.array(z.object({
    dimension: z.enum(["knowledge", "project", "expression"]),
    text: z.string().trim().min(1).max(1000),
    quote: z.string().max(1000).default(""),
  }).strict()).max(20).default([]),
  suggestions: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
  limitations: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
}).strict();
const reportSchema = z.object({
  summary: z.string().trim().min(1).max(4000),
  findings: z.array(findingSchema).max(20).default([]),
  recommendations: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
  limitations: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
}).strict();

const normalize = (value: string) => value.replace(/\s+/g, "").toLocaleLowerCase();

/** A citation is only accepted when it points at supplied evidence and quotes it. */
export function validateCitations(
  citations: { recordId: string; excerpt: string }[],
  items: EvidenceItemInput[],
): Citation[] {
  const index = new Map(items.map(item => [item.recordId, item]));
  return citations.map(citation => {
    const item = index.get(citation.recordId);
    if (!item) throw new GenerationError("GENERATION_FAILED", "生成结果引用了未提供的证据", false);
    const haystack = normalize([item.title, item.content, item.contribution ?? "", ...item.materials.map(m => m.text)].join("\n"));
    if (!haystack.includes(normalize(citation.excerpt))) {
      throw new GenerationError("GENERATION_FAILED", "生成结果引用的原文不在所提供材料中", false);
    }
    return { source: item.source, excerpt: citation.excerpt.trim() };
  });
}

function validateFindings(findings: z.infer<typeof findingSchema>[], input: EvidenceAssessmentInput): SkillFinding[] {
  const wanted = new Set(input.skills.map(skill => skill.skillId));
  return findings.map(finding => {
    if (!wanted.has(finding.skillId)) throw new GenerationError("GENERATION_FAILED", "生成结果返回了未请求的能力标识", false);
    return {
      skill: input.skills.find(skill => skill.skillId === finding.skillId)!,
      support: finding.support,
      performance: finding.performance,
      rationale: finding.rationale,
      citations: validateCitations(finding.citations, input.items),
      limitations: finding.limitations,
      nextChecks: finding.nextChecks,
    };
  });
}

/* ------------------------- LLM-backed adapter --------------------- */
const baseSystem = [
  "你是「破雾」成长助手中的能力证据与模拟面试引擎。",
  "只依据调用方提供的学习记录、材料原文、岗位或能力信息作答，不得编造未提供的事实。",
  "引用必须来自提供的证据：recordId 必须是给出的记录标识，excerpt 必须是对应记录或材料中的原文片段。",
  "信息不足时降低 support 等级、写明 limitations，并在 nextChecks 给出下一步验证方式。",
  "只输出符合要求的 JSON，不要输出解释、Markdown 代码块或额外文字。",
].join("\n");

function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(trimmed); }
  catch {
    // Some providers prepend a short sentence despite the JSON-only prompt.
    // Extract one complete object and still apply the strict schema afterwards.
    const start = trimmed.indexOf("{"); const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* fall through */ }
    }
    throw new GenerationError("GENERATION_FAILED", "生成结果不是合法 JSON", true);
  }
}

/** Models sometimes wrap structured output or use a common synonym for prompt.
 * Normalize only the interview plan envelope; all fields still go through the
 * strict schema below so unsupported content is rejected explicitly. */
function normalizeInterviewPlan(value: unknown): unknown {
  const object = (item: unknown): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item);
  let current = value;
  for (let i = 0; i < 2 && current && typeof current === "object"; i++) {
    if (!object(current)) break;
    if (object(current.result)) current = current.result;
    else if (object(current.data)) current = current.data;
    else break;
  }
  if (!object(current) || !Array.isArray(current.questions)) return current;
  return {
    questions: current.questions.map(item => !object(item) ? item : ({
      category: ({ knowledge_understanding: "knowledge", project_explanation: "project", communication: "expression", 知识理解: "knowledge", 项目说明: "project", 表达: "expression" } as Record<string, string>)[String(item.category ?? item.type)] ?? item.category ?? item.type,
      prompt: item.prompt ?? item.question ?? item.text,
      skillIds: item.skillIds ?? [],
    })),
  };
}

export function createLlmEvidenceGeneration(invoker: LlmInvoker): EvidenceGenerationPort {
  const run = async <T>(systemPrompt: string, userInput: unknown, schema: z.ZodType<T>, normalizeOutput?: (value: unknown) => unknown, repair = false): Promise<T> => {
    let raw: unknown;
    try {
      raw = await invoker.generateStructured<unknown>({
        systemPrompt: `${baseSystem}\n${systemPrompt}\nJSON Schema：${JSON.stringify(z.toJSONSchema(schema))}${repair ? '\n上次输出格式无效。请重新生成，逐项检查必填字段、枚举与数量；不要添加说明。' : ''}`,
        userInput,
        outputSchema: schema,
      });
    } catch (error) {
      if (error && typeof error === "object" && (error as { code?: string }).code === "DEPENDENCY_UNAVAILABLE") {
        throw new GenerationError("DEPENDENCY_UNAVAILABLE", "生成服务尚未配置，请稍后重试", true);
      }
      throw new GenerationError("GENERATION_FAILED", "生成服务暂时不可用", true);
    }
    let parsed: unknown;
    try { parsed = typeof raw === "string" ? parseJson(raw) : raw; }
    catch (error) { if (!repair) return run(systemPrompt, userInput, schema, normalizeOutput, true); throw error; }
    const result = schema.safeParse(normalizeOutput ? normalizeOutput(parsed) : parsed);
    if (!result.success) {
      if (!repair) return run(systemPrompt, userInput, schema, normalizeOutput, true);
      throw new GenerationError("GENERATION_FAILED", "生成结果不符合约定结构，请重新生成", true);
    }
    return result.data;
  };

  return {
    async buildInterview(input) {
      const data = await run(
        `请生成 ${input.questionCount} 道${input.difficulty ?? "适中"}难度的面试题，覆盖知识理解、项目说明和表达三类。`,
        { target: input.target, skills: input.skills, requirements: input.requirements, project: input.project, baseline: input.baseline, focus: input.focus },
        planSchema.refine(plan => plan.questions.length === input.questionCount, "题量必须与请求一致"),
        normalizeInterviewPlan,
      );
      if (data.questions.length !== input.questionCount) {
        throw new GenerationError("GENERATION_FAILED", "生成题目数量与要求不一致", true);
      }
      const allowed = new Set(input.skills.map(skill => skill.skillId));
      return {
        questions: data.questions.map(question => {
          for (const skillId of question.skillIds) {
            if (!allowed.has(skillId)) throw new GenerationError("GENERATION_FAILED", "生成题目引用了未提供的技能标识", false);
          }
          return question;
        }),
      };
    },
    async assessEvidence(input) {
      const data = await run(
        "评估每条证据对所请求能力的支持程度。support 只能是 insufficient、partial 或 supported；写清依据与局限。",
        { skills: input.skills, criteria: input.criteria, focus: input.focus, coverageNote: input.coverageNote, evidence: input.items },
        z.object({ findings: z.array(findingSchema).min(1).max(20) }).strict(),
      );
      return validateFindings(data.findings, input);
    },
    async reviewLearning(input) {
      const data = await run(
        "基于学习记录生成阶段复盘：进展、卡点（区分观察与假设）和下一步建议。不要替用户调整学习计划。",
        { range: input.range, stage: input.stage, focus: input.focus, coverageNote: input.coverageNote, records: input.items },
        reviewSchema,
      );
      return {
        progress: data.progress.map(item => ({ text: item.text, citations: validateCitations(item.citations, input.items) })),
        blockers: data.blockers.map(item => ({
          observation: item.observation, hypothesis: item.hypothesis,
          citations: validateCitations(item.citations, input.items),
        })),
        suggestions: data.suggestions,
      };
    },
    async assessAnswer(input) {
      const data = await run(
        "评估这道面试回答：列出有依据的优点、问题与改进建议。issues.quote 必须是回答中的原文片段。",
        { question: input.question.prompt, category: input.question.category, difficulty: input.difficulty, target: input.target, answer: input.answer },
        feedbackSchema,
      );
      const normalized = normalize(input.answer);
      const issues = data.issues.map(issue => ({
        ...issue,
        quote: issue.quote && normalized.includes(normalize(issue.quote)) ? issue.quote : "",
      }));
      return { strengths: data.strengths, issues, suggestions: data.suggestions, limitations: data.limitations };
    },
    async summarizeInterview(input) {
      const data = await run(
        "根据整场问答生成面试报告：整体摘要、按能力维度的 findings、改进建议与局限。只依据提供的问答与反馈。",
        { target: input.target, difficulty: input.difficulty, skills: input.skills, answers: input.answers },
        reportSchema,
      );
      const allowed = new Set(input.skills.map(skill => skill.skillId));
      const findings = data.findings.map(finding => {
        if (!allowed.has(finding.skillId)) throw new GenerationError("GENERATION_FAILED", "报告引用了未提供的技能标识", false);
        const skill = input.skills.find(item => item.skillId === finding.skillId)!;
        return { ...finding, skill, citations: [] as Citation[], performance: finding.performance };
      });
      return { summary: data.summary, findings, recommendations: data.recommendations, limitations: data.limitations };
    },
  };
}

/** Deterministic stand-in for tests and local development. Never claims a level of mastery. */
export class MockEvidenceGeneration implements EvidenceGenerationPort {
  readonly calls: string[] = [];
  async buildInterview(input: InterviewPlanInput): Promise<InterviewPlan> {
    this.calls.push("buildInterview");
    const categories = ["knowledge", "project", "expression"] as const;
    return {
      questions: Array.from({ length: input.questionCount }, (_, index) => ({
        category: categories[index % categories.length]!,
        prompt: `第 ${index + 1} 题：请结合你的实际经历说明一个具体做法与结果。`,
        skillIds: input.skills.slice(0, 1).map(skill => skill.skillId),
      })),
    };
  }
  async assessEvidence(input: EvidenceAssessmentInput): Promise<SkillFinding[]> {
    this.calls.push("assessEvidence");
    return input.skills.map(skill => {
      const cited = input.items.find(item => item.skillIds.includes(skill.skillId)) ?? input.items[0];
      return {
        skill,
        support: cited ? "partial" : "insufficient",
        performance: null,
        rationale: cited ? "学习记录描述了相关做法，但仍缺少材料或稳定表现佐证。" : "当前没有关联到该能力的证据。",
        citations: cited ? [{ source: cited.source, excerpt: cited.content.slice(0, 60) }] : [],
        limitations: cited ? ["仅依据自述记录，尚未核对原始材料"] : ["没有可用证据"],
        nextChecks: ["补充可核对的成果材料或实际产出"],
      };
    });
  }
  async reviewLearning(input: ReviewInput): Promise<ReviewContent> {
    this.calls.push("reviewLearning");
    return {
      progress: input.items.map(item => ({ text: item.title, citations: [{ source: item.source, excerpt: item.content.slice(0, 60) }] })),
      blockers: input.items
        .filter(item => /卡|难|问题|不确定/.test(item.content))
        .map(item => ({ observation: item.content.slice(0, 100), hypothesis: null, citations: [{ source: item.source, excerpt: item.content.slice(0, 60) }] })),
      suggestions: input.items.length
        ? [{ text: "继续补充可核对的成果材料，确认能力与岗位要求的对应关系。", skillIds: [], taskIds: [] }]
        : [],
    };
  }
  async assessAnswer(input: AnswerAssessmentInput): Promise<AnswerFeedbackContent> {
    this.calls.push("assessAnswer");
    const quote = input.answer.trim().slice(0, 40);
    return {
      strengths: input.answer.trim() ? ["给出了具体回答"] : [],
      issues: [{ dimension: "expression", text: "回答可以补充背景、行动与结果。", quote }],
      suggestions: ["用 STAR 结构补充当时的约束与最终结果"],
      limitations: ["该反馈基于文字回答，未包含语音表达信息"],
    };
  }
  async summarizeInterview(input: ReportInput): Promise<ReportContent> {
    this.calls.push("summarizeInterview");
    return {
      summary: `本场共作答 ${input.answers.length} 题，覆盖${input.skills.map(skill => skill.name).join("、") || "训练范围"}。`,
      findings: input.skills.map(skill => ({
        skill, support: "partial" as const, performance: null,
        rationale: "基于本场文字回答的表现，仍需更多实践材料验证。",
        citations: [], limitations: ["仅依据单场文字问答"], nextChecks: ["补充一次真实项目产出"],
      })),
      recommendations: ["继续练习项目细节与结果表达"],
      limitations: ["报告基于文字回答，未包含语音与视频信息"],
    };
  }
}
