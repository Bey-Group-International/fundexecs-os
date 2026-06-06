-- Advisor hardening pass (database-linter).
--
-- Addresses the parked findings after the Phase-4 + integrations merges:
--   1. auth_rls_initplan (0003) — wrap per-row auth.uid() in (select auth.uid())
--      so it is evaluated once per query instead of once per row.
--   2. authenticated SECURITY DEFINER seed functions (0029) — lock down the two
--      seed_demo_* functions that were the only genuinely unguarded surface.
--   3. unindexed_foreign_keys (0001) — add covering indexes for every FK the
--      linter flagged.
--
-- All statements are additive + idempotent and were applied to the live DB.
-- Behavior is preserved: predicates are unchanged apart from the (select ...)
-- wrapper, and the legitimate seed call paths still succeed.

------------------------------------------------------------------------------
-- 1. RLS init-plan: evaluate auth.uid() once per query, not per row.
------------------------------------------------------------------------------

alter policy "insert own profile" on public.profiles
  with check (id = (select auth.uid()));
alter policy "update own profile" on public.profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
alter policy "view own or co-member profiles" on public.profiles
  using ((id = (select auth.uid())) or private.shares_org(id));

alter policy "view own notifications" on public.notifications
  using (user_id = (select auth.uid()));
alter policy "update own notifications" on public.notifications
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy "write own interactions" on public.interactions
  with check ((user_id = (select auth.uid())) and private.is_org_member(org_id));
alter policy "view own interactions" on public.interactions
  using ((user_id = (select auth.uid())) or private.is_org_admin(org_id));
alter policy "delete own interactions" on public.interactions
  using ((user_id = (select auth.uid())) or private.is_org_admin(org_id));

alter policy "view own or org connections" on public.integration_connections
  using ((user_id = (select auth.uid())) or private.is_org_admin(org_id));
alter policy "manage own connections" on public.integration_connections
  using ((user_id = (select auth.uid())) and private.is_org_member(org_id))
  with check ((user_id = (select auth.uid())) and private.is_org_member(org_id));

alter policy "owner writes relationships" on public.relationships
  using ((user_id = (select auth.uid())) and private.is_org_member(org_id))
  with check ((user_id = (select auth.uid())) and private.is_org_member(org_id));

alter policy "view own member profile" on public.member_profiles
  using (user_id = (select auth.uid()));
alter policy "insert own member profile" on public.member_profiles
  with check (user_id = (select auth.uid()));
alter policy "update own member profile" on public.member_profiles
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

------------------------------------------------------------------------------
-- 2. SECURITY DEFINER seed functions.
--
-- award_trust_xp, create_organization and match_knowledge_chunks already guard
-- themselves (membership check / owner = caller / per-row is_org_member filter),
-- so they keep their grants. The two seed_demo_* functions were the only
-- unguarded surface:
--
--   * seed_demo_baseline_for_org is invoked ONLY by the handle_new_user signup
--     trigger (definer context, auth.uid() is null) — never by app code — so we
--     revoke EXECUTE from authenticated. The trigger runs as its definer
--     (postgres) and is unaffected.
--   * seed_demo_for_member_type IS called by the app as the signed-in user, so
--     it keeps its grant but gains an in-function authz guard.
------------------------------------------------------------------------------

revoke execute on function public.seed_demo_baseline_for_org(uuid, uuid)
  from authenticated;

create or replace function public.seed_demo_for_member_type(_org uuid, _user uuid, _type text)
  returns void
  language plpgsql
  security definer
  set search_path to 'public', 'extensions'
as $function$
declare
  _tag text := private.seed_marker('type:' || coalesce(_type, 'unknown'));
  _deal uuid;
  _c1 uuid; _c2 uuid;
begin
  if _org is null or _user is null or _type is null then
    return;
  end if;
  -- Authz: a signed-in caller may only seed their own workspace. A definer or
  -- service-role caller (auth.uid() is null, e.g. provisioning) is trusted.
  if auth.uid() is not null
     and (auth.uid() <> _user or not private.is_org_member(_org)) then
    raise exception 'not authorized to seed this workspace';
  end if;
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
  insert into public.notifications (user_id, org_id, type, payload)
  values (_user, _org, 'system', jsonb_build_object(
    'tag', _tag,
    'title', 'Workspace personalized',
    'body',  'Earn tuned the desk for your member type.'
  ));
end;
$function$;

-- Re-assert intended grants (CREATE OR REPLACE preserves them, but be explicit).
revoke all on function public.seed_demo_for_member_type(uuid, uuid, text) from public, anon;
grant execute on function public.seed_demo_for_member_type(uuid, uuid, text) to service_role, authenticated;

------------------------------------------------------------------------------
-- 3. Covering indexes for the foreign keys the linter flagged.
------------------------------------------------------------------------------

create index if not exists admin_actions_admin_user_id_idx          on public.admin_actions (admin_user_id);
create index if not exists ai_brains_org_id_idx                     on public.ai_brains (org_id);
create index if not exists allocations_lp_id_idx                    on public.allocations (lp_id);
create index if not exists brain_routing_rules_org_id_idx           on public.brain_routing_rules (org_id);
create index if not exists deals_owner_id_idx                       on public.deals (owner_id);
create index if not exists evidence_approved_by_idx                 on public.evidence (approved_by);
create index if not exists evidence_uploaded_by_idx                 on public.evidence (uploaded_by);
create index if not exists governance_objectives_owner_id_idx       on public.governance_objectives (owner_id);
create index if not exists governance_plans_owner_id_idx            on public.governance_plans (owner_id);
create index if not exists interactions_connection_id_idx           on public.interactions (connection_id);
create index if not exists interactions_contact_id_idx              on public.interactions (contact_id);
create index if not exists interactions_user_id_idx                 on public.interactions (user_id);
create index if not exists knowledge_chunks_brain_id_idx            on public.knowledge_chunks (brain_id);
create index if not exists relationships_contact_id_idx             on public.relationships (contact_id);
create index if not exists relationships_user_id_idx                on public.relationships (user_id);
create index if not exists trust_events_actor_id_idx                on public.trust_events (actor_id);
create index if not exists warm_introductions_connector_contact_id_idx on public.warm_introductions (connector_contact_id);
create index if not exists warm_introductions_connector_user_id_idx on public.warm_introductions (connector_user_id);
create index if not exists warm_introductions_requester_id_idx      on public.warm_introductions (requester_id);
