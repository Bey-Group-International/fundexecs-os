-- 20261106170000_recording_share_security.sql
-- Shared clips, made safe to send outside the firm.
--
--   Trimmed clips    A clip used to be served from the recording's own parts:
--                    the first part (about five seconds of the start of the
--                    meeting, because it carries the stream's header) and a
--                    part of slack either side of the window went to anyone
--                    with the link. A clip is now its own file, cut on the
--                    server when the link is made (lib/meetings/webm-clip.ts)
--                    and stored as parts of its own; the public routes read
--                    only those. Links made before this are cut by the hourly
--                    sweep and answer "being prepared" until then.
--
--   Download control A link streams only, unless its creator allows saving a
--                    copy (allow_download, off by default).
--
--   Access log       Every opening and download of a link, so the host can
--                    see who has looked: when, on what kind of device, and
--                    how many different viewers. The viewer's address is
--                    never stored, only a hash of it salted with the link,
--                    which counts viewers without identifying them.
--
--   Locked columns   The creator could change any column of their link
--                    through the update policy, including which recording it
--                    points to. Column grants now limit them to revoking it
--                    and the download switch; the insert grant likewise keeps
--                    them out of the trimming state the server owns.
--
--   Storage          Uploads into the recordings bucket must name a recording
--                    of a meeting the uploader hosts, under its own folder,
--                    as a numbered part; a retried upload of the same part
--                    may replace it. The folder checks take text, so a stray
--                    object whose folder is not a uuid reads as "no" instead
--                    of failing the whole policy with a cast error.

-- ── recording_shares: the trimmed clip and the download switch ─────────────

ALTER TABLE recording_shares ADD COLUMN IF NOT EXISTS clip_status text NOT NULL DEFAULT 'pending';
ALTER TABLE recording_shares ADD COLUMN IF NOT EXISTS clip_error text;
ALTER TABLE recording_shares ADD COLUMN IF NOT EXISTS clip_offset_ms integer;
ALTER TABLE recording_shares ADD COLUMN IF NOT EXISTS clip_duration_ms integer;
ALTER TABLE recording_shares ADD COLUMN IF NOT EXISTS clip_bytes bigint;
ALTER TABLE recording_shares ADD COLUMN IF NOT EXISTS clip_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE recording_shares ADD COLUMN IF NOT EXISTS clip_started_at timestamptz;
ALTER TABLE recording_shares ADD COLUMN IF NOT EXISTS purged_at timestamptz;
ALTER TABLE recording_shares ADD COLUMN IF NOT EXISTS allow_download boolean NOT NULL DEFAULT false;

do $$ begin
  ALTER TABLE recording_shares ADD CONSTRAINT recording_shares_clip_status_check
    CHECK (clip_status IN ('pending', 'processing', 'ready', 'failed'));
exception when duplicate_object then null; end $$;

-- What the sweep looks for: clips still to cut, and clips whose link is over.
CREATE INDEX IF NOT EXISTS recording_shares_clip_todo_idx
  ON recording_shares (clip_status, created_at)
  WHERE clip_status IN ('pending', 'processing', 'failed');
CREATE INDEX IF NOT EXISTS recording_shares_purge_idx
  ON recording_shares (expires_at)
  WHERE purged_at IS NULL;

-- ── recording_share_parts: the clip's own media ────────────────────────────
-- Written and read only by the server (service role); no policies.

CREATE TABLE IF NOT EXISTS recording_share_parts (
  share_id    uuid    NOT NULL REFERENCES recording_shares(id) ON DELETE CASCADE,
  idx         integer NOT NULL CHECK (idx >= 0),
  path        text    NOT NULL,
  size        integer NOT NULL CHECK (size >= 0),
  offset_ms   integer NOT NULL CHECK (offset_ms >= 0),
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  PRIMARY KEY (share_id, idx)
);

ALTER TABLE recording_share_parts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE recording_share_parts IS
  'The stored parts of a trimmed clip. The public clip routes serve these and nothing else.';

-- ── recording_share_views: who opened a link ───────────────────────────────

CREATE TABLE IF NOT EXISTS recording_share_views (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id   uuid        NOT NULL REFERENCES recording_shares(id) ON DELETE CASCADE,
  kind       text        NOT NULL CHECK (kind IN ('open', 'download')),
  viewer     text        NOT NULL CHECK (length(viewer) BETWEEN 8 AND 64),
  device     text        CHECK (device IS NULL OR length(device) <= 80),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recording_share_views_share_idx ON recording_share_views (share_id, created_at DESC);

ALTER TABLE recording_share_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recording_share_views_owner_read" ON recording_share_views;

-- The person who made the link reads its log; the server writes it.
do $$ begin
  CREATE POLICY "recording_share_views_owner_read" ON recording_share_views
  FOR SELECT USING (share_id IN (SELECT id FROM recording_shares WHERE created_by = auth.uid()));
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

COMMENT ON TABLE recording_share_views IS
  'Each opening or download of a shared clip. viewer is a hash of the address salted with the link, never the address.';
COMMENT ON COLUMN recording_share_views.device IS 'A coarse label such as "Chrome on macOS", not the user agent.';

-- ── Column grants: what a creator may write themselves ────────────────────
-- The routes go through the caller's own client, so these are the real limit
-- on a hand-made request. The service role keeps its own grants.

do $$ begin
  REVOKE UPDATE ON recording_shares FROM authenticated, anon;
  GRANT UPDATE (revoked_at, allow_download) ON recording_shares TO authenticated;
  REVOKE INSERT ON recording_shares FROM authenticated, anon;
  GRANT INSERT (token_hash, meeting_id, recording_id, organization_id, created_by, label, start_ms, end_ms, expires_at, allow_download)
    ON recording_shares TO authenticated;
exception when undefined_object or undefined_table then null; end $$;

-- Revoking is one-way: a link turned off stays off (its clip is deleted by
-- the sweep), so nothing may set revoked_at back.
create or replace function public.recording_shares_keep_revoked()
returns trigger
language plpgsql
as $$
begin
  if old.revoked_at is not null then
    new.revoked_at := old.revoked_at;
  end if;
  return new;
end;
$$;

drop trigger if exists recording_shares_keep_revoked on recording_shares;
create trigger recording_shares_keep_revoked
  before update on recording_shares
  for each row execute function public.recording_shares_keep_revoked();

-- The update policy, restated with the reason it is now enough.
DROP POLICY IF EXISTS "recording_shares_owner_update" ON recording_shares;
do $$ begin
  CREATE POLICY "recording_shares_owner_update" ON recording_shares
  FOR UPDATE USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

-- ── Storage: the recordings bucket ─────────────────────────────────────────

create or replace function public.recording_upload_allowed(meeting text, recording text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.live_meeting_recordings r
    join public.live_meetings m on m.id = r.meeting_id
    where m.id::text = meeting
      and r.id::text = recording
      and m.host_id = auth.uid()
      and r.deleted_at is null
  );
$$;

create or replace function public.attended_live_meeting_text(meeting text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.live_meetings
    where id::text = meeting and host_id = auth.uid()
  ) or exists (
    select 1 from public.live_meeting_participants
    where meeting_id::text = meeting and user_id = auth.uid()
  );
$$;

drop policy if exists "meeting_recordings_host_insert" on storage.objects;
drop policy if exists "meeting_recordings_host_update" on storage.objects;
drop policy if exists "meeting_recordings_attendee_read" on storage.objects;

-- `<meeting>/<recording>/part-NNNNNN.<ext>` and nothing else: the recorder's
-- own naming (chunkPath), for a recording the uploader is hosting.
do $$ begin
  create policy "meeting_recordings_host_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'meeting-recordings'
    and array_length(storage.foldername(name), 1) = 2
    and storage.filename(name) ~ '^part-[0-9]{6,}\.(webm|mp4|m4a|ogg)$'
    and public.recording_upload_allowed((storage.foldername(name))[1], (storage.foldername(name))[2])
  );
exception when undefined_function or undefined_table or duplicate_object then null; end $$;

-- A retried upload replaces the part it already stored (upsert).
do $$ begin
  create policy "meeting_recordings_host_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'meeting-recordings'
    and array_length(storage.foldername(name), 1) = 2
    and storage.filename(name) ~ '^part-[0-9]{6,}\.(webm|mp4|m4a|ogg)$'
    and public.recording_upload_allowed((storage.foldername(name))[1], (storage.foldername(name))[2])
  )
  with check (
    bucket_id = 'meeting-recordings'
    and array_length(storage.foldername(name), 1) = 2
    and storage.filename(name) ~ '^part-[0-9]{6,}\.(webm|mp4|m4a|ogg)$'
    and public.recording_upload_allowed((storage.foldername(name))[1], (storage.foldername(name))[2])
  );
exception when undefined_function or undefined_table or duplicate_object then null; end $$;

-- Readable by the people who were in the meeting, as before.
do $$ begin
  create policy "meeting_recordings_attendee_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'meeting-recordings'
    and public.attended_live_meeting_text((storage.foldername(name))[1])
  );
exception when undefined_function or undefined_table or duplicate_object then null; end $$;

-- Still private, whatever was done to it by hand.
update storage.buckets set public = false where id = 'meeting-recordings';
