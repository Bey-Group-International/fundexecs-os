-- =====================================================================
-- Intelligence flywheel: daily briefings + recency-decay & issuer-dedupe
-- on the adaptive signal scorer.
--
-- Additive + idempotent. Builds directly on the adaptive scorer from
-- 20260608231500_adaptive_match_intelligence.sql:
--   - new `intelligence_briefings` table (one current Earn briefing per org),
--   - a `recency` factor so fresh filings outrank stale ones, and
--   - issuer-level de-duplication so a single issuer can't flood an org's
--     inbox across multiple filings inside a 30-day window.
-- The keyword / adaptive / semantic layers are all preserved unchanged.
-- =====================================================================

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Per-org daily briefing (written by the cron, read by the inbox).
-- ---------------------------------------------------------------------

create table if not exists public.intelligence_briefings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  body text not null,
  match_count integer not null default 0,
  top_score integer,
  generated_at timestamp with time zone not null default now()
);

alter table public.intelligence_briefings enable row level security;

revoke all on table public.intelligence_briefings from anon, authenticated;
grant select on table public.intelligence_briefings to authenticated;
grant select, insert, update on table public.intelligence_briefings to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'intelligence_briefings'
      and policyname = 'members read own org intelligence_briefings'
  ) then
    create policy "members read own org intelligence_briefings"
      on public.intelligence_briefings
      for select to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = intelligence_briefings.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'intelligence_briefings'
      and policyname = 'service_role writes intelligence_briefings'
  ) then
    create policy "service_role writes intelligence_briefings"
      on public.intelligence_briefings
      for all to service_role
      using (true)
      with check (true);
  end if;
end$$;

-- ---------------------------------------------------------------------
-- 2. Scorer v3: + recency decay, + issuer de-duplication.
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
      target.target_raise,
      (select e.embedding from public.org_profile_embeddings e where e.org_id = op.org_id) as org_embedding,
      least(1.5, greatest(0.5, coalesce((select w.multiplier from public.match_scoring_weights w where w.org_id = op.org_id and w.factor = 'thesis_fit'), 1.0))) as m_thesis,
      least(1.5, greatest(0.5, coalesce((select w.multiplier from public.match_scoring_weights w where w.org_id = op.org_id and w.factor = 'persona_fit'), 1.0))) as m_persona,
      least(1.5, greatest(0.5, coalesce((select w.multiplier from public.match_scoring_weights w where w.org_id = op.org_id and w.factor = 'signal_quality'), 1.0))) as m_quality,
      least(1.5, greatest(0.5, coalesce((select w.multiplier from public.match_scoring_weights w where w.org_id = op.org_id and w.factor = 'raise_or_demand_fit'), 1.0))) as m_raise,
      least(1.5, greatest(0.5, coalesce((select w.multiplier from public.match_scoring_weights w where w.org_id = op.org_id and w.factor = 'routing'), 1.0))) as m_routing,
      least(1.5, greatest(0.5, coalesce((select w.multiplier from public.match_scoring_weights w where w.org_id = op.org_id and w.factor = 'semantic_fit'), 1.0))) as m_semantic,
      least(1.5, greatest(0.5, coalesce((select w.multiplier from public.match_scoring_weights w where w.org_id = op.org_id and w.factor = 'recency'), 1.0))) as m_recency
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
      ms.embedding as signal_embedding,
      greatest(
        0,
        extract(epoch from (now() - coalesce(ms.occurred_at, ms.captured_at))) / 86400.0
      ) as age_days,
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
    -- Issuer de-dupe: skip if this org already has a live (new/accepted)
    -- match for the same issuer in the last 30 days.
    and not exists (
      select 1
      from public.matches m3
      join public.market_signals ms3 on ms3.id = m3.subject_id
      where m3.org_id = _org_id
        and m3.kind = 'signal'
        and m3.status in ('new', 'accepted')
        and ms.normalized ->> 'issuer_name' is not null
        and lower(ms.normalized ->> 'issuer_name') = lower(ms3.normalized ->> 'issuer_name')
        and m3.created_at > now() - interval '30 days'
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
      pc.m_thesis,
      pc.m_persona,
      pc.m_quality,
      pc.m_raise,
      pc.m_routing,
      pc.m_semantic,
      pc.m_recency,
      case
        when pc.org_embedding is not null and sc.signal_embedding is not null
          then 1 - (sc.signal_embedding operator(extensions.<=>) pc.org_embedding)
        else null
      end as semantic_similarity,
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
      end as thesis_fit_raw,
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
      end as persona_fit_raw,
      case
        when s.source in ('edgar-form-d', 'edgar-form-adv') then 20
        when s.kind in ('private-fundraise', 'fund-formation') then 18
        when s.kind in ('news', 'press-release', 'market-event', 'capital-markets') then 14
        else 10
      end as signal_quality_raw,
      case
        when s.member_type = 'service_provider' and s.signal_amount is not null then 20
        when s.target_raise is null or s.signal_amount is null then 12
        when s.signal_amount between s.target_raise * 0.25 and s.target_raise * 4 then 20
        when s.signal_amount between s.target_raise * 0.10 and s.target_raise * 8 then 15
        else 8
      end as raise_or_demand_raw,
      (
        case
          when s.severity = 'critical' then 10
          when s.severity = 'warning' then 8
          else 5
        end +
        case
          when s.routed_specialist in ('eleanor', 'adrian', 'marcus', 'noah', 'dalia', 'priya') then 5
          else 2
        end
      ) as routing_raw,
      case
        when s.semantic_similarity is null then 0
        else round(greatest(0, least(1, s.semantic_similarity)) * 20)::integer
      end as semantic_fit_raw,
      case
        when s.age_days <= 2 then 10
        when s.age_days <= 7 then 7
        when s.age_days <= 30 then 4
        when s.age_days <= 90 then 1
        else 0
      end as recency_raw
    from signal_scores s
  ),
  weighted as (
    select
      sc.*,
      round(sc.thesis_fit_raw * sc.m_thesis)::integer as thesis_fit_score,
      round(sc.persona_fit_raw * sc.m_persona)::integer as persona_fit_score,
      round(sc.signal_quality_raw * sc.m_quality)::integer as signal_quality_score,
      round(sc.raise_or_demand_raw * sc.m_raise)::integer as raise_or_demand_score,
      round(sc.routing_raw * sc.m_routing)::integer as routing_score,
      round(sc.semantic_fit_raw * sc.m_semantic)::integer as semantic_fit_score,
      round(sc.recency_raw * sc.m_recency)::integer as recency_score
    from scored sc
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
        + s.semantic_fit_score
        + s.recency_score
      ))::integer,
      jsonb_build_array(
        jsonb_build_object(
          'factor', 'thesis_fit',
          'weight', s.thesis_fit_score,
          'multiplier', s.m_thesis,
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
          'multiplier', s.m_persona,
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
          'multiplier', s.m_quality,
          'detail', case
            when s.source in ('edgar-form-d', 'edgar-form-adv') then 'Primary EDGAR source.'
            when s.kind in ('private-fundraise', 'fund-formation') then 'Core private-market intelligence kind.'
            else 'Secondary or future-source signal kind.'
          end
        ),
        jsonb_build_object(
          'factor', 'raise_or_demand_fit',
          'weight', s.raise_or_demand_score,
          'multiplier', s.m_raise,
          'detail', case
            when s.member_type = 'service_provider' and s.signal_amount is not null then 'Signal amount indicates a potential demand-side account.'
            when s.target_raise is null or s.signal_amount is null then 'Target raise or signal amount unavailable; scored neutrally.'
            else 'Signal amount compared with target raise context.'
          end
        ),
        jsonb_build_object(
          'factor', 'semantic_fit',
          'weight', s.semantic_fit_score,
          'multiplier', s.m_semantic,
          'similarity', s.semantic_similarity,
          'detail', case
            when s.semantic_similarity is null then 'Semantic match pending — embed this org''s mandate to unlock meaning-level scoring.'
            when s.semantic_similarity >= 0.5 then 'Strong meaning-level overlap between this signal and your mandate, beyond exact keywords.'
            when s.semantic_similarity >= 0.3 then 'Moderate meaning-level overlap with your mandate.'
            else 'Low semantic overlap with your mandate embedding.'
          end
        ),
        jsonb_build_object(
          'factor', 'recency',
          'weight', s.recency_score,
          'multiplier', s.m_recency,
          'age_days', round(s.age_days)::integer,
          'detail', case
            when s.age_days <= 2 then 'Filed in the last 48 hours — act while it is hot.'
            when s.age_days <= 7 then 'Filed within the past week.'
            when s.age_days <= 30 then 'Filed within the past month.'
            when s.age_days <= 90 then 'Filed within the past quarter.'
            else 'Older filing; recency no longer adds weight.'
          end
        ),
        jsonb_build_object(
          'factor', 'routing',
          'weight', s.routing_score,
          'multiplier', s.m_routing,
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
    from weighted s
    returning 1
  )
  select count(*) into _inserted from inserted;

  return _inserted;
end;
$$;

revoke all on function public.generate_signal_matches(uuid) from public, anon, authenticated;
grant execute on function public.generate_signal_matches(uuid) to service_role;
