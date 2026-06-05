-- =====================================================================
-- Generalized signup auto-seed + per-member-type top-up.
--
-- - Replaces the @beygroupintl.com-only path: every new user now gets
--   their own org (auto-created) and a generic baseline seed so the app
--   is never empty on first login.
-- - Adds a per-member-type top-up RPC that runs from setMemberType
--   server action after Proof of Truth resolves a type.
-- - Additive + idempotent. No drops. Existing data is left untouched.
-- =====================================================================

-- ---------- helpers ---------------------------------------------------

-- Marker used in the `notes` column on inserted rows so we can detect a
-- prior baseline / type seed and skip re-running.
create or replace function private.seed_marker(_kind text)
returns text language sql immutable as $$
  select '[seed:' || _kind || ']';
$$;
grant execute on function private.seed_marker(text) to service_role, authenticated;

-- ---------- A. Baseline seed for a fresh org --------------------------

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

  -- 2) 3 contacts + 3 identities + 4–6 interactions so warmth aggregates land
  --    non-empty on the Connections screen.
  insert into public.contacts (org_id, full_name, primary_email, company, title)
  values
    (_org, 'Avery Hart', 'avery.hart@example.com', 'Hart Capital Advisors', 'Managing Partner'),
    (_org, 'Jordan Reyes', 'jordan.reyes@example.com', 'Mosaic Family Office', 'Investment Director'),
    (_org, 'Sam Patel', 'sam.patel@example.com', 'Northbridge Partners', 'Principal')
  returning id into _contact_a;
  -- (the returning above only captures the last value; pull them all back by email)
  select id into _contact_a from public.contacts where org_id = _org and primary_email = 'avery.hart@example.com';
  select id into _contact_b from public.contacts where org_id = _org and primary_email = 'jordan.reyes@example.com';
  select id into _contact_c from public.contacts where org_id = _org and primary_email = 'sam.patel@example.com';

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
  values (_org, 'member_profile', _user, 'Proof of Truth', 'active')
  on conflict do nothing;
end;
$$;

revoke all on function public.seed_demo_baseline_for_org(uuid, uuid) from public, anon;
grant execute on function public.seed_demo_baseline_for_org(uuid, uuid) to service_role, authenticated;


-- ---------- B. Per-member-type top-up --------------------------------

create or replace function public.seed_demo_for_member_type(_org uuid, _user uuid, _type text)
returns void language plpgsql security definer set search_path = public, extensions
as $$
declare
  _tag text := private.seed_marker('type:' || coalesce(_type, 'unknown'));
  _deal uuid;
  _c1 uuid; _c2 uuid;
begin
  if _org is null or _user is null or _type is null then
    return;
  end if;

  -- Idempotency: any prior row in `notifications` carrying this exact tag
  -- means the top-up already ran for this org+type. Skip.
  if exists (
    select 1 from public.notifications
    where org_id = _org and (payload ->> 'tag') = _tag limit 1
  ) then
    return;
  end if;

  if _type = 'investment_firm' then
    insert into public.deals (org_id, name, stage, status, amount) values
      (_org, 'Project Atlas — SaaS rollup',   'diligence',  'open', 12400000),
      (_org, 'Meridian Logistics buyout',     'ic',         'open', 28000000),
      (_org, 'NorthStar secondary',           'screening',  'open',  6500000),
      (_org, 'Harbor data-center JV',         'sourcing',   'open', 41000000),
      (_org, 'Vantage healthcare platform',   'closing',    'open', 18750000),
      (_org, 'Summit credit facility',        'closed',     'won',   9000000);

    -- 3 allocations on the first new deal.
    select id into _deal from public.deals
      where org_id = _org and name = 'Project Atlas — SaaS rollup' limit 1;
    if _deal is not null then
      insert into public.allocations (org_id, deal_id, amount, status) values
        (_org, _deal, 3000000, 'proposed'),
        (_org, _deal, 5000000, 'accepted'),
        (_org, _deal, 4000000, 'proposed');
    end if;

    insert into public.capital_providers (org_id, name, capital_types, check_size_min, check_size_max) values
      (_org, 'Meridian LP',        '{equity}',         5000000,  25000000),
      (_org, 'Gulf Sovereign',     '{equity}',        25000000, 150000000);

    insert into public.synergy_opportunities
      (org_id, source_entity_type, target_entity_type, rationale, score, status)
    values
      (_org, 'deal', 'capital_provider',
       'Meridian LP thesis fits the Logistics buyout.', 88.5, 'new');

  elsif _type = 'service_provider' then
    insert into public.deals (org_id, name, stage, status, amount) values
      (_org, 'Apex Capital — fund formation',    'intake',  'open', 250000),
      (_org, 'HarborBridge — due diligence',     'active',  'open', 180000),
      (_org, 'Summit FO — quarterly reporting',  'active',  'open',  60000),
      (_org, 'Vantage — IR collateral',          'intake',  'open',  45000),
      (_org, 'Cedar Holdings — Reg D filing',    'closed',  'won',   75000);

    insert into public.contacts (org_id, full_name, primary_email, company, title) values
      (_org, 'Mia Chen',   'mia.chen@apexcapital.com',     'Apex Capital',   'Founder & GP'),
      (_org, 'Daniel Voss','daniel.voss@harborbridge.com', 'HarborBridge',   'COO'),
      (_org, 'Lena Park',  'lena.park@summitfo.com',       'Summit FO',      'Head of Investments');

    insert into public.notifications (user_id, org_id, type, payload) values
      (_user, _org, 'demand', jsonb_build_object('tag', _tag, 'title', 'New inbound interest', 'body', 'Two prospects asked about your fund-formation services this week.')),
      (_user, _org, 'demand', jsonb_build_object('tag', _tag, 'title', 'High-fit engagement opened', 'body', 'HarborBridge moved your diligence proposal forward.'));

  elsif _type = 'startup' then
    insert into public.contacts (org_id, full_name, primary_email, company, title) values
      (_org, 'Priya Anand',  'priya@horizonventures.com',  'Horizon Ventures',  'Partner'),
      (_org, 'Marcus Liu',   'marcus@steelseed.com',       'Steel Seed',        'Managing Partner'),
      (_org, 'Sophie Marsh', 'sophie@northstar.vc',        'NorthStar VC',      'Principal'),
      (_org, 'Tobi Adesina', 'tobi@arborangels.com',       'Arbor Angels',      'Lead Angel');

    insert into public.deals (org_id, name, stage, status, amount) values
      (_org, 'Series A — primary raise', 'active', 'open', 8000000)
    returning id into _deal;

    insert into public.tasks (org_id, assignee_id, title, status, source) values
      (_org, _user, 'Finalize investor deck v3',  'todo', 'seed'),
      (_org, _user, 'Update data room index',     'todo', 'seed'),
      (_org, _user, 'Draft Q3 investor update',   'todo', 'seed');

    select id into _c1 from public.contacts where org_id = _org and primary_email = 'priya@horizonventures.com' limit 1;
    select id into _c2 from public.contacts where org_id = _org and primary_email = 'marcus@steelseed.com'      limit 1;
    if _c1 is not null then
      insert into public.warm_introductions
        (org_id, requester_id, target_contact_id, strength, rationale, status)
      values (_org, _user, _c1, 78.0, 'Horizon is a fit on stage and sector.', 'requested');
    end if;
    if _c2 is not null then
      insert into public.warm_introductions
        (org_id, requester_id, target_contact_id, strength, rationale, status)
      values (_org, _user, _c2, 72.0, 'Steel Seed leads similar pre-A rounds.', 'requested');
    end if;

  elsif _type = 'student' then
    -- 3 learning-path tasks covering the team and the 15-brain knowledge base.
    insert into public.tasks (org_id, assignee_id, title, status, source) values
      (_org, _user, 'Complete learning path: meet your fifteen specialists', 'todo', 'seed'),
      (_org, _user, 'Run your first workflow with Sterling (Chief of Staff)', 'todo', 'seed'),
      (_org, _user, 'Ask Earn three questions that touch three different brains', 'todo', 'seed');

    insert into public.notifications (user_id, org_id, type, payload) values
      (_user, _org, 'learning', jsonb_build_object('tag', _tag, 'title', 'Lesson 1: How the desk works',  'body', 'A 4-minute overview of the fifteen specialists.')),
      (_user, _org, 'learning', jsonb_build_object('tag', _tag, 'title', 'Lesson 2: Your first mandate', 'body', 'Define your interests so Earn can route work for you.')),
      (_user, _org, 'learning', jsonb_build_object('tag', _tag, 'title', 'Lesson 3: Sourcing fundamentals','body', 'How institutional desks find on-thesis opportunities.')),
      (_user, _org, 'learning', jsonb_build_object('tag', _tag, 'title', 'Lesson 4: Building your network','body', 'Warm intros, follow-ups, and the cadence of trust.'));

    insert into public.contacts (org_id, full_name, primary_email, company, title) values
      (_org, 'Riley Chen',  'riley.chen@school.edu',  'University of Capital', 'Student investor'),
      (_org, 'Noah Park',   'noah.park@school.edu',   'University of Capital', 'Student club lead');

  elsif _type = 'individual_investor' then
    insert into public.deals (org_id, name, stage, status, amount) values
      (_org, 'Acme Robotics — angel round', 'scout',     'open',  100000),
      (_org, 'Cedar Health — seed extension', 'diligence', 'open', 250000),
      (_org, 'Helix Bio — Series A', 'diligence', 'open', 500000),
      (_org, 'Quanta Materials — passed', 'screening', 'passed', 0),
      (_org, 'Ridgepoint Logistics — passed', 'screening', 'passed', 0);

    select id into _deal from public.deals
      where org_id = _org and name = 'Cedar Health — seed extension' limit 1;
    if _deal is not null then
      insert into public.allocations (org_id, deal_id, amount, status) values
        (_org, _deal,  50000, 'proposed'),
        (_org, _deal, 100000, 'accepted'),
        (_org, _deal,  25000, 'proposed');
    end if;

    insert into public.synergy_opportunities
      (org_id, source_entity_type, target_entity_type, rationale, score, status)
    values (_org, 'deal', 'capital_provider',
            'Cedar Health is on the watchlist of two syndicates you follow.', 76.0, 'new');

    insert into public.contacts (org_id, full_name, primary_email, company, title) values
      (_org, 'Hannah Ross', 'hannah@syndicateone.com', 'Syndicate One', 'Lead'),
      (_org, 'Diego Salas', 'diego@coinvestclub.com',  'CoInvest Club', 'Founder');
  end if;

  -- Tag the run so a re-call is a no-op (idempotency guard checked at the top).
  insert into public.notifications (user_id, org_id, type, payload)
  values (_user, _org, 'system', jsonb_build_object(
    'tag', _tag,
    'title', 'Workspace personalized',
    'body',  'Earn tuned the desk for your member type.'
  ));
end;
$$;

revoke all on function public.seed_demo_for_member_type(uuid, uuid, text) from public, anon;
grant execute on function public.seed_demo_for_member_type(uuid, uuid, text) to service_role, authenticated;


-- ---------- C. Generalized handle_new_user ----------------------------

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _bey uuid := 'b0000000-0000-4000-8000-000000000001';
  _email text := lower(coalesce(new.email, ''));
  _new_org uuid;
  _existing_org uuid;
  _org_name text;
begin
  -- 1) Always ensure a profile row.
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;

  -- 2) Bey back-compat: @beygroupintl.com still lands in the shared Bey org as
  --    admin, with the rich Bey demo seed. Existing behaviour preserved so we
  --    do not double-seed legacy users.
  if _email like '%@beygroupintl.com' then
    update public.profiles set role = 'admin' where id = new.id;
    insert into public.org_members (org_id, user_id, role)
    values (_bey, new.id, 'admin')
    on conflict (org_id, user_id) do nothing;

    if not exists (select 1 from public.interactions where user_id = new.id) then
      perform public.seed_demo_for_user(_bey, new.id);
    end if;

    return new;
  end if;

  -- 3) Everyone else: auto-create an org + baseline seed.
  select om.org_id into _existing_org
    from public.org_members om
   where om.user_id = new.id
   order by om.created_at asc
   limit 1;

  if _existing_org is null then
    _org_name := coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'org_name'), ''),
      nullif(split_part(_email, '@', 1), '') || ' Workspace',
      'Your workspace'
    );

    insert into public.organizations (name, type)
    values (_org_name, 'investment')
    returning id into _new_org;

    insert into public.org_members (org_id, user_id, role)
    values (_new_org, new.id, 'owner')
    on conflict (org_id, user_id) do nothing;
  else
    _new_org := _existing_org;
  end if;

  -- 4) Baseline seed (idempotent — re-runs are no-ops).
  perform public.seed_demo_baseline_for_org(_new_org, new.id);

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
-- The trigger itself is the only intended caller; the existing
-- `on auth.users` trigger from the core migration keeps firing.