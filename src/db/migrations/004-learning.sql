CREATE TABLE IF NOT EXISTS learning_plans (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('trial','final')),
  status TEXT NOT NULL CHECK (status IN ('draft','active','paused','completed','archived')),
  source_profile_version INT NOT NULL CHECK (source_profile_version > 0),
  source_career_plan_version INT CHECK (source_career_plan_version IS NULL OR source_career_plan_version > 0),
  target_job_id UUID,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  weekly_minutes INT NOT NULL CHECK (weekly_minutes > 0),
  version INT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS learning_plans_one_active_final ON learning_plans(owner_id) WHERE mode='final' AND status='active';
CREATE INDEX IF NOT EXISTS learning_plans_owner_status ON learning_plans(owner_id,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS learning_stages (
  id UUID PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES learning_plans(id) ON DELETE CASCADE,
  stage_order INT NOT NULL CHECK (stage_order > 0),
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  status TEXT NOT NULL,
  assessment_required BOOLEAN NOT NULL DEFAULT false,
  assessment_id UUID,
  progress_percent INT NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  UNIQUE(plan_id,stage_order),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS learning_tasks (
  id UUID PRIMARY KEY,
  stage_id UUID NOT NULL REFERENCES learning_stages(id) ON DELETE CASCADE,
  parent_task_id UUID REFERENCES learning_tasks(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  task_type TEXT NOT NULL CHECK (task_type IN ('reading','practice','project','review')),
  status TEXT NOT NULL CHECK (status IN ('todo','in_progress','completed','paused')),
  priority INT NOT NULL CHECK (priority > 0),
  estimated_minutes INT NOT NULL CHECK (estimated_minutes > 0),
  actual_minutes INT NOT NULL DEFAULT 0 CHECK (actual_minutes >= 0),
  capability_key TEXT,
  evidence_required BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS learning_tasks_stage_priority ON learning_tasks(stage_id,priority,id);

CREATE TABLE IF NOT EXISTS learning_task_schedules (
  id UUID PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES learning_tasks(id) ON DELETE CASCADE,
  schedule_date DATE NOT NULL,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  duration_minutes INT NOT NULL CHECK (duration_minutes > 0),
  status TEXT NOT NULL CHECK (status IN ('scheduled','done','missed','rescheduled'))
);
CREATE INDEX IF NOT EXISTS learning_task_schedules_date ON learning_task_schedules(schedule_date,task_id);

CREATE TABLE IF NOT EXISTS learning_feedback (
  id UUID PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES learning_plans(id) ON DELETE CASCADE,
  task_id UUID REFERENCES learning_tasks(id) ON DELETE SET NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('too_easy','appropriate','too_hard')),
  reason TEXT CHECK (reason IS NULL OR reason IN ('missing_prerequisite','unclear_first_step','cannot_apply','too_much_content','insufficient_time','lack_of_feedback','other')),
  actual_minutes INT CHECK (actual_minutes IS NULL OR actual_minutes >= 0),
  available_minutes INT CHECK (available_minutes IS NULL OR available_minutes >= 0),
  confidence_score INT CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 100),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS learning_feedback_plan_created ON learning_feedback(plan_id,created_at DESC);

CREATE TABLE IF NOT EXISTS learning_plan_adjustments (
  id UUID PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES learning_plans(id) ON DELETE CASCADE,
  from_version INT NOT NULL,
  to_version INT NOT NULL,
  trigger TEXT NOT NULL,
  reason TEXT NOT NULL,
  change_summary JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (to_version > from_version)
);
CREATE INDEX IF NOT EXISTS learning_plan_adjustments_plan_created ON learning_plan_adjustments(plan_id,created_at DESC);

CREATE TABLE IF NOT EXISTS learning_idempotency_records (
  owner_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  command_name TEXT NOT NULL,
  request_id UUID NOT NULL,
  request_hash TEXT NOT NULL,
  result_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,idempotency_key)
);
