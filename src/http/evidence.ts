import type { IncomingMessage, ServerResponse } from "node:http";
import type { CapabilityRegistry } from "../agent/tools/registry.ts";
import { handleEvidenceHttp } from "../modules/evidence/http.ts";
import type { ApplicationRoute } from "./routes.ts";

const MAX_BODY_BYTES = 1024 * 1024;
// 覆盖模块用到的写入方法，其余方法也交给 handleEvidenceHttp 判定，
// 这样“方法不支持”返回 405、路径不存在返回 404，不会因为没注册而变成 404。
const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;

/**
 * Evidence & Interview 接入主线统一的 ApplicationRoute 机制，与 Career 的
 * createCareerRoutes 保持同一种方式：模块自己负责路径到能力的映射与结果
 * 协议，主线只把路由表汇总起来。请求仍会经过 capability 的入参校验、身份
 * 校验与幂等语义，和主 Agent 调用的是同一套能力。
 */
export function createEvidenceRoutes(registry?: CapabilityRegistry): ApplicationRoute[] {
  const handle = async ({ request, response, context }: {
    request: IncomingMessage;
    response: ServerResponse;
    params: Record<string, string>;
    context: Parameters<ApplicationRoute["handle"]>[0]["context"];
  }) => {
    const result = await handleEvidenceHttp({
      method: request.method ?? "GET",
      path: (request.url ?? "/").split("?", 1)[0],
      query: new URL(request.url ?? "/", "http://localhost").searchParams,
      operationKey: request.headers["idempotency-key"],
      ifMatch: request.headers["if-match"],
      readJson: () => readJson(request),
    }, context, registry);
    send(response, result.status, result.body);
  };
  // ApplicationRoute 每个条目只声明一种方法，因此前缀相同的三种方法各占一条。
  return METHODS.map(method => ({ method, pattern: /^\/api\/evidence\//, handle }));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) throw requestError("请求体过大");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw requestError("请求体必须是 JSON 对象");
  return value as Record<string, unknown>;
}

/** handleEvidenceHttp 会把带 status 的错误映射成对应的 HTTP 状态码。 */
function requestError(message: string) {
  return Object.assign(new Error(message), { status: 400 });
}

function send(response: ServerResponse, status: number, body: unknown) {
  if (!response.headersSent) response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
