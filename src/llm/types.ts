export type LlmInvokerInput = {
  systemPrompt: string;
  userInput: unknown;
  outputSchema: unknown;
  signal?: AbortSignal;
};
