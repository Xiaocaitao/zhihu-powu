-- Learning normalized storage. The owner type remains TEXT for compatibility
-- with the anonymous/authenticated owner boundary used by the main branch.
ALTER TABLE learning_plans ADD COLUMN IF NOT EXISTS available_slots JSONB NOT NULL DEFAULT '[]';
ALTER TABLE learning_plans ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE learning_stages ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE learning_stages ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE learning_stages ADD COLUMN IF NOT EXISTS assessment_required BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE learning_stages ADD COLUMN IF NOT EXISTS assessment_id UUID;
ALTER TABLE learning_stages ADD COLUMN IF NOT EXISTS progress_percent INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS learning_tasks (
  id UUID PRIMARY KEY,
  stage_id UUID NOT NULL REFERENCES learning_stages(id) ON DELETE CASCADE,
  parent_task_id UUID REFERENCES learning_tasks(id) ON DELETE SET NULL,
  title VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  task_type VARCHAR(32) NOT NULL CHECK (task_type IN ('reading','practice','project','review')),
  status VARCHAR(32) NOT NULL CHECK (status IN ('todo','in_progress','completed','paused')),
  priority INTEGER NOT NULL CHECK (priority > 0),
  estimated_minutes INTEGER NOT NULL CHECK (estimated_minutes > 0),
  actual_minutes INTEGER CHECK (actual_minutes IS NULL OR actual_minutes >= 0),
  capability_key VARCHAR(160),
  evidence_required BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learning_task_schedules (
  id UUID PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES learning_tasks(id) ON DELETE CASCADE,
  schedule_date DATE NOT NULL,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  status VARCHAR(32) NOT NULL CHECK (status IN ('scheduled','done','missed','rescheduled')),
  CHECK (end_at IS NULL OR start_at IS NULL OR end_at > start_at)
);

CREATE TABLE IF NOT EXISTS learning_idempotency_records (
  owner_id TEXT NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  command_name VARCHAR(128) NOT NULL,
  request_id TEXT NOT NULL,
  request_hash VARCHAR(128) NOT NULL,
  result_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS learning_plans_one_active_final
  ON learning_plans(owner_id)
  WHERE mode = 'final' AND status = 'active';
CREATE INDEX IF NOT EXISTS learning_stages_plan_order ON learning_stages(plan_id, stage_order);
CREATE INDEX IF NOT EXISTS learning_tasks_stage_priority ON learning_tasks(stage_id, priority);
CREATE INDEX IF NOT EXISTS learning_task_schedules_date ON learning_task_schedules(schedule_date, status);
CREATE INDEX IF NOT EXISTS learning_feedback_plan_created ON learning_feedback(plan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS learning_adjustments_plan_version ON learning_plan_adjustments(plan_id, to_version DESC);

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

-- Convert the JSONB task snapshot written by the old repository. The temporary
-- map gives legacy rows stable UUIDs even when an old task omitted its id.
CREATE TEMP TABLE learning_task_migration_map (
  task_id UUID PRIMARY KEY,
  stage_id UUID NOT NULL,
  plan_id UUID NOT NULL,
  position INTEGER NOT NULL,
  payload JSONB NOT NULL
) ON COMMIT DROP;

INSERT INTO learning_task_migration_map(task_id, stage_id, plan_id, position, payload)
SELECT
  CASE
    WHEN task.item->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (task.item->>'id')::uuid
    ELSE (
      substr(md5(s.id::text || ':' || task.position::text), 1, 8) || '-' ||
      substr(md5(s.id::text || ':' || task.position::text), 9, 4) || '-' ||
      substr(md5(s.id::text || ':' || task.position::text), 13, 4) || '-' ||
      substr(md5(s.id::text || ':' || task.position::text), 17, 4) || '-' ||
      substr(md5(s.id::text || ':' || task.position::text), 21, 12)
    )::uuid
  END,
  s.id,
  s.plan_id,
  task.position,
  task.item
FROM learning_stages s
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.tasks, '[]'::jsonb)) WITH ORDINALITY AS task(item, position)
ON CONFLICT (task_id) DO NOTHING;

INSERT INTO learning_tasks(
  id, stage_id, parent_task_id, title, description, task_type, status, priority,
  estimated_minutes, actual_minutes, capability_key, evidence_required, created_at, updated_at
)
SELECT
  map.task_id,
  map.stage_id,
  CASE WHEN map.payload->>'parentTaskId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (map.payload->>'parentTaskId')::uuid ELSE NULL END,
  COALESCE(NULLIF(map.payload->>'title', ''), '未命名任务'),
  COALESCE(map.payload->>'description', ''),
  CASE WHEN map.payload->>'taskType' IN ('reading','practice','project','review') THEN map.payload->>'taskType' ELSE 'practice' END,
  CASE WHEN map.payload->>'status' IN ('todo','in_progress','completed','paused') THEN map.payload->>'status' ELSE 'todo' END,
  GREATEST(COALESCE((map.payload->>'priority')::integer, map.position), 1),
  GREATEST(CASE WHEN (map.payload->>'estimatedMinutes') ~ '^[0-9]+$' THEN (map.payload->>'estimatedMinutes')::integer ELSE 1 END, 1),
  CASE WHEN (map.payload->>'actualMinutes') ~ '^[0-9]+$' THEN (map.payload->>'actualMinutes')::integer ELSE NULL END,
  NULLIF(map.payload->>'capabilityKey', ''),
  CASE WHEN map.payload->>'evidenceRequired' IN ('true', 'false') THEN (map.payload->>'evidenceRequired')::boolean ELSE FALSE END,
  now(), now()
FROM learning_task_migration_map map
ON CONFLICT (id) DO NOTHING;

INSERT INTO learning_task_schedules(id, task_id, schedule_date, start_at, end_at, duration_minutes, status)
SELECT
  CASE
    WHEN schedule.item->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (schedule.item->>'id')::uuid
    ELSE (
      substr(md5(map.task_id::text || ':' || schedule.position::text), 1, 8) || '-' ||
      substr(md5(map.task_id::text || ':' || schedule.position::text), 9, 4) || '-' ||
      substr(md5(map.task_id::text || ':' || schedule.position::text), 13, 4) || '-' ||
      substr(md5(map.task_id::text || ':' || schedule.position::text), 17, 4) || '-' ||
      substr(md5(map.task_id::text || ':' || schedule.position::text), 21, 12)
    )::uuid
  END,
  map.task_id,
  COALESCE(NULLIF(schedule.item->>'scheduleDate', '')::date, p.start_date),
  NULLIF(schedule.item->>'startAt', '')::timestamptz,
  NULLIF(schedule.item->>'endAt', '')::timestamptz,
  GREATEST(CASE WHEN (schedule.item->>'durationMinutes') ~ '^[0-9]+$' THEN (schedule.item->>'durationMinutes')::integer ELSE t.estimated_minutes END, 1),
  CASE WHEN schedule.item->>'status' IN ('scheduled','done','missed','rescheduled') THEN schedule.item->>'status' ELSE 'scheduled' END
FROM learning_task_migration_map map
JOIN learning_plans p ON p.id = map.plan_id
JOIN learning_tasks t ON t.id = map.task_id
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(map.payload->'schedules', '[]'::jsonb)) WITH ORDINALITY AS schedule(item, position)
ON CONFLICT (id) DO NOTHING;

-- Every legacy task had a task-level date but not necessarily a schedule row.
INSERT INTO learning_task_schedules(id, task_id, schedule_date, duration_minutes, status)
SELECT
  (substr(md5(map.task_id::text || ':fallback'), 1, 8) || '-' ||
   substr(md5(map.task_id::text || ':fallback'), 9, 4) || '-' ||
   substr(md5(map.task_id::text || ':fallback'), 13, 4) || '-' ||
   substr(md5(map.task_id::text || ':fallback'), 17, 4) || '-' ||
   substr(md5(map.task_id::text || ':fallback'), 21, 12))::uuid,
  map.task_id,
  COALESCE(NULLIF(map.payload->>'scheduleDate', '')::date, p.start_date),
  t.estimated_minutes,
  'scheduled'
FROM learning_task_migration_map map
JOIN learning_plans p ON p.id = map.plan_id
JOIN learning_tasks t ON t.id = map.task_id
WHERE NOT EXISTS (SELECT 1 FROM learning_task_schedules s WHERE s.task_id = map.task_id)
ON CONFLICT (id) DO NOTHING;

UPDATE learning_stages s
SET start_date = p.start_date,
    end_date = p.end_date,
    progress_percent = COALESCE((
      SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE t.status = 'completed') / NULLIF(COUNT(*), 0))::integer
      FROM learning_tasks t WHERE t.stage_id = s.id
    ), 0)
FROM learning_plans p
WHERE p.id = s.plan_id;
