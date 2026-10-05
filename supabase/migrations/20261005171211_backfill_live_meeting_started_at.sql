-- live_meetings.started_at has never been written.
--
-- The room set it with a fire-and-forget `void supabase.from(...).update(...)`.
-- A supabase-js query builder only sends its request when it is awaited (its
-- `then` is what runs the fetch), so that statement built a request and never
-- sent it. Every meeting in production -- 75 rows, 31 of them ended -- has a
-- NULL started_at, which is why the report page shows no length for a meeting
-- with no recording, why the log cannot say how long a meeting ran, and why
-- the regenerate route hands the model the SCHEDULED length as though it were
-- the actual one.
--
-- The room now awaits that write, and the report route fills the column in
-- when it closes a meeting that still lacks it. This covers the meetings that
-- already ended: the earliest attendance row is when the room opened; failing
-- that, the first transcript line is the first moment anyone was heard.
--
-- Re-runnable: only rows with a NULL started_at are touched, and the second run
-- finds none.

update public.live_meetings m
set started_at = least(
  (select min(p.joined_at) from public.live_meeting_participants p where p.meeting_id = m.id),
  (select min(t.ts) from public.live_meeting_transcripts t where t.meeting_id = m.id)
)
where m.started_at is null
  and m.status = 'ended'
  and (
    exists (select 1 from public.live_meeting_participants p where p.meeting_id = m.id)
    or exists (select 1 from public.live_meeting_transcripts t where t.meeting_id = m.id)
  );
