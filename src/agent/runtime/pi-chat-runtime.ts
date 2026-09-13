import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { createDoubaoModels } from "./provider.ts";
import { ZhihuClient } from "../../integrations/zhihu/client.ts";
import { createZhihuTools } from "../tools/zhihu.ts";
import { adaptTools } from "../tools/pi-adapter.ts";
import { buildPrompt, type PromptContext } from "../prompts/system.ts";
import type { ChatRuntime, Emit, Transcript } from "../../modules/chat/contracts.ts";
import type { CapabilityContext } from "../../contracts/capability.ts";
import type { CapabilityRegistry } from "../tools/registry.ts";
import { adaptDomainCapabilities } from "../tools/domain-adapter.ts";

export type PiChatRuntimeOptions = {
  modelId?: string;
  apiKey?: string;
  baseUrl?: string;
  client?: ZhihuClient;
  capabilityRegistry?: CapabilityRegistry;
  /** Trusted server-side context, e.g. a compact Profile summary. */
  promptContext?: PromptContext;
};

export class PiChatRuntime implements ChatRuntime {
  private model: Model<any>;
  private apiKey: string;
  private client: ZhihuClient;
  private baseUrl: string;
  private capabilityRegistry?: CapabilityRegistry;
  private promptContext?: PromptContext;
  constructor(options: PiChatRuntimeOptions = {}) {
    const modelId = options.modelId ?? process.env.PI_MODEL ?? "";
    this.apiKey = options.apiKey ?? process.env.PI_API_KEY ?? "";
    this.baseUrl = options.baseUrl ?? process.env.PI_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3";
    if (!this.apiKey || !modelId) throw new Error("PI_API_KEY and PI_MODEL are required");
    this.model = createDoubaoModels(modelId, this.baseUrl).getModel("doubao", modelId)!;
    this.client = options.client ?? new ZhihuClient();
    this.capabilityRegistry = options.capabilityRegistry;
    this.promptContext = options.promptContext;
  }
  async run(input: { message: string; sessionId: string; history: Transcript; signal: AbortSignal; attachments?: import("../../modules/chat/contracts.ts").ChatAttachment[]; context?: CapabilityContext }, emit: Emit): Promise<Transcript> {
    const systemPrompt = await buildPrompt({
      message: input.message,
      sessionId: input.sessionId,
      ownerId: input.context?.ownerId,
      requestId: input.context?.requestId,
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    }, this.promptContext);
    const agent = new Agent({
      streamFn: async (model, context, options) => {
        const models = createDoubaoModels(model.id, this.baseUrl);
        return models.streamSimple(model, context, { ...options, cacheRetention: "none", reasoning: "high", maxRetries: 1, maxRetryDelayMs: 3000 });
      },
      getApiKey: () => this.apiKey,
      initialState: { systemPrompt, model: this.model, thinkingLevel: "high", messages: input.history as AgentMessage[], tools: [
        ...adaptTools(createZhihuTools(this.client)),
        ...(input.context && this.capabilityRegistry ? adaptDomainCapabilities(this.capabilityRegistry.forContext(input.context), input.context) : []),
      ] },
      sessionId: input.sessionId,
      maxRetryDelayMs: 3000,
      // Profile reads must be able to precede research and writes. Pi still
      // owns the loop; this only removes unsafe parallel batches.
      toolExecution: "sequential",
    });
    const unsubscribe = agent.subscribe(async event => {
      if (event.type === "message_update") {
        const part = event.assistantMessageEvent;
        if (part.type === "text_delta") await emit({ type: "text_delta", delta: part.delta });
        if (part.type === "thinking_delta") await emit({ type: "thinking_delta", delta: part.delta });
      } else if (event.type === "tool_execution_start") await emit({ type: "tool_start", tool_call_id: event.toolCallId, tool_name: event.toolName, args: event.args });
      else if (event.type === "tool_execution_update") await emit({ type: "tool_update", tool_call_id: event.toolCallId, tool_name: event.toolName, update: event.partialResult });
      else if (event.type === "tool_execution_end") await emit({ type: "tool_end", tool_call_id: event.toolCallId, tool_name: event.toolName, error: event.isError });
    });
    const abort = () => agent.abort();
    input.signal.addEventListener("abort", abort, { once: true });
    try {
      await agent.prompt(input.message);
      if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
      return agent.state.messages as Transcript;
    }
    finally { input.signal.removeEventListener("abort", abort); unsubscribe(); }
  }
}
