import type { SkillResolution } from "./contracts.ts";
import type { SkillRepository } from "./repository.ts";

export class SharedSkills {
  private readonly repository: SkillRepository;
  constructor(repository: SkillRepository) { this.repository = repository; }
  async get(skillIds: string[]) {
    const rows = await Promise.all(skillIds.map(id => this.repository.get(id)));
    return { items: rows.filter(item => item !== null), missingIds: skillIds.filter((_, index) => !rows[index]) };
  }
  async resolve(terms: string[]): Promise<SkillResolution[]> {
    return Promise.all(terms.map(async input => {
      const matches = await this.repository.resolve(input);
      return {
        input, status: matches.length === 1 ? "resolved" : matches.length ? "ambiguous" : "unresolved",
        candidates: matches.map(({ skillId, name }) => ({ skillId, name })),
      };
    }));
  }
  list(keyword?: string, limit?: number) { return this.repository.list(keyword, limit); }
}
