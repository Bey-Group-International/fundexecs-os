-- A participant row must be earned, not self-issued.
--
-- live_meeting_participants_self was `FOR ALL USING (user_id = auth.uid())`
-- with no WITH CHECK. It decides whose row you may touch but says nothing
-- about WHICH MEETING the row is for, so any signed-in user who knew a
-- meeting's UUID could insert
--   {meeting_id: <that meeting>, user_id: <me>}
-- and become a participant. Participant status is what the read policies for
-- that meeting's transcript, chat, report and recordings (and the storage
-- read policy for the recording objects) key on, so that was a way to read a
-- meeting you were never in. It also skipped the waiting room, whose
-- admission and removal tables were enforced only in application code.
--
-- The rule now, enforced by the database: you may write your own participant
-- row only for a meeting you are entitled to be in --
--   * you host it, or
--   * you are a member of the organization that owns it, or
--   * the host admitted you through the waiting room (an `admitted` row in
--     live_meeting_admissions carrying your user_id, which the knock route
--     writes for signed-in callers).
--
-- No application code changes: members and admitted outsiders keep writing
-- their own row from MeetingRoom.tsx exactly as before, and guests (who have
-- no session) keep going through /api/meetings/[id]/attendance with the
-- service role, which this does not touch.
--
-- The check also runs on UPDATE, against the NEW row. Without that, a user
-- could insert a row for a meeting they may join and then rewrite its
-- meeting_id to point at one they may not.
--
-- The helper is SECURITY DEFINER because live_meeting_admissions has no
-- per-user read policy (only an organization read), so an admitted outsider
-- cannot see their own admission row through RLS. It is not callable by anon.

create or replace function public.can_join_live_meeting(meeting uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
        from public.live_meetings m
       where m.id = meeting
         and (
           m.host_id = auth.uid()
           or (
             m.organization_id is not null
             and exists (
               select 1
                 from public.organization_members om
                where om.organization_id = m.organization_id
                  and om.principal_id = auth.uid()
             )
           )
         )
    )
    or exists (
      select 1
        from public.live_meeting_admissions a
       where a.meeting_id = meeting
         and a.user_id = auth.uid()
         and a.status = 'admitted'
    );
$$;

revoke execute on function public.can_join_live_meeting(uuid) from public, anon;
grant execute on function public.can_join_live_meeting(uuid) to authenticated, service_role;

drop policy if exists live_meeting_participants_self on public.live_meeting_participants;
drop policy if exists live_meeting_participants_self_read on public.live_meeting_participants;
drop policy if exists live_meeting_participants_self_insert on public.live_meeting_participants;
drop policy if exists live_meeting_participants_self_update on public.live_meeting_participants;
drop policy if exists live_meeting_participants_self_delete on public.live_meeting_participants;

create policy live_meeting_participants_self_read
  on public.live_meeting_participants
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy live_meeting_participants_self_insert
  on public.live_meeting_participants
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and public.can_join_live_meeting(meeting_id)
  );

create policy live_meeting_participants_self_update
  on public.live_meeting_participants
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and public.can_join_live_meeting(meeting_id)
  );

create policy live_meeting_participants_self_delete
  on public.live_meeting_participants
  for delete
  to authenticated
  using (user_id = (select auth.uid()));
