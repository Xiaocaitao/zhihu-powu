import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { CapabilityContext, DomainCapability } from "../../contracts/capability.ts";
import { toToolSchema } from "./schema.ts";

const resultStatuses = new Set(["read", "applied", "draft_created", "confirmation_required", "rejected"]);
function validateCapabilityResult(value: unknown): value is { ok: boolean; changed: boolean; domain: string; status: string; summary: string } {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return typeof result.ok === "boolean" && typeof result.changed === "boolean" && typeof result.domain === "string" && typeof result.status === "string" && resultStatuses.has(result.status) && typeof result.summary === "string";
}

export function adaptDomainCapabilities(
  capabilities: readonly DomainCapability[],
  context: CapabilityContext,
  approve?: (name: string, args: unknown, signal?: AbortSignal) => Promise<boolean>,
  guard?: (name: string, args: unknown) => { allowed: boolean; summary: string },
): AgentTool[] {
  return capabilities.map(capability => ({
    name: capability.name,
    label: capability.name,
    description: capability.description,
    parameters: Type.Unsafe(toToolSchema(capability.inputSchema) as any),
    replay: "never" as const,
    execute: async (_id, args, signal) => {
      signal?.throwIfAborted();
      const guardResult = guard?.(capability.name, args);
      if (guardResult && !guardResult.allowed) {
        const result = { ok: false, changed: false, domain: "agent", status: "rejected", summary: guardResult.summary, error: { code: "WORKFLOW_STAGE_REQUIRED", message: guardResult.summary, retryable: false } };
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: result };
      }
      if (capability.requiresConfirmation && !(await approve?.(capability.name, args, signal))) {
        const result = { ok: false, changed: false, domain: "agent", status: "confirmation_required", summary: "这项操作需要用户明确确认后才能执行", error: { code: "CONFIRMATION_REQUIRED", message: "请明确回复确认后再执行", retryable: false } };
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: result };
      }
      try {
        const result = await capability.execute({ ...context, operationKey: `${context.operationKey}:${_id}`, signal }, args);
        if (!validateCapabilityResult(result)) {
          const invalid = { ok: false, changed: false, domain: capability.name.split("_")[0], status: "rejected", summary: "工具返回结果不符合协议，请修正后重试", error: { code: "INVALID_ARGUMENT", message: "TOOL_OUTPUT_INVALID", retryable: false } };
          return { content: [{ type: "text" as const, text: JSON.stringify(invalid) }], details: invalid };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: result };
      } catch (error) {
        signal?.throwIfAborted();
        const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "INVALID_ARGUMENT";
        const result = { ok: false, changed: false, domain: capability.name.split("_")[0], status: "rejected", summary: "工具参数或业务状态不合法", error: { code, message: error instanceof Error ? error.message : String(error), retryable: false } };
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: result };
      }
    },
  }));
}
