-- Follow-up to 006. Historical migration files are immutable because the
-- migration runner records their checksums.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'learning_feedback_difficulty_check') THEN
    ALTER TABLE learning_feedback ADD CONSTRAINT learning_feedback_difficulty_check
      CHECK (difficulty IN ('too_easy','appropriate','too_hard'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'learning_adjustment_version_check') THEN
    ALTER TABLE learning_plan_adjustments ADD CONSTRAINT learning_adjustment_version_check
      CHECK (to_version > from_version);
  END IF;
END $$;

-- The legacy task snapshot has already been converted by 006. New writes use
-- learning_tasks and learning_task_schedules exclusively.
ALTER TABLE learning_stages DROP COLUMN IF EXISTS tasks;
