import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createPowuServer } from "../src/server.ts";
import { ChatService } from "../src/modules/chat/service.ts";
import type { ChatStore, ChatRuntime } from "../src/modules/chat/contracts.ts";

test("chat endpoint forwards raw input and streams text events", async t => {
  const store: ChatStore = { async begin(_owner, input) { return { sessionId: input.session_id ?? "00000000-0000-4000-8000-000000000001", history: [], finish: async () => {}, release: async () => {} }; }, async get() { return []; } };
  const runtime: ChatRuntime = { async run(input, emit) { await emit({ type: "text_delta", delta: `收到：${input.message}` }); return []; } };
  const server = createPowuServer({ chatService: new ChatService(store, runtime) }); t.after(() => server.close()); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "你好", request_id: "00000000-0000-4000-8000-000000000002" }) });
  assert.equal(response.status, 200); const text = await response.text(); assert.match(text, /收到：你好/); assert.match(text, /event: complete/);
  const retired = await fetch(`http://127.0.0.1:${address.port}/api/routes`, { method: "POST", body: "{}" }); assert.equal(retired.status, 410);
});

test("chat request rejects missing protocol fields", async t => {
  const server = createPowuServer({ chatService: new ChatService({ begin: async () => { throw new Error("unused"); }, get: async () => null }, { run: async () => [] }) }); t.after(() => server.close()); server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/chat`, { method: "POST", body: JSON.stringify({ message: "hi" }) }); assert.equal(response.status, 400);
});
