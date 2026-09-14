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

test("学习记录页的筛选、修正与撤回接口契约，以及原型页面可访问", async () => {
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
  const headers = { "content-type": "application/json", cookie: "powu_owner=evidence-page-filters" };
  try {
    // 页面本身可通过服务地址打开，脚本里引用的是真实接口。
    const page = await fetch(`${base}/learning-platform-prototype.html`);
    assert.equal(page.status, 200);
    const markup = await page.text();
    assert.ok(markup.includes("/api/evidence/records"));
    assert.ok(markup.includes("apply-filters"));
    assert.ok(markup.includes("withdraw-record"));

    const create = async (body: Record<string, unknown>) => {
      const response = await fetch(`${base}/api/evidence/records`, { method: "POST", headers, body: JSON.stringify(body) });
      assert.equal(response.status, 200);
      return (await response.json()).data.record;
    };
    const now = Date.now();
    await create({
      kind: "activity", title: "筛选用活动", content: "完成 HTTP 练习",
      occurredAt: new Date(now - 3600_000).toISOString(), durationMinutes: 20, skillIds: [KNOWN_SKILL],
    });
    const outcome = await create({
      kind: "project_outcome", title: "筛选用成果", content: "提交项目里程碑",
      occurredAt: new Date(now - 1800_000).toISOString(),
      project: { title: "筛选用项目", goal: "验证筛选", contribution: "完成接口与联调", contributionPending: false },
    });

    const byKind = await fetch(`${base}/api/evidence/records?kinds=project_outcome`, { headers });
    const kindBody = await byKind.json();
    assert.equal(kindBody.data.page.items.length, 1);
    assert.equal(kindBody.data.page.items[0].kind, "project_outcome");

    const bySkill = await fetch(`${base}/api/evidence/records?skillId=${KNOWN_SKILL}`, { headers });
    const skillBody = await bySkill.json();
    assert.equal(skillBody.data.page.items.length, 1);
    assert.equal(skillBody.data.page.items[0].skillRefs[0].skillId, KNOWN_SKILL);

    const from = new Date(now - 2400_000).toISOString();
    const to = new Date(now).toISOString();
    const byRange = await fetch(`${base}/api/evidence/records?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers });
    assert.equal((await byRange.json()).data.page.items.length, 1);

    // 修正需要真实版本：先用 If-Match 提供，再用过期版本制造冲突。
    const amended = await fetch(`${base}/api/evidence/records/${outcome.recordId}`, {
      method: "PATCH", headers: { ...headers, "if-match": String(outcome.version) },
      body: JSON.stringify({ action: "amend", changes: { content: "补充了本人贡献与结果" } }),
    });
    assert.equal(amended.status, 200);
    const amendedBody = await amended.json();
    assert.equal(amendedBody.data.record.version, 2);
    assert.equal(amendedBody.data.record.content, "补充了本人贡献与结果");

    const stale = await fetch(`${base}/api/evidence/records/${outcome.recordId}`, {
      method: "PATCH", headers: { ...headers, "if-match": String(outcome.version) },
      body: JSON.stringify({ action: "amend", changes: { title: "不该写入" } }),
    });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error.code, "VERSION_CONFLICT");

    const withdrawn = await fetch(`${base}/api/evidence/records/${outcome.recordId}`, {
      method: "PATCH", headers: { ...headers, "if-match": "2" },
      body: JSON.stringify({ action: "withdraw", reason: "成果归属填写有误" }),
    });
    assert.equal(withdrawn.status, 200);
    assert.equal((await withdrawn.json()).data.record.status, "withdrawn");

    const detail = await fetch(`${base}/api/evidence/records/${outcome.recordId}`, { headers });
    const detailBody = await detail.json();
    assert.equal(detailBody.data.record.status, "withdrawn");

    const afterWithdraw = await fetch(`${base}/api/evidence/records?kinds=project_outcome`, { headers });
    assert.equal((await afterWithdraw.json()).data.page.items.length, 0);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
