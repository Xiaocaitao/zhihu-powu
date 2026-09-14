import test from "node:test";
import assert from "node:assert/strict";
import { createLlmEvidenceGeneration, GenerationError, MockEvidenceGeneration, validateCitations } from "../src/modules/evidence/generation.ts";
import { createLlmInvoker, unavailableLlmInvoker } from "../src/llm/invoker.ts";
import { KNOWN_SKILL } from "./support/evidence-fixtures.ts";
import { structuredSystemPrompt } from "../src/llm/doubao.ts";
import { z } from "zod";

const skill = { skillId: KNOWN_SKILL, name: "HTTP" };
const planInput = { target: { kind: "skills" as const, skillIds: [KNOWN_SKILL] }, difficulty: null, questionCount: 1, focus: null, skills: [skill], requirements: null, project: null, baseline: null };

test("模型请求确实包含可读 JSON Schema，格式错误只重试一次", async () => {
  const prompt = structuredSystemPrompt('出题', z.object({ questions: z.array(z.object({ prompt: z.string() })) }));
  assert.match(prompt, /\"properties\"/);
  assert.match(prompt, /questions/);
  assert.ok(!prompt.includes('_def'));
  let calls = 0;
  const generator = createLlmEvidenceGeneration(createLlmInvoker(async request => {
    assert.match(request.systemPrompt, /\"category\"/);
    assert.match(request.systemPrompt, /\"skillIds\"/);
    if (++calls === 1) return { questions: [null] };
    return { questions: [{ category: 'knowledge', prompt: '请解释 HTTP 缓存', skillIds: [KNOWN_SKILL] }] };
  }));
  assert.equal((await generator.buildInterview(planInput)).questions.length, 1);
  assert.equal(calls, 2);
  let failedCalls = 0;
  const invalid = createLlmEvidenceGeneration(createLlmInvoker(async () => { failedCalls++; return { questions: [{ category: 'invented', prompt: '题目' }] }; }));
  await assert.rejects(invalid.buildInterview(planInput), GenerationError);
  assert.equal(failedCalls, 2, '不能把未知分类默认为表达，也不能无限重试');
});

test("真实模型形态的字符串反馈与报告均经过结构校验", async () => {
  const outputs = [
    '```json\n{"strengths":["说明了实际做法"],"issues":[],"suggestions":["补充结果"],"limitations":["仅文字回答"]}\n```',
    JSON.stringify({ summary: '回答清楚但需补充结果', findings: [], recommendations: ['再练项目表达'], limitations: ['仅单场面试'] }),
  ];
  const generator = createLlmEvidenceGeneration(createLlmInvoker(async request => {
    assert.match(request.systemPrompt, /JSON Schema/);
    return outputs.shift();
  }));
  const question = { questionId: 'q', ordinal: 1, category: 'knowledge' as const, prompt: '做了什么', skillRefs: [skill] };
  assert.equal((await generator.assessAnswer({ question, answer: '实现请求解析', difficulty: null, target: planInput.target })).strengths.length, 1);
  assert.equal((await generator.summarizeInterview({ target: planInput.target, difficulty: null, skills: [skill], questions: [question], answers: [{ questionId: 'q', question: question.prompt, answer: '实现请求解析', feedback: null }] })).recommendations.length, 1);
});
const item = {
  recordId: "11111111-1111-4111-8111-111111111111", kind: "activity", title: "完成 HTTP 练习",
  content: "实现了请求解析并记录了缓存疑问", occurredAt: "2026-09-13T02:00:00.000Z", durationMinutes: 30,
  source: { domain: "evidence" as const, entityId: "11111111-1111-4111-8111-111111111111", revision: "1" },
  skillIds: [KNOWN_SKILL], contribution: null, materials: [], materialState: "none",
};

test("确定性生成端口输出可校验的题目、评估和反馈结构", async () => {
  const generator = new MockEvidenceGeneration();
  const plan = await generator.buildInterview({
    target: { kind: "skills", skillIds: [KNOWN_SKILL] }, difficulty: null, questionCount: 2,
    focus: null, skills: [skill], requirements: null, project: null, baseline: null,
  });
  assert.equal(plan.questions.length, 2);
  const findings = await generator.assessEvidence({
    skills: [skill], criteria: null, focus: null, items: [item], coverageNote: [],
  });
  assert.equal(findings[0].support, "partial");
  assert.equal(findings[0].citations[0].source.entityId, item.recordId);
  const feedback = await generator.assessAnswer({
    question: { questionId: "22222222-2222-4222-8222-222222222222", ordinal: 1, category: "project", prompt: "题目", skillRefs: [skill] },
    answer: "回答", difficulty: null, target: { kind: "skills", skillIds: [KNOWN_SKILL] },
  });
  assert.ok(feedback.issues[0].quote);
  const report = await generator.summarizeInterview({
    target: { kind: "skills", skillIds: [KNOWN_SKILL] }, difficulty: null, questions: [],
    answers: [{ questionId: "q", question: "题目", answer: "回答", feedback: null }], skills: [skill],
  });
  assert.match(report.summary, /HTTP/);
});

test("引用校验只接受来自所提供证据的原文，编造引用会被判为生成失败", () => {
  const accepted = validateCitations([{ recordId: item.recordId, excerpt: "实现了请求解析" }], [item]);
  assert.equal(accepted.length, 1);
  assert.throws(() => validateCitations([{ recordId: item.recordId, excerpt: "我精通分布式系统" }], [item]),
    (error: unknown) => error instanceof GenerationError && error.code === "GENERATION_FAILED");
  assert.throws(() => validateCitations([{ recordId: "unknown", excerpt: "实现了请求解析" }], [item]),
    (error: unknown) => error instanceof GenerationError);
});

test("模型适配器校验结构、题量与技能范围", async () => {
  const generation = createLlmEvidenceGeneration(createLlmInvoker(async () => ({
    questions: [{ category: "project", prompt: "讲讲你的项目", skillIds: [KNOWN_SKILL] }],
  })));
  const plan = await generation.buildInterview({
    target: { kind: "skills", skillIds: [KNOWN_SKILL] }, difficulty: null, questionCount: 1,
    focus: null, skills: [skill], requirements: null, project: null, baseline: null,
  });
  assert.equal(plan.questions.length, 1);

  const wrongCount = createLlmEvidenceGeneration(createLlmInvoker(async () => ({
    questions: [{ category: "project", prompt: "只有一题", skillIds: [] }],
  })));
  await assert.rejects(wrongCount.buildInterview({
    target: { kind: "skills", skillIds: [KNOWN_SKILL] }, difficulty: null, questionCount: 3,
    focus: null, skills: [skill], requirements: null, project: null, baseline: null,
  }), (error: unknown) => error instanceof GenerationError);

  const outsideScope = createLlmEvidenceGeneration(createLlmInvoker(async () => ({
    questions: [{ category: "knowledge", prompt: "越界技能", skillIds: ["skill-made-up"] }],
  })));
  await assert.rejects(outsideScope.buildInterview({
    target: { kind: "skills", skillIds: [KNOWN_SKILL] }, difficulty: null, questionCount: 1,
    focus: null, skills: [skill], requirements: null, project: null, baseline: null,
  }), (error: unknown) => error instanceof GenerationError && !error.retryable);
});

test("面试题兼容模型常见的 result/question 字段包装", async () => {
  const generation = createLlmEvidenceGeneration(createLlmInvoker(async () => ({
    result: { questions: [{ type: "项目说明", question: "请介绍一个项目中的关键取舍" }] },
  })));
  const plan = await generation.buildInterview({
    target: { kind: "project", project: { title: "项目", goal: "目标" } }, difficulty: null, questionCount: 1,
    focus: null, skills: [], requirements: null, project: { title: "项目", goal: "目标", contribution: null }, baseline: null,
  });
  assert.equal(plan.questions[0].category, "project");
  assert.equal(plan.questions[0].prompt, "请介绍一个项目中的关键取舍");
});

test("未配置模型时返回依赖不可用，而不是固定回复", async () => {
  const generation = createLlmEvidenceGeneration(unavailableLlmInvoker);
  await assert.rejects(generation.buildInterview({
    target: { kind: "skills", skillIds: [KNOWN_SKILL] }, difficulty: null, questionCount: 1,
    focus: null, skills: [skill], requirements: null, project: null, baseline: null,
  }), (error: unknown) => error instanceof GenerationError && error.code === "DEPENDENCY_UNAVAILABLE");
});
