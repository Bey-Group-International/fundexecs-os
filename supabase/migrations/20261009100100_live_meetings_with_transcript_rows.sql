-- 20261009100100_live_meetings_with_transcript_rows.sql
-- Which of a list of meetings have any transcript rows at all.
--
-- The meeting log offers "Regenerate from transcript" off the newest report
-- row's generated `has_transcript`. That is the right answer for a meeting
-- that HAS a report row — and no answer at all for one that has none. A host
-- who closed the laptop instead of pressing End leaves a meeting with a full
-- transcript in live_meeting_transcripts, no report row, and a log entry that
-- says "one is generated when a meeting is ended from inside the room" next
-- to no button that could do it. The report page, meanwhile, told the same
-- host to use the button the log was not showing.
--
-- The log needs "does this meeting have transcript rows" for two hundred
-- meetings in one read. Selecting `meeting_id` from the transcripts table
-- answers with a row per utterance — thousands — and PostgREST cannot
-- express DISTINCT, so a function answers it instead: one indexed scan,
-- one row per meeting that has any.
--
-- SECURITY INVOKER, deliberately. The caller's own RLS on
-- live_meeting_transcripts decides which meetings they may know about, so
-- the log learns no more here than it could by reading the table. The
-- (meeting_id) index on live_meeting_transcripts makes `= any(ids)` cheap.

create or replace function public.live_meetings_with_transcript_rows(ids uuid[])
returns setof uuid
language sql
stable
security invoker
set search_path = public
as $$
  select distinct t.meeting_id
    from public.live_meeting_transcripts t
   where t.meeting_id = any(ids);
$$;

comment on function public.live_meetings_with_transcript_rows(uuid[]) is
  'The subset of these meeting ids that have at least one transcript row, under the caller''s own RLS. Lets the meeting log offer "Regenerate from transcript" for a meeting nobody ended.';

grant execute on function public.live_meetings_with_transcript_rows(uuid[]) to authenticated;
grant execute on function public.live_meetings_with_transcript_rows(uuid[]) to service_role;
