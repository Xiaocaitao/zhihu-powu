import test from "node:test";
import assert from "node:assert/strict";
import { MockEvidenceGeneration } from "../src/modules/evidence/generation.ts";

test("mock 生成端口输出可校验的题目、评估和反馈结构", async () => { const generator = new MockEvidenceGeneration(); const plan = await generator.buildInterview({ target: { kind: "skills", id: "http" }, questionCount: 2 }); assert.equal(plan.questions.length, 2); assert.equal(plan.questions[0].ordinal, 1); const findings = await generator.assessEvidence({ records: [{}], skillIds: ["http"] }); assert.equal(findings[0].support, "partial"); const feedback = await generator.assessAnswer({ question: "题目", answer: "回答" }); assert.equal(feedback.suggestions.length, 1); const report = await generator.summarizeInterview({ answers: [{}, {}] }); assert.match(report.summary, /2/); });
