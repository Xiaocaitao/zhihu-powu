import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { createPowuServer, resetOAuthSessionsForTests } from "../src/server.ts";
import { ChatService } from "../src/modules/chat/service.ts";
import type { ChatStore, ChatRuntime } from "../src/modules/chat/contracts.ts";
import type { KnowledgeStore } from "../src/modules/knowledge/contracts.ts";
import { createDefaultCapabilityRegistry } from "../src/app/composition-root.ts";

test("chat endpoint forwards raw input and streams text events", async t => {
  const store: ChatStore = { async create() { return { sessionId: "00000000-0000-4000-8000-000000000001", createdAt: new Date().toISOString() }; }, async list() { return []; }, async begin(_owner, input) { return { sessionId: input.session_id ?? "00000000-0000-4000-8000-000000000001", history: [], finish: async () => {}, release: async () => {} }; }, async get() { return []; } };
  const runtime: ChatRuntime = { async run(input, emit) { await emit({ type: "text_delta", delta: `收到：${input.message}` }); return []; } };
  const server = createPowuServer({ chatService: new ChatService(store, runtime) }); t.after(() => server.close()); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "你好", request_id: "00000000-0000-4000-8000-000000000002" }) });
  assert.equal(response.status, 200); const text = await response.text(); assert.match(text, /收到：你好/); assert.match(text, /event: complete/);
  const retired = await fetch(`http://127.0.0.1:${address.port}/api/routes`, { method: "POST", body: "{}" }); assert.equal(retired.status, 410);
});

test("画像读取接口返回 Profile Tool 的真实数据和完善度", async t => {
  const server = createPowuServer({ chatService: new ChatService({ create: async () => ({ sessionId: "00000000-0000-4000-8000-000000000001", createdAt: new Date().toISOString() }), list: async () => [], begin: async () => { throw new Error("unused"); }, get: async () => null }, { run: async () => [] }), capabilityRegistry: createDefaultCapabilityRegistry() }); t.after(() => server.close()); server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/growth/profile`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.profile, null);
  assert.equal(body.completion.percentage, 0);
});

test("career growth endpoint returns saved jobs without selecting one", async t => {
  const registry = createDefaultCapabilityRegistry();
  const save = registry.list().find(capability => capability.name === "save_target_job");
  assert.ok(save);
  const token = "test-career-owner";
  const owner = `anonymous:${createHash("sha256").update(token).digest("hex")}`;
  const saved = await save.execute({ ownerId: owner, requestId: "career-read-test", operationKey: "career-save-test" }, { title: "后端平台工程师", directionCode: "backend", description: "负责 TypeScript 和 PostgreSQL 平台服务开发，维护 REST API。" });
  assert.equal(saved.ok, true);
  const server = createPowuServer({ capabilityRegistry: registry }); t.after(() => server.close()); server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  const cookie = `powu_owner=${token}`;
  const response = await fetch(`http://127.0.0.1:${address.port}/api/growth/career`, { headers: { cookie } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.jobs.length, 1);
  assert.equal(body.jobs[0].title, "后端平台工程师");
  assert.equal(body.plan, null);
});

test("learning growth endpoint returns saved draft plan and today's tasks", async t => {
  const registry = createDefaultCapabilityRegistry();
  const create = registry.list().find(capability => capability.name === "create_learning_plan");
  assert.ok(create);
  const token = "test-learning-owner";
  const owner = `anonymous:${createHash("sha256").update(token).digest("hex")}`;
  const saved = await create.execute({ ownerId: owner, requestId: "learning-read-test", operationKey: "learning-save-test" }, { mode: "trial", sourceProfileVersion: 1, startDate: "2026-09-14", endDate: "2026-10-12", weeklyMinutes: 360, learningGoals: ["后端平台工程"], stages: [{ title: "TypeScript 基础", objective: "掌握类型系统", tasks: [{ title: "完成类型练习", description: "完成一组 TypeScript 类型练习", taskType: "practice", estimatedMinutes: 60 }] }] });
  assert.equal(saved.ok, true);
  const server = createPowuServer({ capabilityRegistry: registry }); t.after(() => server.close()); server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/growth/learning`, { headers: { cookie: `powu_owner=${token}` } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.plan.status, "draft");
  assert.equal(body.plan.stages[0].title, "TypeScript 基础");
  assert.equal(body.tasks.length, 1);
});

test("interview growth endpoint returns ended interview history", async t => {
  const registry = createDefaultCapabilityRegistry();
  const start = registry.list().find(capability => capability.name === "start_interview");
  const finish = registry.list().find(capability => capability.name === "finish_interview");
  assert.ok(start && finish);
  const token = "test-interview-owner";
  const owner = `anonymous:${createHash("sha256").update(token).digest("hex")}`;
  const started = await start.execute({ ownerId: owner, requestId: "interview-start-test", operationKey: "interview-start-test" }, { target: { kind: "skills", skillIds: ["skill-typescript"] }, questionCount: 2 });
  assert.equal(started.ok, true);
  const interviewId = (started.data as { interview?: { interviewId: string } }).interview?.interviewId;
  assert.ok(interviewId);
  await finish.execute({ ownerId: owner, requestId: "interview-finish-test", operationKey: "interview-finish-test" }, { interviewId });
  const server = createPowuServer({ capabilityRegistry: registry }); t.after(() => server.close()); server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/growth/interviews`, { headers: { cookie: `powu_owner=${token}` } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].status, "ended_early");
});

test("interview history reflects a submitted answer", async () => {
  const registry = createDefaultCapabilityRegistry();
  const start = registry.list().find(capability => capability.name === "start_interview");
  const submit = registry.list().find(capability => capability.name === "submit_interview_answer");
  const records = registry.list().find(capability => capability.name === "get_interview_records");
  assert.ok(start && submit && records);
  const owner = "interview-answer-history-owner";
  const context = { ownerId: owner, requestId: "interview-answer-history", operationKey: "interview-answer-history" };
  const started = await start.execute(context, { target: { kind: "skills", skillIds: ["skill-typescript"] }, questionCount: 2 });
  assert.equal(started.ok, true);
  const interview = (started.data as { interview: { interviewId: string; questions: Array<{ questionId: string }> } }).interview;
  const answered = await submit.execute({ ...context, requestId: "interview-answer-history-submit", operationKey: "interview-answer-history-submit" }, { interviewId: interview.interviewId, questionId: interview.questions[0].questionId, answer: "我完成过一次 TypeScript 服务重构。" });
  assert.equal(answered.ok, true);
  const listed = await records.execute({ ...context, requestId: "interview-answer-history-read", operationKey: "interview-answer-history-read" }, {});
  const page = (listed.data as { page: { items: Array<{ answeredCount: number }> } }).page;
  assert.equal(page.items[0].answeredCount, 1);
});

test("chat request rejects missing protocol fields", async t => {
  const server = createPowuServer({ chatService: new ChatService({ create: async () => ({ sessionId: "00000000-0000-4000-8000-000000000001", createdAt: new Date().toISOString() }), list: async () => [], begin: async () => { throw new Error("unused"); }, get: async () => null }, { run: async () => [] }) }); t.after(() => server.close()); server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/chat`, { method: "POST", body: JSON.stringify({ message: "hi" }) }); assert.equal(response.status, 400);
});

test("session endpoints isolate sessions by owner cookie", async t => {
  const owners = new Map<string, Array<{ session_id: string; created_at: string; message_count: number; preview: string | null }>>();
  const store: ChatStore = {
    async create(owner) { const session = { session_id: "00000000-0000-4000-8000-000000000010", created_at: new Date().toISOString(), message_count: 0, preview: null }; owners.set(owner, [session]); return { sessionId: session.session_id, createdAt: session.created_at }; },
    async list(owner) { return owners.get(owner) ?? []; },
    async begin() { throw new Error("unused"); },
    async get(owner, sessionId) { return owners.get(owner)?.some(session => session.session_id === sessionId) ? [] : null; },
  };
  const server = createPowuServer({ chatService: new ChatService(store, { run: async () => [] }) }); t.after(() => server.close()); server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  const created = await fetch(`http://127.0.0.1:${address.port}/api/sessions`, { method: "POST" }); assert.equal(created.status, 201); const cookie = created.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie);
  const listed = await fetch(`http://127.0.0.1:${address.port}/api/sessions`, { headers: { cookie } }); assert.equal(listed.status, 200); assert.equal((await listed.json()).sessions.length, 1);
  const hidden = await fetch(`http://127.0.0.1:${address.port}/api/sessions/00000000-0000-4000-8000-000000000010`); assert.equal(hidden.status, 404);
});

test("anonymous cookie keeps the same owner after a server restart", async t => {
  const sessions = new Map<string, Array<{ session_id: string; created_at: string; message_count: number; preview: string | null }>>();
  const store: ChatStore = {
    async create(owner) { const session = { session_id: "00000000-0000-4000-8000-000000000011", created_at: new Date().toISOString(), message_count: 0, preview: null }; sessions.set(owner, [session]); return { sessionId: session.session_id, createdAt: session.created_at }; },
    async list(owner) { return sessions.get(owner) ?? []; },
    async begin() { throw new Error("unused"); },
    async get() { return null; },
  };
  const open = async () => { const server = createPowuServer({ chatService: new ChatService(store, { run: async () => [] }) }); server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string"); return { server, base: `http://127.0.0.1:${address.port}` }; };
  const first = await open(); const created = await fetch(`${first.base}/api/sessions`, { method: "POST" }); const cookie = created.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie); await new Promise<void>(resolve => first.server.close(() => resolve()));
  const second = await open(); t.after(() => second.server.close()); const listed = await fetch(`${second.base}/api/sessions`, { headers: { cookie } }); assert.equal((await listed.json()).sessions.length, 1);
});

test("authenticated sessions use the Zhihu uid instead of the anonymous cookie owner", async t => {
  const sessions = new Map<string, Array<{ session_id: string; created_at: string; message_count: number; preview: string | null }>>();
  let nextId = 20;
  const store: ChatStore = {
    async create(owner) { const id = `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`; const session = { session_id: id, created_at: new Date().toISOString(), message_count: 0, preview: null }; sessions.set(owner, [...(sessions.get(owner) ?? []), session]); return { sessionId: id, createdAt: session.created_at }; },
    async list(owner) { return sessions.get(owner) ?? []; },
    async begin() { throw new Error("unused"); },
    async get(owner, sessionId) { return sessions.get(owner)?.some(session => session.session_id === sessionId) ? [] : null; },
  };
  const oauth = {
    authorizationUrl: (state: string) => `https://example.test/authorize?state=${encodeURIComponent(state)}`,
    exchangeCode: async (code: string) => ({ accessToken: `token-${code}`, expiresAt: Date.now() + 60_000 }),
    getUserInfo: async (token: string) => ({ uid: token.slice("token-".length), fullname: token.slice("token-".length) }),
  };
  const server = createPowuServer({ chatService: new ChatService(store, { run: async () => [] }), oauth }); t.after(() => server.close()); server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
  async function login(code: string) { const start = await fetch(`${base}/auth/zhihu/start`, { redirect: "manual" }); const cookie = start.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie); const callback = await fetch(`${base}/auth/zhihu/callback?authorization_code=${code}`, { headers: { cookie }, redirect: "manual" }); assert.equal(callback.status, 302); return cookie; }
  const aliceCookie = await login("alice"); const created = await fetch(`${base}/api/sessions`, { method: "POST", headers: { cookie: aliceCookie } }); assert.equal(created.status, 201); const aliceSessionId = (await created.json()).session_id;
  const secondAliceSession = await fetch(`${base}/api/sessions`, { method: "POST", headers: { cookie: aliceCookie } }); assert.equal(secondAliceSession.status, 201);
  const bobCookie = await login("bob"); const bobList = await fetch(`${base}/api/sessions`, { headers: { cookie: bobCookie } }); assert.deepEqual((await bobList.json()).sessions, []);
  const bobHidden = await fetch(`${base}/api/sessions/${aliceSessionId}`, { headers: { cookie: bobCookie } }); assert.equal(bobHidden.status, 404);
  const aliceAgain = await login("alice"); const aliceList = await fetch(`${base}/api/sessions`, { headers: { cookie: aliceAgain } }); assert.equal((await aliceList.json()).sessions.length, 2);
});

test("signed OAuth cookie keeps the authenticated owner after a server restart", async t => {
  const sessions = new Map<string, Array<{ session_id: string; created_at: string; message_count: number; preview: string | null }>>();
  const store: ChatStore = {
    async create(owner) { const session = { session_id: "00000000-0000-4000-8000-000000000012", created_at: new Date().toISOString(), message_count: 0, preview: null }; sessions.set(owner, [ ...(sessions.get(owner) ?? []), session ]); return { sessionId: session.session_id, createdAt: session.created_at }; },
    async list(owner) { return sessions.get(owner) ?? []; },
    async begin() { throw new Error("unused"); },
    async get() { return null; },
  };
  const oauth = {
    authorizationUrl: (state: string) => `https://example.test/authorize?state=${encodeURIComponent(state)}`,
    exchangeCode: async (code: string) => ({ accessToken: `token-${code}`, expiresAt: Date.now() + 60_000 }),
    getUserInfo: async (token: string) => ({ uid: token.slice("token-".length), fullname: "Alice" }),
  };
  const open = async () => { const server = createPowuServer({ chatService: new ChatService(store, { run: async () => [] }), oauth }); server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string"); return { server, base: `http://127.0.0.1:${address.port}` }; };
  const first = await open();
  const start = await fetch(`${first.base}/auth/zhihu/start`, { redirect: "manual" });
  const ownerCookie = start.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(ownerCookie);
  const callback = await fetch(`${first.base}/auth/zhihu/callback?authorization_code=alice`, { headers: { cookie: ownerCookie }, redirect: "manual" });
  const callbackCookies = callback.headers.get("set-cookie")?.split(/,\s*(?=[^;]+=)/).map(value => value.split(";", 1)[0]) ?? [];
  const cookie = [...new Set([ownerCookie, ...callbackCookies])].join("; ");
  const created = await fetch(`${first.base}/api/sessions`, { method: "POST", headers: { cookie } }); assert.equal(created.status, 201);
  await new Promise<void>(resolve => first.server.close(() => resolve()));
  resetOAuthSessionsForTests();
  const second = await open(); t.after(() => second.server.close());
  const listed = await fetch(`${second.base}/api/sessions`, { headers: { cookie } });
  assert.equal((await listed.json()).sessions.length, 1);
});

test("knowledge files support multipart upload, owner isolation and inline preview", async t => {
  const directory = await mkdtemp(join(tmpdir(), "powu-knowledge-preview-"));
  const previewPath = join(directory, "notes.txt");
  await writeFile(previewPath, "hello", "utf8");
  t.after(async () => {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep) && directory.includes("powu-knowledge-preview-"));
    await rm(directory, { recursive: true, force: true });
  });
  const saved = new Map<string, { id: string; original_name: string; mime_type: string; size_bytes: number; url: string; created_at: string }[]>();
  const store: KnowledgeStore = {
    async save(owner, upload) { const file = { id: "00000000-0000-4000-8000-000000000099", original_name: upload.filename, mime_type: upload.contentType, size_bytes: upload.data.byteLength, url: "/api/knowledge/files/00000000-0000-4000-8000-000000000099", created_at: new Date().toISOString() }; saved.set(owner, [...(saved.get(owner) ?? []), file]); return file; },
    async list(owner) { return saved.get(owner) ?? []; },
    async get(owner, id) { const file = saved.get(owner)?.find(item => item.id === id); return file ? { ...file, path: previewPath } : null; },
  };
  const server = createPowuServer({ knowledgeStore: store }); t.after(() => server.close()); server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  const body = new FormData(); body.append("file", new Blob(["hello"], { type: "text/plain" }), "notes.txt");
  const uploaded = await fetch(`http://127.0.0.1:${address.port}/api/knowledge/files`, { method: "POST", body }); assert.equal(uploaded.status, 201);
  const cookie = uploaded.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie);
  const listed = await fetch(`http://127.0.0.1:${address.port}/api/knowledge/files`, { headers: { cookie } }); assert.equal((await listed.json()).files.length, 1);
  const preview = await fetch(`http://127.0.0.1:${address.port}/api/knowledge/files/00000000-0000-4000-8000-000000000099`, { headers: { cookie } }); assert.equal(preview.status, 200); assert.equal(preview.headers.get("x-content-type-options"), "nosniff"); assert.equal(await preview.text(), "hello");
  const hidden = await fetch(`http://127.0.0.1:${address.port}/api/knowledge/files/00000000-0000-4000-8000-000000000099`); assert.equal(hidden.status, 404);
});

test("chat multipart attachments are saved before the Agent run", async t => {
  const seen: string[] = [];
  const store: KnowledgeStore = {
    async save(_owner, upload) { seen.push(upload.filename); return { id: "00000000-0000-4000-8000-000000000098", original_name: upload.filename, mime_type: upload.contentType, size_bytes: upload.data.byteLength, url: "/api/knowledge/files/00000000-0000-4000-8000-000000000098", created_at: new Date().toISOString() }; },
    async list() { return []; }, async get() { return null; },
  };
  const chatStore: ChatStore = { async create() { return { sessionId: "00000000-0000-4000-8000-000000000001", createdAt: new Date().toISOString() }; }, async list() { return []; }, async begin(_owner, input) { return { sessionId: input.session_id ?? "00000000-0000-4000-8000-000000000001", history: [], finish: async () => {}, release: async () => {} }; }, async get() { return []; } };
  const server = createPowuServer({ knowledgeStore: store, chatService: new ChatService(chatStore, { async run(_input, emit) { await emit({ type: "text_delta", delta: "ok" }); return []; } }) }); t.after(() => server.close()); server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  const body = new FormData(); body.set("message", "请总结"); body.set("request_id", "00000000-0000-4000-8000-000000000097"); body.append("file", new Blob(["内容"], { type: "text/plain" }), "资料.txt");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/chat`, { method: "POST", body }); assert.equal(response.status, 200); const text = await response.text(); assert.match(text, /event: attachments/); assert.match(text, /资料/); assert.deepEqual(seen, ["资料.txt"]);
});
