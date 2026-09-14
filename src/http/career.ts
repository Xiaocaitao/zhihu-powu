import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError } from "zod";
import type { CapabilityContext, DomainCommand } from "../contracts/capability.ts";
import type { CareerApplication } from "../modules/career/types.ts";
import {
  analyzeJobGapSchema, compareTargetJobsSchema, confirmCareerPlanSchema, createCareerPlanDraftSchema,
  getCareerPlanSchema, getCareerDashboardSchema, getTargetJobsSchema, listJobCatalogSchema, saveTargetJobSchema, selectTargetJobSchema,
  listTargetCompaniesSchema, selectTargetCompanySchema, compareTargetCompaniesSchema, getIndustryTrendsSchema,
} from "../modules/career/contracts.ts";
import type { CareerCapabilityResult } from "../modules/career/contracts.ts";
import { randomUUID } from "node:crypto";

export function createCareerRoutes(application: CareerApplication) {
  const route = (method: string, pattern: RegExp, handle: (input: { request: IncomingMessage; response: ServerResponse; params: Record<string, string>; context: CapabilityContext }) => Promise<void>) => ({ method, pattern, handle });
  return [
    route("GET", /^\/api\/career\/plan$/, async ({ request, response, context }) => {
      const query = new URL(request.url ?? "/", "http://localhost").searchParams;
      const input = getCareerPlanSchema.parse({ status: query.get("status") ?? undefined, includeGapAnalysis: parseBooleanQuery(query, "includeGapAnalysis") });
      return send(response, 200, { ok: true, data: await application.getCareerPlan(context, input) });
    }),
    route("POST", /^\/api\/career\/plans\/draft$/, async ({ request, response, context }) => {
      const payload = createCareerPlanDraftSchema.parse(await readJson(request));
      return sendResult(response, await application.createCareerPlanDraft(command(context, payload, request)));
    }),
    route("POST", /^\/api\/career\/plans\/(?<id>[^/]+)\/confirm$/, async ({ request, response, params, context }) => {
      const body = await readJson(request);
      const payload = confirmCareerPlanSchema.parse({ planId: params.id, expectedVersion: body.expectedVersion });
      return sendResult(response, await application.confirmCareerPlan(command(context, payload, request)));
    }),
    route("GET", /^\/api\/career\/jobs$/, async ({ request, response, context }) => {
      const input = getTargetJobsSchema.parse(queryInput(request));
      return send(response, 200, { ok: true, data: await application.getTargetJobs(context, input) });
    }),
    route("GET", /^\/api\/career\/job-catalog$/, async ({ request, response, context }) => {
      const input = listJobCatalogSchema.parse(queryInput(request));
      return send(response, 200, { ok: true, data: await application.listJobCatalog(context, input) });
    }),
    route("POST", /^\/api\/career\/jobs$/, async ({ request, response, context }) => {
      const payload = saveTargetJobSchema.parse(await readJson(request));
      return sendResult(response, await application.saveTargetJob(command(context, payload, request)), 201);
    }),
    route("POST", /^\/api\/career\/plans\/(?<id>[^/]+)\/target-job$/, async ({ request, response, params, context }) => {
      const body = await readJson(request);
      const payload = selectTargetJobSchema.parse({ planId: params.id, jobId: body.jobId, expectedVersion: body.expectedVersion });
      return sendResult(response, await application.selectTargetJob(command(context, payload, request)));
    }),
    route("GET", /^\/api\/career\/jobs\/(?<id>[^/]+)\/gap-analysis\/latest$/, async ({ response, params, context }) => {
      return send(response, 200, { ok: true, data: await application.getLatestJobGapAnalysis(context, { jobId: params.id }) });
    }),
    route("POST", /^\/api\/career\/gap-analysis$/, async ({ request, response, context }) => {
      const payload = analyzeJobGapSchema.parse(await readJson(request));
      return sendResult(response, await application.analyzeJobGap(command(context, payload, request)));
    }),
    route("GET", /^\/api\/career\/dashboard$/, async ({ request, response, context }) => {
      const query = new URL(request.url ?? "/", "http://localhost").searchParams;
      const input = getCareerDashboardSchema.parse({ trendPeriodDays: query.has("trendPeriodDays") ? Number(query.get("trendPeriodDays")) : undefined, includeCompanies: parseBooleanQuery(query, "includeCompanies"), includeLearningProgress: parseBooleanQuery(query, "includeLearningProgress") ?? true });
      return send(response, 200, { ok: true, data: await application.getCareerDashboard(context, input) });
    }),
    route("POST", /^\/api\/career\/jobs\/compare$/, async ({ request, response, context }) => {
      const payload = compareTargetJobsSchema.parse(await readJson(request));
      return sendResult(response, await application.compareTargetJobs(context, payload));
    }),
    route("GET", /^\/api\/career\/companies$/, async ({ request, response, context }) => {
      return send(response, 200, { ok: true, data: await application.listTargetCompanies(context, listTargetCompaniesSchema.parse(companyQueryInput(request))) });
    }),
    route("POST", /^\/api\/career\/plans\/(?<id>[^/]+)\/company$/, async ({ request, response, params, context }) => {
      const body = await readJson(request);
      const payload = selectTargetCompanySchema.parse({ planId: params.id, companyId: body.companyId, expectedVersion: body.expectedVersion });
      return sendResult(response, await application.selectTargetCompany(command(context, payload, request)));
    }),
    route("POST", /^\/api\/career\/companies\/compare$/, async ({ request, response, context }) => {
      const payload = compareTargetCompaniesSchema.parse(await readJson(request));
      return sendResult(response, await application.compareTargetCompanies(context, payload));
    }),
    route("GET", /^\/api\/career\/trends$/, async ({ request, response, context }) => {
      const query = new URL(request.url ?? "/", "http://localhost").searchParams;
      const directionCodes = query.getAll("directionCode");
      const input = getIndustryTrendsSchema.parse({ directionCodes: directionCodes.length ? directionCodes : undefined, periodDays: query.has("periodDays") ? Number(query.get("periodDays")) : undefined });
      return send(response, 200, { ok: true, data: await application.getIndustryTrends(context, input) });
    }),
  ];
}

function command<T>(context: CapabilityContext, payload: T, request: IncomingMessage): DomainCommand<T> {
  const idempotencyKey = request.headers["idempotency-key"];
  const key = typeof idempotencyKey === "string" && idempotencyKey.trim() ? idempotencyKey.trim() : "";
  return { context: { ...context, operationKey: key || context.operationKey }, payload, expectedVersion: (payload as { expectedVersion?: number }).expectedVersion, idempotencyKey: key };
}

function parseBooleanQuery(query: URLSearchParams, name: string): boolean | undefined {
  if (!query.has(name)) return undefined;
  const value = query.get(name);
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("invalid_request");
}

function companyQueryInput(request: IncomingMessage) {
  const query = new URL(request.url ?? "/", "http://localhost").searchParams;
  return { keyword: query.get("keyword") ?? undefined, directionCode: query.get("directionCode") ?? undefined, city: query.get("city") ?? undefined, limit: query.has("limit") ? Number(query.get("limit")) : undefined, cursor: query.get("cursor") ?? undefined };
}

function queryInput(request: IncomingMessage) {
  const query = new URL(request.url ?? "/", "http://localhost").searchParams;
  return { directionCode: query.get("directionCode") ?? undefined, keyword: query.get("keyword") ?? undefined, limit: query.has("limit") ? Number(query.get("limit")) : undefined, cursor: query.get("cursor") ?? undefined };
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_request");
  return value as Record<string, unknown>;
}

function sendResult(response: ServerResponse, result: CareerCapabilityResult, successStatus = 200) {
  return send(response, result.ok ? successStatus : statusFor(result.error?.code), result);
}
function statusFor(code?: string) { return code === "NOT_FOUND" ? 404 : code === "FORBIDDEN" ? 403 : ["VERSION_CONFLICT", "DUPLICATE_REQUEST", "INVALID_STATE"].includes(code ?? "") ? 409 : code === "DEPENDENCY_UNAVAILABLE" ? 424 : 400; }
function send(response: ServerResponse, status: number, body: unknown) { if (!response.headersSent) response.writeHead(status, { "content-type": "application/json; charset=utf-8" }); response.end(JSON.stringify(body)); }

export function careerRouteErrorStatus(error: unknown) { return error instanceof ZodError || error instanceof SyntaxError || (error instanceof Error && error.message === "invalid_request") ? 400 : 500; }
