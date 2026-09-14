import type { ServerResponse } from "node:http";
import type { CapabilityRegistry } from "../agent/tools/registry.ts";
import type { ApplicationRoute } from "./routes.ts";

/**
 * 共享能力目录的只读入口，供模拟面试与学习记录页渲染能力下拉。
 * 复用主 Agent 的 list_skill_catalog 能力，不参与任何用户能力判断。
 */
export function createSkillRoutes(registry?: CapabilityRegistry): ApplicationRoute[] {
  return [{
    method: "GET",
    pattern: /^\/api\/skills$/,
    handle: async ({ request, response, context }) => {
      const capability = registry?.list().find(item => item.name === "list_skill_catalog");
      if (!capability) return send(response, 503, { ok: false, error: "skills_unavailable" });
      const query = new URL(request.url ?? "/", "http://localhost").searchParams;
      const input: Record<string, unknown> = {};
      if (query.has("keyword")) input.keyword = query.get("keyword") ?? undefined;
      if (query.has("limit")) input.limit = Number(query.get("limit"));
      try {
        const result = await capability.execute(context, input);
        return send(response, result.ok ? 200 : 400, result);
      } catch { return send(response, 400, { ok: false, error: "invalid_request" }); }
    },
  }];
}

function send(response: ServerResponse, status: number, body: unknown) {
  if (!response.headersSent) response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
