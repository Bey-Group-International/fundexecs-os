-- One-way calls: a recorded phone call, kept as a meeting row.
--
-- WHY THIS IS NOT A NEW TABLE.
--
-- Recording objects are keyed `<meeting_id>/<recording_id>/part-NNNNNN.webm`,
-- the bucket's read policy asks attended_live_meeting(meeting_id) — which
-- resolves through live_meetings — and BOTH the hourly expiry sweep and the
-- delete route's cleanup find a recording's bytes by way of this table. A
-- separate calls table would have sat outside all of it: its recordings would
-- have been unreachable the moment a call was deleted and invisible to the
-- sweep forever, which is precisely the defect that took a full pass to fix
-- for meetings. Sharing the row means sharing the lifecycle that already works.
--
-- What differs is what the row MEANS, which is what `kind` records.

alter table public.live_meetings
  add column if not exists kind text not null default 'meeting';

-- Every row that existed before this is a meeting. The default says so rather
-- than a backfill guessing, because a guess that went the other way would hide
-- a real meeting from the lists people run their day from.
comment on column public.live_meetings.kind is
  'meeting = a room with people in it; one_way = a recorded call with no second participant.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'live_meetings_kind_check'
  ) then
    alter table public.live_meetings
      add constraint live_meetings_kind_check check (kind in ('meeting', 'one_way'));
  end if;
end $$;

-- The consent that was acknowledged before recording could start.
--
-- Stored on the row, not held in a component, because the entire point of it
-- is to still exist months later when somebody asks whether a call should have
-- been recorded. It keeps the exact words the person was shown, not merely
-- that they ticked something: an acknowledgement that cannot say what was
-- acknowledged is not a record of anything.
alter table public.live_meetings
  add column if not exists recording_consent jsonb;

comment on column public.live_meetings.recording_consent is
  'When consent was acknowledged, the disclosure text shown at the time, and what was to be captured. Null means none was recorded — which the report says plainly rather than implying consent.';

-- The archive reads one organisation's calls, newest first, and nothing else.
-- Partial on kind so it stays small: one-way rows are a minority of the table
-- and this index has no business carrying every meeting the org has held.
create index if not exists live_meetings_one_way_idx
  on public.live_meetings (organization_id, created_at desc)
  where kind = 'one_way' and deleted_at is null;

-- The meetings page, the calendar and the upcoming list all read live_meetings
-- directly and would otherwise show a recorded call as a meeting nobody can
-- join. They filter on kind now; this index keeps that filter cheap on the
-- read that loads the meetings page.
create index if not exists live_meetings_kind_idx
  on public.live_meetings (organization_id, kind)
  where deleted_at is null;
