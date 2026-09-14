import { randomUUID } from "node:crypto";
import { ZodError, z } from "zod";
import type { CapabilityRegistry } from "../../agent/tools/registry.ts";
import type { CapabilityContext } from "../../contracts/capability.ts";
import type { CapabilityResult } from "./contracts.ts";

type EvidenceRequest = {
  method: string;
  path: string;
  query: URLSearchParams;
  operationKey?: string | string[];
  ifMatch?: string | string[];
  readJson: () => Promise<unknown>;
};
export type EvidenceHttpResult = { status: number; body: unknown };

const operationKeySchema = z.string().trim().regex(/^[A-Za-z0-9._:-]{1,128}$/);
const jsonObjectSchema = z.record(z.string(), z.unknown());
const numberParam = (value: string | null) => value === null ? undefined : Number(value);
const listParam = (value: string | null) => value ? value.split(",").map(item => item.trim()).filter(Boolean) : undefined;

const errorStatuses: Record<string, number> = {
  NOT_FOUND: 404, FORBIDDEN: 403, INVALID_ARGUMENT: 400, INVALID_STATE: 409,
  VERSION_CONFLICT: 409, DUPLICATE_REQUEST: 409, CONFIRMATION_REQUIRED: 409,
  DEPENDENCY_UNAVAILABLE: 503, GENERATION_FAILED: 502,
};

function failure(status: number, error: string): EvidenceHttpResult {
  return { status, body: { ok: false, error } };
}

/**
 * HTTP transport for the Evidence module. It performs no business decisions:
 * it maps path, query and body onto the same capabilities the Agent uses.
 */
export async function handleEvidenceHttp(
  request: EvidenceRequest,
  context: Omit<CapabilityContext, "operationKey">,
  registry?: CapabilityRegistry,
): Promise<EvidenceHttpResult> {
  if (!registry) return failure(503, "evidence_unavailable");
  let ctx: CapabilityContext;
  try {
    const key = request.operationKey === undefined
      ? randomUUID()
      : operationKeySchema.parse(Array.isArray(request.operationKey) ? request.operationKey[0] : request.operationKey);
    ctx = { ...context, operationKey: `http:${key}` };
  } catch { return failure(400, "invalid_idempotency_key"); }

  const segments = request.path.split("/").filter(Boolean);
  const [resource, entityId, action] = [segments[2], segments[3], segments[4]];
  const method = request.method.toUpperCase();
  const query = Object.fromEntries(request.query);

  let capabilityName: string | undefined;
  let input: Record<string, unknown> = {};
  try {
    if (!resource) return failure(404, "not_found");
    if (!entityId) {
      const routes: Record<string, Record<string, string>> = {
        records: { GET: "get_learning_records", POST: "record_learning_evidence" },
        skills: { GET: "get_skill_evidence" },
        assessments: { POST: "evaluate_learning_evidence" },
        reviews: { GET: "get_learning_reviews", POST: "generate_learning_review" },
        interviews: { GET: "get_interview_records", POST: "start_interview" },
      };
      capabilityName = routes[resource]?.[method];
      if (!capabilityName) return failure(routes[resource] ? 405 : 404, routes[resource] ? "method_not_allowed" : "not_found");
      input = method === "GET" ? {
        ...query,
        ...(query.limit !== undefined ? { limit: numberParam(query.limit ?? null) } : {}),
        ...(query.kinds !== undefined ? { kinds: listParam(query.kinds ?? null) } : {}),
        ...(query.skillIds !== undefined ? { skillIds: listParam(query.skillIds ?? null) } : {}),
        ...(query.sources !== undefined ? { sources: listParam(query.sources ?? null) } : {}),
        ...(query.statuses !== undefined ? { statuses: listParam(query.statuses ?? null) } : {}),
      } : jsonObjectSchema.parse(await request.readJson());
    } else if (resource === "records" && method === "PATCH") {
      capabilityName = "update_learning_evidence";
      const version = request.ifMatch ?? request.query.get("expectedVersion");
      input = {
        ...jsonObjectSchema.parse(await request.readJson()),
        recordId: entityId,
        ...(version !== undefined
          ? { expectedVersion: Number(Array.isArray(version) ? version[0] : version) }
          : {}),
      };
    } else if (resource === "records" && method === "GET") {
      capabilityName = "get_learning_records";
      input = { mode: "detail", recordId: entityId };
    } else if (resource === "reviews" && method === "GET") {
      capabilityName = "get_learning_reviews";
      input = { mode: "detail", reviewId: entityId };
    } else if (resource === "interviews" && !action && method === "GET") {
      capabilityName = "get_interview_session";
      input = { interviewId: entityId };
    } else if (resource === "interviews" && action === "answers" && method === "POST") {
      capabilityName = "submit_interview_answer";
      input = { ...jsonObjectSchema.parse(await request.readJson()), interviewId: entityId };
    } else if (resource === "interviews" && action === "finish" && method === "POST") {
      capabilityName = "finish_interview";
      input = { ...jsonObjectSchema.parse(await request.readJson()), interviewId: entityId };
    } else if (resource === "interviews" && action === "feedback" && method === "GET") {
      capabilityName = "get_interview_feedback";
      input = { ...query, interviewId: entityId };
    }
    if (!capabilityName) return failure(404, "not_found");

    const capability = registry.forContext(ctx).find(item => item.name === capabilityName);
    if (!capability) return failure(503, "evidence_unavailable");
    const result = await capability.execute(ctx, input) as CapabilityResult<unknown>;
    if (result.ok) return { status: 200, body: result };
    return { status: errorStatuses[result.error?.code ?? ""] ?? 400, body: result };
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) return failure(400, "invalid_request");
    if (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
      return failure(error.status, "invalid_request");
    }
    if (error instanceof Error && error.message === "DUPLICATE_SOURCE_FACT") return failure(409, "duplicate_source_fact");
    return failure(502, "evidence_operation_failed");
  }
}
