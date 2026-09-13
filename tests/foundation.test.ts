import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityRegistry } from "../src/agent/tools/registry.ts";
import { matchApplicationRoute } from "../src/http/routes.ts";
import { createLlmInvoker } from "../src/llm/invoker.ts";

test("capability registry rejects duplicate names and route matching exposes params", async () => {
  const capability = { name: "demo", description: "demo", inputSchema: {}, execute: async () => ({ ok: true, changed: false, domain: "demo", status: "read" as const, summary: "ok" }) };
  const registry = new CapabilityRegistry();
  registry.register([capability]);
  assert.throws(() => registry.register([capability]), /duplicate capability/);
  const match = matchApplicationRoute([{ method: "GET", pattern: /^\/api\/x\/(?<id>[^/]+)$/, handle() {} }], "GET", "/api/x/42");
  assert.deepEqual(match?.params, { id: "42" });
});

test("configured LLM invoker forwards structured input and cancellation", async () => {
  let received: unknown;
  const invoker = createLlmInvoker(async input => { received = input; return { answer: "ok" }; });
  const result = await invoker.generateStructured<{ answer: string }>({ systemPrompt: "s", userInput: { x: 1 }, outputSchema: {}, });
  assert.deepEqual(result, { answer: "ok" });
  assert.equal((received as { systemPrompt: string }).systemPrompt, "s");
});
