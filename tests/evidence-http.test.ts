import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createDefaultCapabilityRegistry } from "../src/app/composition-root.ts";
import { createPowuServer } from "../src/server.ts";

test("Evidence HTTP MVP supports record and interview flows", async () => {
  const server = createPowuServer({ capabilityRegistry: createDefaultCapabilityRegistry() });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { "content-type": "application/json", cookie: "powu_owner=evidence-http-test" };
  try {
    const saved = await fetch(`${base}/api/evidence/records`, { method: "POST", headers, body: JSON.stringify({ kind: "activity", title: "HTTP 学习", content: "完成路由练习", occurredAt: "2026-09-13T10:00:00+08:00" }) });
    assert.equal(saved.status, 200); const savedBody = await saved.json(); assert.equal(savedBody.ok, true);
    const records = await fetch(`${base}/api/evidence/records`, { headers: { cookie: headers.cookie } });
    assert.equal(records.status, 200); assert.equal((await records.json()).data.items.length, 1);
    const started = await fetch(`${base}/api/evidence/interviews`, { method: "POST", headers, body: JSON.stringify({ target: { kind: "skills", id: "http" }, questionCount: 1 }) });
    assert.equal(started.status, 200); const interview = (await started.json()).data.interview;
    const answer = await fetch(`${base}/api/evidence/interviews/${interview.interviewId}/answers`, { method: "POST", headers, body: JSON.stringify({ questionId: interview.questions[0].questionId, answer: "我完成了一个 API 项目。" }) });
    assert.equal(answer.status, 200); assert.equal((await answer.json()).ok, true);
    const feedback = await fetch(`${base}/api/evidence/interviews/${interview.interviewId}/feedback`, { headers: { cookie: headers.cookie } });
    assert.equal(feedback.status, 200); assert.equal((await feedback.json()).ok, true);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
