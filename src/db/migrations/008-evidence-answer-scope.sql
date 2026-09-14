-- An answer must reference a question in the same owner's interview.
-- Invalid existing data fails migration instead of being silently deleted.
ALTER TABLE ei_questions ADD CONSTRAINT ei_questions_owner_interview_id_unique
  UNIQUE (owner_id, interview_id, id);
ALTER TABLE ei_answers ADD CONSTRAINT ei_answers_scoped_question_fk
  FOREIGN KEY (owner_id, interview_id, question_id)
  REFERENCES ei_questions(owner_id, interview_id, id) ON DELETE CASCADE;
