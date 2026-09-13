import test from "node:test";
import assert from "node:assert/strict";
import { CareerError } from "../contracts.ts";
import { createMockEvidenceQuery, createMockProfileQuery } from "../mock-dependencies.ts";
import { MockCareerRepository } from "../mock-repository.ts";
import { MockCareerService } from "../service.ts";

const context = (ownerId = "owner-a") => ({ ownerId, sessionId: "session-a", requestId: crypto.randomUUID(), signal: new AbortController().signal });
const service = () => new MockCareerService({ repository: new MockCareerRepository(), profileQuery: createMockProfileQuery(), evidenceQuery: createMockEvidenceQuery() });

test("creates a draft and confirms it with optimistic version", async () => {
  const app = service();
  const ctx = context();
  const created = await app.createCareerPlanDraft({ context: ctx, payload: {}, idempotencyKey: "draft-1" });
  assert.equal(created.status, "draft_created");
  const plan = await app.getCareerPlan(ctx, { includeGapAnalysis: true });
  assert.ok(plan);
  const confirmed = await app.confirmCareerPlan({ context: ctx, payload: { planId: plan.id, expectedVersion: plan.version }, idempotencyKey: "confirm-1" });
  assert.equal(confirmed.status, "applied");
  assert.equal((confirmed.data as typeof plan).status, "confirmed");
});

test("rejects stale plan versions and cross-owner access", async () => {
  const app = service();
  const owner = context("owner-a");
  const created = await app.createCareerPlanDraft({ context: owner, payload: {}, idempotencyKey: "draft-2" });
  await assert.rejects(() => app.confirmCareerPlan({ context: owner, payload: { planId: String(created.entityId), expectedVersion: 99 }, idempotencyKey: "bad-version" }), (error: unknown) => error instanceof CareerError && error.code === "VERSION_CONFLICT");
  assert.equal(await app.getCareerPlan(context("owner-b"), {}), null);
});

test("saves a job without selecting it and analyzes its gap statuses", async () => {
  const app = service();
  const ctx = context();
  const saved = await app.saveTargetJob({ context: ctx, payload: { title: "自定义后端岗位", description: "参与后端接口开发、数据库设计和服务稳定性建设，完成项目交付。" }, idempotencyKey: "job-1" });
  const job = saved.data as { id: string };
  assert.equal((await app.getCareerPlan(ctx, {})), null);
  const analysis = await app.analyzeJobGap({ context: ctx, payload: { jobId: "seed-backend-intern" }, idempotencyKey: "gap-1" });
  const data = analysis.data as { possessed: unknown[]; partial: unknown[]; missing: unknown[]; unknown: unknown[]; recommendedActions: unknown[] };
  assert.ok(data.possessed.length + data.partial.length + data.missing.length + data.unknown.length > 0);
  assert.ok(data.recommendedActions.length > 0);
  assert.equal(job.id.startsWith("job-"), true);
});

test("replays an idempotent write", async () => {
  const app = service();
  const ctx = context();
  const input = { context: ctx, payload: {}, idempotencyKey: "same-request" };
  const first = await app.createCareerPlanDraft(input);
  const second = await app.createCareerPlanDraft(input);
  assert.deepEqual(second, first);
});
