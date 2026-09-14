import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createPowuServer } from "../src/server.ts";
import { createCareerCapabilities } from "../src/modules/career/capabilities.ts";
import { CareerService } from "../src/modules/career/service.ts";
import { MemoryCareerRepository } from "../src/modules/career/repository.ts";
import type { CareerContext, IndustryTrend, ProfileQuery, EvidenceQuery } from "../src/modules/career/contracts.ts";
import type { CareerApplication } from "../src/modules/career/types.ts";

const ownerContext: CareerContext = { ownerId: "career-p1-owner", requestId: "p1-request", operationKey: "p1-operation" };
const profileQuery: ProfileQuery = {
  async getProfileSnapshot() {
    return { directionHints: ["backend"], interests: [], currentSkills: [{ skillCode: "ts" }] };
  },
};
const evidenceQuery: EvidenceQuery = {
  async getSkillEvidenceSnapshot(_ctx, { skillCodes }) {
    return skillCodes.map(skillCode => ({ skillCode, evidenceIds: [], evidenceCount: 0, support: "insufficient" as const }));
  },
};
const trends: IndustryTrend[] = [
  {
    id: "trend-backend-90",
    directionCode: "backend",
    directionName: "后端开发",
    metric: "growth",
    value: 18,
    title: "后端岗位增长",
    summary: "后端岗位需求保持增长。",
    periodDays: 90,
    sampleSize: 120,
    sourceLabel: "test-fixture",
    asOf: "2026-09-01T00:00:00.000Z",
  },
  {
    id: "trend-frontend-30",
    directionCode: "frontend",
    directionName: "前端开发",
    metric: "demand_heat",
    value: 72,
    title: "前端需求热度",
    summary: "前端岗位需求稳定。",
    periodDays: 30,
    sampleSize: 80,
    sourceLabel: "test-fixture",
    asOf: "2026-09-01T00:00:00.000Z",
  },
];

function command<T>(context: CareerContext, payload: T, idempotencyKey: string = crypto.randomUUID()) {
  return { context: { ...context, operationKey: idempotencyKey }, payload, idempotencyKey };
}

async function makeService(ownerId = ownerContext.ownerId) {
  const repo = new MemoryCareerRepository({ trends });
  const service = new CareerService(repo, { profileQuery, evidenceQuery });
  const context = { ...ownerContext, ownerId };
  const draft = await service.createCareerPlanDraft(command(context, { directionCodes: ["backend"] }));
  assert.equal(draft.ok, true);
  return { repo, service, context, plan: (draft.data as { plan: { id: string; version: number } }).plan };
}

async function listen(server: ReturnType<typeof createPowuServer>) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

function cookieFrom(response: Response) {
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

async function json(response: Response) {
  return await response.json() as Record<string, any>;
}

test("Career P1 Service：企业目录、选择、对比、趋势和 Dashboard 聚合", async () => {
  const { service, context, plan } = await makeService();
  const firstJobResult = await service.saveTargetJob(command(context, {
    title: "后端工程师-A",
    companyId: "company-a",
    companyName: "星河科技",
    directionCode: "backend",
    city: "北京",
    description: "负责平台服务、TypeScript 和 SQL 相关后端开发工作。",
    requirements: [{ skillCode: "ts", skillName: "TypeScript", importance: "required" }],
  }));
  const secondJobResult = await service.saveTargetJob(command(context, {
    title: "后端工程师-B",
    companyId: "company-b",
    companyName: "远山科技",
    directionCode: "backend",
    city: "上海",
    description: "负责服务端系统、数据库和云原生平台相关开发工作。",
    requirements: [{ skillCode: "sql", skillName: "SQL", importance: "required" }],
  }));
  assert.equal(firstJobResult.ok, true);
  assert.equal(secondJobResult.ok, true);

  const companies = await service.listTargetCompanies(context, { directionCode: "backend" });
  assert.equal(companies.items.length, 2);
  assert.deepEqual(companies.items.map(item => item.id).sort(), ["company-a", "company-b"]);
  assert.ok(companies.items.every(item => item.relatedJobIds.length === 1));

  const selected = await service.selectTargetCompany(command(context, {
    planId: plan.id,
    companyId: "company-a",
    expectedVersion: plan.version,
  }, "select-company-once"));
  assert.equal(selected.ok, true);
  assert.equal((selected.data as any).plan.targetCompanyId, "company-a");
  const selectedVersion = (selected.data as any).plan.version;

  const conflict = await service.selectTargetCompany(command(context, {
    planId: plan.id,
    companyId: "company-b",
    expectedVersion: plan.version,
  }, "select-company-conflict"));
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error?.code, "VERSION_CONFLICT");

  const comparison = await service.compareTargetCompanies(context, { leftCompanyId: "company-a", rightCompanyId: "company-b" });
  assert.equal(comparison.ok, true);
  assert.equal((comparison.data as any).leftCompany.id, "company-a");
  assert.equal((comparison.data as any).rightCompany.id, "company-b");
  assert.equal((comparison.data as any).comparableJobPairs.length, 1);

  const afterCompare = await service.getCareerPlan(context, {});
  assert.equal(afterCompare?.targetCompanyId, "company-a");
  assert.equal(afterCompare?.version, selectedVersion);

  const filteredTrends = await service.getIndustryTrends(context, { directionCodes: ["backend"], periodDays: 90 });
  assert.equal(filteredTrends.length, 1);
  assert.equal(filteredTrends[0].id, "trend-backend-90");

  const dashboard = await service.getCareerDashboard(context, { includeCompanies: true, trendPeriodDays: 90 });
  assert.equal(dashboard.targetCompanies.length, 2);
  assert.equal(dashboard.targetCompanies.find(company => company.id === "company-a")?.selectionStatus, "selected");
  assert.equal(dashboard.trends.length, 1);
  assert.equal(dashboard.trends[0].directionCode, "backend");
});

test("Career P1 Service：企业 owner 隔离和参数错误", async () => {
  const { service, context, plan } = await makeService();
  await service.saveTargetJob(command(context, {
    title: "后端工程师",
    companyId: "company-owner",
    companyName: "仅本人可见科技",
    directionCode: "backend",
    description: "负责平台服务、TypeScript 和 SQL 相关后端开发工作。",
  }));
  const otherContext = { ...context, ownerId: "career-p1-other" };
  const hidden = await service.listTargetCompanies(otherContext, {});
  assert.equal(hidden.items.length, 0);
  const selectHidden = await service.selectTargetCompany(command(otherContext, {
    planId: plan.id,
    companyId: "company-owner",
    expectedVersion: plan.version,
  }));
  assert.equal(selectHidden.ok, false);
  assert.equal(selectHidden.error?.code, "NOT_FOUND");
  const sameCompany = await service.compareTargetCompanies(context, { leftCompanyId: "company-owner", rightCompanyId: "company-owner" });
  assert.equal(sameCompany.ok, false);
  assert.equal(sameCompany.error?.code, "INVALID_ARGUMENT");
});

test("Career P1 Tool：企业和趋势 Tool 只委托 CareerApplication并保留选择确认", async () => {
  const calls: string[] = [];
  const app = new Proxy({} as CareerApplication, {
    get: (_target, property) => async () => {
      calls.push(String(property));
      return { ok: true, changed: false, domain: "career", status: "read", summary: "ok", data: {} };
    },
  });
  const tools = createCareerCapabilities(app);
  const companyTools = tools.filter(tool => ["list_target_companies", "select_target_company", "compare_target_companies", "get_industry_trends"].includes(tool.name));
  assert.deepEqual(companyTools.map(tool => tool.name), ["list_target_companies", "select_target_company", "compare_target_companies", "get_industry_trends"]);
  assert.equal(tools.find(tool => tool.name === "select_target_company")?.requiresConfirmation, true);
  assert.equal(tools.find(tool => tool.name === "list_target_companies")?.requiresConfirmation, undefined);
  assert.equal(tools.find(tool => tool.name === "compare_target_companies")?.requiresConfirmation, undefined);
  assert.equal(tools.find(tool => tool.name === "get_industry_trends")?.requiresConfirmation, undefined);

  const context = { ...ownerContext, operationKey: "tool-p1" };
  await tools.find(tool => tool.name === "list_target_companies")!.execute(context, {});
  await tools.find(tool => tool.name === "select_target_company")!.execute(context, { planId: "plan-1", companyId: "company-1", expectedVersion: 1 });
  await tools.find(tool => tool.name === "compare_target_companies")!.execute(context, { leftCompanyId: "company-1", rightCompanyId: "company-2" });
  await tools.find(tool => tool.name === "get_industry_trends")!.execute(context, { directionCodes: ["backend"], periodDays: 90 });
  assert.deepEqual(calls, ["listTargetCompanies", "selectTargetCompany", "compareTargetCompanies", "getIndustryTrends"]);
});

test("Career P1 HTTP：企业、趋势、Dashboard 路由传递 owner、幂等键和版本", async t => {
  const repo = new MemoryCareerRepository({ trends });
  const service = new CareerService(repo, { profileQuery, evidenceQuery });
  const server = createPowuServer({ careerApplication: service });
  const base = await listen(server);
  t.after(() => server.close());

  const first = await fetch(`${base}/api/career/plan`);
  assert.equal(first.status, 200);
  const cookie = cookieFrom(first);
  assert.ok(cookie);

  const draftResponse = await fetch(`${base}/api/career/plans/draft`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "idempotency-key": "http-draft-1" },
    body: JSON.stringify({ directionCodes: ["backend"] }),
  });
  assert.equal(draftResponse.status, 200);
  const draftBody = await json(draftResponse);
  const plan = draftBody.data.plan;

  const saveA = await fetch(`${base}/api/career/jobs`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "idempotency-key": "http-job-a" },
    body: JSON.stringify({ title: "HTTP 后端岗位 A", companyId: "http-company-a", companyName: "HTTP 星河", directionCode: "backend", description: "负责平台服务、TypeScript 和 SQL 相关后端开发工作。" }),
  });
  const saveB = await fetch(`${base}/api/career/jobs`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "idempotency-key": "http-job-b" },
    body: JSON.stringify({ title: "HTTP 后端岗位 B", companyId: "http-company-b", companyName: "HTTP 远山", directionCode: "backend", description: "负责服务端系统、数据库和云原生平台相关开发工作。" }),
  });
  assert.equal(saveA.status, 201);
  assert.equal(saveB.status, 201);

  const companiesResponse = await fetch(`${base}/api/career/companies?directionCode=backend`, { headers: { cookie } });
  assert.equal(companiesResponse.status, 200);
  const companiesBody = await json(companiesResponse);
  assert.equal(companiesBody.data.items.length, 2);

  const selectResponse = await fetch(`${base}/api/career/plans/${encodeURIComponent(plan.id)}/company`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "idempotency-key": "http-select-company" },
    body: JSON.stringify({ companyId: "http-company-a", expectedVersion: plan.version }),
  });
  assert.equal(selectResponse.status, 200);
  const selectedBody = await json(selectResponse);
  assert.equal(selectedBody.data.plan.targetCompanyId, "http-company-a");

  const compareResponse = await fetch(`${base}/api/career/companies/compare`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ leftCompanyId: "http-company-a", rightCompanyId: "http-company-b" }),
  });
  assert.equal(compareResponse.status, 200);
  assert.equal((await json(compareResponse)).data.leftCompany.id, "http-company-a");

  const trendsResponse = await fetch(`${base}/api/career/trends?directionCode=backend&periodDays=90`, { headers: { cookie } });
  assert.equal(trendsResponse.status, 200);
  assert.equal((await json(trendsResponse)).data.length, 1);

  const dashboardResponse = await fetch(`${base}/api/career/dashboard?includeCompanies=true&periodDays=90`, { headers: { cookie } });
  assert.equal(dashboardResponse.status, 200);
  const dashboardBody = await json(dashboardResponse);
  assert.equal(dashboardBody.data.targetCompanies.length, 2);
  assert.equal(dashboardBody.data.plan.targetCompanyId, "http-company-a");

  const missingKey = await fetch(`${base}/api/career/plans/${encodeURIComponent(plan.id)}/company`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ companyId: "http-company-b", expectedVersion: selectedBody.data.plan.version }),
  });
  assert.equal(missingKey.status, 400);
  assert.equal((await json(missingKey)).error.code, "INVALID_ARGUMENT");
});


test("Career P1 回归：企业目录不过滤当前方向、目标选择幂等且 confirmed 后锁定", async () => {
  const { service, context, plan } = await makeService();
  const backendJob = await service.saveTargetJob(command(context, {
    title: "后端岗位",
    companyId: "company-backend",
    companyName: "后端企业",
    directionCode: "backend",
    city: "北京",
    description: "负责后端服务和数据库开发。",
    requirements: [{ skillCode: "ts", skillName: "TypeScript", importance: "required" }],
  }));
  const frontendJob = await service.saveTargetJob(command(context, {
    title: "前端岗位",
    companyId: "company-frontend",
    companyName: "前端企业",
    directionCode: "frontend",
    city: "上海",
    description: "负责前端应用开发。",
    requirements: [{ skillCode: "ts", skillName: "TypeScript", importance: "required" }],
  }));
  assert.equal(backendJob.ok, true);
  assert.equal(frontendJob.ok, true);
  const backendJobId = (backendJob.data as { job: { id: string } }).job.id;
  const frontendJobId = (frontendJob.data as { job: { id: string } }).job.id;

  const selectedJob = await service.selectTargetJob(command(context, {
    planId: plan.id,
    jobId: backendJobId,
    expectedVersion: plan.version,
  }, "regression-select-job"));
  assert.equal(selectedJob.ok, true);
  const selectedJobPlan = (selectedJob.data as { plan: { version: number } }).plan;

  const repeatedJob = await service.selectTargetJob(command(context, {
    planId: plan.id,
    jobId: backendJobId,
    expectedVersion: selectedJobPlan.version,
  }, "regression-repeat-job"));
  assert.equal(repeatedJob.ok, true);
  assert.equal(repeatedJob.changed, false);
  assert.equal((repeatedJob.data as { plan: { version: number } }).plan.version, selectedJobPlan.version);

  const dashboard = await service.getCareerDashboard(context);
  assert.deepEqual(dashboard.targetCompanies.map(company => company.id).sort(), ["company-backend", "company-frontend"]);

  const selectedCompany = await service.selectTargetCompany(command(context, {
    planId: plan.id,
    companyId: "company-backend",
    expectedVersion: selectedJobPlan.version,
  }, "regression-select-company"));
  assert.equal(selectedCompany.ok, true);
  const selectedCompanyPlan = (selectedCompany.data as { plan: { version: number } }).plan;

  const repeatedCompany = await service.selectTargetCompany(command(context, {
    planId: plan.id,
    companyId: "company-backend",
    expectedVersion: selectedCompanyPlan.version,
  }, "regression-repeat-company"));
  assert.equal(repeatedCompany.ok, true);
  assert.equal(repeatedCompany.changed, false);
  assert.equal((repeatedCompany.data as { plan: { version: number } }).plan.version, selectedCompanyPlan.version);

  const confirmed = await service.confirmCareerPlan(command(context, {
    planId: plan.id,
    expectedVersion: selectedCompanyPlan.version,
  }, "regression-confirm"));
  assert.equal(confirmed.ok, true);
  const confirmedVersion = (confirmed.data as { plan: { version: number } }).plan.version;

  const blockedJob = await service.selectTargetJob(command(context, {
    planId: plan.id,
    jobId: frontendJobId,
    expectedVersion: confirmedVersion,
  }, "regression-blocked-job"));
  assert.equal(blockedJob.ok, false);
  assert.equal(blockedJob.error?.code, "INVALID_STATE");

  const blockedCompany = await service.selectTargetCompany(command(context, {
    planId: plan.id,
    companyId: "company-frontend",
    expectedVersion: confirmedVersion,
  }, "regression-blocked-company"));
  assert.equal(blockedCompany.ok, false);
  assert.equal(blockedCompany.error?.code, "INVALID_STATE");
});
