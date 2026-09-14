import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createPowuServer } from "../src/server.ts";
import { createDefaultCapabilityRegistry } from "../src/app/composition-root.ts";
import { EvidenceApplication } from "../src/modules/evidence/application.ts";
import { createEvidenceService } from "../src/modules/evidence/defaults.ts";
import { MockEvidenceGeneration } from "../src/modules/evidence/generation.ts";
import { MemoryEvidenceRepository } from "../src/modules/evidence/memory-repository.ts";
import { defaultPorts, KNOWN_SKILL } from "./support/evidence-fixtures.ts";

/**
 * Mirrors the requests the two prototype pages issue, so a change to an
 * endpoint path or response envelope fails here instead of in the browser.
 */
test("学习记录与模拟面试页面调用的接口契约保持可用", async () => {
  const registry = createDefaultCapabilityRegistry({
    evidence: new EvidenceApplication(new MemoryEvidenceRepository(), createEvidenceService({
      generation: new MockEvidenceGeneration(), ports: defaultPorts(),
    })),
  });
  const server = createPowuServer({ capabilityRegistry: registry });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { "content-type": "application/json", cookie: "powu_owner=evidence-page" };
  const call = async (path: string, init?: RequestInit) => {
    const response = await fetch(base + path, init);
    const payload = await response.json();
    assert.equal(response.status, 200, `${path} -> ${JSON.stringify(payload)}`);
    assert.equal(payload.ok, true);
    return payload.data;
  };
  try {
    // 学习记录页：本周查询
    const empty = await call("/api/evidence/records?weekOf=" + encodeURIComponent(new Date().toISOString()), { headers });
    assert.ok(Array.isArray(empty.page.items));
    assert.ok(empty.coverage);
    assert.ok(empty.range.timeZone);

    await call("/api/evidence/records", {
      method: "POST", headers,
      body: JSON.stringify({
        kind: "activity", title: "页面契约：HTTP 练习", content: "完成请求解析并记录了缓存疑问",
        occurredAt: new Date(Date.now() - 3600_000).toISOString(), durationMinutes: 40,
        skillIds: [KNOWN_SKILL],
      }),
    });
    const listed = await call("/api/evidence/records?weekOf=" + encodeURIComponent(new Date().toISOString()), { headers });
    assert.equal(listed.page.items.length, 1);
    const recordId = listed.page.items[0].recordId as string;

    // 单条详情与能力评估
    const detail = await call(`/api/evidence/records/${recordId}`, { headers });
    assert.equal(detail.record.recordId, recordId);
    assert.equal(detail.record.skillRefs[0].skillId, KNOWN_SKILL);
    const assessment = await call("/api/evidence/assessments", {
      method: "POST", headers,
      body: JSON.stringify({ evidenceIds: [recordId], skillIds: [KNOWN_SKILL] }),
    });
    assert.equal(assessment.assessment.findings.length, 1);
    const skills = await call("/api/evidence/skills", { headers });
    assert.equal(skills.page.items[0].verification, "available");

    // 阶段复盘：生成、列表、详情
    const to = new Date().toISOString();
    const from = new Date(Date.now() - 7 * 86400000).toISOString();
    const review = await call("/api/evidence/reviews", { method: "POST", headers, body: JSON.stringify({ from, to }) });
    assert.ok(review.review.progress.length);
    const reviews = await call("/api/evidence/reviews", { headers });
    assert.equal(reviews.page.items.length, 1);
    const reviewDetail = await call(`/api/evidence/reviews/${reviews.page.items[0].reviewId}`, { headers });
    assert.equal(reviewDetail.review.reviewId, review.review.reviewId);

    // 模拟面试页：开始、恢复、作答、报告、历史
    const started = await call("/api/evidence/interviews", {
      method: "POST", headers,
      body: JSON.stringify({ target: { kind: "skills", skillIds: [KNOWN_SKILL] }, questionCount: 2 }),
    });
    const interview = started.interview;
    assert.equal(interview.status, "active");
    assert.ok(interview.currentQuestion);

    const session = await call("/api/evidence/interviews", { headers });
    assert.equal(session.session.interviewId, interview.interviewId);

    const first = await call(`/api/evidence/interviews/${interview.interviewId}/answers`, {
      method: "POST", headers,
      body: JSON.stringify({ questionId: interview.currentQuestion.questionId, answer: "我实现了请求解析并说明了结果。" }),
    });
    assert.equal(first.feedback.status, "succeeded");
    assert.ok(first.nextQuestion);
    assert.equal(first.nextQuestion.ordinal, 2);

    const second = await call(`/api/evidence/interviews/${interview.interviewId}/answers`, {
      method: "POST", headers,
      body: JSON.stringify({ questionId: first.nextQuestion.questionId, answer: "我用一个项目说明了自己的做法。" }),
    });
    assert.equal(second.report.status, "succeeded");
    assert.equal(second.interview.status, "completed");

    const feedback = await call(`/api/evidence/interviews/${interview.interviewId}/feedback`, { headers });
    assert.equal(feedback.reportStatus, "succeeded");
    const perQuestion = await call(
      `/api/evidence/interviews/${interview.interviewId}/feedback?questionId=${interview.currentQuestion.questionId}`, { headers });
    assert.equal(perQuestion.feedback.status, "succeeded");

    const history = await call("/api/evidence/interviews", { headers });
    assert.equal(history.page.items.length, 1);
    assert.equal(history.session, null);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
