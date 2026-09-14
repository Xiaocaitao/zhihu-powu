-- Aggregates are stored as one JSON document next to the columns used for
-- ownership, ordering and constraints. Child rows stay authoritative for
-- uniqueness so concurrent writers cannot create two answers for one question.
ALTER TABLE ei_interviews ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}';
ALTER TABLE ei_questions ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}';
ALTER TABLE ei_answers ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}';
ALTER TABLE ei_reviews ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}';
ALTER TABLE ei_reviews ADD COLUMN IF NOT EXISTS stage_id TEXT;
ALTER TABLE ei_assessments ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}';
ALTER TABLE ei_interview_reports ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}';
