-- One attendance row per member per meeting.
--
-- `live_meeting_participants` has carried a primary key on `id` and two
-- non-unique indexes since it was created, and nothing else. The join path in
-- MeetingRoom has always written:
--
--   .upsert({ meeting_id, user_id, ... }, { onConflict: "meeting_id,user_id" })
--
-- ON CONFLICT infers its arbiter from a unique index, so with no matching one
-- Postgres refused the whole statement:
--
--   42P10: there is no unique or exclusion constraint matching the
--          ON CONFLICT specification
--
-- The call was fire-and-forget, so nothing surfaced the refusal and the table
-- stayed empty in production — 24 meetings, 36 reports, zero attendance rows.
-- That is not a cosmetic gap: live_meeting_reports and live_meeting_transcripts
-- are readable by "the host OR a participant", so with no participant rows the
-- attendees-only rule collapsed to host-only. Everyone else who sat through a
-- meeting was locked out of its report, and the meetings list could not show a
-- head-count because presence is read from this table too.
--
-- The index below is what makes that upsert legal. It is also the constraint
-- the data always implied: a member is in a meeting once, and rejoining after a
-- dropped connection has to update that row rather than accumulate another.
--
-- `user_id` is nullable and stays that way — guests join without an account.
-- NULLs are distinct in a unique index by default, so unauthenticated guests
-- each keep their own row, which is the behaviour we want; only signed-in
-- members are collapsed to one.

-- Written defensively rather than because production needs it: the table is
-- empty there, precisely because of the bug above. Other environments may have
-- rows from before the upsert was introduced, and the index cannot build while
-- duplicates exist. The earliest arrival is kept — that is when the person
-- actually joined.
delete from public.live_meeting_participants p
where p.user_id is not null
  and exists (
    select 1
    from public.live_meeting_participants keep
    where keep.meeting_id = p.meeting_id
      and keep.user_id = p.user_id
      and (keep.joined_at, keep.id) < (p.joined_at, p.id)
  );

-- Plain, not CONCURRENTLY: the table is empty-to-tiny, and CONCURRENTLY cannot
-- run inside the transaction a migration is applied in.
create unique index if not exists live_meeting_participants_meeting_user_idx
  on public.live_meeting_participants (meeting_id, user_id);

comment on index public.live_meeting_participants_meeting_user_idx is
  'One attendance row per member per meeting. Also the arbiter the join upsert infers ON CONFLICT (meeting_id, user_id) against.';

-- Redundant now: the unique index above leads with meeting_id, so it serves
-- every lookup this one did.
drop index if exists public.live_meeting_participants_meeting_id_idx;

-- Departure is written on leave, on end, and on pagehide, and presence reads
-- rows with no left_at. This is the index behind that read.
create index if not exists live_meeting_participants_present_idx
  on public.live_meeting_participants (meeting_id)
  where left_at is null;
