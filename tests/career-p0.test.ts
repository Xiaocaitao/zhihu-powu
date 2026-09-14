import assert from "node:assert/strict";
import test from "node:test";
import { CareerService } from "../src/modules/career/service.ts";
import { MemoryCareerRepository } from "../src/modules/career/repository.ts";
import type { CareerContext, EvidenceQuery, ProfileQuery } from "../src/modules/career/contracts.ts";
import { createCareerCapabilities } from "../src/modules/career/capabilities.ts";

const ctx: CareerContext = { ownerId: "career-p0-owner", requestId: "req", operationKey: "op" };
const profileQuery: ProfileQuery = { async getProfileSnapshot() { return { directionHints: ["backend"], interests: [], currentSkills: [{ skillCode: "ts" }] }; } };
const evidenceQuery: EvidenceQuery = { async getSkillEvidenceSnapshot(_ctx, { skillCodes }) { return skillCodes.map(skillCode => skillCode === "ts" ? { skillCode, level: 4, evidenceIds: ["e1", "e2"], evidenceCount: 2, support: "supported" as const } : skillCode === "sql" ? { skillCode, evidenceIds: ["e3"], evidenceCount: 1, support: "partial" as const } : { skillCode, evidenceIds: [], evidenceCount: 0, support: "insufficient" as const }); } };
function command(payload: any, key = crypto.randomUUID() as `${string}-${string}-${string}-${string}-${string}`) { return { context: { ...ctx, operationKey: key }, payload, idempotencyKey: key }; }

test("Career P0：保存不选中、选择/确认版本、幂等和 owner 隔离", async () => {
  const repo = new MemoryCareerRepository(); const service = new CareerService(repo, { profileQuery, evidenceQuery });
  const draft = await service.createCareerPlanDraft(command({ directionCodes: ["backend"] }, crypto.randomUUID())); assert.equal(draft.ok, true);
  const plan = (draft.data as any).plan;
  const saved = await service.saveTargetJob(command({ title: "后端工程师", description: "负责 TypeScript、SQL 和平台服务开发。", requirements: [{ skillCode: "ts", skillName: "TypeScript", importance: "required" }, { skillCode: "sql", skillName: "SQL", importance: "required" }, { skillCode: "docker", skillName: "Docker", importance: "required" }] }, crypto.randomUUID())); assert.equal(saved.ok, true);
  const job = (saved.data as any).job; assert.equal((await service.getCareerDashboard(ctx)).activeJob, null);
  const selectKey = crypto.randomUUID();
  const selected = await service.selectTargetJob(command({ planId: plan.id, jobId: job.id, expectedVersion: plan.version }, selectKey)); assert.equal(selected.ok, true);
  const nextVersion = (selected.data as any).plan.version;
  const duplicate = await service.selectTargetJob(command({ planId: plan.id, jobId: job.id, expectedVersion: nextVersion }, selectKey)); assert.equal(duplicate.ok, false); assert.equal(duplicate.error?.code, "DUPLICATE_REQUEST");
  const gap = await service.analyzeJobGap(command({ jobId: job.id, planId: plan.id, includeUnknown: true }, crypto.randomUUID())); assert.equal(gap.ok, true); const result = (gap.data as any).gap; assert.equal(result.possessed.length, 1); assert.equal(result.partial.length, 1); assert.equal(result.missing.length, 1); assert.equal(result.recommendedActions.some((x: any) => x.type === "learn_skill"), true);
  const confirmed = await service.confirmCareerPlan(command({ planId: plan.id, expectedVersion: nextVersion }, crypto.randomUUID())); assert.equal(confirmed.ok, true);
  const other = await service.getTargetJob({ ...ctx, ownerId: "another-owner" }, { jobId: job.id }); assert.equal(other, null);
});

test("Career P0：Tool 集合只委托 CareerApplication 并保留确认约束", () => {
  const calls: string[] = []; const app = new Proxy({} as any, { get: (_target, property) => async () => { calls.push(String(property)); return { ok: true, changed: false, domain: "career", status: "read", summary: "ok", data: {} }; } });
  const tools = createCareerCapabilities(app);
  const toolNames = tools.map(tool => tool.name);
  const expectedP0Tools = [
    "get_career_plan",
    "create_career_plan_draft",
    "get_target_jobs",
    "save_target_job",
    "list_job_catalog",
    "select_target_job",
    "analyze_job_gap",
    "confirm_career_plan",
    "get_career_dashboard",
    "compare_target_jobs",
  ];
  const expectedP1Tools = [
    "list_target_companies",
    "select_target_company",
    "compare_target_companies",
    "get_industry_trends",
  ];
  for (const toolName of [...expectedP0Tools, ...expectedP1Tools]) {
    assert.ok(toolNames.includes(toolName), `missing career tool: ${toolName}`);
  }
  assert.equal(toolNames.length, expectedP0Tools.length + expectedP1Tools.length);
  assert.equal(tools.find(tool => tool.name === "select_target_job")?.requiresConfirmation, true); assert.equal(tools.find(tool => tool.name === "confirm_career_plan")?.requiresConfirmation, true); assert.equal(calls.length, 0);
});


test("Career P0：未知项、隐藏未知项、Learning 降级和缺少依赖", async () => {
  const repo = new MemoryCareerRepository();
  const service = new CareerService(repo, { profileQuery, evidenceQuery, learningProgressQuery: { async getActionProgress() { throw new Error("learning unavailable"); } } });
  const draft = await service.createCareerPlanDraft(command({ directionCodes: ["backend"] }));
  const plan = (draft.data as any).plan;
  const saved = await service.saveTargetJob(command({ title: "平台工程师", description: "负责平台服务、TypeScript、SQL 和云原生基础设施。", requirements: [
    { skillCode: "ts", skillName: "TypeScript", importance: "required" },
    { skillCode: "sql", skillName: "SQL", importance: "required" },
    { skillCode: "docker", skillName: "Docker", importance: "required" },
    { skillCode: "k8s", skillName: "Kubernetes", importance: "preferred" },
  ] }));
  const job = (saved.data as any).job;
  const gap = await service.analyzeJobGap(command({ jobId: job.id, planId: plan.id, includeUnknown: true }));
  const analysis = (gap.data as any).gap;
  assert.equal(analysis.matchScore, null);
  assert.equal(analysis.unknown.length, 1);
  assert.ok(analysis.recommendedActions.some((action: any) => action.type === "clarify_requirement"));
  assert.ok(analysis.recommendedActions.some((action: any) => action.type === "learn_skill"));
  const hidden = await service.analyzeJobGap(command({ jobId: job.id, planId: plan.id, includeUnknown: false }));
  assert.equal((hidden.data as any).gap.unknown.length, 0);
  assert.ok((hidden.data as any).gap.recommendedActions.length > 0);
  const dashboard = await service.getCareerDashboard(ctx, { includeLearningProgress: true });
  assert.ok(dashboard.recommendedActions.every(action => action.learningPlanStatus === "not_linked"));
  const noProfile = new CareerService(repo, { evidenceQuery });
  const unavailable = await noProfile.createCareerPlanDraft(command({ directionCodes: ["backend"] }));
  assert.equal(unavailable.error?.code, "DEPENDENCY_UNAVAILABLE");
});

test("Career P0：写接口缺少 Idempotency-Key 时拒绝", async () => {
  const service = new CareerService(new MemoryCareerRepository(), { profileQuery, evidenceQuery });
  const result = await service.saveTargetJob({ context: ctx, payload: { title: "后端工程师", description: "负责 TypeScript、SQL 和平台服务开发。" }, idempotencyKey: "" });
  assert.equal(result.error?.code, "INVALID_ARGUMENT");
});

