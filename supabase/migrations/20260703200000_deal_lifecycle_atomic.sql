-- 20260703200000_deal_lifecycle_atomic.sql
-- Three deal/portfolio lifecycle actions used to be written as two independent,
-- unchecked Supabase calls apiece, wired to plain `<form action={...}>` server
-- actions returning `Promise<void>` — the same shape the capital-events fix
-- (20260703180000_capital_ops_atomic.sql) already closed for capital calls,
-- distributions, and secondary transfers:
--
--   - promoteDealToAsset: insert an `assets` row, then update the deal's stage
--     to 'owned'. A failure between the two left a deal marked "owned" with no
--     matching holding, or (on retry) a duplicate asset if the first insert
--     actually succeeded but the caller never saw that.
--   - recordIcDecision: insert an `ic_decisions` row, then (for go/no_go)
--     advance the deal's stage. A failure between the two left an IC vote on
--     the record with the deal stage unchanged, or the deal advanced with no
--     corresponding decision in the audit trail.
--   - recordValuationMark: insert a `valuation_marks` row, then roll the value
--     onto the asset's `current_value`. A failure between the two left the
--     audit trail and the asset's headline mark out of sync.
--
-- None of the three checked the Supabase client's `error` at all, so every
-- failure mode above looked identical to success in the UI. These RPCs put
-- each pair of writes in one transaction (a PL/pgSQL function body is atomic
-- by default — no explicit BEGIN/COMMIT needed) and return enough for the
-- caller to build a proper `{ok, error}` result, matching the rest of the
-- codebase's server-action convention.

create or replace function public.promote_deal_to_asset(
  p_org uuid,
  p_deal_id uuid,
  p_asset_type text
) returns jsonb
language plpgsql security invoker as $$
declare
  v_deal record;
  v_existing uuid;
begin
  select id, name, fund_id, asset_class, target_amount
    into v_deal
    from public.deals
    where id = p_deal_id and organization_id = p_org;
  if not found then
    raise exception 'deal % not found', p_deal_id;
  end if;

  select id into v_existing
    from public.assets
    where organization_id = p_org and deal_id = p_deal_id;

  if v_existing is null then
    insert into public.assets (
      organization_id, deal_id, fund_id, name, asset_type,
      acquisition_date, acquisition_cost, current_value, status
    ) values (
      p_org, p_deal_id, v_deal.fund_id, v_deal.name, p_asset_type::asset_type,
      current_date, v_deal.target_amount, v_deal.target_amount, 'active'
    )
    returning id into v_existing;
  end if;

  update public.deals set stage = 'owned'
    where id = p_deal_id and organization_id = p_org;

  return jsonb_build_object('assetId', v_existing);
end $$;

create or replace function public.record_ic_decision(
  p_org uuid,
  p_deal_id uuid,
  p_decision text,
  p_rationale text,
  p_conviction int,
  p_decided_by uuid
) returns jsonb
language plpgsql security invoker as $$
declare
  v_id uuid;
  v_next_stage deal_stage;
begin
  if not exists (select 1 from public.deals where id = p_deal_id and organization_id = p_org) then
    raise exception 'deal % not found', p_deal_id;
  end if;

  insert into public.ic_decisions
    (organization_id, deal_id, decision, rationale, conviction, decided_by)
  values
    (p_org, p_deal_id, p_decision::ic_decision, p_rationale, p_conviction, p_decided_by)
  returning id into v_id;

  v_next_stage := case p_decision
    when 'go' then 'closing'::deal_stage
    when 'no_go' then 'passed'::deal_stage
    else null
  end;

  if v_next_stage is not null then
    update public.deals set stage = v_next_stage
      where id = p_deal_id and organization_id = p_org;
  end if;

  return jsonb_build_object('decisionId', v_id);
end $$;

create or replace function public.record_valuation_mark(
  p_org uuid,
  p_asset_id uuid,
  p_value numeric,
  p_as_of date,
  p_method text,
  p_note text,
  p_created_by uuid
) returns jsonb
language plpgsql security invoker as $$
declare
  v_id uuid;
  v_updated uuid;
begin
  insert into public.valuation_marks
    (organization_id, asset_id, value, as_of, method, note, created_by)
  values
    (p_org, p_asset_id, p_value, p_as_of, p_method, p_note, p_created_by)
  returning id into v_id;

  update public.assets set current_value = p_value
    where id = p_asset_id and organization_id = p_org
    returning id into v_updated;
  if v_updated is null then
    raise exception 'asset % not found', p_asset_id;
  end if;

  return jsonb_build_object('markId', v_id);
end $$;
