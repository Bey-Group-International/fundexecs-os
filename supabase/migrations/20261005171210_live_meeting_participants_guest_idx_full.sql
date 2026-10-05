-- Guest attendance never landed: the index the upsert infers against was partial.
--
-- 20261002200000 added live_meeting_participants_meeting_guest_idx as a PARTIAL
-- unique index (`where guest_key is not null`) and named it the arbiter for the
-- guest join's `on conflict (meeting_id, guest_key)`. PostgreSQL cannot infer a
-- partial unique index from a bare conflict target: the statement has to repeat
-- the index predicate (`on conflict (meeting_id, guest_key) where guest_key is
-- not null`), and PostgREST's `onConflict` option has no way to say so. So every
-- guest attendance write failed with 42P10 -- the very error the earlier
-- migration's comment says it was there to end -- and the attendance route
-- answered 500 for every admitted guest. In production, meeting
-- 86846a43-0f3c-4fa3-bcb6-d85b364e6897 admitted a guest who spoke for an hour
-- and has no attendance row; the report shows them as not having joined.
--
-- The predicate was never needed. A unique index treats NULLs as distinct, so a
-- plain unique index on (meeting_id, guest_key) constrains guest rows exactly
-- as the partial one did and leaves member rows -- all with a NULL guest_key --
-- unconstrained by it, as before. What changes is that a bare conflict target
-- can now infer it.
--
-- Re-runnable: the drop is guarded and the create is `if not exists`; a second
-- run drops and recreates the same full index.

drop index if exists public.live_meeting_participants_meeting_guest_idx;

create unique index if not exists live_meeting_participants_meeting_guest_idx
  on public.live_meeting_participants (meeting_id, guest_key);

comment on index public.live_meeting_participants_meeting_guest_idx is
  'One attendance row per guest per meeting, and the arbiter the guest join upsert infers ON CONFLICT (meeting_id, guest_key) against. Deliberately NOT partial: PostgREST cannot repeat an index predicate in a conflict target, so a partial index here made every guest write fail with 42P10. NULLs are distinct, so member rows (guest_key null) are unaffected.';
