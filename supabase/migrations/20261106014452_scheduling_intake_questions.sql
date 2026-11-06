-- 20261106014452_scheduling_intake_questions.sql
-- The questions a bookable meeting type asks the person booking it.
--
-- "Which fund is this about?", "Roughly what size is the commitment?": a host
-- used to ask these on the call itself, or in an email chain before it, because
-- the booking page only offered one free-text box that most people left blank.
-- A meeting type can now carry a few short questions of its own.
--
-- Stored as a JSON array of {id, label, kind, options, required}, read through
-- lib/meetings/intake.ts. The answers are not stored here or in a column of
-- their own: they are folded into the booking's existing notes, so they reach
-- the meeting description, the host's emails and the report brief through the
-- paths the notes already take.

ALTER TABLE scheduling_event_types
  ADD COLUMN IF NOT EXISTS intake_questions jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$ BEGIN
  ALTER TABLE scheduling_event_types
    ADD CONSTRAINT scheduling_event_types_intake_questions_array
    CHECK (jsonb_typeof(intake_questions) = 'array' AND jsonb_array_length(intake_questions) <= 5);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN scheduling_event_types.intake_questions IS
  'Questions the booking page asks for this meeting type: [{id, label, kind: short|long|choice, options, required}], at most 5.';
