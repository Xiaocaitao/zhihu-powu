import { createLlmEvidenceGeneration, type EvidenceGenerationPort } from "./generation.ts";
import type { EvidencePorts } from "./ports.ts";
import { EvidenceService } from "./service.ts";
import { EvidenceApplication } from "./application.ts";
import { MemoryEvidenceRepository } from "./memory-repository.ts";
import { createLlmInvoker, unavailableLlmInvoker, type LlmInvoker } from "../../llm/invoker.ts";

export type EvidenceAssemblyOptions = {
  generation?: EvidenceGenerationPort;
  llm?: LlmInvoker;
  ports?: EvidencePorts;
  now?: () => Date;
};

/**
 * Assemble the domain service. When no generation port is supplied the model
 * adapter is used, so a deployment without a configured model returns an
 * explicit dependency-unavailable result instead of fixed production replies.
 */
export function createEvidenceService(options: EvidenceAssemblyOptions = {}): EvidenceService {
  const generation = options.generation
    ?? createLlmEvidenceGeneration(options.llm ?? unavailableLlmInvoker);
  return new EvidenceService({
    generation,
    ports: options.ports ?? {},
    ...(options.now ? { now: options.now } : {}),
  });
}

export function createEvidenceApplication(options: EvidenceAssemblyOptions = {}): EvidenceApplication {
  return new EvidenceApplication(new MemoryEvidenceRepository(), createEvidenceService(options));
}

export { createLlmInvoker };
