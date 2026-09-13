import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createPowuServer } from "../src/server.ts";
import { ChatService } from "../src/modules/chat/service.ts";
import type { ChatStore, ChatRuntime } from "../src/modules/chat/contracts.ts";
import type { KnowledgeStore } from "../src/modules/knowledge/contracts.ts";

test("chat endpoint forwards raw input and streams text events", async t => {
  const store: ChatStore = { async create() { return { sessionId: "00000000-0000-4000-8000-000000000001", createdAt: new Date().toISOString() }; }, async list() { return []; }, async begin(_owner, input) { return { sessionId: input.session_id ?? "00000000-0000-4000-8000-000000000001", history: [], finish: async () => {}, release: async () => {} }; }, async get() { return []; } };
  const runtime: ChatRuntime = { async run(input, emit) { await emit({ type: "text_delta", delta: `收到：${input.message}` }); return []; } };
  const server = createPowuServer({ chatService: new ChatService(store, runtime) }); t.after(() => server.close()); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "你好", request_id: "00000000-0000-4000-8000-000000000002" }) });
  assert.equal(response.status, 200); const text = await response.text(); assert.match(text, /收到：你好/); assert.match(text, /event: complete/);
  const retired = await fetch(`http://127.0.0.1:${address.port}/api/routes`, { method: "POST", body: "{}" }); assert.equal(retired.status, 410);
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

test("knowledge files support multipart upload, owner isolation and inline preview", async t => {
  const saved = new Map<string, { id: string; original_name: string; mime_type: string; size_bytes: number; url: string; created_at: string }[]>();
  const store: KnowledgeStore = {
    async save(owner, upload) { const file = { id: "00000000-0000-4000-8000-000000000099", original_name: upload.filename, mime_type: upload.contentType, size_bytes: upload.data.byteLength, url: "/api/knowledge/files/00000000-0000-4000-8000-000000000099", created_at: new Date().toISOString() }; saved.set(owner, [...(saved.get(owner) ?? []), file]); return file; },
    async list(owner) { return saved.get(owner) ?? []; },
    async get(owner, id) { const file = saved.get(owner)?.find(item => item.id === id); return file ? { ...file, path: "/dev/null" } : null; },
  };
  const server = createPowuServer({ knowledgeStore: store }); t.after(() => server.close()); server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  const body = new FormData(); body.append("file", new Blob(["hello"], { type: "text/plain" }), "notes.txt");
  const uploaded = await fetch(`http://127.0.0.1:${address.port}/api/knowledge/files`, { method: "POST", body }); assert.equal(uploaded.status, 201);
  const cookie = uploaded.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie);
  const listed = await fetch(`http://127.0.0.1:${address.port}/api/knowledge/files`, { headers: { cookie } }); assert.equal((await listed.json()).files.length, 1);
  const preview = await fetch(`http://127.0.0.1:${address.port}/api/knowledge/files/00000000-0000-4000-8000-000000000099`, { headers: { cookie } }); assert.equal(preview.status, 200); assert.equal(preview.headers.get("x-content-type-options"), "nosniff");
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
