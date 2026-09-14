import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { ensureSchema } from "../src/db/postgres.ts";
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
