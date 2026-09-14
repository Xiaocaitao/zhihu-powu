ALTER TABLE ei_records ADD COLUMN details JSONB NOT NULL DEFAULT '{}';
ALTER TABLE ei_assessments ADD COLUMN details JSONB NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX ei_records_one_source_fact ON ei_records(owner_id,source_domain,source_entity_id);
CREATE TABLE ei_record_revisions (
  owner_id TEXT NOT NULL,
  record_id UUID NOT NULL,
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (owner_id,record_id,version),
  FOREIGN KEY (owner_id,record_id) REFERENCES ei_records(owner_id,id)
);
