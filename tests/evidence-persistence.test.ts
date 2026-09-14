import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import { Pool } from "pg";
import { ensureSchema } from "../src/db/postgres.ts";
import { EvidenceApplication } from "../src/modules/evidence/application.ts";
import { EvidenceService } from "../src/modules/evidence/service.ts";
import { PostgresEvidenceRepository } from "../src/modules/evidence/postgres-repository.ts";
import { createDefaultCapabilityRegistry } from "../src/app/composition-root.ts";
import { createPowuServer } from "../src/server.ts";

// Opt in with a dedicated local test database. CI supplies an ephemeral PostgreSQL.
test("PostgreSQL interview answers survive application restart and stay atomic", {
  skip: process.env.TEST_DATABASE_URL ? false : "TEST_DATABASE_URL is not configured",
}, async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const token = `interview-regression-${randomUUID()}`;
  const owner = `anonymous:${createHash("sha256").update(token).digest("hex")}`;
  const context = () => ({ ownerId: owner, requestId: randomUUID() });
  const makeApp = () => new EvidenceApplication(new EvidenceService(), new PostgresEvidenceRepository(pool));
  try {
    await ensureSchema(pool);
    const first = makeApp();
    const started = await first.startInterview(context(), { kind: "skills", id: "postgresql" }, 3);
    assert.ok(started.ok && started.data);
    const interview = started.data.interview;
    const answerText = "I inspect EXPLAIN ANALYZE before choosing an index.";
    const submitted = await first.submitInterviewAnswer(context(), interview.interviewId, interview.questions[0].questionId, answerText);
    assert.equal(submitted.ok, true);

    // A new application has none of the previous service's in-memory state.
    const restarted = makeApp();
    const readback = await restarted.getInterviewSession(context(), interview.interviewId);
    assert.ok(readback.ok && readback.data);
    assert.equal(readback.data.interview.answeredCount, 1);
    assert.equal(readback.data.interview.answers.length, 1);
    assert.equal(readback.data.interview.answers[0].text, answerText);
    const feedback = await restarted.getInterviewFeedback(context(), interview.interviewId);
    assert.ok(feedback.ok && feedback.data && "feedback" in feedback.data);
    assert.equal(feedback.data.feedback.length, 1);
    assert.equal(typeof feedback.data.feedback[0].feedback, "string");

    const version = (await pool.query("SELECT version FROM ei_interviews WHERE owner_id=$1 AND id=$2", [owner, interview.interviewId])).rows[0].version;
    const duplicate = await restarted.submitInterviewAnswer(context(), interview.interviewId, interview.questions[0].questionId, answerText);
    assert.equal(duplicate.ok, true);
    assert.equal(duplicate.changed, false);
    assert.equal((await pool.query("SELECT version FROM ei_interviews WHERE owner_id=$1 AND id=$2", [owner, interview.interviewId])).rows[0].version, version);

    // Force a late FK failure after the header update; the entire save must roll back.
    const invalid = structuredClone(readback.data.interview);
    invalid.answeredCount = 2;
    invalid.answers.push({ answerId: randomUUID(), questionId: randomUUID(), text: "invalid reference" });
    await assert.rejects(new PostgresEvidenceRepository(pool).saveInterview(invalid));
    const afterFailure = await makeApp().getInterviewSession(context(), interview.interviewId);
    assert.ok(afterFailure.ok && afterFailure.data);
    assert.equal(afterFailure.data.interview.answeredCount, 1);
    assert.equal(afterFailure.data.interview.answers.length, 1);

    const server = createPowuServer({ capabilityRegistry: createDefaultCapabilityRegistry({ evidence: makeApp() }) });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address(); assert.ok(address && typeof address !== "string");
      const url = `http://127.0.0.1:${address.port}/api/growth/interviews`;
      const response = await fetch(url, { headers: { cookie: `powu_owner=${token}` } });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.session.interviewId, interview.interviewId);
      assert.equal(body.session.answeredCount, 1);
      assert.equal(body.items[0].answeredCount, 1);
      const other = await fetch(url);
      assert.deepEqual(await other.json(), { ok: true, items: [], session: null });
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }

    const next = await makeApp().submitInterviewAnswer(context(), interview.interviewId, interview.questions[1].questionId, "I compare query plans before and after the change.");
    assert.equal(next.ok, true);
    const finished = await makeApp().finishInterview(context(), interview.interviewId);
    assert.ok(finished.ok && finished.data);
    assert.equal(finished.data.interview.status, "ended_early");
    assert.equal(finished.data.interview.answeredCount, 2);
    const final = await makeApp().getInterviewRecords(context());
    assert.ok(final.data);
    assert.equal(final.data.items[0].answeredCount, 2);
    assert.equal(final.data.session, null);
    const hidden = await makeApp().getInterviewFeedback({ ownerId: `${owner}-other` }, interview.interviewId);
    assert.equal(hidden.ok, false);
  } finally {
    // Remove only this test's interview aggregates, never pre-existing data.
    try { await pool.query("DELETE FROM ei_interviews WHERE owner_id=$1", [owner]); }
    finally { await pool.end(); }
  }
});
