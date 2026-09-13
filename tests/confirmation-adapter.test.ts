import assert from "node:assert/strict";
import test from "node:test";
import { adaptDomainCapabilities } from "../src/agent/tools/domain-adapter.ts";
import { explicitlyConfirms } from "../src/agent/runtime/pi-chat-runtime.ts";

test("确认信号必须点名对应的成长动作", () => {
  assert.equal(explicitlyConfirms("confirm_learning_plan", "确认学习计划"), true);
  assert.equal(explicitlyConfirms("confirm_career_plan", "确认学习计划"), false);
  assert.equal(explicitlyConfirms("confirm_learning_plan", "确认学习计划，但先不要执行"), false);
  assert.equal(explicitlyConfirms("upload_knowledge_file", "确认上传"), false);
});

test("未获得宿主确认时返回结构化 confirmation_required", async () => {
  const [tool] = adaptDomainCapabilities([{
    name: "confirm_learning_plan", description: "", inputSchema: { type: "object" }, requiresConfirmation: true,
    execute: async () => { throw new Error("should not execute"); },
  }], { ownerId: "u1", requestId: "r1", operationKey: "o1" });
  const result = await tool.execute("call-1", {}, new AbortController().signal);
  assert.equal(result.details.status, "confirmation_required");
  assert.equal(result.details.error.code, "CONFIRMATION_REQUIRED");
  assert.equal(result.details.error.retryable, false);
});
