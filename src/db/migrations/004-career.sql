CREATE TABLE IF NOT EXISTS career_plans (
  id UUID PRIMARY KEY, owner_id TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('draft','confirmed','archived')),
  version INTEGER NOT NULL DEFAULT 1, direction_codes JSONB NOT NULL DEFAULT '[]', target_job_id UUID,
  target_company_name TEXT, target_city TEXT, target_salary_text TEXT, rationale TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(owner_id,id)
);
CREATE TABLE IF NOT EXISTS career_target_jobs (
  id UUID PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL, company_name TEXT, direction_code TEXT,
  city TEXT, employment_type TEXT NOT NULL DEFAULT 'unknown', salary_text TEXT, description TEXT NOT NULL,
  requirements JSONB NOT NULL DEFAULT '[]', source TEXT NOT NULL DEFAULT 'manual', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(owner_id,id)
);
CREATE TABLE IF NOT EXISTS career_gap_analyses (
  id UUID PRIMARY KEY, owner_id TEXT NOT NULL, job_id UUID NOT NULL, plan_id UUID, match_score INTEGER,
  possessed JSONB NOT NULL DEFAULT '[]', partial JSONB NOT NULL DEFAULT '[]', missing JSONB NOT NULL DEFAULT '[]', unknown JSONB NOT NULL DEFAULT '[]',
  evidence_snapshot_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(owner_id,id)
);
CREATE INDEX IF NOT EXISTS career_jobs_owner_created ON career_target_jobs(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS career_gaps_owner_job ON career_gap_analyses(owner_id, job_id, created_at DESC);
