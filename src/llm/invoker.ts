import type { LlmInvokerInput } from "./types.ts";

export type { LlmInvokerInput } from "./types.ts";

export interface LlmInvoker {
  generateStructured<T>(input: LlmInvokerInput): Promise<T>;
}

export type StructuredLlmExecutor = (input: LlmInvokerInput) => Promise<unknown>;

/** Provider-neutral adapter. The composition root supplies the actual model transport. */
export function createLlmInvoker(executor: StructuredLlmExecutor): LlmInvoker {
  return {
    async generateStructured<T>(input: LlmInvokerInput) {
      input.signal?.throwIfAborted();
      const result = await executor(input);
      input.signal?.throwIfAborted();
      return result as T;
    },
  };
}

export class LlmDependencyUnavailable extends Error {
  readonly code = "DEPENDENCY_UNAVAILABLE" as const;
  constructor(message = "LLM provider is not configured") { super(message); }
}

export const unavailableLlmInvoker: LlmInvoker = {
  async generateStructured() { throw new LlmDependencyUnavailable(); },
};
