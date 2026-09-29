-- Meetings: evaluate auth.uid() once per query, not once per row.
--
-- Supabase's performance advisor (lint 0003, auth_rls_initplan) flags every
-- policy below: each calls auth.uid() bare, so Postgres re-evaluates it for
-- every row a statement touches instead of hoisting it into a single initplan.
-- These are the policies behind the room, the report, the recording and its
-- five-second parts — the recording-part insert was the most expensive meetings
-- statement in pg_stat_statements (mean 28ms) and runs every five seconds for
-- the length of every recorded meeting.
--
-- The fix is the one the advisor prescribes and the earlier
-- 20260629140609_fix_rls_auth_initplan applied elsewhere: `auth.uid()` becomes
-- `(select auth.uid())`. Access is unchanged — the same function, the same
-- comparison — only when it is evaluated moves.
--
-- Rewritten from the LIVE definition with ALTER POLICY rather than restated
-- from scratch, so this cannot drift from what each policy actually says (or
-- quietly revert a later change to one): it swaps the bare calls and touches
-- nothing else. A policy that does not exist on this database is skipped, and
-- a call that is already wrapped is left alone, so re-running is a no-op.

do $$
declare
  target record;
  pol record;
  wrapped_qual text;
  wrapped_check text;
  stmt text;
begin
  for target in
    select * from (values
      ('live_meeting_admissions',       'live_meeting_admissions_org_read'),
      ('live_meeting_chat',             'live_meeting_chat_read'),
      ('live_meeting_participants',     'live_meeting_participants_org_read'),
      ('live_meeting_participants',     'live_meeting_participants_self'),
      ('live_meeting_recording_chunks', 'live_meeting_recording_chunks_host_write'),
      ('live_meeting_recording_chunks', 'live_meeting_recording_chunks_read'),
      ('live_meeting_recordings',       'live_meeting_recordings_host_write'),
      ('live_meeting_recordings',       'live_meeting_recordings_read'),
      ('live_meeting_removals',         'live_meeting_removals_org_read'),
      ('live_meeting_reports',          'live_meeting_reports_meeting'),
      ('live_meeting_transcripts',      'live_meeting_transcripts_meeting'),
      ('live_meetings',                 'live_meetings_delete'),
      ('live_meetings',                 'live_meetings_insert'),
      ('live_meetings',                 'live_meetings_select'),
      ('live_meetings',                 'live_meetings_update'),
      ('meeting_briefs',                'org_member'),
      ('meeting_notes',                 'org_members_all')
    ) as t(tbl, name)
  loop
    select p.qual, p.with_check
      into pol
      from pg_policies p
     where p.schemaname = 'public'
       and p.tablename = target.tbl
       and p.policyname = target.name;
    if not found then
      continue;
    end if;

    -- Only a bare call: one already preceded by SELECT is left as it is.
    wrapped_qual  := regexp_replace(pol.qual,       '(?<!SELECT )auth\.uid\(\)', '(SELECT auth.uid())', 'g');
    wrapped_check := regexp_replace(pol.with_check, '(?<!SELECT )auth\.uid\(\)', '(SELECT auth.uid())', 'g');

    if wrapped_qual is not distinct from pol.qual
       and wrapped_check is not distinct from pol.with_check then
      continue;
    end if;

    stmt := format('alter policy %I on public.%I', target.name, target.tbl);
    -- USING and WITH CHECK are each set only when the policy has one: an
    -- INSERT policy cannot take USING, and adding a clause a policy did not
    -- have would change what it allows.
    if pol.qual is not null then
      stmt := stmt || format(' using (%s)', wrapped_qual);
    end if;
    if pol.with_check is not null then
      stmt := stmt || format(' with check (%s)', wrapped_check);
    end if;
    execute stmt;
  end loop;
end $$;
