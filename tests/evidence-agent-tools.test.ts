import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultCapabilityRegistry } from "../src/app/composition-root.ts";
import { EvidenceApplication } from "../src/modules/evidence/application.ts";
import { createEvidenceService } from "../src/modules/evidence/defaults.ts";
import { MockEvidenceGeneration } from "../src/modules/evidence/generation.ts";
import { MemoryEvidenceRepository } from "../src/modules/evidence/memory-repository.ts";
import { adaptDomainCapabilities } from "../src/agent/tools/domain-adapter.ts";
import { deriveLearningWorkflowState } from "../src/agent/workflows/learning-workflow.ts";
import { defaultPorts, KNOWN_SKILL } from "./support/evidence-fixtures.ts";

const TOOL_NAMES = [
  "get_learning_records", "record_learning_evidence", "update_learning_evidence", "evaluate_learning_evidence",
  "get_skill_evidence", "generate_learning_review", "get_learning_reviews",
  "start_interview", "get_interview_session", "submit_interview_answer", "finish_interview",
  "get_interview_feedback", "get_interview_records",
];

/**
 * 页面改造成页内直连之后，主 Agent 这条链路必须仍然可用：
 * 工具注册、Agent 适配器执行、以及对话式记录的工作流门禁。
 */
test("Agent 侧仍注册并可调用 Evidence 与 Interview 的 13 个工具", async () => {
  const registry = createDefaultCapabilityRegistry({
    evidence: new EvidenceApplication(new MemoryEvidenceRepository(), createEvidenceService({
      generation: new MockEvidenceGeneration(), ports: defaultPorts(),
    })),
  });
  const names = registry.list().map(capability => capability.name);
  for (const name of TOOL_NAMES) assert.ok(names.includes(name), `缺少工具 ${name}`);

  const context = { ownerId: "agent-owner", requestId: "agent-request", operationKey: "agent-operation" };
  const tools = adaptDomainCapabilities(registry.forContext(context), context);
  assert.equal(tools.length >= TOOL_NAMES.length, true);

  // 对话里说“开一场模拟面试”时，Agent 走的就是这条执行路径。
  const start = tools.find(tool => tool.name === "start_interview");
  assert.ok(start);
  const started = await start.execute("call-start", { target: { kind: "skills", skillIds: [KNOWN_SKILL] }, questionCount: 1 });
  const startedDetails = started.details as { ok: boolean; data?: { interview?: { interviewId: string; status: string } } };
  assert.equal(startedDetails.ok, true);
  assert.equal(startedDetails.data?.interview?.status, "active");

  // 对话里描述学习经历时，Agent 调 record_learning_evidence 落库。
  const record = tools.find(tool => tool.name === "record_learning_evidence");
  assert.ok(record);
  const saved = await record.execute("call-record", {
    kind: "activity", title: "Agent 记录的学习", content: "在对话中说明完成了一次 HTTP 练习",
    occurredAt: "2026-09-14T10:00:00+08:00", durationMinutes: 20,
  });
  assert.equal((saved.details as { ok: boolean }).ok, true);
});

test("对话式记录沿用工作流门禁：明确“记录/保存 + 学习经历/成果/证据”才放行", () => {
  assert.equal(deriveLearningWorkflowState("请帮我记录这次学习经历：今天练习了 HTTP 缓存，用时 40 分钟"), "evidence_recorded");
  assert.equal(deriveLearningWorkflowState("保存一下我的学习成果：完成了登录接口"), "evidence_recorded");
  // 其它说法不会进入记录阶段，运行时会拦下写入并提示补充说明。
  assert.notEqual(deriveLearningWorkflowState("我今天学了 HTTP 缓存，记一下"), "evidence_recorded");
  assert.notEqual(deriveLearningWorkflowState("HTTP 缓存是怎么回事"), "evidence_recorded");
});
