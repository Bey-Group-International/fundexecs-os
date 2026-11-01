-- Audit log: say who an entry is about when it isn't a signed-in person.
--
-- The trigger records auth.uid(), which is null for the service role. That left
-- every LP action and every system action with no actor and no way to tell them
-- apart from each other. actor_kind adds the missing word:
--   user    a signed-in person (actor_id is set)
--   lp      the investor, acting through their emailed-code link
--   system  the app itself (the hourly sweep, the automatic OFAC screen)
-- Entries written before this column existed keep it null: the log is
-- append-only, so they are not rewritten, and null reads as "not recorded".
-- Re-runnable.
alter table public.onboarding_audit_log
  add column if not exists actor_kind text;

alter table public.onboarding_audit_log
  drop constraint if exists onboarding_audit_log_actor_kind_check;
alter table public.onboarding_audit_log
  add constraint onboarding_audit_log_actor_kind_check
  check (actor_kind is null or actor_kind in ('user', 'lp', 'system'));

-- The same function as 20261031200021, with actor_kind added to every branch.
-- A row with no signed-in person is the LP's when the LP caused it (a consent, or
-- a submission) and the system's otherwise.
create or replace function public.onboarding_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  kind text := case when auth.uid() is not null then 'user' else 'system' end;
begin
  if tg_table_name = 'onboarding_checks' then
    if tg_op = 'INSERT' then
      insert into public.onboarding_audit_log (organization_id, session_id, actor_id, actor_kind, action, detail)
      values (new.organization_id, new.session_id, uid, kind, 'check.recorded',
              jsonb_build_object('kind', new.kind, 'status', new.status, 'method', new.method));
    elsif old.status is distinct from new.status then
      insert into public.onboarding_audit_log (organization_id, session_id, actor_id, actor_kind, action, detail)
      values (new.organization_id, new.session_id, uid, kind, 'check.updated',
              jsonb_build_object('kind', new.kind, 'from', old.status, 'to', new.status, 'method', new.method));
    end if;
  elsif tg_table_name = 'onboarding_decisions' then
    insert into public.onboarding_audit_log (organization_id, session_id, actor_id, actor_kind, action, detail)
    values (new.organization_id, new.session_id, uid, kind, 'decision.recorded',
            jsonb_build_object('decision', new.decision));
  elsif tg_table_name = 'lp_onboarding_consents' then
    insert into public.onboarding_audit_log (organization_id, session_id, actor_id, actor_kind, action, detail)
    values (new.organization_id, new.session_id, uid,
            case when uid is not null then 'user' else 'lp' end, 'consent.granted',
            jsonb_build_object('scope', new.scope, 'text_version', new.text_version));
  elsif tg_table_name = 'lp_onboarding_sessions' then
    if old.review_state is distinct from new.review_state then
      insert into public.onboarding_audit_log (organization_id, session_id, actor_id, actor_kind, action, detail)
      values (new.organization_id, new.id, uid,
              case when uid is not null then 'user' when new.review_state = 'submitted' then 'lp' else 'system' end,
              'review.state_changed',
              jsonb_build_object('from', old.review_state, 'to', new.review_state));
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.onboarding_audit() from public, anon, authenticated;
