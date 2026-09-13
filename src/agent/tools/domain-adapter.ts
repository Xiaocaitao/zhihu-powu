import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { CapabilityContext, DomainCapability } from "../../contracts/capability.ts";

export function adaptDomainCapabilities(
  capabilities: readonly DomainCapability[],
  context: CapabilityContext,
  approve?: (name: string, args: unknown, signal?: AbortSignal) => Promise<boolean>,
): AgentTool[] {
  return capabilities.map(capability => ({
    name: capability.name,
    label: capability.name,
    description: capability.description,
    parameters: Type.Unsafe(capability.inputSchema as any),
    replay: "never" as const,
    execute: async (_id, args, signal) => {
      signal?.throwIfAborted();
      if (capability.requiresConfirmation && !(await approve?.(capability.name, args, signal))) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: { code: "CONFIRMATION_REQUIRED" } }) }], details: { ok: false, error: { code: "CONFIRMATION_REQUIRED" } } };
      }
      const result = await capability.execute({ ...context, operationKey: `${context.operationKey}:${_id}`, signal }, args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: result };
    },
  }));
}
