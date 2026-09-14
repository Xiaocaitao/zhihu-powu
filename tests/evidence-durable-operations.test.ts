import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import { Pool } from "pg";
import { ensureSchema } from "../src/db/postgres.ts";
import { createDefaultCapabilityRegistry } from "../src/app/composition-root.ts";
import { createPowuServer } from "../src/server.ts";
import { EvidenceApplication } from "../src/modules/evidence/application.ts";
import { PostgresEvidenceRepository } from "../src/modules/evidence/postgres-repository.ts";
import { activityInput, KNOWN_SKILL, serviceWith } from "./support/evidence-fixtures.ts";

const databaseTest = { skip: process.env.TEST_DATABASE_URL ? false : "TEST_DATABASE_URL is not configured" };

test("PostgreSQL 幂等：同一操作标识并发只写入一次，不同载荷被拒绝", databaseTest, async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const ownerId = randomUUID();
  const app = () => new EvidenceApplication(new PostgresEvidenceRepository(pool), serviceWith());
  const command = { ownerId, operationKey: "record-intent" };
  try {
    await ensureSchema(pool);
    const input = activityInput({ skillIds: [KNOWN_SKILL] });
    const results = await Promise.all([
      app().recordLearningEvidence(command, input),
      app().recordLearningEvidence(command, input),
    ]);
    assert.ok(results.every(result => result.ok));
    assert.equal(results[0].entityId, results[1].entityId);
    assert.equal(results.filter(result => result.changed).length, 1);

    const stored = await pool.query("SELECT count(*)::int AS count FROM ei_records WHERE owner_id=$1", [ownerId]);
    assert.equal(stored.rows[0].count, 1);

    const conflict = await app().recordLearningEvidence(command, { ...input, title: "不同载荷" });
    assert.equal(conflict.error?.code, "DUPLICATE_REQUEST");

    const replay = await app().recordLearningEvidence(command, input);
    assert.equal(replay.changed, false);
    assert.equal(replay.entityId, results[0].entityId);
  } finally {
    try {
      await pool.query("DELETE FROM ei_operations WHERE owner_id=$1", [ownerId]);
      await pool.query("DELETE FROM ei_records WHERE owner_id=$1", [ownerId]);
    } finally { await pool.end(); }
  }
});

test("PostgreSQL 记录、修订与复盘在应用重建后仍然可读，且按 owner 隔离", databaseTest, async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const ownerId = randomUUID();
  const app = () => new EvidenceApplication(new PostgresEvidenceRepository(pool), serviceWith());
  try {
    await ensureSchema(pool);
    const saved = await app().recordLearningEvidence({ ownerId, operationKey: "record-1" },
      activityInput({ skillIds: [KNOWN_SKILL] }));
    assert.ok(saved.ok && saved.entityId);

    const amended = await app().updateLearningEvidence({ ownerId, operationKey: "amend-1", expectedVersion: 1 },
      { recordId: saved.entityId!, action: "amend", changes: { content: "补充了缓存验证结果" } });
    assert.equal(amended.ok, true);

    const read = await app().getLearningRecords({ ownerId }, { mode: "detail", recordId: saved.entityId! });
    assert.ok("record" in read.data!);
    const detail = read.data as { record: { content: string; version: number; occurredAt: string } };
    assert.equal(detail.record.content, "补充了缓存验证结果");
    assert.equal(detail.record.version, 2);
    assert.equal(detail.record.occurredAt, "2026-09-13T10:00:00+08:00");

    const review = await app().generateLearningReview({ ownerId, operationKey: "review-1" },
      { from: "2026-09-13T00:00:00+08:00", to: "2026-09-14T00:00:00+08:00" });
    assert.equal(review.ok, true);
    const reviews = await app().getLearningReviews({ ownerId }, {});
    assert.equal("page" in reviews.data! && reviews.data.page.items.length, 1);

    const other = await app().getLearningRecords({ ownerId: randomUUID() }, { mode: "list" });
    assert.deepEqual("page" in other.data! ? other.data.page.items : [], []);
  } finally {
    try {
      await pool.query("DELETE FROM ei_operations WHERE owner_id=$1", [ownerId]);
      await pool.query("DELETE FROM ei_record_revisions WHERE owner_id=$1", [ownerId]);
      await pool.query("DELETE FROM ei_reviews WHERE owner_id=$1", [ownerId]);
      await pool.query("DELETE FROM ei_records WHERE owner_id=$1", [ownerId]);
    } finally { await pool.end(); }
  }
});

test("PostgreSQL 并发作答只推进一次，且回答必须属于同一场面试", databaseTest, async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const ownerId = randomUUID();
  const app = () => new EvidenceApplication(new PostgresEvidenceRepository(pool), serviceWith());
  try {
    await ensureSchema(pool);
    const started = await app().startInterview({ ownerId, operationKey: "interview-1" },
      { target: { kind: "skills", skillIds: [KNOWN_SKILL] }, questionCount: 2 });
    const interview = started.data!.interview;
    const results = await Promise.all(["回答一", "回答二"].map((answer, index) =>
      app().submitInterviewAnswer({ ownerId, operationKey: `answer-${index}` }, {
        interviewId: interview.interviewId, questionId: interview.questions[0].questionId, answer,
      })));
    assert.equal(results.filter(result => result.ok).length, 1);
    assert.equal(results.filter(result => result.error?.code === "INVALID_STATE").length, 1);

    const session = await app().getInterviewSession({ ownerId }, interview.interviewId);
    assert.equal(session.data!.interview.answeredCount, 1);
    assert.equal(session.data!.interview.answers.length, 1);

    const second = await app().startInterview({ ownerId, operationKey: "interview-2" },
      { target: { kind: "skills", skillIds: [KNOWN_SKILL] }, questionCount: 1, startNew: true });
    await assert.rejects(pool.query(
      "INSERT INTO ei_answers (id,owner_id,interview_id,question_id,text,text_hash) VALUES ($1,$2,$3,$4,'bad','bad')",
      [randomUUID(), ownerId, second.data!.interview.interviewId, interview.questions[1].questionId],
    ), (error: unknown) => (error as { constraint?: string }).constraint === "ei_answers_scoped_question_fk");
  } finally {
    try {
      await pool.query("DELETE FROM ei_operations WHERE owner_id=$1", [ownerId]);
      await pool.query("DELETE FROM ei_interviews WHERE owner_id=$1", [ownerId]);
    } finally { await pool.end(); }
  }
});

test("用旧快照落库时不会为他人回答写入反馈（Regression: ei_answer_feedback FK）", databaseTest, async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const ownerId = randomUUID();
  const app = () => new EvidenceApplication(new PostgresEvidenceRepository(pool), serviceWith());
  const repository = new PostgresEvidenceRepository(pool);
  try {
    await ensureSchema(pool);
    const started = await app().startInterview({ ownerId, operationKey: "stale-1" },
      { target: { kind: "skills", skillIds: [KNOWN_SKILL] }, questionCount: 2 });
    const interview = started.data!.interview;

    // 另一个并发请求已经为第 1 题写入了回答行。
    const winner = await app().submitInterviewAnswer({ ownerId, operationKey: "stale-winner" }, {
      interviewId: interview.interviewId, questionId: interview.questions[0].questionId, answer: "先提交的回答",
    });
    assert.equal(winner.ok, true);
    const storedAnswerId = winner.data!.interview.answers[0].answerId;

    // 模拟输家：仍基于“未作答”的旧快照，但换了一个新的 answerId。
    // 仓储必须拒绝这次写入，而不是留下“回答行属于 A、聚合文档写着 B”的脏状态。
    const stale = structuredClone(interview);
    const loserAnswerId = randomUUID();
    stale.answeredCount = 1;
    stale.version = 2;
    stale.answers = [{
      answerId: loserAnswerId, questionId: interview.questions[0].questionId, text: "后到的重复回答",
      feedback: {
        questionId: interview.questions[0].questionId, answerId: loserAnswerId, status: "succeeded",
        strengths: ["重复"], issues: [], suggestions: [], limitations: [], updatedAt: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
    }];
    await assert.rejects(repository.saveInterview(stale), /STALE_INTERVIEW_AGGREGATE/);

    const stored = await app().getInterviewSession({ ownerId }, interview.interviewId);
    const answers = stored.data!.interview.answers;
    assert.equal(answers.length, 1);
    assert.equal(answers[0].answerId, storedAnswerId);
    assert.equal(answers[0].text, "先提交的回答");
    assert.equal(stored.data!.interview.answeredCount, 1);
    const feedbackRows = await pool.query(
      "SELECT count(*)::int AS count FROM ei_answer_feedback WHERE owner_id=$1 AND answer_id <> $2",
      [ownerId, storedAnswerId],
    );
    assert.equal(feedbackRows.rows[0].count, 0, "不应为他人的回答写入反馈");
  } finally {
    try {
      await pool.query("DELETE FROM ei_operations WHERE owner_id=$1", [ownerId]);
      await pool.query("DELETE FROM ei_interviews WHERE owner_id=$1", [ownerId]);
    } finally { await pool.end(); }
  }
});

test("HTTP 并发提交同一题的体验：一次成功、一次可重试冲突，会话保持一致", databaseTest, async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  // The HTTP owner comes from the cookie, so derive the same owner the server uses.
  const token = `race-${randomUUID()}`;
  const ownerId = `anonymous:${createHash("sha256").update(token).digest("hex")}`;
  const app = () => new EvidenceApplication(new PostgresEvidenceRepository(pool), serviceWith());
  try {
    await ensureSchema(pool);
    const started = await app().startInterview({ ownerId, operationKey: "http-race-start" },
      { target: { kind: "skills", skillIds: [KNOWN_SKILL] }, questionCount: 2 });
    const interview = started.data!.interview;

    const registry = createDefaultCapabilityRegistry({ evidence: app() });
    const server = createPowuServer({ capabilityRegistry: registry });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { "content-type": "application/json", cookie: `powu_owner=${token}` };
    try {
      const submit = (answer: string, key: string) => fetch(`${base}/api/evidence/interviews/${interview.interviewId}/answers`, {
        method: "POST", headers: { ...headers, "idempotency-key": key },
        body: JSON.stringify({ questionId: interview.questions[0].questionId, answer }),
      });
      const [first, second] = await Promise.all([submit("并发回答甲", "race-a"), submit("并发回答乙", "race-b")]);
      const statuses = [first.status, second.status].sort();
      assert.deepEqual(statuses, [200, 409], `期望一次成功一次冲突，实际 ${statuses.join("/")}`);
      const conflictBody = await (first.status === 409 ? first : second).json();
      assert.equal(conflictBody.error.code, "INVALID_STATE");
      // 冲突是“已有回答”而非临时故障：原样重试不会成功，因此提示刷新而不是重试。
      assert.equal(conflictBody.error.retryable, false);
      assert.match(conflictBody.error.message, /刷新/);

      // 冲突之后会话仍然可读、可继续作答，不会留下半写状态。
      const session = await fetch(`${base}/api/evidence/interviews/${interview.interviewId}`, { headers: { cookie: headers.cookie } });
      const body = await session.json();
      assert.equal(body.data.interview.answeredCount, 1);
      assert.equal(body.data.interview.answers.length, 1);
      const next = await fetch(`${base}/api/evidence/interviews/${interview.interviewId}/answers`, {
        method: "POST", headers: { ...headers, "idempotency-key": "race-next" },
        body: JSON.stringify({ questionId: interview.questions[1].questionId, answer: "冲突后继续作答" }),
      });
      assert.equal(next.status, 200);
      const finished = await (await next.json()).data;
      assert.equal(finished.interview.status, "completed");
      assert.equal(finished.interview.reportStatus, "succeeded");

      // 结束是幂等的：已完成后再结束不会生成第二份报告。
      const reFinish = await fetch(`${base}/api/evidence/interviews/${interview.interviewId}/finish`, {
        method: "POST", headers: { ...headers, "idempotency-key": "race-finish-again" }, body: "{}",
      });
      assert.equal(reFinish.status, 200);
      const reFinished = await reFinish.json();
      assert.equal(reFinished.data.report.reportId, finished.interview.report.reportId);
      const reportCount = await pool.query(
        "SELECT count(*)::int AS count FROM ei_interview_reports WHERE owner_id=$1 AND interview_id=$2",
        [ownerId, interview.interviewId],
      );
      assert.equal(reportCount.rows[0].count, 1, "整场报告只应存在一份");
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  } finally {
    try {
      await pool.query("DELETE FROM ei_operations WHERE owner_id=$1", [ownerId]);
      await pool.query("DELETE FROM ei_interviews WHERE owner_id=$1", [ownerId]);
    } finally { await pool.end(); }
  }
});
