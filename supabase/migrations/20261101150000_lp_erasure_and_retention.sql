-- LP data erasure and retention (SOC 2 gap G-1).
--
-- Two service-role-only functions. Neither is reachable by a signed-in user: the
-- app checks the caller is an owner/admin of the LP's organization first.
--
--   erase_lp_onboarding(org, session, actor)   erase ONE LP at a person's request
--   purge_abandoned_lp_onboarding(days)        delete links nobody ever used
--
-- Erasing deletes the session row; every dependent table (profile, owners,
-- consents, access codes, checks, decisions) is removed by its foreign key
-- cascade. onboarding_audit_log is NOT removed: it holds ids and codes, never
-- names or free text, and it gets a final 'lp.erased' / 'lp.purged' entry first.
--
-- What is NOT erased, on purpose (money may have moved, or a screen hit may need
-- to be kept for a legal duty): an LP who is approved, committed or complete, or
-- who has any check flagged. The function returns 'retention_required' for them.

create or replace function public.erase_lp_onboarding(p_org uuid, p_session uuid, p_actor uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_review text;
  v_flagged int;
  v_owners int;
begin
  select status, review_state into v_status, v_review
  from public.lp_onboarding_sessions
  where id = p_session and organization_id = p_org
  for update;
  if not found then
    return 'not_found';
  end if;

  select count(*) into v_flagged
  from public.onboarding_checks
  where session_id = p_session and organization_id = p_org and status = 'flagged';

  if v_review = 'approved' or v_status in ('committed', 'complete') or v_flagged > 0 then
    return 'retention_required';
  end if;

  select count(*) into v_owners from public.lp_onboarding_owners where session_id = p_session;

  insert into public.onboarding_audit_log (organization_id, session_id, actor_id, actor_kind, action, detail)
  values (p_org, p_session, p_actor, 'user', 'lp.erased',
          jsonb_build_object('review_state', v_review, 'status', v_status, 'owners', v_owners));

  delete from public.lp_onboarding_sessions where id = p_session and organization_id = p_org;
  return 'erased';
end;
$$;

-- Links that were made and never used: the LP never submitted, the link expired
-- more than p_days ago, and nothing was ever flagged. Returns how many were removed.
create or replace function public.purge_abandoned_lp_onboarding(p_days int default 90)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  if p_days is null or p_days < 30 then
    raise exception 'p_days must be at least 30' using errcode = '22023';
  end if;

  for r in
    select s.id, s.organization_id
    from public.lp_onboarding_sessions s
    where s.review_state in ('not_started', 'in_progress')
      and s.status = 'pending'
      and s.submitted_at is null
      and s.expires_at < now() - make_interval(days => p_days)
      and not exists (
        select 1 from public.onboarding_checks c
        where c.session_id = s.id and c.organization_id = s.organization_id and c.status = 'flagged')
    limit 500
  loop
    insert into public.onboarding_audit_log (organization_id, session_id, actor_id, actor_kind, action, detail)
    values (r.organization_id, r.id, null, 'system', 'lp.purged', jsonb_build_object('after_days', p_days));
    delete from public.lp_onboarding_sessions where id = r.id and organization_id = r.organization_id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.erase_lp_onboarding(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.purge_abandoned_lp_onboarding(int) from public, anon, authenticated;
grant execute on function public.erase_lp_onboarding(uuid, uuid, uuid) to service_role;
grant execute on function public.purge_abandoned_lp_onboarding(int) to service_role;
