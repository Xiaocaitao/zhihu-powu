import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultCapabilityRegistry } from "../src/app/composition-root.ts";
import { adaptDomainCapabilities } from "../src/agent/tools/domain-adapter.ts";

test("业务 Zod schema 在 Agent 边界转换为 JSON Schema", () => {
  const capability = createDefaultCapabilityRegistry().list().find(item => item.name === "save_profile_fact");
  assert.ok(capability);
  const [tool] = adaptDomainCapabilities([capability], {
    ownerId: "u1", sessionId: "s1", requestId: "r1", operationKey: "o1",
  });
  const schema = tool.parameters as Record<string, unknown>;
  assert.equal(schema.type, "object");
  assert.deepEqual(Object.keys(schema.properties as object).sort(), ["evidenceRef", "expectedVersion", "factType", "isConfirmed", "source", "value"]);
  const value = (schema.properties as Record<string, any>).value;
  assert.ok(Array.isArray(value.anyOf));
  assert.ok(value.anyOf.some((item: any) => item.properties?.text?.minLength === 1));
  assert.ok(value.anyOf.some((item: any) => item.properties?.items?.type === "array"));
  assert.equal("_def" in schema, false);
});
