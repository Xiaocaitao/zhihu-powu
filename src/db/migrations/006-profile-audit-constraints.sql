-- Add the audit uniqueness invariant without changing the checksum of the
-- already-applied 005-profile-audit.sql migration.
-- Keep the earliest row for a repeated entity version before adding the index.
DELETE FROM profile_change_log duplicate
USING profile_change_log original
WHERE duplicate.owner_id = original.owner_id
  AND duplicate.entity_type = original.entity_type
  AND duplicate.entity_id = original.entity_id
  AND duplicate.entity_version = original.entity_version
  AND duplicate.ctid > original.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS profile_change_log_entity_version_uq
  ON profile_change_log (owner_id, entity_type, entity_id, entity_version);
