-- 20261106040717_recording_shares.sql
-- A link to part of a recording, for somebody without an account.
--
-- The stretch of a call where the terms were agreed, sent to an LP or a
-- partner who was not on it: until now the only way to share a recording was
-- to download the whole file and send it, which hands over the full meeting
-- and can never be taken back. A share is a window [start_ms, end_ms) of one
-- recording, behind an unguessable token, that expires, can be revoked, and
-- counts how often it was opened.
--
-- The token itself is never stored, only its SHA-256: a leaked table is not a
-- set of working links. The public routes serve ONLY the recording parts
-- inside the window (plus the first, which carries the stream's header), so a
-- clip link cannot be turned into the whole recording.
--
-- Only a meeting's host may share its recording — the recording read policy
-- deliberately stops at the people who were in the meeting, and a host
-- choosing to send part of it outside is a decision for the host.

CREATE TABLE IF NOT EXISTS recording_shares (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash      text        NOT NULL UNIQUE,
  meeting_id      uuid        NOT NULL REFERENCES live_meetings(id) ON DELETE CASCADE,
  recording_id    uuid        NOT NULL REFERENCES live_meeting_recordings(id) ON DELETE CASCADE,
  organization_id uuid        REFERENCES organizations(id) ON DELETE CASCADE,
  created_by      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label           text        CHECK (label IS NULL OR length(label) <= 120),
  start_ms        integer     NOT NULL DEFAULT 0 CHECK (start_ms >= 0),
  end_ms          integer     CHECK (end_ms IS NULL OR end_ms > start_ms),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  open_count      integer     NOT NULL DEFAULT 0 CHECK (open_count >= 0),
  last_opened_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recording_shares_recording_idx ON recording_shares (recording_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recording_shares_creator_idx ON recording_shares (created_by, created_at DESC);

ALTER TABLE recording_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recording_shares_owner_read" ON recording_shares;
DROP POLICY IF EXISTS "recording_shares_owner_update" ON recording_shares;
DROP POLICY IF EXISTS "recording_shares_host_insert" ON recording_shares;

do $$ begin
  CREATE POLICY "recording_shares_owner_read" ON recording_shares
  FOR SELECT USING (created_by = auth.uid());
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

-- Revoking is the only change a creator makes; the routes write nothing else.
do $$ begin
  CREATE POLICY "recording_shares_owner_update" ON recording_shares
  FOR UPDATE USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

do $$ begin
  CREATE POLICY "recording_shares_host_insert" ON recording_shares
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND meeting_id IN (SELECT id FROM live_meetings WHERE host_id = auth.uid())
    AND recording_id IN (SELECT id FROM live_meeting_recordings r WHERE r.meeting_id = recording_shares.meeting_id)
  );
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

COMMENT ON TABLE recording_shares IS
  'Expiring, revocable links to a window of one recording, for people without an account. Only the token''s hash is stored.';
