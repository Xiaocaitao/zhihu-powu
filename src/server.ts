import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { createPool, ensureSchema } from "./db/postgres.ts";
import { PostgresChatStore } from "./modules/chat/postgres-repository.ts";
import { ChatService } from "./modules/chat/service.ts";
import { chatRequestSchema, ChatError } from "./modules/chat/contracts.ts";
import { PiChatRuntime } from "./agent/runtime/pi-chat-runtime.ts";
import { createZhihuOAuth, type ZhihuOAuthProfile, type ZhihuOAuthProvider } from "./integrations/zhihu/oauth.ts";
import { matchApplicationRoute, type ApplicationRoute } from "./http/routes.ts";
import type { CapabilityRegistry } from "./agent/tools/registry.ts";
import type { PromptContext } from "./agent/prompts/system.ts";
import { PostgresKnowledgeStore } from "./modules/knowledge/postgres-repository.ts";
import type { KnowledgeStore, KnowledgeUpload } from "./modules/knowledge/contracts.ts";

type Options = { chatService?: ChatService; knowledgeStore?: KnowledgeStore; readiness?: () => Promise<void>; applicationRoutes?: ApplicationRoute[]; oauth?: ZhihuOAuthProvider; capabilityRegistry?: CapabilityRegistry; promptContext?: PromptContext };
const owners = new Map<string, string>();
type OAuthSession = { state?: string; stateVerified?: boolean; accessToken?: string; expiresAt?: number; profile?: ZhihuOAuthProfile; error?: { code: string; message: string } };
const oauthSessions = new Map<string, OAuthSession>();
export function createPowuServer(options: Options = {}): Server {
  const oauth = options.oauth ?? createZhihuOAuth();
  return createServer(async (req, res) => {
    const path = (req.url ?? "/").split("?", 1)[0];
    if (path === "/healthz") return send(res, 200, { ok: true });
    if (path === "/readyz") { try { await options.readiness?.(); return send(res, 200, { ok: true }); } catch { return send(res, 503, { ok: false }); } }
    if (path === "/" && req.method === "GET") return serve(res, "../public/index.html", "text/html; charset=utf-8");
    if (path === "/learning-plan.html" && req.method === "GET") return serve(res, "../public/learning-plan.html", "text/html; charset=utf-8");
    if (path.startsWith("/assets/") && req.method === "GET") { const name = path.slice(8); if (!name || name.includes("..") || name.includes("\\")) return send(res, 404, { error: "not_found" }); const types: Record<string,string> = { ".js":"text/javascript; charset=utf-8", ".gif":"image/gif", ".jpg":"image/jpeg", ".png":"image/png" }; return serve(res, `../public/assets/${name}`, types[name.slice(name.lastIndexOf(".")).toLowerCase()] ?? "application/octet-stream"); }
    if (path === "/api/auth/zhihu/status" && req.method === "GET") {
      const session = oauthSession(req, res);
      const authorized = Boolean(session.accessToken && session.expiresAt && session.expiresAt > Date.now() && session.profile);
      return send(res, 200, { ok: true, authorized, profile: authorized ? session.profile : null, uid: authorized ? session.profile?.uid : null, state_verified: session.stateVerified ?? null, error: session.error ?? null });
    }
    if (path === "/auth/zhihu/start" && req.method === "GET") {
      const session = oauthSession(req, res);
      try {
        const state = randomBytes(24).toString("base64url");
        session.state = state;
        session.stateVerified = undefined;
        session.error = undefined;
        return redirect(res, oauth.authorizationUrl(state), res.getHeader("set-cookie"));
      } catch (error) {
        session.error = oauthError(error);
        return redirect(res, "/?oauth=error", res.getHeader("set-cookie"));
      }
    }
    if (path === "/auth/zhihu/callback" && req.method === "GET") {
      const session = oauthSession(req, res);
      const query = new URL(req.url ?? "/", "http://localhost").searchParams;
      const code = query.get("authorization_code") ?? query.get("code") ?? "";
      const returnedState = query.get("state");
      try {
        if (session.state && returnedState && !sameSecret(session.state, returnedState)) throw new Error("OAuth state 校验失败，请重新登录。 ");
        session.stateVerified = Boolean(session.state && returnedState);
        const token = await oauth.exchangeCode(code);
        const profile = await oauth.getUserInfo(token.accessToken);
        session.accessToken = token.accessToken;
        session.expiresAt = token.expiresAt;
        session.profile = profile;
        session.state = undefined;
        session.error = undefined;
        return redirect(res, "/?oauth=success", res.getHeader("set-cookie"));
      } catch (error) {
        session.accessToken = undefined;
        session.expiresAt = undefined;
        session.profile = undefined;
        session.state = undefined;
        session.error = oauthError(error);
        return redirect(res, "/?oauth=error", res.getHeader("set-cookie"));
      }
    }
    if (path === "/api/auth/zhihu/logout" && req.method === "POST") {
      const session = oauthSession(req, res);
      session.accessToken = undefined; session.expiresAt = undefined; session.profile = undefined; session.state = undefined; session.stateVerified = undefined; session.error = undefined;
      return send(res, 200, { ok: true });
    }
    if (path === "/api/knowledge/files" && req.method === "GET") {
      if (!options.knowledgeStore) return send(res, 503, { error: "knowledge_unavailable" });
      try { return send(res, 200, { files: await options.knowledgeStore.list(authenticatedOwner(req, res)) }); }
      catch (error) { console.error("knowledge listing failed", error); return send(res, 502, { error: "knowledge_list_failed" }); }
    }
    if (path === "/api/knowledge/files" && req.method === "POST") {
      if (!options.knowledgeStore) return send(res, 503, { error: "knowledge_unavailable" });
      try {
        const payload = await readMultipart(req);
        if (!payload.files.length) throw new ChatError("file_required", 400);
        const files = await Promise.all(payload.files.map(file => options.knowledgeStore!.save(authenticatedOwner(req, res), file)));
        return send(res, 201, { files });
      } catch (error) { return send(res, error instanceof ChatError ? error.status : 400, { ok: false, error: error instanceof ChatError ? error.message : "invalid_upload" }); }
    }
    const knowledgeFile = path.match(/^\/api\/knowledge\/files\/([0-9a-f-]+)$/i)?.[1];
    if (knowledgeFile && req.method === "GET") {
      if (!options.knowledgeStore) return send(res, 503, { error: "knowledge_unavailable" });
      const file = await options.knowledgeStore.get(authenticatedOwner(req, res), knowledgeFile);
      if (!file) return send(res, 404, { error: "not_found" });
      try {
        const info = await stat(file.path);
        const requestedDownload = new URL(req.url ?? "/", "http://localhost").searchParams.has("download");
        const previewable = /^(image\/|text\/(plain|markdown)$|application\/(pdf|json)$)/i.test(file.mime_type);
        const disposition = requestedDownload || !previewable ? "attachment" : "inline";
        res.writeHead(200, { "content-type": file.mime_type, "content-length": info.size, "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.original_name)}`, "x-content-type-options": "nosniff" });
        createReadStream(file.path).pipe(res);
      } catch { return send(res, 404, { error: "file_missing" }); }
      return;
    }
    if (path === "/api/routes" || path.startsWith("/api/routes/")) return send(res, 410, { ok: false, error: "route_api_retired", message: "请使用 /api/chat" });
    if (path === "/api/chat" && req.method === "POST") return chat(req, res);
    if (path === "/api/sessions" && req.method === "POST") {
      if (!options.chatService) return send(res, 503, { error: "chat_unavailable" });
      try { const created = await options.chatService.createSession(authenticatedOwner(req, res)); return send(res, 201, { session_id: created.sessionId, created_at: created.createdAt }); }
      catch (error) { console.error("session creation failed", error); return send(res, 502, { ok: false, error: "session_create_failed" }); }
    }
    if (path === "/api/sessions" && req.method === "GET") {
      if (!options.chatService) return send(res, 503, { error: "chat_unavailable" });
      try { return send(res, 200, { sessions: await options.chatService.listSessions(authenticatedOwner(req, res)) }); }
      catch (error) { console.error("session listing failed", error); return send(res, 502, { ok: false, error: "session_list_failed" }); }
    }
    const session = path.match(/^\/api\/sessions\/([0-9a-f-]+)$/i)?.[1];
    if (session && req.method === "GET") { if (!options.chatService) return send(res, 503, { error: "chat_unavailable" }); const runs = await options.chatService.get(authenticatedOwner(req, res), session); return send(res, runs ? 200 : 404, runs ?? { error: "not_found" }); }
    const applicationRoute = matchApplicationRoute(options.applicationRoutes ?? [], req.method ?? "GET", path);
    if (applicationRoute) {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      req.once("aborted", cancel); res.once("close", cancel);
      try {
        await applicationRoute.route.handle({
          request: req,
          response: res,
          params: applicationRoute.params,
          context: { ownerId: authenticatedOwner(req, res), requestId: randomUUID(), operationKey: randomUUID(), signal: controller.signal },
        });
      } catch (error) {
        if (!res.headersSent) send(res, 500, { ok: false, error: "application_route_failed" });
        else if (!res.writableEnded) res.end();
      } finally {
        req.removeListener("aborted", cancel); res.removeListener("close", cancel);
      }
      return;
    }
    return send(res, 404, { ok: false, error: "not_found" });

    async function chat(request: IncomingMessage, response: ServerResponse) {
      if (!options.chatService) return send(response, 503, { error: "chat_unavailable" });
      try {
        const payload = await readRequestPayload(request); const owner = authenticatedOwner(request, response);
        if (payload.files.length && !options.knowledgeStore) throw new ChatError("knowledge_unavailable", 503);
        const attachments = options.knowledgeStore && payload.files.length ? await Promise.all(payload.files.map(file => options.knowledgeStore!.save(owner, file))) : [];
        const input = chatRequestSchema.parse({ ...payload.fields, attachments: attachments.length ? attachments : undefined }); const controller = new AbortController(); const cancel = () => controller.abort(); request.once("aborted", cancel); response.once("close", cancel);
        response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
        if (attachments.length && !response.destroyed) response.write(`event: attachments\ndata: ${JSON.stringify({ type: "attachments", attachments })}\n\n`);
        await options.chatService.chat(owner, input, controller.signal, async event => { if (!response.destroyed && !response.writableEnded) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); }); response.end(); request.removeListener("aborted", cancel); response.removeListener("close", cancel);
      } catch (error) { if (response.headersSent) { if (!response.writableEnded) { response.write(`event: error\ndata: ${JSON.stringify({ type: "error", error: error instanceof ChatError ? error.message : "chat_failed" })}\n\n`); response.end(); } return; } if (error instanceof ZodError || error instanceof SyntaxError || error instanceof ChatError) return send(response, error instanceof ChatError ? error.status : 400, { ok: false, error: error instanceof ChatError ? error.message : "invalid_request" }); console.error("chat failed", error); return send(response, 502, { ok: false, error: "chat_failed" }); }
    }
  });
}
function oauthSession(req: IncomingMessage, res: ServerResponse) {
  const owner = cookieOwner(req, res);
  let session = oauthSessions.get(owner);
  if (!session) { session = {}; oauthSessions.set(owner, session); }
  return session;
}
function authenticatedOwner(req: IncomingMessage, res: ServerResponse) {
  const anonymousOwner = cookieOwner(req, res);
  const session = oauthSessions.get(anonymousOwner);
  if (session?.accessToken && session.expiresAt && session.expiresAt > Date.now() && session.profile?.uid) return `zhihu:${session.profile.uid}`;
  return anonymousOwner;
}
function sameSecret(a: string, b: string) { return a.length === b.length && Buffer.from(a).equals(Buffer.from(b)); }
function oauthError(error: unknown) { return { code: error instanceof Error && "code" in error ? String((error as { code?: unknown }).code) : "OAUTH_FAILED", message: error instanceof Error ? error.message : "知乎 OAuth 登录失败，请重试。" }; }
function redirect(res: ServerResponse, location: string, cookie: string | string[] | number | undefined) { const headers: Record<string, string | string[]> = { location }; if (typeof cookie === "string" || Array.isArray(cookie)) headers["set-cookie"] = cookie; res.writeHead(302, headers); res.end(); }
function cookieOwner(req: IncomingMessage, res: ServerResponse) {
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
async function readRequestPayload(req: IncomingMessage): Promise<{ fields: Record<string, string>; files: KnowledgeUpload[] }> {
  if (!(req.headers["content-type"] ?? "").startsWith("multipart/form-data")) return { fields: (await readBody(req)) as Record<string, string>, files: [] };
  return readMultipart(req);
}
async function readBody(req: IncomingMessage) { const chunks: Buffer[] = []; let size = 0; for await (const c of req) { const b = Buffer.from(c); size += b.length; if (size > 128 * 1024) throw new ChatError("body_too_large", 413); chunks.push(b); } if (!chunks.length) throw new ChatError("body_required", 400); return JSON.parse(Buffer.concat(chunks).toString()); }
async function readMultipart(req: IncomingMessage): Promise<{ fields: Record<string, string>; files: KnowledgeUpload[] }> {
  const type = req.headers["content-type"] ?? ""; const match = type.match(/boundary=(?:"([^"]+)"|([^;]+))/i); const boundary = match?.[1] ?? match?.[2];
  if (!boundary) throw new ChatError("multipart_boundary_required", 400);
  const chunks: Buffer[] = []; let size = 0; const configuredMax = Number(process.env.UPLOAD_MAX_BYTES); const max = Number.isSafeInteger(configuredMax) && configuredMax > 0 ? configuredMax : 20 * 1024 * 1024;
  for await (const c of req) { const b = Buffer.from(c); size += b.length; if (size > max) throw new ChatError("body_too_large", 413); chunks.push(b); }
  const raw = Buffer.concat(chunks), delimiter = Buffer.from(`--${boundary}`), fields: Record<string, string> = {}, files: KnowledgeUpload[] = [];
  let start = raw.indexOf(delimiter);
  while (start >= 0) {
    const next = raw.indexOf(delimiter, start + delimiter.length); if (next < 0) break;
    const section = raw.subarray(start + delimiter.length + 2, next - 2); const headerEnd = section.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd > 0) {
      const headers = section.subarray(0, headerEnd).toString(); const data = section.subarray(headerEnd + 4); const disposition = headers.match(/content-disposition: form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
      if (disposition) { const filename = disposition[2]; if (filename !== undefined) files.push({ filename, contentType: headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() ?? "application/octet-stream", data: Buffer.from(data) }); else fields[disposition[1]] = data.toString(); }
    }
    start = next;
  }
  if (!Object.keys(fields).length && !files.length) throw new ChatError("body_required", 400);
  return { fields, files };
}
export async function startPowuServer(options: Options = {}): Promise<Server> { const pool = createPool(); await ensureSchema(pool); const service = options.chatService ?? new ChatService(new PostgresChatStore(pool), new PiChatRuntime({ capabilityRegistry: options.capabilityRegistry, promptContext: options.promptContext })); const server = createPowuServer({ ...options, chatService: service, knowledgeStore: options.knowledgeStore ?? new PostgresKnowledgeStore(pool), readiness: options.readiness ?? (async () => { await pool.query("SELECT 1"); }) }); server.once("close", () => void pool.end()); await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? "0.0.0.0", () => { server.removeListener("error", reject); resolve(); }); }); return server; }
if (process.argv[1] === fileURLToPath(import.meta.url)) startPowuServer().catch(error => { console.error(error); process.exitCode = 1; });
