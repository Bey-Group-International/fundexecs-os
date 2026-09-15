-- Meeting recordings: the artifact, and the parts it is assembled from.
--
-- A live meeting here is a MESH. Every participant sends media to every other
-- participant and no server ever holds the streams, so nothing server-side can
-- record them — there is nothing in the middle to record. The only place all of
-- the media exists at once is a participant's browser, and the only participant
-- guaranteed to be present for the whole meeting, and entitled to the result,
-- is the host.
--
-- So the host's browser composites the call to a canvas, mixes the audio, and
-- encodes it. That works, and it has one failure mode this schema is shaped
-- around: the recording lives on one laptop until it is uploaded. Phase 1 of
-- this work was spent learning exactly that lesson about transcripts — a record
-- held only in a browser is a record one closed lid away from never existing.
--
-- Hence parts. The encoder emits every few seconds and each piece is uploaded
-- as it is produced, so a host whose battery dies loses seconds rather than an
-- hour. Nothing ever stitches them back into one object: Storage cannot
-- concatenate server-side, and pulling hundreds of megabytes through a
-- serverless function to rewrite them would cost more than storing them twice.
-- The playback route presents the parts as one byte stream instead, and answers
-- Range requests by mapping bytes onto the parts that hold them
-- (lib/meetings/recording-range.ts), which is what makes seeking work.

-- ---------------------------------------------------------------------------
-- live_meeting_recordings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS live_meeting_recordings (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id        uuid        NOT NULL REFERENCES live_meetings(id) ON DELETE CASCADE,
  -- The host who pressed Record. Kept even if their account is later removed:
  -- "who recorded this" is the question a consent dispute asks, and answering
  -- it with null helps nobody.
  started_by        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  started_by_name   text,
  started_at        timestamptz NOT NULL DEFAULT now(),
  ended_at          timestamptz,
  -- 'recording' is the live state. A row stuck there is a host who vanished
  -- mid-call; the sweep closes those out rather than leaving a recording that
  -- claims to still be running days later.
  status            text        NOT NULL DEFAULT 'recording'
                                CHECK (status IN ('recording', 'complete', 'failed', 'abandoned')),
  mime_type         text        NOT NULL DEFAULT 'video/webm',
  duration_seconds  integer,
  size_bytes        bigint      NOT NULL DEFAULT 0,
  chunk_count       integer     NOT NULL DEFAULT 0,
  -- When the sweep may delete the objects. Stored rather than computed so a
  -- deployment can extend one recording without changing the policy for all.
  expires_at        timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  -- Set once the objects are gone, so the row can still say a recording existed
  -- and why it no longer does.
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS live_meeting_recordings_meeting_idx
  ON live_meeting_recordings (meeting_id, started_at DESC);

-- The sweep's query: everything past its date that still has objects.
CREATE INDEX IF NOT EXISTS live_meeting_recordings_expiry_idx
  ON live_meeting_recordings (expires_at)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- live_meeting_recording_chunks
-- ---------------------------------------------------------------------------
-- One row per uploaded part. `size` is the reason this table exists at all:
-- answering a Range request means knowing where each part sits in the assembled
-- stream, and asking Storage for the size of seven hundred objects on every
-- seek is not a plan.
CREATE TABLE IF NOT EXISTS live_meeting_recording_chunks (
  recording_id uuid        NOT NULL REFERENCES live_meeting_recordings(id) ON DELETE CASCADE,
  -- Sequence number as the encoder produced it. The primary key with
  -- recording_id, so a retried upload of the same part replaces it rather than
  -- inserting a duplicate that would corrupt the assembled stream.
  idx          integer     NOT NULL,
  path         text        NOT NULL,
  size         integer     NOT NULL CHECK (size >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (recording_id, idx)
);

COMMENT ON TABLE live_meeting_recording_chunks IS
  'Ordered parts of one recording; sizes let the playback route answer Range requests without listing Storage.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE live_meeting_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_meeting_recording_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "live_meeting_recordings_read" ON live_meeting_recordings;
DROP POLICY IF EXISTS "live_meeting_recordings_host_write" ON live_meeting_recordings;
DROP POLICY IF EXISTS "live_meeting_recording_chunks_read" ON live_meeting_recording_chunks;
DROP POLICY IF EXISTS "live_meeting_recording_chunks_host_write" ON live_meeting_recording_chunks;

-- Readable by the people who were in the meeting — the same rule the
-- transcripts and reports use. A recording is the most revealing thing a
-- meeting produces, so this is deliberately not widened to the org.
do $$ begin
  CREATE POLICY "live_meeting_recordings_read" ON live_meeting_recordings
  FOR SELECT USING (
    meeting_id IN (
      SELECT id FROM live_meetings WHERE host_id = auth.uid()
      UNION
      SELECT meeting_id FROM live_meeting_participants WHERE user_id = auth.uid()
    )
  );
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

-- Only the host writes, because only the host records. This is the whole
-- authorization story for the upload path: the browser PUTs parts straight to
-- Storage, and the bucket policy below asks the same question.
do $$ begin
  CREATE POLICY "live_meeting_recordings_host_write" ON live_meeting_recordings
  FOR ALL USING (
    meeting_id IN (SELECT id FROM live_meetings WHERE host_id = auth.uid())
  ) WITH CHECK (
    meeting_id IN (SELECT id FROM live_meetings WHERE host_id = auth.uid())
  );
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

do $$ begin
  CREATE POLICY "live_meeting_recording_chunks_read" ON live_meeting_recording_chunks
  FOR SELECT USING (
    recording_id IN (
      SELECT r.id FROM live_meeting_recordings r
      WHERE r.meeting_id IN (
        SELECT id FROM live_meetings WHERE host_id = auth.uid()
        UNION
        SELECT meeting_id FROM live_meeting_participants WHERE user_id = auth.uid()
      )
    )
  );
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

do $$ begin
  CREATE POLICY "live_meeting_recording_chunks_host_write" ON live_meeting_recording_chunks
  FOR ALL USING (
    recording_id IN (
      SELECT r.id FROM live_meeting_recordings r
      JOIN live_meetings m ON m.id = r.meeting_id
      WHERE m.host_id = auth.uid()
    )
  ) WITH CHECK (
    recording_id IN (
      SELECT r.id FROM live_meeting_recordings r
      JOIN live_meetings m ON m.id = r.meeting_id
      WHERE m.host_id = auth.uid()
    )
  );
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- meeting-recordings Storage bucket (private)
-- ---------------------------------------------------------------------------
-- Never public. A recording carries faces, voices and whatever was on a shared
-- screen; the only way to read one is a short-lived signed URL minted after the
-- route has decided the reader was in the meeting.
--
-- 32 MB per object: a part is ~940KB at the bitrates in recording-policy.ts, so
-- this is thirty times the expected size and still a hard stop on a browser
-- that decides to emit something enormous.
insert into storage.buckets (id, name, public, file_size_limit)
values ('meeting-recordings', 'meeting-recordings', false, 33554432)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit;

-- ---------------------------------------------------------------------------
-- Storage policies
-- ---------------------------------------------------------------------------
-- Objects are keyed `<meeting_id>/<recording_id>/part-NNNNNN.webm`, so the
-- first path segment is the meeting and the host check is a lookup on it.
--
-- SECURITY DEFINER, like the document bucket's helper and for the same reason:
-- a policy that selects from live_meetings under the caller's own RLS recurses.
create or replace function public.is_live_meeting_host(meeting uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.live_meetings
    where id = meeting and host_id = auth.uid()
  );
$$;

create or replace function public.attended_live_meeting(meeting uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.live_meetings
    where id = meeting and host_id = auth.uid()
  ) or exists (
    select 1 from public.live_meeting_participants
    where meeting_id = meeting and user_id = auth.uid()
  );
$$;

drop policy if exists "meeting_recordings_host_insert" on storage.objects;
drop policy if exists "meeting_recordings_attendee_read" on storage.objects;

do $$ begin
  create policy "meeting_recordings_host_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'meeting-recordings'
    and public.is_live_meeting_host(((storage.foldername(name))[1])::uuid)
  );
exception when undefined_function or undefined_table or duplicate_object then null; end $$;

do $$ begin
  create policy "meeting_recordings_attendee_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'meeting-recordings'
    and public.attended_live_meeting(((storage.foldername(name))[1])::uuid)
  );
exception when undefined_function or undefined_table or duplicate_object then null; end $$;
