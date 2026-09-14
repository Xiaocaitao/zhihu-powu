-- Public terminology only. No owner proficiency, user goals, or learning records here.
CREATE TABLE shared_skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  aliases JSONB NOT NULL DEFAULT '[]',
  terms JSONB NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL CHECK (revision > 0)
);
CREATE INDEX shared_skills_terms_idx ON shared_skills USING GIN (terms);
