import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { createPool, ensureSchema } from "./db/postgres.ts";
import { PostgresChatStore } from "./modules/chat/postgres-repository.ts";
import { ChatService } from "./modules/chat/service.ts";
import { chatRequestSchema, ChatError } from "./modules/chat/contracts.ts";
import { PiChatRuntime } from "./agent/runtime/pi-chat-runtime.ts";

type Options = { chatService?: ChatService; readiness?: () => Promise<void>; routeService?: unknown };
const owners = new Map<string, string>();
export function createPowuServer(options: Options = {}): Server {
  return createServer(async (req, res) => {
    const path = (req.url ?? "/").split("?", 1)[0];
    if (path === "/healthz") return send(res, 200, { ok: true });
    if (path === "/readyz") { try { await options.readiness?.(); return send(res, 200, { ok: true }); } catch { return send(res, 503, { ok: false }); } }
    if (path === "/" && req.method === "GET") return serve(res, "../public/index.html", "text/html; charset=utf-8");
    if (path.startsWith("/assets/") && req.method === "GET") { const name = path.slice(8); if (!name || name.includes("..") || name.includes("\\")) return send(res, 404, { error: "not_found" }); const types: Record<string,string> = { ".js":"text/javascript; charset=utf-8", ".gif":"image/gif", ".jpg":"image/jpeg", ".png":"image/png" }; return serve(res, `../public/assets/${name}`, types[name.slice(name.lastIndexOf(".")).toLowerCase()] ?? "application/octet-stream"); }
    if (path === "/api/routes" || path.startsWith("/api/routes/")) return send(res, 410, { ok: false, error: "route_api_retired", message: "请使用 /api/chat" });
    if (path === "/api/chat" && req.method === "POST") return chat(req, res);
    const session = path.match(/^\/api\/sessions\/([0-9a-f-]+)$/i)?.[1];
    if (session && req.method === "GET") { if (!options.chatService) return send(res, 503, { error: "chat_unavailable" }); const runs = await options.chatService.get(ownerId(req, res), session); return send(res, runs ? 200 : 404, runs ?? { error: "not_found" }); }
    return send(res, 404, { ok: false, error: "not_found" });

    async function chat(request: IncomingMessage, response: ServerResponse) {
      if (!options.chatService) return send(response, 503, { error: "chat_unavailable" });
      try {
        const input = chatRequestSchema.parse(await readBody(request)); const owner = ownerId(request, response); const controller = new AbortController(); const cancel = () => controller.abort(); request.once("aborted", cancel); response.once("close", cancel);
        response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
        await options.chatService.chat(owner, input, controller.signal, async event => { if (!response.destroyed && !response.writableEnded) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); }); response.end(); request.removeListener("aborted", cancel); response.removeListener("close", cancel);
      } catch (error) { if (response.headersSent) { if (!response.writableEnded) { response.write(`event: error\ndata: ${JSON.stringify({ type: "error", error: error instanceof ChatError ? error.message : "chat_failed" })}\n\n`); response.end(); } return; } if (error instanceof ZodError || error instanceof SyntaxError || error instanceof ChatError) return send(response, error instanceof ChatError ? error.status : 400, { ok: false, error: error instanceof ChatError ? error.message : "invalid_request" }); console.error("chat failed", error); return send(response, 502, { ok: false, error: "chat_failed" }); }
    }
  });
}
function ownerId(req: IncomingMessage, res: ServerResponse) {
  const token = req.headers.cookie?.match(/(?:^|; )(?:__Host-)?powu_owner=([^;]+)/)?.[1];
  if (token && owners.has(token)) return owners.get(token)!;
  const key = randomBytes(32).toString("base64url");
  const owner = randomBytes(24).toString("base64url");
  owners.set(key, owner);
  const secure = process.env.COOKIE_SECURE === "true" || (process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false");
  const name = secure ? "__Host-powu_owner" : "powu_owner";
  res.setHeader("set-cookie", `${name}=${key}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure ? "; Secure" : ""}`);
  return owner;
}
async function serve(res: ServerResponse, relative: string, type: string) { try { res.writeHead(200, { "content-type": type }); res.end(await readFile(new URL(relative, import.meta.url))); } catch { send(res, 404, { error: "not_found" }); } }
function send(res: ServerResponse, status: number, body: unknown) { if (!res.headersSent) res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); }
async function readBody(req: IncomingMessage) { const chunks: Buffer[] = []; let size = 0; for await (const c of req) { const b = Buffer.from(c); size += b.length; if (size > 128 * 1024) throw new ChatError("body_too_large", 413); chunks.push(b); } if (!chunks.length) throw new ChatError("body_required", 400); return JSON.parse(Buffer.concat(chunks).toString()); }
export async function startPowuServer(): Promise<Server> { const pool = createPool(); await ensureSchema(pool); const service = new ChatService(new PostgresChatStore(pool), new PiChatRuntime()); const server = createPowuServer({ chatService: service, readiness: async () => { await pool.query("SELECT 1"); } }); server.once("close", () => void pool.end()); await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? "0.0.0.0", () => { server.removeListener("error", reject); resolve(); }); }); return server; }
if (process.argv[1] === fileURLToPath(import.meta.url)) startPowuServer().catch(error => { console.error(error); process.exitCode = 1; });
