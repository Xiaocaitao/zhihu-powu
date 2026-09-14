import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import type { Server } from "node:http";
import { createDefaultCapabilityRegistry } from "../src/app/composition-root.ts";
import { createPowuServer } from "../src/server.ts";
import { MemoryEvidenceRepository } from "../src/modules/evidence/memory-repository.ts";
import { EvidenceApplication } from "../src/modules/evidence/application.ts";
import { GenerationError, MockEvidenceGeneration } from "../src/modules/evidence/generation.ts";
import { createEvidenceService } from "../src/modules/evidence/defaults.ts";
import { defaultPorts, KNOWN_SKILL } from "./support/evidence-fixtures.ts";

async function withServer(run: (base: string) => Promise<void>, registry = createTestRegistry()) {
  const server: Server = createPowuServer({ capabilityRegistry: registry });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}

function createTestRegistry(repository = new MemoryEvidenceRepository(), generation = new MockEvidenceGeneration()) {
  return createDefaultCapabilityRegistry({
    evidence: new EvidenceApplication(repository, createEvidenceService({
      generation, ports: defaultPorts(),
    })),
  });
}

const headers = { "content-type": "application/json", cookie: "powu_owner=evidence-http-test" };

test('手填项目出题失败后重试、作答、重建应用恢复、再练一场保持范围', async () => {
  const repository = new MemoryEvidenceRepository();
  const generator = new MockEvidenceGeneration();
  const build = generator.buildInterview.bind(generator);
  let first = true;
  generator.buildInterview = async input => {
    if (first) { first = false; throw new GenerationError('GENERATION_FAILED', '测试格式失败'); }
    return build(input);
  };
  const input = { target: { kind: 'project', project: { title: '我的笔记应用', goal: '查询笔记', contribution: '实现缓存' } }, questionCount: 1, focus: '缓存', difficulty: 'introductory' };
  let completedId = '';
  await withServer(async base => {
    const post = async (path: string, body: unknown) => {
      const res = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
      assert.equal(res.status, 200); return (await res.json()).data;
    };
    const failed = await post('/api/evidence/interviews', input);
    assert.equal(failed.interview.status, 'preparation_failed');
    const retry = await post('/api/evidence/interviews', { ...input, startNew: true });
    assert.equal(retry.interview.status, 'active');
    assert.notEqual(retry.interview.interviewId, failed.interview.interviewId);
    const answered = await post(`/api/evidence/interviews/${retry.interview.interviewId}/answers`, { questionId: retry.interview.currentQuestion.questionId, answer: '先按关键字检索，再缓存热点查询。' });
    assert.equal(answered.interview.status, 'completed');
    assert.equal(answered.interview.reportStatus, 'succeeded');
    completedId = answered.interview.interviewId;
  }, createTestRegistry(repository, generator));
  await withServer(async base => {
    const saved = await (await fetch(`${base}/api/evidence/interviews/${completedId}`, { headers })).json();
    assert.deepEqual(saved.data.interview.target, input.target);
    assert.equal(saved.data.interview.focus, '缓存');
    const again = await fetch(`${base}/api/evidence/interviews`, { method: 'POST', headers, body: JSON.stringify({ target: saved.data.interview.target, questionCount: saved.data.interview.totalQuestions, difficulty: saved.data.interview.difficulty, focus: saved.data.interview.focus, startNew: true }) });
    const session = (await again.json()).data.interview;
    assert.notEqual(session.interviewId, completedId);
    assert.deepEqual(session.target, input.target);
    assert.equal(session.difficulty, input.difficulty);
  }, createTestRegistry(repository));
});

test("Evidence HTTP 完成记录与面试闭环", async () => {
  await withServer(async base => {
    const saved = await fetch(`${base}/api/evidence/records`, {
      method: "POST", headers, body: JSON.stringify({
        kind: "activity", title: "HTTP 学习", content: "完成路由练习并记录了疑问",
        occurredAt: "2026-09-13T10:00:00+08:00", durationMinutes: 30,
      }),
    });
    assert.equal(saved.status, 200);
    const savedBody = await saved.json();
    assert.equal(savedBody.ok, true);
    assert.equal(savedBody.data.record.durationMinutes, 30);

    const records = await fetch(`${base}/api/evidence/records?limit=10`, { headers: { cookie: headers.cookie } });
    assert.equal(records.status, 200);
    assert.equal((await records.json()).data.page.items.length, 1);

    const started = await fetch(`${base}/api/evidence/interviews`, {
      method: "POST", headers, body: JSON.stringify({ target: { kind: "skills", skillIds: [KNOWN_SKILL] }, questionCount: 1 }),
    });
    assert.equal(started.status, 200);
    const interview = (await started.json()).data.interview;
    assert.equal(interview.status, "active");

    const answer = await fetch(`${base}/api/evidence/interviews/${interview.interviewId}/answers`, {
      method: "POST", headers,
      body: JSON.stringify({ questionId: interview.questions[0].questionId, answer: "我完成了一个 API 项目并说明了结果。" }),
    });
    assert.equal(answer.status, 200);
    const answered = await answer.json();
    assert.equal(answered.data.feedback.status, "succeeded");
    assert.equal(answered.data.interview.reportStatus, "succeeded");

    const feedback = await fetch(`${base}/api/evidence/interviews/${interview.interviewId}/feedback`, {
      headers: { cookie: headers.cookie },
    });
    assert.equal(feedback.status, 200);
    assert.equal(typeof (await feedback.json()).data.report.summary, "string");
  });
});

test("HTTP 重试复用操作标识，同一标识不同内容返回 409", async () => {
  const repository = new MemoryEvidenceRepository();
  const body = {
    kind: "activity", title: "HTTP 重试", content: "完成客户端请求练习",
    occurredAt: "2026-09-14T00:00:00Z",
  };
  const retryHeaders = { ...headers, "idempotency-key": "record-intent" };
  await withServer(async base => {
    const first = await fetch(`${base}/api/evidence/records`, { method: "POST", headers: retryHeaders, body: JSON.stringify(body) });
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    const replay = await fetch(`${base}/api/evidence/records`, { method: "POST", headers: retryHeaders, body: JSON.stringify(body) });
    assert.equal((await replay.json()).entityId, firstBody.entityId);
    const conflict = await fetch(`${base}/api/evidence/records`, {
      method: "POST", headers: retryHeaders, body: JSON.stringify({ ...body, title: "新的意图" }),
    });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error.code, "DUPLICATE_REQUEST");

    const read = await fetch(`${base}/api/evidence/records`, { headers });
    assert.equal((await read.json()).data.page.items.length, 1);
  }, createTestRegistry(repository));
});

test("HTTP 拒绝伪造身份字段、错误路径与非法标识", async () => {
  await withServer(async base => {
    const spoof = await fetch(`${base}/api/evidence/records`, {
      method: "POST", headers,
      body: JSON.stringify({ kind: "activity", title: "t", content: "c", occurredAt: "2026-09-14T00:00:00Z", ownerId: "other" }),
    });
    assert.equal(spoof.status, 400);
    const missing = await fetch(`${base}/api/evidence/interviews/11111111-1111-4111-8111-111111111111`, { headers });
    assert.equal(missing.status, 404);
    const badKey = await fetch(`${base}/api/evidence/records`, {
      method: "POST", headers: { ...headers, "idempotency-key": "invalid key" },
      body: JSON.stringify({ kind: "activity", title: "t", content: "c", occurredAt: "2026-09-14T00:00:00Z" }),
    });
    assert.equal(badKey.status, 400);
    const wrongMethod = await fetch(`${base}/api/evidence/skills`, { method: "DELETE", headers });
    assert.equal(wrongMethod.status, 405);
  });
});

test("HTTP 在没有注册表时返回 503 而不是落到静态页面", async () => {
  const server = createPowuServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/evidence/interviews`);
    assert.equal(response.status, 503);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
