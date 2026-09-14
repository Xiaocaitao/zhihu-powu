import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ProfileFactDTO, ProfileFactPayload, ProfileFactSource, ProfileSection, ProfileFactType, UserGoalDTO } from "./contracts.ts";
import type { ProfileRepository } from "./repository.ts";

type FactRow = Omit<ProfileFactDTO, "value" | "evidenceRef"> & { value: ProfileFactPayload["value"]; evidence_ref?: { evidenceId: string; evaluatedAt: string } | null };
type GoalRow = { id: string; ownerId: string; goalType: "target_direction"; value: { direction: string | null }; version: number; updatedAt: string };

/** PostgreSQL repository for Profile-owned facts and goals. */
export class PostgresProfileRepository implements ProfileRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }
  async getFacts(ownerId: string, sections?: ProfileSection[]) { const values: unknown[] = [ownerId]; const where = ["owner_id=$1"]; if (sections?.length) { values.push(sections); where.push(`section = ANY($${values.length})`); } const result = await this.pool.query<FactRow>(`SELECT id,fact_type AS "factType",section,value,source,is_confirmed AS "isConfirmed",evidence_ref,version,updated_at::text AS "updatedAt" FROM profile_facts WHERE ${where.join(" AND ")} ORDER BY fact_type`, values); return result.rows.map(row => ({ ...row, evidenceRef: row.evidence_ref ?? undefined })) as ProfileFactDTO[]; }
  async getGoals(ownerId: string) { const result = await this.pool.query<GoalRow>(`SELECT id,owner_id AS "ownerId",goal_type AS "goalType",value,version,updated_at::text AS "updatedAt" FROM profile_goals WHERE owner_id=$1 ORDER BY updated_at DESC`, [ownerId]); return result.rows as UserGoalDTO[]; }
  async saveFact(ownerId: string, fact: Omit<ProfileFactDTO, "id" | "version" | "updatedAt">, expectedVersion?: number) {
    if (expectedVersion !== undefined) {
      const current = await this.pool.query<{ version: number }>(`SELECT version FROM profile_facts WHERE owner_id=$1 AND fact_type=$2`, [ownerId, fact.factType]);
      if (!current.rowCount || current.rows[0].version !== expectedVersion) throw new Error("VERSION_CONFLICT");
    }
    const id = randomUUID(); const result = await this.pool.query<FactRow>(`INSERT INTO profile_facts (id,owner_id,fact_type,section,value,source,is_confirmed,evidence_ref,version) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,1) ON CONFLICT (owner_id,fact_type) DO UPDATE SET section=EXCLUDED.section,value=EXCLUDED.value,source=EXCLUDED.source,is_confirmed=EXCLUDED.is_confirmed,evidence_ref=EXCLUDED.evidence_ref,version=profile_facts.version+1,updated_at=now() WHERE ($9::int IS NULL OR profile_facts.version=$9) RETURNING id,fact_type AS "factType",section,value,source,is_confirmed AS "isConfirmed",evidence_ref,version,updated_at::text AS "updatedAt"`, [id, ownerId, fact.factType, fact.section, JSON.stringify(fact.value), fact.source, fact.isConfirmed, JSON.stringify(fact.evidenceRef ?? null), expectedVersion ?? null]); if (!result.rowCount) throw new Error("VERSION_CONFLICT"); const row = result.rows[0]; return { id:row.id, factType:row.factType, section:row.section, value:row.value, source:row.source, isConfirmed:row.isConfirmed, evidenceRef:row.evidence_ref ?? undefined, version:row.version, updatedAt:row.updatedAt } as ProfileFactDTO;
  }
  async saveGoal(ownerId: string, value: { direction: string | null }, expectedVersion?: number) { if (expectedVersion !== undefined) { const current = await this.pool.query<{ version:number }>(`SELECT version FROM profile_goals WHERE owner_id=$1 AND goal_type='target_direction'`, [ownerId]); if (!current.rowCount || current.rows[0].version !== expectedVersion) throw new Error("VERSION_CONFLICT"); } const result = await this.pool.query<GoalRow>(`INSERT INTO profile_goals (id,owner_id,value,version) VALUES ($1,$2,$3::jsonb,1) ON CONFLICT (owner_id,goal_type) DO UPDATE SET value=EXCLUDED.value,version=profile_goals.version+1,updated_at=now() WHERE ($4::int IS NULL OR profile_goals.version=$4) RETURNING id,owner_id AS "ownerId",goal_type AS "goalType",value,version,updated_at::text AS "updatedAt"`, [randomUUID(), ownerId, JSON.stringify(value), expectedVersion ?? null]); if (!result.rowCount) throw new Error("VERSION_CONFLICT"); const row=result.rows[0]; return { id:row.id, goalType:row.goalType, value:row.value, version:row.version, updatedAt:row.updatedAt } as UserGoalDTO; }
}
