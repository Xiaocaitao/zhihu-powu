import { createDoubaoModels } from "../agent/runtime/provider.ts";
import type { StructuredLlmExecutor } from "./invoker.ts";
import { z } from "zod";

/** Serialize the contract into the provider request; a Zod object alone is not
 * visible to the model. Keep validation in the calling domain as well. */
export function structuredSystemPrompt(prompt: string, schema: unknown): string {
  const jsonSchema = schema instanceof z.ZodType ? z.toJSONSchema(schema) : schema;
  return `${prompt}\n输出必须严格符合以下 JSON Schema（不要添加额外字段）：\n${JSON.stringify(jsonSchema)}`;
}

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
    const signal = AbortSignal.any([AbortSignal.timeout(90_000), ...(input.signal ? [input.signal] : [])]);
    const response = await models.completeSimple(model, {
      systemPrompt: structuredSystemPrompt(input.systemPrompt, input.outputSchema),
      messages: [{
        role: "user",
        content: [{ type: "text" as const, text: JSON.stringify(input.userInput) }],
        timestamp: Date.now(),
      }],
    }, { reasoning: "low", maxRetries: 1, maxRetryDelayMs: 3000, signal });
    if (response.stopReason === 'error' || response.stopReason === 'aborted' || response.stopReason === 'length') {
      throw new Error('structured response did not complete');
    }
    const text = response.content
      .flatMap(part => part.type === "text" ? [part.text] : [])
      .join("")
      .trim();
    if (!text) throw new Error("empty structured response");
    // Domain adapter owns JSON parsing and bounded format-repair retries.
    return text;
  };
}
