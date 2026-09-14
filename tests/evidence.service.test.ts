import assert from "node:assert/strict";
import test from "node:test";
import { GenerationError } from "../src/modules/evidence/generation.ts";
import type { EvidenceState } from "../src/modules/evidence/service.ts";
import type { SourceChange } from "../src/modules/evidence/ports.ts";
import { activityInput, defaultPorts, KNOWN_SKILL, ownerContext, serviceWith } from "./support/evidence-fixtures.ts";

const emptyState = (): EvidenceState => ({ records: [], projects: [], interviews: [], assessments: [], reviews: [] });
const ctx = ownerContext();

test("学习记录保留真实用时；缺少外部来源时说明缺口而不是猜测", async () => {
  const service = serviceWith();
  const created = await service.createRecord(ctx, emptyState(), activityInput({ taskId: "task-1" }));
  assert.equal(created.ok, true);
  const { record, pendingAssociations, missingInformation } = created.data!;
  assert.equal(record.durationMinutes, 45);
  assert.equal(record.source.domain, "evidence");
  assert.deepEqual(pendingAssociations.map(item => item.source), ["learning"]);
  assert.equal(record.coverage.complete, false);

  const withoutDuration = await service.createRecord(ctx, emptyState(), activityInput({ durationMinutes: undefined }));
  assert.equal(withoutDuration.data!.record.durationMinutes, null);
  assert.ok(withoutDuration.data!.missingInformation.some(item => item.includes("实际用时")));
});

test("项目成果记录本人贡献；贡献待补时不能当作个人已验证成果", async () => {
  const service = serviceWith();
  const created = await service.createRecord(ctx, emptyState(), activityInput({
    kind: "project_outcome", title: "校园服务 API", content: "完成查询接口",
    project: { title: "校园服务 API", goal: "提供课程查询", contributionPending: true },
  }));
  assert.equal(created.ok, true);
  assert.equal(created.data!.record.contributionPending, true);
  assert.ok(created.data!.record.projectId);
  assert.equal(created.data!.record.coverage.complete, false);
});

test("修正记录需要匹配版本，保留历史修订并让旧评估过期", async () => {
  const service = serviceWith();
  const state = emptyState();
  const created = await service.createRecord(ctx, state, activityInput({ skillIds: [KNOWN_SKILL] }));
  state.records.push(created.data!.record);
  const assessed = await service.assessEvidence(ctx, state, {
    evidenceIds: [created.data!.record.recordId], skillIds: [KNOWN_SKILL],
  });
  state.assessments.push(assessed.data!.assessment);

  const stale = await service.amendRecord(ctx, state, created.data!.record.recordId, { content: "补充反思" });
  assert.equal(stale.error?.code, "VERSION_CONFLICT");

  const amended = await service.amendRecord({ ...ctx, expectedVersion: 1 }, state, created.data!.record.recordId,
    { content: "补充反思后重新核对", durationUnknown: true });
  assert.equal(amended.ok, true);
  assert.equal(amended.data!.record.version, 2);
  assert.equal(amended.data!.record.durationMinutes, null);
  assert.equal(amended.data!.revision.version, 1);
  assert.deepEqual(amended.data!.invalidatedAssessmentIds, [assessed.data!.assessment.assessmentId]);
});

test("撤回记录后默认列表不再返回，但修订与撤回原因保留", async () => {
  const service = serviceWith();
  const state = emptyState();
  const created = await service.createRecord(ctx, state, activityInput());
  state.records.push(created.data!.record);
  const withdrawn = await service.withdrawRecord({ ...ctx, expectedVersion: 1 }, state, created.data!.record.recordId, "记录内容有误");
  assert.equal(withdrawn.data!.record.status, "withdrawn");
  assert.equal(withdrawn.data!.record.withdrawalReason, "记录内容有误");
  state.records = [withdrawn.data!.record];
  const listed = await service.queryRecords(ctx, state, { mode: "list" });
  assert.equal("page" in listed.data! && listed.data.page.items.length, 0);
});

test("其他模块的同一来源修订只记一次，乱序修订被忽略", async () => {
  const service = serviceWith();
  const state = emptyState();
  const change: SourceChange = {
    sourceDomain: "learning", sourceEventId: "event-1", sourceEntityId: "task-9", sourceRevision: 2,
    occurredAt: "2026-09-13T12:00:00+08:00", kind: "task_change", change: "created",
    snapshot: { title: "完成数据库任务", content: "任务标记为完成", taskId: "task-9" },
  };
  const first = await service.applySourceChange(ctx, state, change);
  state.records.push(first.data!.record);
  const replay = await service.applySourceChange(ctx, state, change);
  assert.equal(replay.data!.duplicate, true);
  const outOfOrder = await service.applySourceChange(ctx, state, { ...change, sourceRevision: 1, occurredAt: "2026-09-12T12:00:00+08:00" });
  assert.equal(outOfOrder.data!.duplicate, true);
  const next = await service.applySourceChange(ctx, state, {
    ...change, sourceRevision: 3, change: "amended",
    snapshot: { title: "完成数据库任务并复盘", content: "补充了复盘说明", taskId: "task-9" },
  });
  assert.equal(next.data!.duplicate, false);
  assert.equal(next.data!.record.version, 2);
  assert.equal(next.data!.record.source.revision, "3");
});

test("证据评估与阶段复盘在生成不可用时如实返回错误，不虚构结论", async () => {
  const failing = {
    buildInterview: async () => { throw new GenerationError("DEPENDENCY_UNAVAILABLE", "生成服务尚未配置"); },
    assessEvidence: async () => { throw new GenerationError("DEPENDENCY_UNAVAILABLE", "生成服务尚未配置"); },
    reviewLearning: async () => { throw new GenerationError("GENERATION_FAILED", "生成失败"); },
    assessAnswer: async () => { throw new GenerationError("GENERATION_FAILED", "生成失败"); },
    summarizeInterview: async () => { throw new GenerationError("GENERATION_FAILED", "生成失败"); },
  };
  const service = serviceWith({ generation: failing });
  const state = emptyState();
  const created = await service.createRecord(ctx, state, activityInput({ skillIds: [KNOWN_SKILL] }));
  state.records.push(created.data!.record);

  const assessed = await service.assessEvidence(ctx, state, {
    evidenceIds: [created.data!.record.recordId], skillIds: [KNOWN_SKILL],
  });
  assert.equal(assessed.ok, false);
  assert.equal(assessed.error?.code, "DEPENDENCY_UNAVAILABLE");
  assert.equal(assessed.error?.retryable, true);

  const review = await service.generateReview(ctx, state, { from: "2026-09-13T00:00:00+08:00", to: "2026-09-14T00:00:00+08:00" });
  assert.equal(review.ok, false);
  assert.equal(review.error?.code, "GENERATION_FAILED");
});

test("没有学习记录时拒绝生成阶段复盘", async () => {
  const service = serviceWith();
  const result = await service.generateReview(ctx, emptyState(), {
    from: "2026-09-13T00:00:00+08:00", to: "2026-09-14T00:00:00+08:00",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "INVALID_ARGUMENT");
});

test("只能回答当前题目；重复提交不推进进度，改写回答被拒绝", async () => {
  const service = serviceWith();
  const state = emptyState();
  const started = await service.startInterview(ctx, state, { target: { kind: "skills", skillIds: [KNOWN_SKILL] }, questionCount: 2 });
  const interview = started.data!.interview;
  assert.equal(interview.status, "active");
  assert.equal(interview.questions.length, 2);
  state.interviews.push(interview);

  const outOfOrder = await service.submitAnswer(ctx, state, interview.interviewId, interview.questions[1].questionId, "第二题");
  assert.equal(outOfOrder.error?.code, "INVALID_STATE");

  const answered = await service.submitAnswer(ctx, state, interview.interviewId, interview.questions[0].questionId, "我实现了请求解析。");
  assert.equal(answered.ok, true);
  assert.equal(answered.data!.interview.answeredCount, 1);
  assert.equal(answered.data!.feedback?.status, "succeeded");
  state.interviews = [answered.data!.interview];

  const replay = await service.submitAnswer(ctx, state, interview.interviewId, interview.questions[0].questionId, "我实现了请求解析。");
  assert.equal(replay.ok, true);
  assert.equal(replay.changed, false);
  const rewrite = await service.submitAnswer(ctx, state, interview.interviewId, interview.questions[0].questionId, "换个说法");
  assert.equal(rewrite.error?.code, "INVALID_STATE");
});

test("训练范围必须来自真实岗位、能力或项目", async () => {
  const service = serviceWith();
  const state = emptyState();
  const unknownSkill = await service.startInterview(ctx, state, { target: { kind: "skills", skillIds: ["skill-not-in-catalog"] } });
  assert.equal(unknownSkill.error?.code, "INVALID_ARGUMENT");
  const missingJob = await service.startInterview(ctx, state, { target: { kind: "job", jobId: "job-1" } });
  assert.equal(missingJob.error?.code, "NOT_FOUND");
  const missingProject = await service.startInterview(ctx, state, { target: { kind: "project", projectId: "11111111-1111-4111-8111-111111111111" } });
  assert.equal(missingProject.error?.code, "NOT_FOUND");
});

test("项目训练支持手填项目资料，岗位没有结构化能力时仍可进行通用训练", async () => {
  const service = serviceWith();
  const inline = await service.startInterview(ctx, emptyState(), {
    target: { kind: "project", project: { title: "个人知识库", goal: "整理学习资料" } }, questionCount: 1,
  });
  assert.equal(inline.ok, true);
  assert.equal(inline.data!.interview.status, "active");
  assert.equal(inline.data!.interview.target.project?.title, "个人知识库");
  const ports = defaultPorts();
  ports.career = { getJobRequirements: async () => ({ value: { jobId: "job-1", title: "后端实习", requirements: "熟悉服务端开发", skillRefs: [], revision: "1" }, coverage: { complete: true, missing: [], observedAt: new Date().toISOString() } }) };
  const job = await serviceWith({ ports }).startInterview(ctx, emptyState(), { target: { kind: "job", jobId: "job-1" }, questionCount: 1 });
  assert.equal(job.ok, true);
  assert.equal(job.data!.interview.status, "active");
});

test("题目生成失败时保留会话与可恢复提示", async () => {
  const service = serviceWith({ generation: {
    buildInterview: async () => { throw new GenerationError("DEPENDENCY_UNAVAILABLE", "生成服务尚未配置", true); },
    assessEvidence: async () => [], reviewLearning: async () => ({ progress: [], blockers: [], suggestions: [] }),
    assessAnswer: async () => ({ strengths: [], issues: [], suggestions: [], limitations: [] }),
    summarizeInterview: async () => ({ summary: "x", findings: [], recommendations: [], limitations: [] }),
  } });
  const started = await service.startInterview(ctx, emptyState(), { target: { kind: "skills", skillIds: [KNOWN_SKILL] } });
  assert.equal(started.ok, true);
  assert.equal(started.data!.interview.status, "preparation_failed");
  assert.equal(started.data!.recovery?.retryable, true);
  assert.equal(started.data!.interview.coverage.complete, false);
});

test("答完全部题目会生成整场报告，提前结束同样生成报告", async () => {
  const service = serviceWith();
  const state = emptyState();
  const started = await service.startInterview(ctx, state, { target: { kind: "skills", skillIds: [KNOWN_SKILL] }, questionCount: 1 });
  const interview = started.data!.interview;
  state.interviews.push(interview);
  const answered = await service.submitAnswer(ctx, state, interview.interviewId, interview.questions[0].questionId, "我用一次真实练习说明做法。");
  assert.equal(answered.data!.interview.status, "completed");
  assert.equal(answered.data!.interview.reportStatus, "succeeded");
  assert.ok(answered.data!.report?.summary);

  const second = await service.startInterview(ctx, state, { target: { kind: "skills", skillIds: [KNOWN_SKILL] }, questionCount: 2, startNew: true });
  state.interviews = [answered.data!.interview, second.data!.interview];
  const firstAnswer = await service.submitAnswer(
    ctx, state, second.data!.interview.interviewId, second.data!.interview.questions[0].questionId, "先答一题");
  // The service returns a new aggregate; the caller persists it, so the test does the same.
  state.interviews = [answered.data!.interview, firstAnswer.data!.interview];
  const refreshed = firstAnswer.data!.interview;
  const finished = await service.finishInterview(ctx, state, refreshed.interviewId, "时间不够");
  state.interviews = [answered.data!.interview, finished.data!.interview];
  assert.equal(finished.data!.interview.status, "ended_early");
  assert.equal(finished.data!.interview.reportStatus, "succeeded");
  const feedback = service.getFeedback(ctx, state, refreshed.interviewId);
  assert.equal("reportStatus" in feedback.data!, true);
});

test("能力卡片只读取已保存评估；证据撤回后标记为需要复核", async () => {
  const service = serviceWith();
  const state = emptyState();
  const created = await service.createRecord(ctx, state, activityInput({ skillIds: [KNOWN_SKILL] }));
  state.records.push(created.data!.record);
  const empty = await service.querySkillCards(ctx, state, { skillIds: [KNOWN_SKILL] });
  assert.equal(empty.data!.page.items[0].verification, "no_evidence");

  const assessed = await service.assessEvidence(ctx, state, {
    evidenceIds: [created.data!.record.recordId], skillIds: [KNOWN_SKILL],
  });
  state.assessments.push(assessed.data!.assessment);
  const available = await service.querySkillCards(ctx, state, { skillIds: [KNOWN_SKILL] });
  assert.equal(available.data!.page.items[0].verification, "available");
  assert.equal(available.data!.page.items[0].assessments[0].validity, "current");

  const withdrawn = await service.withdrawRecord({ ...ctx, expectedVersion: 1 }, state, created.data!.record.recordId, "材料有误");
  state.records = [withdrawn.data!.record];
  const stale = await service.querySkillCards(ctx, state, { skillIds: [KNOWN_SKILL] });
  assert.equal(stale.data!.page.items[0].verification, "no_evidence");
  assert.equal(stale.data!.page.items[0].assessments[0].validity, "stale");
});
