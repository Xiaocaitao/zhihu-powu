import type { EvidenceQuery, ProfileQuery } from "./contracts.ts";

export const createMockProfileQuery = (profile = { directionHints: ["backend_engineering"], interests: ["服务端开发"], currentSkills: [{ skillCode: "typescript", level: 3 }], weeklyAvailableHours: 8, goalText: "探索后端工程方向" }): ProfileQuery => ({ getProfileSnapshot: async () => structuredClone(profile) });

export const createMockEvidenceQuery = (): EvidenceQuery => ({
  getSkillEvidenceSnapshot: async (_ctx, { skillCodes }) => skillCodes.map((skillCode) => ({
    skillCode,
    level: skillCode === "typescript" ? 3 as const : skillCode === "sql" ? 2 as const : undefined,
    evidenceIds: skillCode === "typescript" ? ["evidence-project"] : skillCode === "sql" ? ["evidence-practice"] : [],
    evidenceCount: skillCode === "typescript" || skillCode === "sql" ? 1 : 0,
  })),
});
