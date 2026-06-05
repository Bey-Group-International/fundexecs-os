-- =====================================================================
-- Patch: seed_demo_baseline_for_org had a multi-row INSERT with
-- `RETURNING id INTO _contact_a` (single scalar), which Postgres rejects
-- with "query returned more than one row". The author's comment said it
-- only captures the last value — that is not actually true; PL/pgSQL
-- throws TOO_MANY_ROWS.
--
-- Fix: drop the bogus RETURNING and rely on the explicit SELECTs that
-- follow (which were already written correctly). Additive + idempotent.
-- =====================================================================

create or replace function public.seed_demo_baseline_for_org(_org uuid, _user uuid)
returns void language plpgsql security definer set search_path = public, extensions
as $$
declare
  _plan uuid;
  _contact_a uuid; _contact_b uuid; _contact_c uuid;
  _baseline_tag text := private.seed_marker('baseline');
begin
  if _org is null or _user is null then
    return;
  end if;

  -- Idempotency: skip the whole baseline if we've already seeded it for this org.
  if exists (
    select 1 from public.notifications
    where org_id = _org and (payload ->> 'tag') = _baseline_tag limit 1
  ) then
    return;
  end if;

  -- 1) Governance plan + 3 generic objectives across the intent / formation /
  --    execution layers so the Strategy screen is alive on day one.
  insert into public.governance_plans (org_id, name, horizon, status, owner_id)
  values (_org, 'Your 100/30/10 plan', '12mo', 'active', _user)
  returning id into _plan;

  insert into public.governance_objectives
    (org_id, plan_id, objective, timeline, priority, status, ai_recommendation)
  values
    (_org, _plan, 'Define your thesis and mandate', 'Q1', 'high', 'open',
      'Set your thesis with Earn so the whole team aligns from day one.'),
    (_org, _plan, 'Stand up your operating rhythm', 'Q1', 'medium', 'open',
      'Wire your tools, contacts, and weekly cadence into the OS.'),
    (_org, _plan, 'Complete the Proof of Truth', 'Q1', 'high', 'open',
      'Finish onboarding so Earn can route work to the right specialist.');

  -- 2) 3 contacts + 3 identities + 5 interactions so warmth aggregates land
  --    non-empty on the Connections screen.
  insert into public.contacts (org_id, full_name, primary_email, company, title)
  values
    (_org, 'Avery Hart',   'avery.hart@example.com',   'Hart Capital Advisors',  'Managing Partner'),
    (_org, 'Jordan Reyes', 'jordan.reyes@example.com', 'Mosaic Family Office',   'Investment Director'),
    (_org, 'Sam Patel',    'sam.patel@example.com',    'Northbridge Partners',   'Principal');

  -- Pull the freshly inserted contact ids back by email so we can FK them.
  select id into _contact_a from public.contacts where org_id = _org and primary_email = 'avery.hart@example.com'   limit 1;
  select id into _contact_b from public.contacts where org_id = _org and primary_email = 'jordan.reyes@example.com' limit 1;
  select id into _contact_c from public.contacts where org_id = _org and primary_email = 'sam.patel@example.com'    limit 1;

  insert into public.contact_identities (org_id, contact_id, kind, value)
  values
    (_org, _contact_a, 'email', 'avery.hart@example.com'),
    (_org, _contact_b, 'email', 'jordan.reyes@example.com'),
    (_org, _contact_c, 'email', 'sam.patel@example.com')
  on conflict (org_id, kind, value) do nothing;

  insert into public.interactions (org_id, user_id, contact_id, provider, type, direction, occurred_at, subject, external_ref)
  values
    (_org, _user, _contact_a, 'seed', 'email_sent',     'outbound', now() - interval '2 days',  'Intro on FundExecs OS',          'seed:baseline:' || _user || ':a:1'),
    (_org, _user, _contact_a, 'seed', 'email_received', 'inbound',  now() - interval '1 day',   'Re: Intro on FundExecs OS',      'seed:baseline:' || _user || ':a:2'),
    (_org, _user, _contact_b, 'seed', 'meeting',         'internal', now() - interval '6 days', 'Coffee with Mosaic FO',          'seed:baseline:' || _user || ':b:1'),
    (_org, _user, _contact_b, 'seed', 'email_sent',     'outbound', now() - interval '3 days',  'Mosaic follow-up materials',     'seed:baseline:' || _user || ':b:2'),
    (_org, _user, _contact_c, 'seed', 'email_received', 'inbound',  now() - interval '11 days', 'Northbridge co-invest inquiry',  'seed:baseline:' || _user || ':c:1')
  on conflict (org_id, provider, external_ref) do nothing;

  -- 3) One generic partnership + service provider + capital provider.
  insert into public.partnerships (org_id, counterparty, type, stage)
  values (_org, 'Northbridge Partners', 'co-invest', 'prospect');

  insert into public.service_providers (org_id, name, category, status)
  values (_org, 'Allen & Park LLP', 'legal', 'active');

  insert into public.capital_providers (org_id, name, capital_types, check_size_min, check_size_max)
  values (_org, 'Mosaic Family Office', '{equity}', 250000, 5000000);

  -- 4) Two welcome notifications tagged so re-runs are skipped.
  insert into public.notifications (user_id, org_id, type, payload)
  values
    (_user, _org, 'welcome', jsonb_build_object(
      'tag', _baseline_tag,
      'title', 'Welcome to FundExecs OS',
      'body',  'Earn and your fifteen specialists are ready when you are.'
    )),
    (_user, _org, 'task', jsonb_build_object(
      'tag', _baseline_tag,
      'title', 'Complete your Proof of Truth',
      'body',  'Pick your member type so Earn can personalize the desk.'
    ));

  -- 5) Chain-of-Trust record in 'Proof of Truth' state on the member profile
  --    itself. member_profiles is keyed by user_id, so entity_id = _user.
  insert into public.member_profiles (user_id, draft, status)
  values (_user, '{}'::jsonb, 'in_progress')
  on conflict (user_id) do nothing;

  insert into public.chain_of_trust_records
    (org_id, entity_type, entity_id, current_layer, status)
  select _org, 'member_profile', _user, 'Proof of Truth', 'active'
  where not exists (
    select 1 from public.chain_of_trust_records
    where org_id = _org and entity_type = 'member_profile' and entity_id = _user
  );
end;
$$;

revoke all on function public.seed_demo_baseline_for_org(uuid, uuid) from public, anon;
grant execute on function public.seed_demo_baseline_for_org(uuid, uuid) to service_role, authenticated;
