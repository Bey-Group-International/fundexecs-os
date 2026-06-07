-- =====================================================================
-- Wave 4 module data RPCs: Capital Stack, Match Inbox, Audit Trail,
-- Objections, and deal-to-mandate matching.
--
-- Additive + idempotent. No UI/auth/client changes. Claude applies this
-- migration, runs advisors, and regenerates database.types.ts.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Advisor-friendly lookup indexes for the Wave 4 hot paths.
-- ---------------------------------------------------------------------

alter table public.matches
  add column if not exists acted_by uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.matches'::regclass
      and conname = 'matches_acted_by_fkey'
  ) then
    alter table public.matches
      add constraint matches_acted_by_fkey
      foreign key (acted_by)
      references public.profiles (id)
      on delete set null;
  end if;
end$$;

create index if not exists matches_acted_by_idx
  on public.matches (acted_by);
create index if not exists matches_org_kind_status_score_idx
  on public.matches (org_id, kind, status, score desc, created_at desc);
create index if not exists capital_commitments_org_lp_type_idx
  on public.capital_commitments (org_id, lp_type);
create index if not exists capital_commitments_org_updated_idx
  on public.capital_commitments (org_id, updated_at desc, created_at desc);
create index if not exists trust_events_org_created_at_idx
  on public.trust_events (org_id, created_at desc);
create index if not exists admin_actions_org_created_at_idx
  on public.admin_actions (org_id, created_at desc)
  where org_id is not null;
create index if not exists diligence_findings_org_created_at_idx
  on public.diligence_findings (org_id, created_at desc);
create index if not exists deals_org_status_stage_idx
  on public.deals (org_id, status, stage);
create index if not exists capital_providers_org_status_idx
  on public.capital_providers (org_id, status);
create index if not exists synergy_opportunities_org_source_lookup_idx
  on public.synergy_opportunities (org_id, source_entity_type, source_entity_id);
create index if not exists synergy_opportunities_org_target_lookup_idx
  on public.synergy_opportunities (org_id, target_entity_type, target_entity_id);
create index if not exists chain_of_trust_records_org_entity_lookup_idx
  on public.chain_of_trust_records (org_id, entity_type, entity_id);
create index if not exists diligence_runs_org_deal_status_created_idx
  on public.diligence_runs (org_id, deal_id, status, created_at desc);

-- ---------------------------------------------------------------------
-- 2. Capital Stack read path.
--
-- Preserves existing totals and adds a commitments JSON list. The summary
-- aggregates every capital_commitments row, including lp_type =
-- 'allocation_backfill' rows created by the release-data backfill.
-- ---------------------------------------------------------------------

drop function if exists public.capital_stack_summary(uuid);

create function public.capital_stack_summary(_org_id uuid)
returns table (
  org_id uuid,
  currency text,
  stage_totals jsonb,
  lp_type_totals jsonb,
  target_total numeric,
  soft_circle_total numeric,
  committed_total numeric,
  closed_total numeric,
  withdrawn_total numeric,
  active_total numeric,
  gap_to_target numeric,
  commitments jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with authorized as (
    select _org_id as org_id
    where (select auth.role()) = 'service_role'
       or private.is_org_member(_org_id)
  ),
  commitments_base as (
    select c.*
    from public.capital_commitments c
    join authorized a on a.org_id = c.org_id
  ),
  expected_stages(stage) as (
    values ('target'), ('soft_circle'), ('committed'), ('closed'), ('withdrawn')
  ),
  by_stage as (
    select s.stage, coalesce(sum(c.amount), 0)::numeric as total
    from expected_stages s
    left join commitments_base c on c.stage = s.stage
    group by s.stage
  ),
  by_lp_type as (
    select
      coalesce(nullif(c.lp_type, ''), 'unspecified') as lp_type,
      coalesce(sum(c.amount), 0)::numeric as total
    from commitments_base c
    group by coalesce(nullif(c.lp_type, ''), 'unspecified')
  ),
  totals as (
    select
      coalesce(sum(c.amount) filter (where c.stage = 'target'), 0)::numeric as target_total,
      coalesce(sum(c.amount) filter (where c.stage = 'soft_circle'), 0)::numeric as soft_circle_total,
      coalesce(sum(c.amount) filter (where c.stage = 'committed'), 0)::numeric as committed_total,
      coalesce(sum(c.amount) filter (where c.stage = 'closed'), 0)::numeric as closed_total,
      coalesce(sum(c.amount) filter (where c.stage = 'withdrawn'), 0)::numeric as withdrawn_total
    from commitments_base c
  ),
  commitment_rows as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'org_id', c.org_id,
          'lp_id', c.lp_id,
          'lp_name', cp.name,
          'amount', c.amount,
          'currency', c.currency,
          'stage', c.stage,
          'tranche', c.tranche,
          'lp_type', coalesce(nullif(c.lp_type, ''), 'unspecified'),
          'expected_close', c.expected_close,
          'notes', c.notes,
          'source', coalesce(
            cs.source_table,
            case
              when c.lp_type = 'allocation_backfill' then 'allocation_backfill'
              else 'capital_commitments'
            end
          ),
          'source_id', cs.source_id,
          'created_at', c.created_at,
          'updated_at', c.updated_at
        )
        order by c.updated_at desc, c.created_at desc
      ),
      '[]'::jsonb
    ) as commitments
    from commitments_base c
    left join public.capital_providers cp
      on cp.id = c.lp_id
     and cp.org_id = c.org_id
    left join public.capital_commitment_sources cs
      on cs.commitment_id = c.id
     and cs.org_id = c.org_id
  )
  select
    a.org_id,
    coalesce(
      (select c.currency from commitments_base c order by c.created_at desc limit 1),
      'USD'
    ) as currency,
    coalesce((select jsonb_object_agg(s.stage, s.total) from by_stage s), '{}'::jsonb) as stage_totals,
    coalesce((select jsonb_object_agg(l.lp_type, l.total) from by_lp_type l), '{}'::jsonb) as lp_type_totals,
    t.target_total,
    t.soft_circle_total,
    t.committed_total,
    t.closed_total,
    t.withdrawn_total,
    (t.soft_circle_total + t.committed_total + t.closed_total)::numeric as active_total,
    greatest(
      t.target_total - (t.soft_circle_total + t.committed_total + t.closed_total),
      0
    )::numeric as gap_to_target,
    cr.commitments
  from authorized a
  cross join totals t
  cross join commitment_rows cr;
$$;

revoke all on function public.capital_stack_summary(uuid) from public, anon;
grant execute on function public.capital_stack_summary(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Match Inbox action RPC.
--
-- Authenticated users can only act on matches in their org, and only from
-- new -> accepted/dismissed. Accepted LP matches seed a capital_commitment.
-- Accepted deal matches seed or reuse a deal <-> capital_provider synergy.
-- ---------------------------------------------------------------------

create or replace function public.act_on_match(_match_id uuid, _action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _match public.matches%rowtype;
  _updated public.matches%rowtype;
  _status text;
  _actor uuid := auth.uid();
  _role text := coalesce((select auth.role()), '');
  _side_effect_id uuid;
  _side_effect_type text;
  _provider_id uuid;
begin
  _status := case lower(btrim(coalesce(_action, '')))
    when 'accept' then 'accepted'
    when 'accepted' then 'accepted'
    when 'dismiss' then 'dismissed'
    when 'dismissed' then 'dismissed'
    else null
  end;

  if _status is null then
    raise exception 'Unsupported match action: %', _action
      using errcode = '22023';
  end if;

  select * into _match
  from public.matches
  where id = _match_id
  for update;

  if _match.id is null then
    raise exception 'Match % not found', _match_id
      using errcode = 'P0002';
  end if;

  if _role <> 'service_role'
     and (_actor is null or not private.is_org_member(_match.org_id)) then
    raise exception 'Not authorized to act on match %', _match_id
      using errcode = '42501';
  end if;

  if _match.status <> 'new' then
    raise exception 'Match % is already % and cannot transition to %',
      _match_id, _match.status, _status
      using errcode = '22023';
  end if;

  update public.matches
     set status = _status,
         acted_at = now(),
         acted_by = _actor
   where id = _match.id
   returning * into _updated;

  if _status = 'accepted' and _updated.kind = 'lp' then
    select cc.id into _side_effect_id
    from public.capital_commitments cc
    where cc.org_id = _updated.org_id
      and cc.lp_id = _updated.subject_id
      and cc.stage <> 'withdrawn'
    order by cc.created_at asc
    limit 1;

    if _side_effect_id is null then
      insert into public.capital_commitments (
        org_id,
        lp_id,
        amount,
        stage,
        lp_type,
        notes
      )
      values (
        _updated.org_id,
        _updated.subject_id,
        0,
        'target',
        'matched',
        'Created by act_on_match for accepted LP match ' || _updated.id::text
      )
      returning id into _side_effect_id;
    end if;

    _side_effect_type := 'capital_commitment';
  elsif _status = 'accepted' and _updated.kind = 'deal' then
    select nullif(elem.value ->> 'capital_provider_id', '')::uuid into _provider_id
    from jsonb_array_elements(
      case
        when jsonb_typeof(_updated.rationale) = 'array' then _updated.rationale
        else '[]'::jsonb
      end
    ) as elem(value)
    where (elem.value ->> 'capital_provider_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    limit 1;

    if _provider_id is not null and exists (
      select 1
      from public.capital_providers cp
      where cp.id = _provider_id
        and cp.org_id = _updated.org_id
    ) then
      select s.id into _side_effect_id
      from public.synergy_opportunities s
      where s.org_id = _updated.org_id
        and s.source_entity_type = 'deal'
        and s.source_entity_id = _updated.subject_id
        and s.target_entity_type = 'capital_provider'
        and s.target_entity_id = _provider_id
      order by s.created_at asc
      limit 1;

      if _side_effect_id is null then
        insert into public.synergy_opportunities (
          org_id,
          source_entity_type,
          source_entity_id,
          target_entity_type,
          target_entity_id,
          rationale,
          score,
          status
        )
        values (
          _updated.org_id,
          'deal',
          _updated.subject_id,
          'capital_provider',
          _provider_id,
          'Accepted Match Inbox deal-to-mandate match ' || _updated.id::text,
          _updated.score,
          'accepted'
        )
        returning id into _side_effect_id;
      end if;

      _side_effect_type := 'synergy_opportunity';
    end if;
  end if;

  return to_jsonb(_updated) || jsonb_build_object(
    'side_effect',
    case
      when _side_effect_id is null then null
      else jsonb_build_object('type', _side_effect_type, 'id', _side_effect_id)
    end
  );
end;
$$;

revoke all on function public.act_on_match(uuid, text) from public, anon, authenticated;
grant execute on function public.act_on_match(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Audit Trail read RPC.
-- ---------------------------------------------------------------------

create or replace function public.get_audit_trail(
  _org_id uuid,
  _limit integer default 50
)
returns table (
  occurred_at timestamp with time zone,
  source text,
  actor text,
  title text,
  detail text,
  score integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _safe_limit integer := least(greatest(coalesce(_limit, 50), 1), 200);
begin
  if _org_id is null then
    raise exception 'org_id is required'
      using errcode = '22023';
  end if;

  if (select auth.role()) <> 'service_role'
     and not private.is_org_member(_org_id) then
    raise exception 'Not authorized for org %', _org_id
      using errcode = '42501';
  end if;

  return query
  with feed as (
    select
      te.created_at as occurred_at,
      'trust_event'::text as source,
      coalesce(nullif(p.full_name, ''), 'System') as actor,
      initcap(replace(te.action, '_', ' ')) as title,
      concat_ws(
        ' | ',
        nullif(initcap(replace(te.entity_type, '_', ' ')), ''),
        coalesce(te.entity_id::text, te.metadata ->> 'entity_ref'),
        case
          when te.metadata ? 'layer' then 'Layer: ' || (te.metadata ->> 'layer')
        end,
        case
          when te.metadata ? 'rejection_reason' then 'Reason: ' || (te.metadata ->> 'rejection_reason')
        end
      ) as detail,
      case
        when jsonb_typeof(te.metadata -> 'score') = 'number'
          then least(100, greatest(0, (te.metadata ->> 'score')::numeric))::integer
        else null::integer
      end as score
    from public.trust_events te
    left join public.profiles p on p.id = te.actor_id
    where te.org_id = _org_id

    union all

    select
      aa.created_at as occurred_at,
      'admin_action'::text as source,
      coalesce(nullif(p.full_name, ''), 'System') as actor,
      initcap(replace(aa.action_type, '_', ' ')) as title,
      concat_ws(
        ' | ',
        nullif(initcap(replace(coalesce(aa.target_type, ''), '_', ' ')), ''),
        aa.target_id::text,
        case
          when aa.metadata ? 'email' then 'Email: ' || (aa.metadata ->> 'email')
        end
      ) as detail,
      null::integer as score
    from public.admin_actions aa
    left join public.profiles p on p.id = aa.admin_user_id
    where aa.org_id = _org_id

    union all

    select
      df.created_at as occurred_at,
      'diligence_finding'::text as source,
      'Diligence AI'::text as actor,
      df.summary as title,
      concat_ws(
        ' | ',
        initcap(replace(df.agent, '_', ' ')),
        nullif(df.detail, '')
      ) as detail,
      df.score as score
    from public.diligence_findings df
    where df.org_id = _org_id
  )
  select
    feed.occurred_at,
    feed.source,
    feed.actor,
    feed.title,
    feed.detail,
    feed.score
  from feed
  order by feed.occurred_at desc
  limit _safe_limit;
end;
$$;

revoke all on function public.get_audit_trail(uuid, integer) from public, anon, authenticated;
grant execute on function public.get_audit_trail(uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Objections write RPCs.
-- ---------------------------------------------------------------------

create or replace function public.upsert_objection(
  _org_id uuid,
  _lp_id uuid,
  _category text,
  _objection text,
  _rebuttal text default null,
  _status text default 'open',
  _id uuid default null
)
returns table (
  id uuid,
  org_id uuid,
  lp_id uuid,
  category text,
  objection text,
  rebuttal text,
  status text,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  _existing public.objections%rowtype;
  _row public.objections%rowtype;
  _role text := coalesce((select auth.role()), '');
  _normalized_status text := lower(btrim(coalesce(_status, 'open')));
begin
  _category := btrim(coalesce(_category, ''));
  _objection := btrim(coalesce(_objection, ''));

  if _org_id is null then
    raise exception 'org_id is required'
      using errcode = '22023';
  end if;

  if _role <> 'service_role'
     and not private.is_org_member(_org_id) then
    raise exception 'Not authorized for org %', _org_id
      using errcode = '42501';
  end if;

  if _normalized_status not in ('open', 'resolved') then
    raise exception 'Unsupported objection status: %', _status
      using errcode = '22023';
  end if;

  if _category = '' then
    raise exception 'category is required'
      using errcode = '22023';
  end if;

  if _objection = '' then
    raise exception 'objection is required'
      using errcode = '22023';
  end if;

  if _lp_id is not null and not exists (
    select 1
    from public.capital_providers cp
    where cp.id = _lp_id
      and cp.org_id = _org_id
  ) then
    raise exception 'LP % not found for org %', _lp_id, _org_id
      using errcode = '23503';
  end if;

  if _id is null then
    insert into public.objections (
      org_id,
      lp_id,
      category,
      objection,
      rebuttal,
      status,
      resolved_at
    )
    values (
      _org_id,
      _lp_id,
      _category,
      _objection,
      nullif(btrim(coalesce(_rebuttal, '')), ''),
      _normalized_status,
      case when _normalized_status = 'resolved' then now() else null end
    )
    returning * into _row;
  else
    select * into _existing
    from public.objections o
    where o.id = _id
    for update;

    if _existing.id is null or _existing.org_id <> _org_id then
      raise exception 'Objection % not found for org %', _id, _org_id
        using errcode = 'P0002';
    end if;

    update public.objections o
       set lp_id = _lp_id,
           category = _category,
           objection = _objection,
           rebuttal = nullif(btrim(coalesce(_rebuttal, '')), ''),
           status = _normalized_status,
           resolved_at = case
             when _normalized_status = 'resolved' then coalesce(_existing.resolved_at, now())
             else null
           end,
           updated_at = now()
     where o.id = _existing.id
     returning * into _row;
  end if;

  return query
  select
    o.id,
    o.org_id,
    o.lp_id,
    o.category,
    o.objection,
    o.rebuttal,
    o.status,
    o.resolved_at,
    o.created_at,
    o.updated_at
  from public.objections o
  where o.id = _row.id;
end;
$$;

create or replace function public.resolve_objection(_id uuid)
returns table (
  id uuid,
  org_id uuid,
  lp_id uuid,
  category text,
  objection text,
  rebuttal text,
  status text,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  _existing public.objections%rowtype;
  _row public.objections%rowtype;
  _role text := coalesce((select auth.role()), '');
begin
  if _id is null then
    raise exception 'objection id is required'
      using errcode = '22023';
  end if;

  select * into _existing
  from public.objections o
  where o.id = _id
  for update;

  if _existing.id is null then
    raise exception 'Objection % not found', _id
      using errcode = 'P0002';
  end if;

  if _role <> 'service_role'
     and not private.is_org_member(_existing.org_id) then
    raise exception 'Not authorized to resolve objection %', _id
      using errcode = '42501';
  end if;

  update public.objections o
     set status = 'resolved',
         resolved_at = coalesce(_existing.resolved_at, now()),
         updated_at = now()
   where o.id = _existing.id
   returning * into _row;

  return query
  select
    o.id,
    o.org_id,
    o.lp_id,
    o.category,
    o.objection,
    o.rebuttal,
    o.status,
    o.resolved_at,
    o.created_at,
    o.updated_at
  from public.objections o
  where o.id = _row.id;
end;
$$;

revoke all on function public.upsert_objection(uuid, uuid, text, text, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.resolve_objection(uuid)
  from public, anon, authenticated;
grant execute on function public.upsert_objection(uuid, uuid, text, text, text, text, uuid)
  to authenticated, service_role;
grant execute on function public.resolve_objection(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. Deal-to-mandate Match Inbox scorer.
-- ---------------------------------------------------------------------

create or replace function public.generate_deal_matches(_org_id uuid)
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
    raise exception 'generate_deal_matches requires service_role'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('generate_deal_matches:' || _org_id::text, 0)
  );

  with eligible_deals as (
    select
      d.id as deal_id,
      d.org_id,
      d.name as deal_name,
      d.stage as deal_stage,
      d.status as deal_status,
      d.amount as deal_amount,
      lower(concat_ws(' ', d.name, d.stage, d.status)) as deal_text
    from public.deals d
    where d.org_id = _org_id
      and coalesce(lower(d.status), '') not in ('closed', 'lost', 'rejected', 'archived', 'deleted')
      and not exists (
        select 1
        from public.matches m
        where m.org_id = d.org_id
          and m.kind = 'deal'
          and m.subject_id = d.id
      )
  ),
  provider_candidates as (
    select
      cp.id as provider_id,
      cp.org_id,
      cp.name as provider_name,
      coalesce(cp.capital_types, '{}'::text[]) as capital_types,
      cp.check_size_min,
      cp.check_size_max,
      coalesce(cp.criteria, '{}'::jsonb) as criteria,
      cp.status,
      lower(concat_ws(
        ' ',
        cp.name,
        array_to_string(coalesce(cp.capital_types, '{}'::text[]), ' '),
        coalesce(cp.criteria, '{}'::jsonb)::text
      )) as criteria_text,
      lower(concat_ws(
        ' ',
        cp.criteria ->> 'geography',
        cp.criteria ->> 'geographies',
        cp.criteria ->> 'region',
        cp.criteria ->> 'regions'
      )) as geography_text
    from public.capital_providers cp
    where cp.org_id = _org_id
      and lower(cp.status) = 'active'
  ),
  pair_signals as (
    select
      d.*,
      p.provider_id,
      p.provider_name,
      p.capital_types,
      p.check_size_min,
      p.check_size_max,
      p.criteria,
      p.status as provider_status,
      p.criteria_text,
      p.geography_text,
      (
        select count(*)
        from unnest(p.capital_types) as capital_type(value)
        where length(btrim(capital_type.value)) > 1
          and d.deal_text like '%' || lower(btrim(capital_type.value)) || '%'
      ) as capital_type_overlap,
      (
        select count(*)
        from regexp_split_to_table(p.criteria_text, '[^a-z0-9]+') as token(value)
        where length(token.value) > 3
          and d.deal_text like '%' || token.value || '%'
      ) as criteria_token_overlap,
      (
        select max(least(100, greatest(0, coalesce(s.score, 0))))::numeric
        from public.synergy_opportunities s
        where s.org_id = d.org_id
          and (
            (
              s.source_entity_type = 'deal'
              and s.source_entity_id = d.deal_id
              and s.target_entity_type = 'capital_provider'
              and s.target_entity_id = p.provider_id
            )
            or (
              s.source_entity_type = 'capital_provider'
              and s.source_entity_id = p.provider_id
              and s.target_entity_type = 'deal'
              and s.target_entity_id = d.deal_id
            )
          )
      ) as warmth_signal
    from eligible_deals d
    join provider_candidates p on p.org_id = d.org_id
  ),
  scored as (
    select
      ps.*,
      case
        when ps.capital_type_overlap > 0 or ps.criteria_token_overlap > 0 then 20
        when ps.criteria <> '{}'::jsonb then 12
        else 6
      end as thesis_fit_score,
      case
        when ps.deal_amount is null then 12
        when ps.check_size_min is null and ps.check_size_max is null then 10
        when (ps.check_size_min is null or ps.check_size_min <= ps.deal_amount)
         and (ps.check_size_max is null or ps.check_size_max >= ps.deal_amount) then 25
        when (ps.check_size_min is null or ps.check_size_min <= ps.deal_amount * 1.25)
         and (ps.check_size_max is null or ps.check_size_max >= ps.deal_amount * 0.75) then 18
        else 8
      end as check_size_score,
      case
        when nullif(btrim(ps.geography_text), '') is null then 8
        when ps.deal_text like '%' || ps.geography_text || '%' then 15
        else 10
      end as geography_score,
      case
        when cardinality(ps.capital_types) > 0 and ps.provider_status = 'active' then 20
        when cardinality(ps.capital_types) > 0 or ps.criteria <> '{}'::jsonb then 14
        else 8
      end as mandate_score,
      case
        when ps.warmth_signal is not null then round(ps.warmth_signal * 0.20)::integer
        when ps.provider_status = 'active' then 8
        else 4
      end as warmth_score
    from pair_signals ps
  ),
  ranked as (
    select
      s.*,
      least(100, greatest(
        0,
        s.thesis_fit_score + s.check_size_score + s.geography_score + s.mandate_score + s.warmth_score
      ))::integer as match_score,
      row_number() over (
        partition by s.deal_id
        order by
          least(100, greatest(
            0,
            s.thesis_fit_score + s.check_size_score + s.geography_score + s.mandate_score + s.warmth_score
          )) desc,
          s.warmth_signal desc nulls last,
          s.provider_name asc
      ) as match_rank
    from scored s
  ),
  inserted as (
    insert into public.matches (org_id, kind, subject_id, score, rationale, status)
    select
      r.org_id,
      'deal',
      r.deal_id,
      r.match_score,
      jsonb_build_array(
        jsonb_build_object(
          'factor', 'thesis_fit',
          'weight', r.thesis_fit_score,
          'detail', case
            when r.capital_type_overlap > 0 then 'Provider capital types appear in the deal context.'
            when r.criteria_token_overlap > 0 then 'Provider criteria terms overlap with the deal context.'
            when r.criteria <> '{}'::jsonb then 'Provider has structured criteria but no explicit deal-text overlap.'
            else 'Deal/provider thesis context is sparse.'
          end,
          'capital_provider_id', r.provider_id,
          'capital_provider_name', r.provider_name
        ),
        jsonb_build_object(
          'factor', 'check_size',
          'weight', r.check_size_score,
          'detail', case
            when r.deal_amount is null then 'Deal amount unavailable; scored neutrally.'
            when r.check_size_min is null and r.check_size_max is null then 'Provider check-size range unavailable.'
            else 'Provider check-size range compared with deal amount.'
          end,
          'capital_provider_id', r.provider_id,
          'capital_provider_name', r.provider_name
        ),
        jsonb_build_object(
          'factor', 'geography',
          'weight', r.geography_score,
          'detail', case
            when nullif(btrim(r.geography_text), '') is null then 'No geography mandate specified.'
            when r.deal_text like '%' || r.geography_text || '%' then 'Provider geography appears in deal context.'
            else 'Provider geography specified but deal geography is not explicit.'
          end,
          'capital_provider_id', r.provider_id,
          'capital_provider_name', r.provider_name
        ),
        jsonb_build_object(
          'factor', 'mandate',
          'weight', r.mandate_score,
          'detail', case
            when cardinality(r.capital_types) > 0 then 'Provider has explicit capital type mandate.'
            when r.criteria <> '{}'::jsonb then 'Provider has structured mandate criteria.'
            else 'Provider mandate is sparse.'
          end,
          'capital_provider_id', r.provider_id,
          'capital_provider_name', r.provider_name
        ),
        jsonb_build_object(
          'factor', 'warmth',
          'weight', r.warmth_score,
          'detail', case
            when r.warmth_signal is not null then 'Existing deal-to-provider synergy signal found.'
            when r.provider_status = 'active' then 'Active provider, but no pair-specific warmth signal yet.'
            else 'No active warmth signal available.'
          end,
          'capital_provider_id', r.provider_id,
          'capital_provider_name', r.provider_name
        )
      ),
      'new'
    from ranked r
    where r.match_rank = 1
    returning 1
  )
  select count(*) into _inserted from inserted;

  return _inserted;
end;
$$;

revoke all on function public.generate_deal_matches(uuid) from public, anon, authenticated;
grant execute on function public.generate_deal_matches(uuid) to service_role;
