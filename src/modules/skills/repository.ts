import type { Pool } from "pg";
import { normalizeSkillTerm, type SkillDefinition } from "./contracts.ts";

export interface SkillRepository {
  get(skillId: string): Promise<SkillDefinition | null>;
  resolve(term: string): Promise<SkillDefinition[]>;
  list(keyword?: string, limit?: number): Promise<SkillDefinition[]>;
}

export class MemorySkillRepository implements SkillRepository {
  private readonly definitions: readonly SkillDefinition[];
  constructor(definitions: readonly SkillDefinition[] = []) { this.definitions = structuredClone(definitions); }
  async get(skillId: string) { return structuredClone(this.definitions.find(skill => skill.skillId === skillId) ?? null); }
  async resolve(term: string) {
    const normalized = normalizeSkillTerm(term);
    return structuredClone(this.definitions.filter(skill =>
      [skill.skillId, skill.name, ...skill.aliases].some(alias => normalizeSkillTerm(alias) === normalized)));
  }
  async list(keyword = "", limit = 20) {
    const normalized = normalizeSkillTerm(keyword);
    return structuredClone(this.definitions.filter(skill =>
      [skill.skillId, skill.name, ...skill.aliases].some(alias => normalizeSkillTerm(alias).includes(normalized)))
      .sort((a, b) => a.skillId.localeCompare(b.skillId)).slice(0, limit));
  }
}

const columns = 'id AS "skillId", name, description, aliases, revision';

export class PostgresSkillRepository implements SkillRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  /** Operator-owned definitions only; no user/Agent write tool can redefine the catalog. */
  async install(definitions: readonly SkillDefinition[]) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const definition of definitions) {
        const terms = [...new Set([definition.skillId, definition.name, ...definition.aliases].map(normalizeSkillTerm))];
        await client.query(
          "INSERT INTO shared_skills (id,name,description,aliases,terms,revision) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,aliases=EXCLUDED.aliases,terms=EXCLUDED.terms,revision=EXCLUDED.revision WHERE shared_skills.revision < EXCLUDED.revision",
          [definition.skillId, definition.name, definition.description, JSON.stringify(definition.aliases), JSON.stringify(terms), definition.revision],
        );
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async get(skillId: string) {
    const result = await this.pool.query<SkillDefinition>("SELECT " + columns + " FROM shared_skills WHERE id=$1", [skillId]);
    return result.rows[0] ?? null;
  }
  async resolve(term: string) {
    const result = await this.pool.query<SkillDefinition>("SELECT " + columns + " FROM shared_skills WHERE terms ? $1 ORDER BY id", [normalizeSkillTerm(term)]);
    return result.rows;
  }
  async list(keyword = "", limit = 20) {
    const result = await this.pool.query<SkillDefinition>(
      "SELECT " + columns + " FROM shared_skills WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(terms) AS term WHERE strpos(term,$1)>0) ORDER BY id LIMIT $2",
      [normalizeSkillTerm(keyword), Math.min(Math.max(limit, 1), 100)],
    );
    return result.rows;
  }
}
