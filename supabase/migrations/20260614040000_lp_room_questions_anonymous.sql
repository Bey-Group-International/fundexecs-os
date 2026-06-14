-- LP Room — let anonymous external questions persist their body.
--
-- The public /lp/[token] room lets an unauthenticated LP ask a question, but
-- `lp_room_questions.asked_by` was a NOT NULL FK to `profiles`, so only
-- signed-in members could be recorded as the asker. That forced the public
-- path to log only a `data_room_views` row ("this LP reached out") and drop
-- the question body. This makes the asker optional and adds an asker email so
-- the body itself can be stored (written via the service role from
-- `submitPublicLpQuestion`), where it surfaces in the manager Q&A for an
-- Earn-drafted answer.
--
-- Additive + idempotent: dropping NOT NULL is a no-op when already nullable,
-- and the column add is guarded. No data is rewritten; existing rows keep
-- their asked_by. Service-role insert + member RLS are unchanged.

alter table public.lp_room_questions
  alter column asked_by drop not null;

alter table public.lp_room_questions
  add column if not exists asker_email text;
