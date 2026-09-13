CREATE TABLE IF NOT EXISTS ei_projects (
  id UUID PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id)
);

CREATE TABLE IF NOT EXISTS ei_records (
  id UUID PRIMARY KEY,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('activity','project_outcome','task_change','learning_feedback','plan_adjustment','assessment_result','interview_result')),
  status TEXT NOT NULL CHECK (status IN ('active','withdrawn')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  project_id UUID,
  task_id TEXT,
  skill_ids JSONB NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  source_domain TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, source_domain, source_entity_id, source_revision),
  FOREIGN KEY (owner_id, project_id) REFERENCES ei_projects(owner_id, id)
);
CREATE INDEX IF NOT EXISTS ei_records_owner_occurred ON ei_records(owner_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ei_records_owner_task ON ei_records(owner_id, task_id);

CREATE TABLE IF NOT EXISTS ei_assessments (
  id UUID PRIMARY KEY,
  owner_id TEXT NOT NULL,
  evidence_ids JSONB NOT NULL,
  skill_ids JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('not_started','running','succeeded','failed')),
  findings JSONB NOT NULL DEFAULT '[]',
  operation_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, operation_key)
);

CREATE TABLE IF NOT EXISTS ei_reviews (
  id UUID PRIMARY KEY,
  owner_id TEXT NOT NULL,
  range_from TIMESTAMPTZ NOT NULL,
  range_to TIMESTAMPTZ NOT NULL,
  time_zone TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('not_started','running','succeeded','failed')),
  result JSONB,
  operation_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, operation_key),
  CHECK (range_from < range_to)
);

CREATE TABLE IF NOT EXISTS ei_interviews (
  id UUID PRIMARY KEY,
  owner_id TEXT NOT NULL,
  target JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('preparing','active','completed','ended_early','preparation_failed')),
  difficulty TEXT,
  total_questions INTEGER CHECK (total_questions IS NULL OR total_questions BETWEEN 1 AND 20),
  answered_count INTEGER NOT NULL DEFAULT 0 CHECK (answered_count >= 0),
  version INTEGER NOT NULL DEFAULT 1,
  operation_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, operation_key)
);
CREATE INDEX IF NOT EXISTS ei_interviews_owner_created ON ei_interviews(owner_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS ei_questions (
  id UUID PRIMARY KEY,
  owner_id TEXT NOT NULL,
  interview_id UUID NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  category TEXT NOT NULL,
  prompt TEXT NOT NULL,
  skill_ids JSONB NOT NULL DEFAULT '[]',
  private_rubric JSONB NOT NULL DEFAULT '{}',
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, interview_id, ordinal),
  FOREIGN KEY (owner_id, interview_id) REFERENCES ei_interviews(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ei_answers (
  id UUID PRIMARY KEY,
  owner_id TEXT NOT NULL,
  interview_id UUID NOT NULL,
  question_id UUID NOT NULL,
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, interview_id, question_id),
  FOREIGN KEY (owner_id, interview_id) REFERENCES ei_interviews(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, question_id) REFERENCES ei_questions(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ei_answer_feedback (
  id UUID PRIMARY KEY,
  owner_id TEXT NOT NULL,
  answer_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('not_started','running','succeeded','failed')),
  result JSONB,
  operation_key TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, answer_id),
  UNIQUE (owner_id, operation_key),
  FOREIGN KEY (owner_id, answer_id) REFERENCES ei_answers(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ei_interview_reports (
  id UUID PRIMARY KEY,
  owner_id TEXT NOT NULL,
  interview_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('not_started','running','succeeded','failed')),
  result JSONB,
  operation_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, interview_id),
  UNIQUE (owner_id, operation_key),
  FOREIGN KEY (owner_id, interview_id) REFERENCES ei_interviews(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ei_operations (
  id UUID PRIMARY KEY,
  owner_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  entity_id UUID,
  phase TEXT NOT NULL,
  generation_status TEXT,
  result JSONB,
  error JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, capability, operation_key)
);
