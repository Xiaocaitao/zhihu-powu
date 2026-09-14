CREATE TABLE IF NOT EXISTS learning_plans (
  id UUID PRIMARY KEY, owner_id TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('trial','final')),
  status TEXT NOT NULL CHECK (status IN ('draft','active','paused','completed','archived')),
  source_profile_version INTEGER NOT NULL, source_career_plan_version INTEGER, target_job_id UUID,
  start_date DATE NOT NULL, end_date DATE NOT NULL, weekly_minutes INTEGER NOT NULL CHECK (weekly_minutes > 0),
  version INTEGER NOT NULL DEFAULT 1, learning_goals JSONB NOT NULL DEFAULT '[]', updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(owner_id,id)
);
CREATE TABLE IF NOT EXISTS learning_stages (
  id UUID PRIMARY KEY, plan_id UUID NOT NULL, stage_order INTEGER NOT NULL, title TEXT NOT NULL, objective TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo', tasks JSONB NOT NULL DEFAULT '[]', UNIQUE(plan_id, stage_order)
);
CREATE TABLE IF NOT EXISTS learning_feedback (
  id UUID PRIMARY KEY, owner_id TEXT NOT NULL, plan_id UUID NOT NULL, task_id UUID, difficulty TEXT NOT NULL,
  reason TEXT, actual_minutes INTEGER, available_minutes INTEGER, confidence_score INTEGER, note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(owner_id,id)
);
CREATE TABLE IF NOT EXISTS learning_plan_adjustments (
  id UUID PRIMARY KEY, owner_id TEXT NOT NULL, plan_id UUID NOT NULL, from_version INTEGER NOT NULL, to_version INTEGER NOT NULL,
  trigger TEXT NOT NULL, reason TEXT NOT NULL, change_summary JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(owner_id,id)
);
CREATE INDEX IF NOT EXISTS learning_plans_owner_status ON learning_plans(owner_id, status);
