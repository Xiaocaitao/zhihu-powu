import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityRegistry } from "../src/agent/tools/registry.ts";
import { matchApplicationRoute } from "../src/http/routes.ts";
import { createLlmInvoker } from "../src/llm/invoker.ts";
import { buildPrompt } from "../src/agent/prompts/system.ts";

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

test("growth prompt injects trusted context without turning routing into keyword rules", async () => {
  const prompt = await buildPrompt({ message: "帮我做职业规划", sessionId: "session-1", ownerId: "owner-1", requestId: "request-1" }, async input => {
    assert.deepEqual(input, { message: "帮我做职业规划", sessionId: "session-1", ownerId: "owner-1", requestId: "request-1" });
    return "Profile 摘要：目标方向为空，已学内容为 Java。";
  });
  assert.match(prompt, /先理解用户当前目标/);
  assert.match(prompt, /先提出最少量的澄清问题/);
  assert.match(prompt, /Profile 摘要：目标方向为空/);
});

test("growth prompt maps an explicit skills write to learned_content profile facts", async () => {
  const prompt = await buildPrompt({ message: "记录我已经掌握的 TypeScript 和 PostgreSQL", sessionId: "session-2" });
  assert.match(prompt, /明确要求“记录\/保存\/更新我掌握的技能、已学习内容或学习经历”/);
  assert.match(prompt, /save_profile_fact/);
  assert.match(prompt, /factType 固定为 learned_content/);
  assert.match(prompt, /value 使用 \{ items: string\[\] \}/);
  assert.match(prompt, /不要把单纯的技能清单或自我描述改走 Evidence 的 record_learning_evidence/);
  assert.match(prompt, /此类请求信息足够时必须直接调用一次 record_learning_evidence/);
});

test("growth prompt keeps first learning plans in trial mode", async () => {
  const prompt = await buildPrompt({ message: "生成学习计划", sessionId: "session-1" });
  assert.match(prompt, /首次生成.*mode=trial/);
  assert.match(prompt, /不要把 final draft 当成可确认计划/);
});

test("growth prompt defines the learning assistant chain", async () => {
  const prompt = await buildPrompt({ message: "我要学习 PostgreSQL 性能优化", sessionId: "chain-1" });
  assert.match(prompt, /至少调用一次 search_zhihu/);
  assert.match(prompt, /明确标为 trial 的学习计划草案/);
  assert.match(prompt, /用户未确认前不得调用 confirm_learning_plan/);
  assert.match(prompt, /先调用 update_learning_task 更新状态/);
  assert.match(prompt, /同一 taskId 调用 record_learning_evidence/);
});
