import { createDoubaoModels } from "../agent/runtime/provider.ts";
import type { StructuredLlmExecutor } from "./invoker.ts";

/**
 * Structured JSON executor backed by the same Doubao/Ark model the chat runtime
 * uses. Returns null when the deployment has no model configured, so the host
 * can fall back to an explicit "dependency unavailable" result instead of
 * inventing content.
 */
export function createDoubaoStructuredExecutor(config: {
  modelId?: string;
  baseUrl?: string;
} = {}): StructuredLlmExecutor | null {
  const modelId = config.modelId ?? process.env.PI_MODEL ?? "";
  if (!modelId) return null;
  if (!(process.env.PI_API_KEY ?? "")) return null;
  const baseUrl = config.baseUrl ?? process.env.PI_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3";
  const models = createDoubaoModels(modelId, baseUrl);
  const model = models.getModel("doubao", modelId);
  if (!model) return null;
  return async input => {
    input.signal?.throwIfAborted();
    const response = await models.completeSimple(model, {
      systemPrompt: input.systemPrompt,
      messages: [{
        role: "user",
        content: [{ type: "text" as const, text: JSON.stringify(input.userInput) }],
        timestamp: Date.now(),
      }],
    }, { reasoning: "low", maxRetries: 1, maxRetryDelayMs: 3000, signal: input.signal });
    const text = response.content
      .flatMap(part => part.type === "text" ? [part.text] : [])
      .join("")
      .trim();
    if (!text) throw new Error("empty structured response");
    return JSON.parse(text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()) as unknown;
  };
}
