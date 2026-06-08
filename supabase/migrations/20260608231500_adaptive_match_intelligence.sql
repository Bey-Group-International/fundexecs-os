-- =====================================================================
-- Adaptive match intelligence: the self-aware layer on top of the Wave 6
-- deterministic signal scorer.
--
-- Additive + idempotent. Backend/data only. Two new capabilities:
--
--   1. A per-org / per-factor learning memory (`match_scoring_weights`).
--      `recompute_match_scoring_weights` reads every actioned signal match
--      and learns which rationale factors actually predict an ACCEPT vs a
--      DISMISS, then stores a 0.5x-1.5x multiplier per factor. The scorer
--      reads those multipliers, so the inbox literally tunes itself to each
--      org's revealed preferences over time.
--
--   2. A semantic-fit factor. `org_profile_embeddings` holds a Voyage vector
--      for each org's mandate; `generate_signal_matches` adds a cosine-
--      similarity component against `market_signals.embedding`. When either
--      embedding is absent the factor scores 0 and the keyword path is
--      unchanged — never-block, same as the AI evidence validator.
--
-- Nothing here drops or rewrites existing rows; the scorer keeps its exact
-- public signature so all call sites are untouched.
-- =====================================================================

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Per-org, per-factor adaptive weights (the learning memory).
-- ---------------------------------------------------------------------

create table if not exists public.match_scoring_weights (
  org_id uuid not null references public.organizations (id) on delete cascade,
  factor text not null,
  multiplier numeric(4, 3) not null default 1.0,
  accepted_count integer not null default 0,
  dismissed_count integer not null default 0,
  sample_size integer not null default 0,
  updated_at timestamp with time zone not null default now(),
  primary key (org_id, factor)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.match_scoring_weights'::regclass
      and conname = 'match_scoring_weights_multiplier_range'
  ) then
    alter table public.match_scoring_weights
      add constraint match_scoring_weights_multiplier_range
      check (multiplier between 0.5 and 1.5);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.match_scoring_weights'::regclass
      and conname = 'match_scoring_weights_factor_not_blank'
  ) then
    alter table public.match_scoring_weights
      add constraint match_scoring_weights_factor_not_blank
      check (length(btrim(factor)) > 0);
  end if;
end$$;

alter table public.match_scoring_weights enable row level security;

revoke all on table public.match_scoring_weights from anon, authenticated;
grant select on table public.match_scoring_weights to authenticated;
grant select, insert, update on table public.match_scoring_weights to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'match_scoring_weights'
      and policyname = 'members read own org match_scoring_weights'
  ) then
    create policy "members read own org match_scoring_weights"
      on public.match_scoring_weights
      for select to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = match_scoring_weights.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'match_scoring_weights'
      and policyname = 'service_role writes match_scoring_weights'
  ) then
    create policy "service_role writes match_scoring_weights"
      on public.match_scoring_weights
      for all to service_role
      using (true)
      with check (true);
  end if;
end$$;

-- ---------------------------------------------------------------------
-- 2. Per-org mandate embedding (semantic-fit source).
-- ---------------------------------------------------------------------

create table if not exists public.org_profile_embeddings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  embedding extensions.vector(1024),
  source_text text,
  updated_at timestamp with time zone not null default now()
);

create index if not exists org_profile_embeddings_embedding_idx
  on public.org_profile_embeddings using hnsw (embedding extensions.vector_cosine_ops);

alter table public.org_profile_embeddings enable row level security;

revoke all on table public.org_profile_embeddings from anon, authenticated;
grant select on table public.org_profile_embeddings to authenticated;
grant select, insert, update on table public.org_profile_embeddings to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'org_profile_embeddings'
      and policyname = 'members read own org_profile_embeddings'
  ) then
    create policy "members read own org_profile_embeddings"
      on public.org_profile_embeddings
      for select to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = org_profile_embeddings.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'org_profile_embeddings'
      and policyname = 'service_role writes org_profile_embeddings'
  ) then
    create policy "service_role writes org_profile_embeddings"
      on public.org_profile_embeddings
      for all to service_role
      using (true)
      with check (true);
  end if;
end$$;

-- ---------------------------------------------------------------------
-- 3. The learning step.
--
-- For each rationale factor, compare its average contributed weight on
-- ACCEPTED matches vs DISMISSED matches. A factor that scored higher on the
-- matches the operator accepted is predictive → multiplier > 1. One that
-- scored higher on dismissals is anti-predictive → multiplier < 1. We only
-- adjust a factor once it has been seen on both sides of at least a few
-- decisions, so a cold inbox stays neutral (1.0) and never over-fits.
-- ---------------------------------------------------------------------

create or replace function public.recompute_match_scoring_weights(_org_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _updated integer := 0;
  _decisions integer := 0;
  _min_decisions constant integer := 3;
  _gain constant numeric := 0.5;
begin
  if _org_id is null then
    raise exception 'org_id is required' using errcode = '22023';
  end if;

  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'recompute_match_scoring_weights requires service_role'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('recompute_match_scoring_weights:' || _org_id::text, 0)
  );

  select count(*) into _decisions
  from public.matches m
  where m.org_id = _org_id
    and m.kind = 'signal'
    and m.status in ('accepted', 'dismissed');

  -- Cold start: reset everything to neutral and stop. Never over-fit a
  -- handful of clicks.
  if _decisions < _min_decisions then
    update public.match_scoring_weights
      set multiplier = 1.0, sample_size = _decisions, updated_at = now()
      where org_id = _org_id;
    return 0;
  end if;

  with factor_rows as (
    select
      m.status,
      e.obj ->> 'factor' as factor,
      nullif(e.obj ->> 'weight', '')::numeric as weight
    from public.matches m
    cross join lateral jsonb_array_elements(m.rationale) as e(obj)
    where m.org_id = _org_id
      and m.kind = 'signal'
      and m.status in ('accepted', 'dismissed')
      and (e.obj ->> 'factor') is not null
      and (e.obj ->> 'factor') <> 'match_reason'
  ),
  agg as (
    select
      factor,
      avg(weight) filter (where status = 'accepted') as acc_avg,
      avg(weight) filter (where status = 'dismissed') as dis_avg,
      count(*) filter (where status = 'accepted') as acc_n,
      count(*) filter (where status = 'dismissed') as dis_n
    from factor_rows
    where factor is not null and weight is not null
    group by factor
  ),
  learned as (
    select
      factor,
      acc_n,
      dis_n,
      case
        -- Need signal on both sides to learn a direction; otherwise neutral.
        when acc_n > 0 and dis_n > 0 then
          least(1.5, greatest(0.5,
            1 + _gain * (acc_avg - dis_avg)
              / nullif(greatest(abs(acc_avg), abs(dis_avg), 1), 0)
          ))
        else 1.0
      end as multiplier
    from agg
  ),
  upserted as (
    insert into public.match_scoring_weights
      (org_id, factor, multiplier, accepted_count, dismissed_count, sample_size, updated_at)
    select
      _org_id,
      l.factor,
      round(l.multiplier, 3),
      l.acc_n,
      l.dis_n,
      l.acc_n + l.dis_n,
      now()
    from learned l
    on conflict (org_id, factor) do update
      set multiplier = excluded.multiplier,
          accepted_count = excluded.accepted_count,
          dismissed_count = excluded.dismissed_count,
          sample_size = excluded.sample_size,
          updated_at = now()
    returning 1
  )
  select count(*) into _updated from upserted;

  return _updated;
end;
$$;

revoke all on function public.recompute_match_scoring_weights(uuid) from public, anon, authenticated;
grant execute on function public.recompute_match_scoring_weights(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 4. Weight-aware + semantic-aware signal scorer.
--
-- Same signature and same five base factors as Wave 6, plus:
--   - a `semantic_fit` factor (0-20) from cosine similarity when both the
--     org mandate embedding and the signal embedding exist, and
--   - per-factor adaptive multipliers from match_scoring_weights.
-- The keyword path is preserved exactly; semantic + adaptive layers are
-- strictly additive and degrade to the Wave 6 behaviour when their inputs
-- are missing.
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
      least(1.5, greatest(0.5, coalesce((select w.multiplier from public.match_scoring_weights w where w.org_id = op.org_id and w.factor = 'semantic_fit'), 1.0))) as m_semantic
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
      pc.m_thesis,
      pc.m_persona,
      pc.m_quality,
      pc.m_raise,
      pc.m_routing,
      pc.m_semantic,
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
      end as semantic_fit_raw
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
      round(sc.semantic_fit_raw * sc.m_semantic)::integer as semantic_fit_score
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
