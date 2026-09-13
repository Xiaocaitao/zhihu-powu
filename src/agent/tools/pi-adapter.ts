import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { createZhihuTools } from "./zhihu.ts";

type Tool = ReturnType<typeof createZhihuTools>[number];
// Capabilities are selected by the trusted host, not by user/model parameters.
export const publicToolNames = new Set(["search_zhihu", "search_global", "get_zhihu_hot_list", "ask_zhihu"]);
export function adaptTools(tools: Tool[], allowed: ReadonlySet<string> = publicToolNames,
  approve?: (name: string, args: unknown, signal?: AbortSignal) => Promise<boolean>): AgentTool[] {
  return tools.filter(tool => allowed.has(tool.name)).map(tool => ({
    name: tool.name, label: tool.name, description: tool.description,
    parameters: Type.Unsafe(tool.inputSchema),
    replay: "never",
    execute: async (_id, args, signal, onUpdate) => {
      signal?.throwIfAborted();
      const confirmed = tool.requiresConfirmation ? await approve?.(tool.name, args, signal) : undefined;
      signal?.throwIfAborted();
      const result = await tool.execute(args, {
        signal, confirmed,
        onChunk: chunk => onUpdate?.({ content: [{ type: "text", text: JSON.stringify(chunk) }], details: chunk }),
      });
      if (!result.ok) throw new Error(result.error.message);
      return { content: [{ type: "text", text: JSON.stringify(result.data) }], details: result.data };
    },
  }));
}
