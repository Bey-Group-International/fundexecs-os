-- Attendance for the people who have no account.
--
-- `live_meeting_participants.user_id` has been nullable since the table was
-- created, and the migration that added the member unique index said why:
--
--   "`user_id` is nullable and stays that way — guests join without an account.
--    NULLs are distinct in a unique index by default, so unauthenticated guests
--    each keep their own row, which is the behaviour we want."
--
-- The column was ready. Nothing could write to it. The table's only policy is
--
--   live_meeting_participants_self  FOR ALL USING (user_id = auth.uid())
--
-- and for an invite-link guest both sides are NULL. `NULL = NULL` is NULL, not
-- true, so the policy denies every guest insert -- silently, because a policy
-- cannot fail loudly. An invite-link guest was therefore absent from the
-- head-count, absent from the report's attendance, and locked out of the report
-- itself: `live_meeting_reports` and `live_meeting_transcripts` are readable by
-- "the host OR a participant", and a guest was neither.
--
-- This migration does NOT loosen that policy, and the choice is deliberate. A
-- policy permissive enough to admit an anonymous client would admit it to every
-- meeting, because an anonymous session carries nothing to scope it with -- the
-- room code is not in the request, and knowledge of a room code is not an
-- identity Postgres can check. The write goes through a route instead, which is
-- the pattern this codebase already settled on for exactly this problem:
-- `authorizeMeetingCaller` reads the guest's admission row and then writes with
-- the service role. See `lib/meetings/meeting-access.server.ts`, whose header
-- describes this same failure for transcripts and chat.
--
-- So all that is needed here is the identity to write, and the index that makes
-- a guest's row findable again.

-- The key the guest's browser minted and stored. The same value
-- `live_meeting_removals.guest_key` holds, and the same one the knock route
-- already trusts to decide whether this guest was admitted -- so this adds no
-- new notion of identity, it records one the system already issues.
alter table public.live_meeting_participants
  add column if not exists guest_key text;

comment on column public.live_meeting_participants.guest_key is
  'Invite-link guest identity, from lib/meetings/guest-key.ts; null for signed-in members, whose identity is user_id.';

-- The guest counterpart to live_meeting_participants_meeting_user_idx.
--
-- PARTIAL, and that is the whole reason it has to be its own index rather than
-- widening the existing one. NULLs are distinct in a unique index, so
-- (meeting_id, user_id) cannot constrain guest rows at all: without this, every
-- reload and every rejoin inserts another row, which inflates the live
-- head-count and puts the same person in the report twice. `where guest_key is
-- not null` keeps members -- all of whom have a NULL guest_key -- out of it, so
-- the two identities are constrained separately and neither collapses the other.
--
-- It is also the arbiter the guest join upsert infers ON CONFLICT
-- (meeting_id, guest_key) against. See `participantConflictTarget`; without a
-- matching index Postgres refuses the whole statement with 42P10, which is the
-- bug that left this table empty in production for its first 24 meetings.
create unique index if not exists live_meeting_participants_meeting_guest_idx
  on public.live_meeting_participants (meeting_id, guest_key)
  where guest_key is not null;

comment on index public.live_meeting_participants_meeting_guest_idx is
  'One attendance row per guest per meeting. Also the arbiter the guest join upsert infers ON CONFLICT (meeting_id, guest_key) against. Partial because NULLs are distinct, so the member index cannot constrain guest rows.';

-- Every attendance row names somebody.
--
-- A row with neither identity cannot be told from the next one like it: it
-- cannot be de-duplicated on a rejoin, cannot be matched to an invitee, and
-- cannot be counted without risking counting one person twice. The report's
-- attendance rules already defend against it by answering "cannot tell" rather
-- than inventing an absence; this stops the shape existing in the first place.
--
-- Added NOT VALID and then validated, so the two halves are visible separately:
-- if production holds a row this forbids, the VALIDATE fails loudly with the
-- constraint already in place for new writes, rather than the whole migration
-- rolling back and leaving nothing. No such row should exist -- the only writer
-- so far required a user_id -- and the validation is what proves it rather than
-- assuming it.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'live_meeting_participants_has_identity'
      and conrelid = 'public.live_meeting_participants'::regclass
  ) then
    alter table public.live_meeting_participants
      add constraint live_meeting_participants_has_identity
      check (user_id is not null or guest_key is not null)
      not valid;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'live_meeting_participants_has_identity'
      and conrelid = 'public.live_meeting_participants'::regclass
      and not convalidated
  ) then
    alter table public.live_meeting_participants
      validate constraint live_meeting_participants_has_identity;
  end if;
end $$;
