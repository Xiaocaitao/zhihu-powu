ALTER TABLE career_plans ADD COLUMN IF NOT EXISTS target_company_id TEXT;
ALTER TABLE career_target_jobs ADD COLUMN IF NOT EXISTS company_id TEXT;

CREATE TABLE IF NOT EXISTS career_target_companies (
  id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  industry TEXT,
  direction_code TEXT,
  city TEXT,
  summary TEXT,
  related_job_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  match_score INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, owner_id)
);

CREATE TABLE IF NOT EXISTS career_industry_trends (
  id TEXT PRIMARY KEY,
  direction_code TEXT NOT NULL,
  direction_name TEXT NOT NULL,
  metric TEXT NOT NULL CHECK (metric IN ('demand_heat', 'growth', 'skill_change')),
  value NUMERIC NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  period_days INTEGER NOT NULL CHECK (period_days IN (30, 90, 180)),
  sample_size INTEGER,
  source_label TEXT NOT NULL,
  as_of TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS career_companies_owner_updated ON career_target_companies(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS career_trends_direction_period ON career_industry_trends(direction_code, period_days);
