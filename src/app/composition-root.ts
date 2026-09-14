import { CapabilityRegistry, type CapabilityFactory } from "../agent/tools/registry.ts";
import { createProfileCapabilities } from "../modules/profile/capabilities.ts";
import { MemoryProfileRepository, type ProfileRepository } from "../modules/profile/repository.ts";
import { ProfileService } from "../modules/profile/service.ts";
import { createEvidenceCapabilities } from "../modules/evidence/capabilities.ts";
import { EvidenceService } from "../modules/evidence/service.ts";
import { EvidenceApplication } from "../modules/evidence/application.ts";
import { MemoryEvidenceRepository } from "../modules/evidence/repository.ts";
import { createCareerCapabilities } from "../modules/career/capabilities.ts";
import { CareerService } from "../modules/career/service.ts";
import { MemoryCareerRepository, type CareerRepository } from "../modules/career/repository.ts";
import { createLearningCapabilities } from "../modules/learning/capabilities.ts";
import { LearningService } from "../modules/learning/service.ts";
import { MemoryLearningRepository, type LearningRepository } from "../modules/learning/repository.ts";
import type { CareerApplication } from "../modules/career/types.ts";
import type { CareerContext, EvidenceQuery, LearningProgressQuery, ProfileQuery } from "../modules/career/contracts.ts";

export type DefaultApplications = {
  careerApplication: CareerApplication;
  capabilityRegistry: CapabilityRegistry;
};

export type DefaultDependencies = {
  profile?: ProfileRepository;
  evidence?: EvidenceService | EvidenceApplication;
  career?: CareerRepository;
  learning?: LearningRepository;
  careerApplication?: CareerApplication;
};

function createQueries(
  profileService: ProfileService,
  evidence: EvidenceService | EvidenceApplication,
  learning: LearningService,
): { profileQuery: ProfileQuery; evidenceQuery: EvidenceQuery; learningProgressQuery: LearningProgressQuery } {
  const profileQuery: ProfileQuery = {
    async getProfileSnapshot(ctx: CareerContext) {
      const profile = await profileService.getUserProfile({ ownerId: ctx.ownerId }, {});
      const fact = (type: string) => profile.facts.find(item => item.factType === type)?.value as Record<string, unknown> | undefined;
      const goal = profile.goals[0]?.value.direction ?? undefined;
      const interests = Array.isArray(fact("interest_direction")?.items) ? fact("interest_direction")!.items as string[] : [];
      const learned = Array.isArray(fact("learned_content")?.items) ? fact("learned_content")!.items as string[] : [];
      const weeklyHours = fact("weekly_time")?.hours;
      return {
        directionHints: [...new Set([goal, ...interests].filter((value): value is string => Boolean(value)))],
        interests,
        currentSkills: learned.map(skillCode => ({ skillCode })),
        weeklyAvailableHours: typeof weeklyHours === "number" ? weeklyHours : undefined,
        goalText: goal,
      };
    },
  };

  const evidenceQuery: EvidenceQuery = {
    async getSkillEvidenceSnapshot(ctx: CareerContext, input) {
      if (evidence instanceof EvidenceApplication) return evidence.getSkillEvidenceSnapshot(ctx, input);
      return input.skillCodes.map(skillCode => {
        const item = evidence.getSkillEvidence(ctx, skillCode).data?.items[0];
        return {
          skillCode,
          evidenceIds: item?.recordIds ?? [],
          evidenceCount: item?.recordIds.length ?? 0,
          support: item?.support ?? "insufficient",
        };
      });
    },
  };

  const learningProgressQuery: LearningProgressQuery = {
    async getActionProgress(ctx, input) {
      const plan = await learning.getActivePlan({ ownerId: ctx.ownerId }, { includeTasks: true });
      const tasks = plan?.stages.flatMap(stage => stage.tasks) ?? [];
      return input.actionIds.map(actionId => {
        const task = tasks.find(item => item.id === actionId || item.capabilityKey === actionId);
        if (!task) return { actionId, status: "not_linked" as const };
        const status = task.status === "completed" ? "completed" as const : task.status === "in_progress" ? "in_progress" as const : "planned" as const;
        return { actionId, status, linkedTaskId: task.id };
      });
    },
  };

  return { profileQuery, evidenceQuery, learningProgressQuery };
}

export function createDefaultApplications(dependencies: DefaultDependencies = {}): DefaultApplications {
  const profile = new ProfileService(dependencies.profile ?? new MemoryProfileRepository());
  const evidence = dependencies.evidence ?? new EvidenceApplication(new EvidenceService(), new MemoryEvidenceRepository());
  const learning = new LearningService(dependencies.learning ?? new MemoryLearningRepository());
  const careerApplication = dependencies.careerApplication ?? new CareerService(
    dependencies.career ?? new MemoryCareerRepository(),
    createQueries(profile, evidence, learning),
  );
  const capabilityRegistry = createCapabilityRegistry([
    () => createProfileCapabilities(profile) as never,
    () => createCareerCapabilities(careerApplication) as never,
    () => createLearningCapabilities(learning) as never,
    () => createEvidenceCapabilities(evidence) as never,
  ]);
  return { careerApplication, capabilityRegistry };
}

export function createCapabilityRegistry(factories: readonly CapabilityFactory[] = []): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  for (const factory of factories) registry.register(factory());
  return registry;
}

/** Local composition used by the server and by the browser prototype. */
export function createDefaultCapabilityRegistry(dependencies: DefaultDependencies = {}): CapabilityRegistry {
  return createDefaultApplications(dependencies).capabilityRegistry;
}
