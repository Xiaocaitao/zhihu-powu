import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { CapabilityContext, CapabilityResult, DomainCapability } from "../../contracts/capability.ts";
import { toToolSchema } from "./schema.ts";

const resultStatuses = new Set(["read", "applied", "draft_created", "confirmation_required", "rejected"]);
function validateCapabilityResult(value: unknown): value is CapabilityResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return typeof result.ok === "boolean" && typeof result.changed === "boolean" && typeof result.domain === "string" && typeof result.status === "string" && resultStatuses.has(result.status) && typeof result.summary === "string";
}

/** Keep diagnostic fields for server-side details, but never put them in the model-facing content. */
type ToolResult = { ok: boolean; changed: boolean; domain: string; status: string; summary: string; [key: string]: unknown };

function modelVisibleResult(result: ToolResult): Record<string, unknown> {
  if (result.ok) return result as Record<string, unknown>;
  return { ok: false, changed: result.changed, domain: result.domain, status: result.status, summary: result.summary };
}

function modelContent(result: ToolResult) {
  return { content: [{ type: "text" as const, text: JSON.stringify(modelVisibleResult(result)) }], details: result };
}

function failureSummary(capabilityName: string): string {
  if (capabilityName.includes("learning_plan") || capabilityName.includes("learning_task")) return "学习计划暂时无法保存或更新，请稍后重试。";
  if (capabilityName.includes("profile") || capabilityName.includes("user_goal")) return "用户画像暂时无法保存，请稍后重试。";
  if (capabilityName.includes("evidence")) return "学习经历暂时无法保存，请稍后重试。";
  if (capabilityName.includes("career")) return "职业规划暂时无法保存或更新，请稍后重试。";
  return "当前操作暂时无法完成，请检查输入后重试。";
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
        return modelContent(result);
      }
      if (capability.requiresConfirmation && !(await approve?.(capability.name, args, signal))) {
        const result = { ok: false, changed: false, domain: "agent", status: "confirmation_required", summary: "这项操作需要用户明确确认后才能执行", error: { code: "CONFIRMATION_REQUIRED", message: "请明确回复确认后再执行", retryable: false } };
        return modelContent(result);
      }
      try {
        const result = await capability.execute({ ...context, operationKey: `${context.operationKey}:${_id}`, signal }, args);
        if (!validateCapabilityResult(result)) {
          const invalid = { ok: false, changed: false, domain: capability.name.split("_")[0], status: "rejected", summary: "当前操作暂时无法完成，请稍后重试。", error: { code: "INVALID_ARGUMENT", message: "TOOL_OUTPUT_INVALID", retryable: false } };
          return modelContent(invalid);
        }
        return modelContent(result);
      } catch (error) {
        signal?.throwIfAborted();
        const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "INVALID_ARGUMENT";
        const result = { ok: false, changed: false, domain: capability.name.split("_")[0], status: "rejected", summary: failureSummary(capability.name), error: { code, message: error instanceof Error ? error.message : String(error), retryable: false } };
        return modelContent(result);
      }
    },
  }));
}
