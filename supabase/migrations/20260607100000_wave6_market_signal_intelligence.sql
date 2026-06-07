-- =====================================================================
-- Wave 6 intelligence Phase 1: global market signals + signal matching.
--
-- Additive + idempotent. Backend/data only:
-- - no ingestion, cron, UI, lib/ai, or Supabase client changes
-- - Claude applies this migration, runs advisors, and regenerates types
-- =====================================================================

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Market signals: global reference data for EDGAR/Form D/Form ADV and
-- future low-cost capital-market sources. Org-specific targeting lives in
-- public.matches rows, not on this table.
-- ---------------------------------------------------------------------

create table if not exists public.market_signals (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_external_id text,
  kind text not null,
  captured_at timestamp with time zone not null default now(),
  occurred_at timestamp with time zone,
  raw_payload jsonb not null default '{}'::jsonb,
  normalized jsonb,
  severity text not null default 'info',
  embedding extensions.vector(1024),
  routed_specialist text,
  created_at timestamp with time zone not null default now()
);

create unique index if not exists market_signals_source_external_id_key
  on public.market_signals (source, source_external_id);
create index if not exists market_signals_kind_captured_at_idx
  on public.market_signals (kind, captured_at desc);
create index if not exists market_signals_routed_specialist_idx
  on public.market_signals (routed_specialist);
create index if not exists market_signals_embedding_idx
  on public.market_signals using hnsw (embedding extensions.vector_cosine_ops);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.market_signals'::regclass
      and conname = 'market_signals_source_not_blank'
  ) then
    alter table public.market_signals
      add constraint market_signals_source_not_blank
      check (length(btrim(source)) > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.market_signals'::regclass
      and conname = 'market_signals_kind_not_blank'
  ) then
    alter table public.market_signals
      add constraint market_signals_kind_not_blank
      check (length(btrim(kind)) > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.market_signals'::regclass
      and conname = 'market_signals_severity_check'
  ) then
    alter table public.market_signals
      add constraint market_signals_severity_check
      check (severity in ('critical', 'warning', 'info'));
  end if;
end$$;

alter table public.market_signals enable row level security;

revoke all on table public.market_signals from anon, authenticated;
grant select on table public.market_signals to authenticated;
grant select, insert, update on table public.market_signals to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'market_signals'
      and policyname = 'authenticated read market_signals'
  ) then
    create policy "authenticated read market_signals" on public.market_signals
      for select to authenticated
      using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'market_signals'
      and policyname = 'service_role insert market_signals'
  ) then
    create policy "service_role insert market_signals" on public.market_signals
      for insert to service_role
      with check (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'market_signals'
      and policyname = 'service_role update market_signals'
  ) then
    create policy "service_role update market_signals" on public.market_signals
      for update to service_role
      using (true)
      with check (true);
  end if;
end$$;

-- Existing Match Inbox rows only allowed lp/deal before Phase 1. Signal
-- matches reuse the same table, so extend the existing check idempotently.
do $$
declare
  _kind_check text;
begin
  select pg_get_constraintdef(c.oid) into _kind_check
  from pg_constraint c
  where c.conrelid = 'public.matches'::regclass
    and c.conname = 'matches_kind_check';

  if _kind_check is null then
    alter table public.matches
      add constraint matches_kind_check
      check (kind in ('lp', 'deal', 'signal'));
  elsif position('signal' in _kind_check) = 0 then
    alter table public.matches drop constraint matches_kind_check;
    alter table public.matches
      add constraint matches_kind_check
      check (kind in ('lp', 'deal', 'signal'));
  end if;
end$$;

-- ---------------------------------------------------------------------
-- 2. Deterministic signal scorer.
--
-- Mirrors generate_lp_matches: one service-role RPC, one inserted Match Inbox
-- row per unmatched subject, 0-100 explainable score, rationale array. The
-- current Source-of-Truth fund profile lives in the org owner's
-- member_profiles row; there is no dedicated fund_profiles table on main.
-- ---------------------------------------------------------------------

create or replace function public.generate_signal_matches(_org_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _inserted integer := 0;
begin
  if _org_id is null then
    raise exception 'org_id is required'
      using errcode = '22023';
  end if;

  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'generate_signal_matches requires service_role'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('generate_signal_matches:' || _org_id::text, 0)
  );

  with owner_profile as (
    select
      o.id as org_id,
      o.name as org_name,
      o.tier as org_tier,
      o.type::text as org_type,
      coalesce(
        p.member_type,
        case
          when o.type::text = 'service_provider' then 'service_provider'
          when o.type::text = 'lp' then 'individual_investor'
          when o.type::text in ('fund', 'capital_provider') then 'investment_firm'
          else null
        end
      ) as member_type,
      mp.focus_areas,
      mp.details,
      lower(concat_ws(
        ' ',
        o.name,
        o.tier,
        o.type::text,
        p.member_type,
        mp.display_name,
        mp.headline,
        mp.bio,
        array_to_string(mp.focus_areas, ' '),
        mp.details ->> 'thesis',
        mp.details ->> 'investment_thesis',
        mp.details ->> 'strategy',
        mp.details ->> 'sector',
        mp.details ->> 'focus',
        mp.details ->> 'geography',
        mp.details ->> 'region',
        mp.details ->> 'industry',
        mp.details ->> 'target_customer',
        mp.details ->> 'ideal_customer',
        mp.details ->> 'services',
        mp.details ->> 'capabilities',
        mp.details::text
      )) as profile_text
    from public.organizations o
    left join lateral (
      select om.user_id
      from public.org_members om
      where om.org_id = o.id
        and om.status = 'active'
      order by
        case om.role when 'owner' then 0 when 'admin' then 1 else 2 end,
        om.created_at asc
      limit 1
    ) owner on true
    left join public.profiles p on p.id = owner.user_id
    left join public.member_profiles mp on mp.user_id = owner.user_id
    where o.id = _org_id
  ),
  profile_context as (
    select
      op.org_id,
      coalesce(op.member_type, 'investment_firm') as member_type,
      coalesce(op.focus_areas, '{}'::text[]) as focus_areas,
      coalesce(op.details, '{}'::jsonb) as details,
      coalesce(op.profile_text, '') as profile_text,
      target.target_raise
    from owner_profile op
    left join lateral (
      select max(nullif(regexp_replace(v.raw_value, '[^0-9]', '', 'g'), '')::numeric) as target_raise
      from (values
        (op.details ->> 'target_raise'),
        (op.details ->> 'targetRaise'),
        (op.details ->> 'fund_size'),
        (op.details ->> 'raise_target')
      ) as v(raw_value)
      where v.raw_value ~ '[0-9]'
    ) target on true
  ),
  signal_candidates as (
    select
      ms.id as signal_id,
      ms.source,
      ms.source_external_id,
      ms.kind,
      ms.captured_at,
      ms.occurred_at,
      coalesce(ms.normalized, '{}'::jsonb) as normalized,
      ms.severity,
      coalesce(
        nullif(btrim(ms.routed_specialist), ''),
        case
          when ms.source in ('edgar-form-d', 'form-d') or ms.kind in ('private-fundraise', 'fundraise') then 'eleanor'
          when ms.source in ('edgar-form-adv', 'form-adv') or ms.kind in ('fund-formation', 'compliance') then 'adrian'
          when ms.kind in ('deal', 'deal-flow', 'ownership', 'portfolio-event') then 'marcus'
          when ms.kind in ('capital-markets', 'market-event') then 'priya'
          when ms.kind in ('news', 'press-release', 'web') then 'noah'
          else 'dalia'
        end
      ) as routed_specialist,
      lower(concat_ws(
        ' ',
        ms.source,
        ms.kind,
        ms.severity,
        ms.routed_specialist,
        ms.normalized ->> 'issuer_name',
        ms.normalized ->> 'entity_name',
        ms.normalized ->> 'company_name',
        ms.normalized ->> 'fund_name',
        ms.normalized ->> 'industry',
        ms.normalized ->> 'sector',
        ms.normalized ->> 'strategy',
        ms.normalized ->> 'geography',
        ms.normalized ->> 'region',
        ms.normalized ->> 'description',
        ms.normalized ->> 'summary',
        ms.normalized::text,
        left(coalesce(ms.raw_payload::text, ''), 4000)
      )) as signal_text,
      amount.signal_amount
    from public.market_signals ms
    left join lateral (
      select max(nullif(regexp_replace(v.raw_value, '[^0-9]', '', 'g'), '')::numeric) as signal_amount
      from (values
        (ms.normalized ->> 'offering_amount'),
        (ms.normalized ->> 'total_offering_amount'),
        (ms.normalized ->> 'amount'),
        (ms.normalized ->> 'fund_size'),
        (ms.raw_payload ->> 'offering_amount'),
        (ms.raw_payload ->> 'totalOfferingAmount'),
        (ms.raw_payload ->> 'amount')
      ) as v(raw_value)
      where v.raw_value ~ '[0-9]'
    ) amount on true
    where not exists (
      select 1
      from public.matches m
      where m.org_id = _org_id
        and m.kind = 'signal'
        and m.subject_id = ms.id
    )
  ),
  signal_scores as (
    select
      sc.*,
      pc.org_id,
      pc.member_type,
      pc.focus_areas,
      pc.profile_text,
      pc.target_raise,
      (
        select count(*)
        from unnest(pc.focus_areas) as focus(value)
        where length(btrim(focus.value)) > 2
          and sc.signal_text like '%' || lower(btrim(focus.value)) || '%'
      ) as focus_overlap,
      (
        select count(*)
        from regexp_split_to_table(pc.profile_text, '[^a-z0-9]+') as token(value)
        where length(token.value) > 3
          and sc.signal_text like '%' || token.value || '%'
      ) as profile_token_overlap,
      (
        select coalesce(jsonb_agg(distinct hit.value), '[]'::jsonb)
        from (
          select focus.value
          from unnest(pc.focus_areas) as focus(value)
          where length(btrim(focus.value)) > 2
            and sc.signal_text like '%' || lower(btrim(focus.value)) || '%'
          union all
          select 'thesis'
          where pc.profile_text <> ''
            and exists (
              select 1
              from regexp_split_to_table(pc.profile_text, '[^a-z0-9]+') as token(value)
              where length(token.value) > 5
                and sc.signal_text like '%' || token.value || '%'
              limit 1
            )
          union all
          select 'target_raise'
          where pc.target_raise is not null and sc.signal_amount is not null
        ) as hit(value)
      ) as matched_fields
    from signal_candidates sc
    cross join profile_context pc
  ),
  scored as (
    select
      s.*,
      case
        when s.focus_overlap > 0 then 25
        when s.profile_token_overlap >= 3 then 20
        when s.profile_token_overlap > 0 then 14
        when s.profile_text <> '' then 8
        else 5
      end as thesis_fit_score,
      case
        when s.member_type = 'service_provider'
          and (
            s.kind in ('private-fundraise', 'fund-formation', 'compliance', 'news', 'press-release')
            or s.signal_text ~ '(service|vendor|provider|legal|compliance|fund administration|audit|tax)'
          ) then 20
        when s.member_type = 'investment_firm'
          and s.kind in ('private-fundraise', 'fund-formation', 'deal', 'market-event') then 20
        when s.member_type = 'individual_investor'
          and s.kind in ('private-fundraise', 'fund-formation', 'capital-markets', 'market-event') then 18
        when s.member_type in ('startup', 'student') then 8
        else 12
      end as persona_fit_score,
      case
        when s.source in ('edgar-form-d', 'edgar-form-adv') then 20
        when s.kind in ('private-fundraise', 'fund-formation') then 18
        when s.kind in ('news', 'press-release', 'market-event', 'capital-markets') then 14
        else 10
      end as signal_quality_score,
      case
        when s.member_type = 'service_provider' and s.signal_amount is not null then 20
        when s.target_raise is null or s.signal_amount is null then 12
        when s.signal_amount between s.target_raise * 0.25 and s.target_raise * 4 then 20
        when s.signal_amount between s.target_raise * 0.10 and s.target_raise * 8 then 15
        else 8
      end as raise_or_demand_score,
      case
        when s.severity = 'critical' then 10
        when s.severity = 'warning' then 8
        else 5
      end +
      case
        when s.routed_specialist in ('eleanor', 'adrian', 'marcus', 'noah', 'dalia', 'priya') then 5
        else 2
      end as routing_score
    from signal_scores s
  ),
  inserted as (
    insert into public.matches (org_id, kind, subject_id, score, rationale, status)
    select
      s.org_id,
      'signal',
      s.signal_id,
      least(100, greatest(
        0,
        s.thesis_fit_score
        + s.persona_fit_score
        + s.signal_quality_score
        + s.raise_or_demand_score
        + s.routing_score
      ))::integer,
      jsonb_build_array(
        jsonb_build_object(
          'factor', 'thesis_fit',
          'weight', s.thesis_fit_score,
          'detail', case
            when s.focus_overlap > 0 then 'Signal text overlaps with fund profile focus areas.'
            when s.profile_token_overlap > 0 then 'Signal text overlaps with profile thesis or strategy terms.'
            when s.profile_text <> '' then 'Profile exists but no explicit signal overlap was found.'
            else 'No profile thesis or focus context is available yet.'
          end
        ),
        jsonb_build_object(
          'factor', 'persona_fit',
          'weight', s.persona_fit_score,
          'detail', case
            when s.member_type = 'service_provider' then 'Service-provider persona scored for demand-side fundraising, formation, compliance, and vendor-need signals.'
            when s.member_type = 'individual_investor' then 'Individual-investor persona scored for raise, formation, and capital-market signals.'
            when s.member_type = 'investment_firm' then 'Investment-firm persona scored for raise, formation, deal, and market-event signals.'
            else 'Persona is not in Phase 1 focus; signal receives a neutral-low fit score.'
          end
        ),
        jsonb_build_object(
          'factor', 'signal_quality',
          'weight', s.signal_quality_score,
          'detail', case
            when s.source in ('edgar-form-d', 'edgar-form-adv') then 'Primary EDGAR source.'
            when s.kind in ('private-fundraise', 'fund-formation') then 'Core private-market intelligence kind.'
            else 'Secondary or future-source signal kind.'
          end
        ),
        jsonb_build_object(
          'factor', 'raise_or_demand_fit',
          'weight', s.raise_or_demand_score,
          'detail', case
            when s.member_type = 'service_provider' and s.signal_amount is not null then 'Signal amount indicates a potential demand-side account.'
            when s.target_raise is null or s.signal_amount is null then 'Target raise or signal amount unavailable; scored neutrally.'
            else 'Signal amount compared with target raise context.'
          end
        ),
        jsonb_build_object(
          'factor', 'routing',
          'weight', s.routing_score,
          'detail', 'Signal routed to ' || coalesce(s.routed_specialist, 'dalia') || ' for specialist follow-up.',
          'routed_specialist', coalesce(s.routed_specialist, 'dalia')
        ),
        jsonb_build_object(
          'factor', 'match_reason',
          'weight', 0,
          'detail', 'Matched fields: ' || coalesce(s.matched_fields::text, '[]'),
          'matched_fields', s.matched_fields,
          'member_type', s.member_type,
          'source', s.source,
          'source_external_id', s.source_external_id,
          'signal_kind', s.kind,
          'severity', s.severity,
          'routed_specialist', coalesce(s.routed_specialist, 'dalia')
        )
      ),
      'new'
    from scored s
    returning 1
  )
  select count(*) into _inserted from inserted;

  return _inserted;
end;
$$;

revoke all on function public.generate_signal_matches(uuid) from public, anon, authenticated;
grant execute on function public.generate_signal_matches(uuid) to service_role;
