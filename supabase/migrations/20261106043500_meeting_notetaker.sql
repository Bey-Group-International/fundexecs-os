-- 20261106043500_meeting_notetaker.sql
-- The meeting notetaker: what the host has set for it, the notes it keeps as
-- the meeting runs, each person's own notes and bookmarks, and the firm's
-- glossary of names and terms the recogniser gets wrong.
--
--   live_meetings.notetaker   the host's settings: paused, who sees the live
--                             notes, the transcription language. One small
--                             JSON object, read by everyone in the room.
--   live_meetings.live_notes  the latest AI notes for the meeting, shared by
--                             the whole room so one model call serves everyone.
--   live_meeting_notes        one row per person per meeting: what they typed.
--   live_meeting_bookmarks    moments people flagged while it was happening.
--   meeting_glossary_terms    the firm's spellings: "Dunbar Capital", "LPAC".
--
-- The routes authorise the caller (host, member, participant) and write with
-- the service role; the policies below are the floor for any direct read.

ALTER TABLE live_meetings ADD COLUMN IF NOT EXISTS notetaker jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE live_meetings ADD COLUMN IF NOT EXISTS live_notes jsonb;

CREATE TABLE IF NOT EXISTS live_meeting_notes (
  meeting_id  uuid        NOT NULL REFERENCES live_meetings(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body        text        NOT NULL DEFAULT '' CHECK (length(body) <= 20000),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, user_id)
);

CREATE TABLE IF NOT EXISTS live_meeting_bookmarks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  uuid        NOT NULL REFERENCES live_meetings(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  at          timestamptz NOT NULL,
  label       text        CHECK (label IS NULL OR length(label) <= 200),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS live_meeting_bookmarks_meeting_idx ON live_meeting_bookmarks (meeting_id, at);

CREATE TABLE IF NOT EXISTS meeting_glossary_terms (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  term            text        NOT NULL CHECK (length(term) BETWEEN 2 AND 80),
  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS meeting_glossary_terms_org_term_idx
  ON meeting_glossary_terms (organization_id, lower(term));

ALTER TABLE live_meeting_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_meeting_bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_glossary_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "live_meeting_notes_own" ON live_meeting_notes;
DROP POLICY IF EXISTS "live_meeting_bookmarks_own" ON live_meeting_bookmarks;
DROP POLICY IF EXISTS "live_meeting_bookmarks_host_read" ON live_meeting_bookmarks;
DROP POLICY IF EXISTS "meeting_glossary_terms_org_read" ON meeting_glossary_terms;

-- Your notes are yours: nobody else reads them, the host included.
do $$ begin
  CREATE POLICY "live_meeting_notes_own" ON live_meeting_notes
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

do $$ begin
  CREATE POLICY "live_meeting_bookmarks_own" ON live_meeting_bookmarks
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

-- The host reads everyone's bookmarks: they are moments for the report.
do $$ begin
  CREATE POLICY "live_meeting_bookmarks_host_read" ON live_meeting_bookmarks
  FOR SELECT USING (meeting_id IN (SELECT id FROM live_meetings WHERE host_id = auth.uid()));
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

do $$ begin
  CREATE POLICY "meeting_glossary_terms_org_read" ON meeting_glossary_terms
  FOR SELECT USING (organization_id IN (SELECT public.current_principal_org_ids()));
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

COMMENT ON COLUMN live_meetings.notetaker IS
  'Host settings for the notetaker: {paused, notesVisibility: "everyone"|"host", lang}.';
COMMENT ON COLUMN live_meetings.live_notes IS
  'The latest live AI notes, shared by the room: {key_points, decisions, action_items, summary, generatedAt, lines}.';
COMMENT ON TABLE meeting_glossary_terms IS
  'A firm''s names and terms, used to correct the live transcript and told to the report model.';
