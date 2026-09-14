import assert from "node:assert/strict";
import test from "node:test";
import { adaptDomainCapabilities } from "../src/agent/tools/domain-adapter.ts";

test("业务工具参数错误返回不可重试的结构化结果", async () => {
  const [tool] = adaptDomainCapabilities([{
    name: "save_profile_fact", description: "", inputSchema: { type: "object" },
    execute: async () => { throw new Error("INVALID_ARGUMENT"); },
  }], { ownerId: "u1", requestId: "r1", operationKey: "o1" });
  const result = await tool.execute("call-1", {}, new AbortController().signal);
  const content = result.content[0];
  assert.equal(content.type, "text");
  const body = JSON.parse(content.text);
  assert.equal(body.ok, false);
  assert.equal(body.summary, "用户画像暂时无法保存，请稍后重试。");
  assert.equal("error" in body, false);
  assert.equal(result.details.error.code, "INVALID_ARGUMENT");
  assert.equal(result.details.error.retryable, false);
});
