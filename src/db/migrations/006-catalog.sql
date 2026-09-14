CREATE TABLE IF NOT EXISTS career_catalog_jobs (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL, title TEXT NOT NULL, company_name TEXT,
  city TEXT, employment_type TEXT, salary_text TEXT, description TEXT NOT NULL,
  requirements JSONB NOT NULL DEFAULT '[]', responsibilities JSONB NOT NULL DEFAULT '[]',
  tags JSONB NOT NULL DEFAULT '[]', source_url TEXT, collected_at TIMESTAMPTZ,
  content_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_id, content_hash)
);
CREATE INDEX IF NOT EXISTS career_catalog_jobs_search ON career_catalog_jobs USING GIN (to_tsvector('simple', title || ' ' || coalesce(company_name,'') || ' ' || description));
CREATE INDEX IF NOT EXISTS career_catalog_jobs_city ON career_catalog_jobs(city);

CREATE TABLE IF NOT EXISTS career_catalog_interviews (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL,
  company_name TEXT, job_title TEXT, city TEXT, interview_round TEXT, result TEXT,
  question_count INTEGER, tags JSONB NOT NULL DEFAULT '[]', source_url TEXT,
  collected_at TIMESTAMPTZ, content_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_id, content_hash)
);
CREATE INDEX IF NOT EXISTS career_catalog_interviews_search ON career_catalog_interviews USING GIN (to_tsvector('simple', title || ' ' || content));
CREATE INDEX IF NOT EXISTS career_catalog_interviews_tags ON career_catalog_interviews USING GIN (tags);
