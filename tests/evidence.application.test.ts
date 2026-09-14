import test from "node:test";
import assert from "node:assert/strict";
import type { EvidenceRepository } from "../src/modules/evidence/repository.ts";
import { activityInput, applicationWith, KNOWN_SKILL, ownerContext } from "./support/evidence-fixtures.ts";

const ctx = ownerContext("owner-restart");

test("应用层写入落库后，新的应用实例仍能读到记录、复盘与评估", async () => {
  const { app } = applicationWith();
  const saved = await app().recordLearningEvidence(ctx, activityInput({ skillIds: [KNOWN_SKILL] }));
  assert.equal(saved.ok, true);

  const read = await app().getLearningRecords(ctx, { mode: "list" });
  assert.equal("page" in read.data! && read.data.page.items.length, 1);

  const review = await app().generateLearningReview(ctx, {
    from: "2026-09-13T00:00:00+08:00", to: "2026-09-14T00:00:00+08:00",
  });
  assert.equal(review.ok, true);
  const reviews = await app().getLearningReviews(ctx, {});
  assert.equal("page" in reviews.data! && reviews.data.page.items.length, 1);

  const assessed = await app().evaluateLearningEvidence(ctx, {
    evidenceIds: [saved.entityId!], skillIds: [KNOWN_SKILL],
  });
  assert.equal(assessed.ok, true);
  const cards = await app().getSkillEvidence(ctx, { skillIds: [KNOWN_SKILL] });
  assert.equal(cards.data!.page.items[0].assessments.length, 1);
});

test("同一操作标识只写入一次，重复请求返回原结果且不产生第二条记录", async () => {
  const { app, repository } = applicationWith();
  const command = { ...ctx, operationKey: "record-intent-1" };
  const first = await app().recordLearningEvidence(command, activityInput());
  assert.equal(first.changed, true);
  const replay = await app().recordLearningEvidence(command, activityInput());
  assert.equal(replay.entityId, first.entityId);
  assert.equal(replay.changed, false);
  const stored = await repository.listRecords(ctx.ownerId, { includeWithdrawn: true });
  assert.equal(stored.length, 1);

  const conflict = await app().recordLearningEvidence(command, activityInput({ title: "新的意图" }));
  assert.equal(conflict.error?.code, "DUPLICATE_REQUEST");
});

test("并发相同命令只创建一条记录", async () => {
  const { app, repository } = applicationWith();
  const command = { ...ctx, operationKey: "record-intent-concurrent" };
  const results = await Promise.all([
    app().recordLearningEvidence(command, activityInput()),
    app().recordLearningEvidence(command, activityInput()),
  ]);
  assert.equal(new Set(results.map(item => item.entityId)).size, 1);
  assert.equal((await repository.listRecords(ctx.ownerId, { includeWithdrawn: true })).length, 1);
});

test("操作记录写入失败时业务数据一起回滚", async () => {
  const { app, repository } = applicationWith();
  const failing: EvidenceRepository = {
    transaction: (ownerId, run) => repository.transaction(ownerId, async inner => {
      inner.saveOperation = async () => { throw new Error("storage failure"); };
      return run(inner);
    }),
    getOperation: (...args) => repository.getOperation(...args),
    saveOperation: (...args) => repository.saveOperation(...args),
    createRecord: (...args) => repository.createRecord(...args),
    getRecord: (...args) => repository.getRecord(...args),
    listRecords: (...args) => repository.listRecords(...args),
    updateRecord: (...args) => repository.updateRecord(...args),
    getSourceRecord: (...args) => repository.getSourceRecord(...args),
    saveRevision: (...args) => repository.saveRevision(...args),
    listRevisions: (...args) => repository.listRevisions(...args),
    saveProject: (...args) => repository.saveProject(...args),
    getProject: (...args) => repository.getProject(...args),
    listProjects: (...args) => repository.listProjects(...args),
    saveAssessment: (...args) => repository.saveAssessment(...args),
    listAssessments: (...args) => repository.listAssessments(...args),
    saveReview: (...args) => repository.saveReview(...args),
    listReviews: (...args) => repository.listReviews(...args),
    saveInterview: (...args) => repository.saveInterview(...args),
    getInterview: (...args) => repository.getInterview(...args),
    listInterviews: (...args) => repository.listInterviews(...args),
  };
  const { app: failingApp } = applicationWith({ repository: failing as never });
  const command = { ...ctx, operationKey: "record-intent-rollback" };
  await assert.rejects(failingApp().recordLearningEvidence(command, activityInput()), /storage failure/);
  assert.deepEqual(await repository.listRecords(ctx.ownerId, { includeWithdrawn: true }), []);
  const retry = await app().recordLearningEvidence(command, activityInput());
  assert.equal(retry.changed, true);
  assert.equal((await repository.listRecords(ctx.ownerId, { includeWithdrawn: true })).length, 1);
});

test("面试在应用重建后恢复，作答与报告一并持久化", async () => {
  const { app } = applicationWith();
  const started = await app().startInterview(ctx, { target: { kind: "skills", skillIds: [KNOWN_SKILL] }, questionCount: 1 });
  const interview = started.data!.interview;
  const answered = await app().submitInterviewAnswer(ctx, {
    interviewId: interview.interviewId, questionId: interview.questions[0].questionId, answer: "我完成过一次 API 项目。",
  });
  assert.equal(answered.ok, true);

  const restored = await app().getInterviewSession(ctx, interview.interviewId);
  assert.equal(restored.data!.interview.answeredCount, 1);
  assert.equal(restored.data!.interview.answers[0].text, "我完成过一次 API 项目。");
  assert.equal(restored.data!.interview.reportStatus, "succeeded");
  assert.ok(restored.data!.interview.report?.summary);

  const history = await app().getInterviewRecords(ctx, {});
  assert.equal(history.data!.page.items.length, 1);
  assert.equal(history.data!.session, null);
  assert.equal((await app().getInterviewRecords({ ownerId: "someone-else" }, {})).data!.page.items.length, 0);
});

test("修正记录后旧评估标记为过期，能力卡片要求重新评估", async () => {
  const { app } = applicationWith();
  const saved = await app().recordLearningEvidence(ctx, activityInput({ skillIds: [KNOWN_SKILL] }));
  await app().evaluateLearningEvidence(ctx, { evidenceIds: [saved.entityId!], skillIds: [KNOWN_SKILL] });
  const amended = await app().updateLearningEvidence(
    { ...ctx, expectedVersion: 1 },
    { recordId: saved.entityId!, action: "amend", changes: { content: "补充了缓存验证结果" } },
  );
  assert.equal(amended.ok, true);
  assert.equal(amended.data!.invalidatedAssessmentIds.length, 1);
  const cards = await app().getSkillEvidence(ctx, { skillIds: [KNOWN_SKILL] });
  assert.equal(cards.data!.page.items[0].verification, "needs_review");
  assert.equal(cards.data!.page.items[0].assessments[0].validity, "stale");
});

test("版本不匹配的修正被拒绝，数据库内容保持不变", async () => {
  const { app } = applicationWith();
  const saved = await app().recordLearningEvidence(ctx, activityInput());
  const conflict = await app().updateLearningEvidence(
    { ...ctx, expectedVersion: 9 },
    { recordId: saved.entityId!, action: "amend", changes: { title: "不该写入" } },
  );
  assert.equal(conflict.error?.code, "VERSION_CONFLICT");
  const read = await app().getLearningRecords(ctx, { mode: "detail", recordId: saved.entityId! });
  assert.equal("record" in read.data! && read.data.record.title, activityInput().title);
});
