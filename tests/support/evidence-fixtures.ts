import { MemoryEvidenceRepository } from "../../src/modules/evidence/memory-repository.ts";
import { EvidenceApplication } from "../../src/modules/evidence/application.ts";
import { EvidenceService } from "../../src/modules/evidence/service.ts";
import { MockEvidenceGeneration, type EvidenceGenerationPort } from "../../src/modules/evidence/generation.ts";
import type { EvidencePorts } from "../../src/modules/evidence/ports.ts";
import { MemorySkillRepository } from "../../src/modules/skills/repository.ts";
import { initialSkillDefinitions } from "../../src/modules/skills/definitions.ts";
import { SharedSkills } from "../../src/modules/skills/service.ts";

export const skills = () => new SharedSkills(new MemorySkillRepository(initialSkillDefinitions));

export function defaultPorts(extra: EvidencePorts = {}): EvidencePorts {
  return { skills: skills(), ...extra };
}

export function serviceWith(options: {
  generation?: EvidenceGenerationPort;
  ports?: EvidencePorts;
  now?: () => Date;
} = {}) {
  return new EvidenceService({
    generation: options.generation ?? new MockEvidenceGeneration(),
    ports: options.ports ?? defaultPorts(),
    ...(options.now ? { now: options.now } : {}),
  });
}

export function applicationWith(options: {
  generation?: EvidenceGenerationPort;
  ports?: EvidencePorts;
  repository?: MemoryEvidenceRepository;
} = {}) {
  const repository = options.repository ?? new MemoryEvidenceRepository();
  const service = serviceWith({ generation: options.generation, ports: options.ports });
  // A fresh application per call so tests never rely on process memory.
  return {
    repository,
    app: () => new EvidenceApplication(repository, serviceWith({ generation: options.generation, ports: options.ports })),
  };
}

export const activityInput = (overrides: Record<string, unknown> = {}) => ({
  kind: "activity" as const,
  title: "完成 HTTP 请求解析练习",
  content: "实现了请求解析并写了笔记，缓存部分还不确定。",
  occurredAt: "2026-09-13T10:00:00+08:00",
  durationMinutes: 45,
  ...overrides,
});

export const ownerContext = (ownerId = "owner-a") => ({ ownerId, requestId: `req-${Math.random().toString(36).slice(2)}` });

/** Learned-skill ids present in the shared catalog. */
export const KNOWN_SKILL = "skill-http";
