import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createPowuServer } from "../src/server.ts";
import { ChatService } from "../src/modules/chat/service.ts";
import type { ChatStore, ChatRuntime } from "../src/modules/chat/contracts.ts";

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
