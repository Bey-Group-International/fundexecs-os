-- =====================================================================
-- Admin bootstrap + rich demo seed for human testing.
-- - A fixed "Bey Group International" org.
-- - @beygroupintl.com signups are auto-promoted to admin of that org, with
--   per-user demo warmth + notifications seeded on first login.
-- - Org-scoped demo data (brains, deals, partnerships, providers,
--   governance, synergy, chain-of-trust, contacts) so screens are populated.
-- =====================================================================

insert into public.organizations (id, name, type, tier)
values ('b0000000-0000-4000-8000-000000000001', 'Bey Group International', 'fund', 'institutional')
on conflict (id) do nothing;

-- the 15 global "Earn" brains
insert into public.ai_brains (org_id, slug, name, is_global, persona, description)
select null, v.slug, v.name, true, v.persona, v.descr
from (values
  ('master-workflow','Master Workflow','command','Routes work across all brains and the command layer.'),
  ('earnest-fundmaker','Earnest Fundmaker','concierge','Earn — the showrunner / private-market assistant.'),
  ('automater','Automater','intake','Scrubs and structures inbound intake into the system.'),
  ('executive-advisor','Executive Advisor','intelligence','Investor intelligence and executive guidance.'),
  ('rainmaker','Rainmaker','closer','Drives closes and capital commitments.'),
  ('deal-sourcer','Deal Sourcer','acquisitions','Sources and screens acquisition opportunities.'),
  ('capital-connector','Capital Connector','financing','Connects deals to capital providers.'),
  ('legal-admin','Legal Admin','compliance','Compliance, legal, and document administration.'),
  ('pr-director','PR Director','materials','Produces PR and investor-facing materials.'),
  ('seo-disruptor','SEO Disruptor','growth','Search and discovery growth.'),
  ('lead-generator','Lead Generator','funnels','Builds and runs lead funnels.'),
  ('event-curator','Private Event Curator','network','Curates private events and introductions.'),
  ('investor-relations','Investor Relations','relations','Manages LP relationships and updates.'),
  ('capital-raiser','Elite Capital Raiser','raise','Leads institutional capital raises.'),
  ('workflow-instructor','Workflow Instructor','enablement','Teaches and optimizes operator workflows.')
) as v(slug, name, persona, descr)
where not exists (select 1 from public.ai_brains b where b.org_id is null and b.slug = v.slug);

-- org-scoped demo data (runs once)
do $$
declare _org uuid := 'b0000000-0000-4000-8000-000000000001';
declare _plan uuid;
declare _deal uuid;
declare _chain uuid;
begin
  if exists (select 1 from public.deals where org_id = _org) then
    return;
  end if;

  insert into public.deals (org_id, name, stage, status, amount) values
    (_org, 'Project Atlas — SaaS rollup', 'diligence', 'open', 12400000),
    (_org, 'Meridian Logistics buyout', 'ic', 'open', 28000000),
    (_org, 'NorthStar secondary', 'screening', 'open', 6500000),
    (_org, 'Harbor data-center JV', 'sourcing', 'open', 41000000),
    (_org, 'Vantage healthcare platform', 'closing', 'open', 18750000),
    (_org, 'Summit credit facility', 'closed', 'won', 9000000);

  insert into public.partnerships (org_id, counterparty, type, stage) values
    (_org, 'Apex Capital', 'co-invest', 'active'),
    (_org, 'HarborBridge', 'service', 'prospect'),
    (_org, 'Gulf Sovereign', 'lp', 'diligence');

  insert into public.service_providers (org_id, name, category, status) values
    (_org, 'Kirkland & Ellis', 'legal', 'active'),
    (_org, 'PwC Deal Advisory', 'diligence', 'active'),
    (_org, 'Carta', 'cap-table', 'active');

  insert into public.capital_providers (org_id, name, capital_types, check_size_min, check_size_max) values
    (_org, 'Meridian LP', '{equity}', 5000000, 25000000),
    (_org, 'Summit Family Office', '{equity,credit}', 2000000, 15000000),
    (_org, 'Gulf Sovereign', '{equity}', 25000000, 150000000);

  insert into public.governance_plans (org_id, name, horizon, status)
  values (_org, 'Fund I — 100/30/10 Plan', '12mo', 'active') returning id into _plan;
  insert into public.governance_objectives (org_id, plan_id, objective, timeline, priority, status, ai_recommendation) values
    (_org, _plan, 'Close $50M first-close commitments', 'Q3', 'high', 'open', 'Prioritize the 3 hottest LP relationships.'),
    (_org, _plan, 'Build 10 proprietary deal sources', 'Q3', 'medium', 'open', 'Activate the Deal Sourcer brain weekly.'),
    (_org, _plan, 'Complete Fund I governance docs', 'Q2', 'high', 'open', 'Route to Legal Admin for the LPA pack.'),
    (_org, _plan, 'Reach Proof of Execution on Atlas', 'Q2', 'medium', 'open', 'Upload diligence evidence to advance the layer.'),
    (_org, _plan, 'Launch quarterly LP update cadence', 'Q2', 'low', 'open', 'Use the IR brain + lp-update template.');

  insert into public.synergy_opportunities (org_id, source_entity_type, target_entity_type, rationale, score, status) values
    (_org, 'deal', 'capital_provider', 'Meridian LP thesis fits the Logistics buyout.', 88.5, 'new'),
    (_org, 'partnership', 'deal', 'Apex co-invest appetite matches Atlas.', 76.0, 'new');

  select id into _deal from public.deals where org_id = _org and name = 'Project Atlas — SaaS rollup' limit 1;
  insert into public.chain_of_trust_records (org_id, entity_type, entity_id, current_layer, completion_percentage, status)
  values (_org, 'deal', _deal, 'Proof of Concept', 45, 'active') returning id into _chain;
  insert into public.proof_layers (org_id, chain_record_id, layer_name, layer_order, human_approval_status, completion_percentage) values
    (_org, _chain, 'Proof of Truth', 1, 'approved', 100),
    (_org, _chain, 'Proof of Concept', 2, 'pending', 60),
    (_org, _chain, 'Proof of Execution', 3, 'pending', 15),
    (_org, _chain, 'Proof of Work', 4, 'pending', 0);

  insert into public.contacts (org_id, full_name, primary_email, company, title) values
    (_org, 'Jordan Wells', 'jordan.wells@apexcapital.com', 'Apex Capital', 'Managing Partner'),
    (_org, 'Priya Nair', 'priya@meridianlp.com', 'Meridian LP', 'Investment Director'),
    (_org, 'Marcus Lee', 'marcus.lee@harborbridge.com', 'HarborBridge', 'Principal'),
    (_org, 'Elena Sokolova', 'elena@northstar.vc', 'NorthStar Ventures', 'General Partner'),
    (_org, 'David Okafor', 'david.okafor@summitfo.com', 'Summit Family Office', 'CIO'),
    (_org, 'Sarah Chen', 'sarah.chen@vantagepe.com', 'Vantage PE', 'Partner'),
    (_org, 'Tom Bradley', 'tom@bridgewater-co.com', 'Bridgewater & Co', 'Advisor'),
    (_org, 'Aisha Rahman', 'aisha@gulfsovereign.com', 'Gulf Sovereign', 'Director');
end $$;

-- per-user demo warmth + notifications (called on first @beygroupintl.com login)
create or replace function public.seed_demo_for_user(_org uuid, _user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select * from (values
      ('jordan.wells@apexcapital.com', 10, 14),
      ('priya@meridianlp.com', 9, 10),
      ('marcus.lee@harborbridge.com', 5, 40),
      ('elena@northstar.vc', 5, 35),
      ('david.okafor@summitfo.com', 4, 50),
      ('sarah.chen@vantagepe.com', 2, 160),
      ('tom@bridgewater-co.com', 2, 200),
      ('aisha@gulfsovereign.com', 1, 240)
    ) as t(email, cnt, maxd)
  loop
    insert into public.interactions (org_id, user_id, contact_id, provider, type, direction, occurred_at, subject, external_ref)
    select _org, _user, c.id, 'seed',
      (array['email_sent','email_received','meeting'])[1 + (g % 3)],
      (array['outbound','inbound','internal'])[1 + (g % 3)],
      now() - ((r.maxd::float * g / greatest(r.cnt, 1)) || ' days')::interval,
      'Demo touchpoint with ' || c.full_name,
      'seed:' || _user || ':' || c.id || ':' || g
    from public.contacts c
    cross join generate_series(1, r.cnt) as g
    where c.org_id = _org and c.primary_email = r.email
    on conflict (org_id, provider, external_ref) do nothing;
  end loop;

  insert into public.warm_introductions (org_id, requester_id, target_contact_id, connector_contact_id, strength, rationale, status)
  select _org, _user, t.id, c.id, 82.0,
    c.full_name || ' is warm with ' || t.full_name || ' — strong intro path.', 'suggested'
  from public.contacts t, public.contacts c
  where t.org_id = _org and c.org_id = _org
    and t.primary_email = 'aisha@gulfsovereign.com'
    and c.primary_email = 'jordan.wells@apexcapital.com'
  on conflict do nothing;

  insert into public.notifications (user_id, org_id, type, payload) values
    (_user, _org, 'synergy', jsonb_build_object('title', 'New synergy: Apex x Meridian', 'body', 'Earn found a co-invest overlap.')),
    (_user, _org, 'task', jsonb_build_object('title', '3 LPs need follow-up', 'body', 'Warm connections are cooling off.')),
    (_user, _org, 'trust', jsonb_build_object('title', 'Proof of Concept advanced', 'body', 'Fund I readiness at 62%.'));
end $$;
revoke all on function public.seed_demo_for_user(uuid, uuid) from public, anon, authenticated;

-- new-user trigger: profile + @beygroupintl.com admin promotion + demo seed
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _bey uuid := 'b0000000-0000-4000-8000-000000000001';
  _email text := lower(coalesce(new.email, ''));
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;

  if _email like '%@beygroupintl.com' then
    update public.profiles set role = 'admin' where id = new.id;
    insert into public.org_members (org_id, user_id, role)
    values (_bey, new.id, 'admin')
    on conflict (org_id, user_id) do nothing;

    if not exists (select 1 from public.interactions where user_id = new.id) then
      perform public.seed_demo_for_user(_bey, new.id);
    end if;
  end if;

  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
