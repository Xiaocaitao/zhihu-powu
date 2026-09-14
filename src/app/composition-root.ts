import { CapabilityRegistry, type CapabilityFactory } from "../agent/tools/registry.ts";
import { createProfileCapabilities } from "../modules/profile/capabilities.ts";
import { MemoryProfileRepository } from "../modules/profile/repository.ts";
import { ProfileService } from "../modules/profile/service.ts";
import { createEvidenceCapabilities } from "../modules/evidence/capabilities.ts";
import { EvidenceApplication } from "../modules/evidence/application.ts";
import { createEvidenceApplication, createEvidenceService } from "../modules/evidence/defaults.ts";
import { MockEvidenceGeneration } from "../modules/evidence/generation.ts";
import type { EvidenceGenerationPort } from "../modules/evidence/generation.ts";
import { SharedSkills } from "../modules/skills/service.ts";
import { MemorySkillRepository } from "../modules/skills/repository.ts";
import { initialSkillDefinitions } from "../modules/skills/definitions.ts";
import { createSkillCapabilities } from "../modules/skills/capabilities.ts";
import { createCareerCapabilities } from "../modules/career/capabilities.ts";
import { CareerService } from "../modules/career/service.ts";
import { MemoryCareerRepository } from "../modules/career/repository.ts";
import { createLearningCapabilities } from "../modules/learning/capabilities.ts";
import { LearningService } from "../modules/learning/service.ts";
import { MemoryLearningRepository } from "../modules/learning/repository.ts";
import type { ProfileRepository } from "../modules/profile/repository.ts";
import type { CareerRepository } from "../modules/career/repository.ts";
import type { LearningRepository } from "../modules/learning/repository.ts";

/** Assemble module capabilities in one place; modules remain unaware of the Agent runtime. */
export function createCapabilityRegistry(factories: readonly CapabilityFactory[] = []): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  for (const factory of factories) registry.register(factory());
  return registry;
}

/** Local composition used by the server and by the browser prototype. */
export function createDefaultCapabilityRegistry(dependencies: {
  profile?: ProfileRepository;
  evidence?: EvidenceApplication;
  evidenceGeneration?: EvidenceGenerationPort;
  career?: CareerRepository;
  learning?: LearningRepository;
  skills?: SharedSkills;
} = {}): CapabilityRegistry {
  const profile = new ProfileService(dependencies.profile ?? new MemoryProfileRepository());
  const career = new CareerService(dependencies.career ?? new MemoryCareerRepository());
  const learning = new LearningService(dependencies.learning ?? new MemoryLearningRepository());
  const skills = dependencies.skills ?? new SharedSkills(new MemorySkillRepository(initialSkillDefinitions));
  // Development and tests use a deterministic generator; production injects the model adapter.
  const evidence = dependencies.evidence ?? createEvidenceApplication({
    generation: dependencies.evidenceGeneration ?? new MockEvidenceGeneration(),
    ports: { skills },
  });
  return createCapabilityRegistry([
    () => createProfileCapabilities(profile) as never,
    () => createCareerCapabilities(career) as never,
    () => createLearningCapabilities(learning) as never,
    () => createEvidenceCapabilities(evidence) as never,
    () => createSkillCapabilities(skills),
  ]);
}

export { createEvidenceApplication, createEvidenceService };
