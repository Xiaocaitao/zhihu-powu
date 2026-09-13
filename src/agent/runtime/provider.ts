import { createModels, createProvider, envApiKeyAuth, type Model, type MutableModels } from "@earendil-works/pi-ai";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";

export function createDoubaoModels(modelId: string, baseUrl = "https://ark.cn-beijing.volces.com/api/v3"): MutableModels {
  const model: Model<"openai-responses"> = {
    id: modelId,
    name: `Doubao ${modelId}`,
    api: "openai-responses",
    provider: "doubao",
    baseUrl,
    reasoning: true,
    // Doubao accepts reasoning.effort but rejects the OpenAI-only summary field.
    samplingParams: { reasoning: { effort: "high" } },
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
    compat: { supportsDeveloperRole: false, supportsLongCacheRetention: false, supportsStrictMode: false },
  };
  const models = createModels(); models.setProvider(createProvider({ id: "doubao", name: "Doubao / Volcengine Ark", baseUrl, auth: { apiKey: envApiKeyAuth("Doubao API key", ["PI_API_KEY"]) }, models: [model], api: openAIResponsesApi() })); return models;
}
