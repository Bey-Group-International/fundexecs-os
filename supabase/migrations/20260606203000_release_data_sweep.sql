-- =====================================================================
-- Release data sweep: Wave 3 population, Objections, Stripe top-ups,
-- and safe SECURITY DEFINER/RLS hardening.
--
-- Additive + idempotent. Claude applies this migration and regenerates
-- database.types.ts from the live project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Wallet-on-signup: every new org gets starter credits + a ledger row.
-- ---------------------------------------------------------------------

create unique index if not exists credit_transactions_signup_grant_org_key
  on public.credit_transactions (org_id)
  where reason = 'signup_grant' and delta = 500 and ref_id is null;

create or replace function public.ensure_credit_wallet_for_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _inserted boolean := false;
begin
  insert into public.credit_wallets (org_id, balance, plan)
  values (new.id, 500, 'standard')
  on conflict (org_id) do nothing
  returning true into _inserted;

  if coalesce(_inserted, false) then
    insert into public.credit_transactions (org_id, delta, reason, ref_id, balance_after)
    values (new.id, 500, 'signup_grant', null, 500)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'ensure_credit_wallet_on_org_insert'
      and tgrelid = 'public.organizations'::regclass
  ) then
    create trigger ensure_credit_wallet_on_org_insert
      after insert on public.organizations
      for each row execute function public.ensure_credit_wallet_for_org();
  end if;
end$$;

-- Backfill orgs created after the one-time Wave 2 seed but before this trigger.
with inserted_wallets as (
  insert into public.credit_wallets (org_id, balance, plan)
  select o.id, 500, 'standard'
  from public.organizations o
  left join public.credit_wallets w on w.org_id = o.id
  where w.org_id is null
  on conflict (org_id) do nothing
  returning org_id, balance
)
insert into public.credit_transactions (org_id, delta, reason, ref_id, balance_after)
select org_id, 500, 'signup_grant', null, balance
from inserted_wallets
on conflict do nothing;

revoke all on function public.ensure_credit_wallet_for_org() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Objections library: per-LP objections + rebuttals.
-- ---------------------------------------------------------------------

create table if not exists public.objections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  lp_id uuid references public.capital_providers (id) on delete set null,
  category text not null,
  objection text not null,
  rebuttal text,
  status text not null default 'open',
  resolved_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists objections_org_status_idx
  on public.objections (org_id, status, created_at desc);
create index if not exists objections_org_lp_idx
  on public.objections (org_id, lp_id);
create index if not exists objections_lp_id_idx
  on public.objections (lp_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.objections'::regclass
      and conname = 'objections_status_check'
  ) then
    alter table public.objections
      add constraint objections_status_check
      check (status in ('open', 'resolved'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.objections'::regclass
      and conname = 'objections_category_not_blank'
  ) then
    alter table public.objections
      add constraint objections_category_not_blank
      check (length(btrim(category)) > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.objections'::regclass
      and conname = 'objections_objection_not_blank'
  ) then
    alter table public.objections
      add constraint objections_objection_not_blank
      check (length(btrim(objection)) > 0);
  end if;
end$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_updated_at'
      and tgrelid = 'public.objections'::regclass
  ) then
    create trigger set_updated_at
      before update on public.objections
      for each row execute function public.set_updated_at();
  end if;
end$$;

alter table public.objections enable row level security;

revoke all on table public.objections from anon, authenticated;
grant select on table public.objections to authenticated;
grant select, insert, update, delete on table public.objections to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'objections' and policyname = 'members read objections'
  ) then
    create policy "members read objections" on public.objections
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'objections' and policyname = 'service_role insert objections'
  ) then
    create policy "service_role insert objections" on public.objections
      for insert to service_role
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'objections' and policyname = 'service_role update objections'
  ) then
    create policy "service_role update objections" on public.objections
      for update to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'objections' and policyname = 'service_role delete objections'
  ) then
    create policy "service_role delete objections" on public.objections
      for delete to service_role
      using (true);
  end if;
end$$;

-- ---------------------------------------------------------------------
-- 3. Stripe top-up ledger + service-role grant-on-success path.
-- ---------------------------------------------------------------------

create table if not exists public.credit_purchases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  amount_credits integer not null,
  amount_cents integer not null,
  currency text not null default 'usd',
  stripe_session_id text not null,
  status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists credit_purchases_stripe_session_id_key
  on public.credit_purchases (stripe_session_id);
create index if not exists credit_purchases_org_status_idx
  on public.credit_purchases (org_id, status, created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.credit_purchases'::regclass
      and conname = 'credit_purchases_amount_credits_check'
  ) then
    alter table public.credit_purchases
      add constraint credit_purchases_amount_credits_check
      check (amount_credits > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.credit_purchases'::regclass
      and conname = 'credit_purchases_amount_cents_check'
  ) then
    alter table public.credit_purchases
      add constraint credit_purchases_amount_cents_check
      check (amount_cents >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.credit_purchases'::regclass
      and conname = 'credit_purchases_status_check'
  ) then
    alter table public.credit_purchases
      add constraint credit_purchases_status_check
      check (status in ('pending', 'succeeded', 'failed', 'canceled'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.credit_purchases'::regclass
      and conname = 'credit_purchases_stripe_session_not_blank'
  ) then
    alter table public.credit_purchases
      add constraint credit_purchases_stripe_session_not_blank
      check (length(btrim(stripe_session_id)) > 0);
  end if;
end$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_updated_at'
      and tgrelid = 'public.credit_purchases'::regclass
  ) then
    create trigger set_updated_at
      before update on public.credit_purchases
      for each row execute function public.set_updated_at();
  end if;
end$$;

alter table public.credit_purchases enable row level security;

revoke all on table public.credit_purchases from anon, authenticated;
grant select on table public.credit_purchases to authenticated;
grant select, insert, update, delete on table public.credit_purchases to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'credit_purchases' and policyname = 'members read credit_purchases'
  ) then
    create policy "members read credit_purchases" on public.credit_purchases
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'credit_purchases' and policyname = 'service_role insert credit_purchases'
  ) then
    create policy "service_role insert credit_purchases" on public.credit_purchases
      for insert to service_role
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'credit_purchases' and policyname = 'service_role update credit_purchases'
  ) then
    create policy "service_role update credit_purchases" on public.credit_purchases
      for update to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'credit_purchases' and policyname = 'service_role delete credit_purchases'
  ) then
    create policy "service_role delete credit_purchases" on public.credit_purchases
      for delete to service_role
      using (true);
  end if;
end$$;

create or replace function public.record_credit_topup(
  _org_id uuid,
  _amount_credits integer,
  _amount_cents integer,
  _stripe_session_id text,
  _status text default 'succeeded',
  _metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _purchase public.credit_purchases%rowtype;
  _previous_status text;
  _normalized_status text := lower(coalesce(_status, 'succeeded'));
  _new_balance integer;
begin
  if _amount_credits is null or _amount_credits <= 0 then
    raise exception 'Top-up credits must be positive';
  end if;

  if _amount_cents is null or _amount_cents < 0 then
    raise exception 'Top-up amount_cents must be non-negative';
  end if;

  if nullif(btrim(_stripe_session_id), '') is null then
    raise exception 'stripe_session_id is required';
  end if;

  if _normalized_status not in ('pending', 'succeeded', 'failed', 'canceled') then
    raise exception 'Unsupported credit purchase status: %', _status;
  end if;

  select * into _purchase
  from public.credit_purchases
  where stripe_session_id = _stripe_session_id
  for update;

  _previous_status := _purchase.status;

  if _purchase.id is null then
    insert into public.credit_purchases (
      org_id,
      amount_credits,
      amount_cents,
      stripe_session_id,
      status,
      metadata
    )
    values (
      _org_id,
      _amount_credits,
      _amount_cents,
      _stripe_session_id,
      _normalized_status,
      coalesce(_metadata, '{}'::jsonb)
    )
    returning * into _purchase;
  else
    update public.credit_purchases
       set org_id = _org_id,
           amount_credits = _amount_credits,
           amount_cents = _amount_cents,
           status = _normalized_status,
           metadata = coalesce(_metadata, '{}'::jsonb),
           updated_at = now()
     where id = _purchase.id
     returning * into _purchase;
  end if;

  if _purchase.status = 'succeeded' and coalesce(_previous_status, '') <> 'succeeded' then
    _new_balance := public.grant_credits(
      _purchase.org_id,
      _purchase.amount_credits,
      'stripe_topup',
      _purchase.id
    );
  else
    select w.balance into _new_balance
    from public.credit_wallets w
    where w.org_id = _purchase.org_id;
  end if;

  return jsonb_build_object(
    'purchase_id', _purchase.id,
    'status', _purchase.status,
    'credits_granted', (_purchase.status = 'succeeded' and coalesce(_previous_status, '') <> 'succeeded'),
    'balance_after', _new_balance
  );
end;
$$;

revoke all on function public.record_credit_topup(uuid, integer, integer, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_credit_topup(uuid, integer, integer, text, text, jsonb)
  to service_role;

-- ---------------------------------------------------------------------
-- 4. Match Inbox population: deterministic LP scorer.
-- ---------------------------------------------------------------------

create or replace function public.generate_lp_matches(_org_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _inserted integer := 0;
begin
  with owner_profile as (
    select
      mp.focus_areas,
      mp.details,
      lower(concat_ws(
        ' ',
        o.name,
        o.tier,
        mp.headline,
        mp.bio,
        array_to_string(mp.focus_areas, ' '),
        mp.details ->> 'thesis',
        mp.details ->> 'investment_thesis',
        mp.details ->> 'strategy',
        mp.details ->> 'sector',
        mp.details ->> 'focus',
        mp.details ->> 'geography',
        mp.details ->> 'region'
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
    left join public.member_profiles mp on mp.user_id = owner.user_id
    where o.id = _org_id
  ),
  fund_context as (
    select
      coalesce(focus_areas, '{}'::text[]) as focus_areas,
      coalesce(details, '{}'::jsonb) as details,
      coalesce(profile_text, '') as profile_text,
      target.target_raise
    from owner_profile op
    left join lateral (
      select max(nullif(regexp_replace(v.raw_value, '[^0-9.]', '', 'g'), '')::numeric) as target_raise
      from (values
        (op.details ->> 'target_raise'),
        (op.details ->> 'targetRaise'),
        (op.details ->> 'fund_size'),
        (op.details ->> 'raise_target')
      ) as v(raw_value)
      where v.raw_value ~ '[0-9]'
    ) target on true
  ),
  provider_signals as (
    select
      cp.id as provider_id,
      cp.org_id,
      cp.name,
      cp.capital_types,
      cp.check_size_min,
      cp.check_size_max,
      cp.criteria,
      cp.status,
      fc.focus_areas,
      fc.profile_text,
      fc.target_raise,
      lower(concat_ws(
        ' ',
        cp.name,
        array_to_string(cp.capital_types, ' '),
        cp.criteria::text
      )) as criteria_text,
      lower(concat_ws(
        ' ',
        cp.criteria ->> 'geography',
        cp.criteria ->> 'geographies',
        cp.criteria ->> 'region',
        cp.criteria ->> 'regions'
      )) as geography_text,
      (
        select count(*)
        from unnest(fc.focus_areas) as focus(value)
        where length(btrim(focus.value)) > 2
          and lower(concat_ws(' ', cp.name, array_to_string(cp.capital_types, ' '), cp.criteria::text))
            like '%' || lower(btrim(focus.value)) || '%'
      ) as focus_overlap,
      (
        select max(least(100, greatest(0, coalesce(s.score, 0))))::numeric
        from public.synergy_opportunities s
        where s.org_id = cp.org_id
          and (
            (s.source_entity_type = 'capital_provider' and s.source_entity_id = cp.id)
            or (s.target_entity_type = 'capital_provider' and s.target_entity_id = cp.id)
          )
      ) as warmth_signal
    from public.capital_providers cp
    cross join fund_context fc
    where cp.org_id = _org_id
      and not exists (
        select 1
        from public.matches m
        where m.org_id = cp.org_id
          and m.kind = 'lp'
          and m.subject_id = cp.id
      )
  ),
  scored as (
    select
      p.*,
      case
        when p.focus_overlap > 0 then 20
        when p.criteria <> '{}'::jsonb and p.profile_text <> '' then 12
        when p.profile_text <> '' then 8
        else 5
      end as thesis_fit_score,
      case
        when p.check_size_min is null and p.check_size_max is null then 10
        when p.target_raise is null then 12
        when (p.check_size_min is null or p.check_size_min <= p.target_raise * 0.25)
         and (p.check_size_max is null or p.check_size_max >= p.target_raise * 0.02) then 25
        when p.check_size_max is null or p.check_size_max >= p.target_raise * 0.01 then 18
        else 8
      end as check_size_score,
      case
        when nullif(btrim(p.geography_text), '') is null then 8
        when p.profile_text like '%' || p.geography_text || '%' then 15
        else 10
      end as geography_score,
      case
        when cardinality(p.capital_types) > 0 and p.status = 'active' then 20
        when cardinality(p.capital_types) > 0 or p.criteria <> '{}'::jsonb then 14
        else 8
      end as mandate_score,
      case
        when p.warmth_signal is not null then round(p.warmth_signal * 0.20)::integer
        when p.status = 'active' then 8
        else 4
      end as warmth_score
    from provider_signals p
  ),
  inserted as (
    insert into public.matches (org_id, kind, subject_id, score, rationale, status)
    select
      s.org_id,
      'lp',
      s.provider_id,
      least(100, greatest(
        0,
        s.thesis_fit_score + s.check_size_score + s.geography_score + s.mandate_score + s.warmth_score
      )),
      jsonb_build_array(
        jsonb_build_object(
          'factor', 'thesis_fit',
          'weight', s.thesis_fit_score,
          'detail', case
            when s.focus_overlap > 0 then 'Provider criteria overlap with fund focus areas.'
            when s.criteria <> '{}'::jsonb then 'Provider has criteria but no explicit focus-area overlap.'
            else 'No explicit thesis criteria available; neutral-low score.'
          end
        ),
        jsonb_build_object(
          'factor', 'check_size',
          'weight', s.check_size_score,
          'detail', case
            when s.check_size_min is null and s.check_size_max is null then 'No check-size range provided.'
            when s.target_raise is null then 'Fund target raise unavailable; range scored neutrally.'
            else 'Provider check-size range compared with target raise.'
          end
        ),
        jsonb_build_object(
          'factor', 'geography',
          'weight', s.geography_score,
          'detail', case
            when nullif(btrim(s.geography_text), '') is null then 'No geography mandate specified.'
            when s.profile_text like '%' || s.geography_text || '%' then 'Provider geography appears in fund profile context.'
            else 'Provider geography specified but not found in fund profile context.'
          end
        ),
        jsonb_build_object(
          'factor', 'mandate',
          'weight', s.mandate_score,
          'detail', case
            when cardinality(s.capital_types) > 0 then 'Provider has explicit capital type mandate.'
            when s.criteria <> '{}'::jsonb then 'Provider has structured criteria.'
            else 'Provider mandate is sparse.'
          end
        ),
        jsonb_build_object(
          'factor', 'warmth',
          'weight', s.warmth_score,
          'detail', case
            when s.warmth_signal is not null then 'Existing synergy signal found for this capital provider.'
            when s.status = 'active' then 'Active provider, but no relationship warmth signal yet.'
            else 'No active warmth signal available.'
          end
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

revoke all on function public.generate_lp_matches(uuid) from public, anon, authenticated;
grant execute on function public.generate_lp_matches(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 5. Capital Stack backfill from allocations.
-- ---------------------------------------------------------------------

create table if not exists public.capital_commitment_sources (
  commitment_id uuid primary key references public.capital_commitments (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  source_table text not null,
  source_id uuid not null,
  created_at timestamp with time zone not null default now()
);

create unique index if not exists capital_commitment_sources_source_key
  on public.capital_commitment_sources (source_table, source_id);
create index if not exists capital_commitment_sources_org_id_idx
  on public.capital_commitment_sources (org_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.capital_commitment_sources'::regclass
      and conname = 'capital_commitment_sources_source_table_check'
  ) then
    alter table public.capital_commitment_sources
      add constraint capital_commitment_sources_source_table_check
      check (source_table in ('allocations'));
  end if;
end$$;

alter table public.capital_commitment_sources enable row level security;

revoke all on table public.capital_commitment_sources from anon, authenticated;
grant select on table public.capital_commitment_sources to authenticated;
grant select, insert, update, delete on table public.capital_commitment_sources to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'capital_commitment_sources' and policyname = 'members read capital_commitment_sources'
  ) then
    create policy "members read capital_commitment_sources" on public.capital_commitment_sources
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'capital_commitment_sources' and policyname = 'service_role insert capital_commitment_sources'
  ) then
    create policy "service_role insert capital_commitment_sources" on public.capital_commitment_sources
      for insert to service_role
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'capital_commitment_sources' and policyname = 'service_role update capital_commitment_sources'
  ) then
    create policy "service_role update capital_commitment_sources" on public.capital_commitment_sources
      for update to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'capital_commitment_sources' and policyname = 'service_role delete capital_commitment_sources'
  ) then
    create policy "service_role delete capital_commitment_sources" on public.capital_commitment_sources
      for delete to service_role
      using (true);
  end if;
end$$;

with candidates as (
  select
    gen_random_uuid() as commitment_id,
    a.id as allocation_id,
    a.org_id,
    cp.id as capital_provider_id,
    greatest(coalesce(a.amount, 0), 0)::numeric(18, 2) as amount,
    case
      when lower(a.status) in ('funded', 'closed') then 'closed'
      when lower(a.status) in ('committed', 'accepted') then 'committed'
      when lower(a.status) in ('soft', 'soft-circle', 'soft_circle', 'softcircle', 'interested', 'pending') then 'soft_circle'
      when lower(a.status) in ('withdrawn', 'rejected', 'lost', 'declined') then 'withdrawn'
      else 'target'
    end as stage,
    a.created_at,
    a.updated_at
  from public.allocations a
  left join public.capital_providers cp
    on cp.id = a.lp_id
   and cp.org_id = a.org_id
  where not exists (
    select 1
    from public.capital_commitment_sources s
    where s.source_table = 'allocations'
      and s.source_id = a.id
  )
),
inserted_commitments as (
  insert into public.capital_commitments (
    id,
    org_id,
    lp_id,
    amount,
    currency,
    stage,
    lp_type,
    notes,
    created_at,
    updated_at
  )
  select
    c.commitment_id,
    c.org_id,
    c.capital_provider_id,
    c.amount,
    'USD',
    c.stage,
    'allocation_backfill',
    'Backfilled from allocations row ' || c.allocation_id::text,
    c.created_at,
    c.updated_at
  from candidates c
  returning id
)
insert into public.capital_commitment_sources (commitment_id, org_id, source_table, source_id)
select c.commitment_id, c.org_id, 'allocations', c.allocation_id
from candidates c
join inserted_commitments i on i.id = c.commitment_id
on conflict (source_table, source_id) do nothing;

-- ---------------------------------------------------------------------
-- 6. RLS/grants spot-audit for newest existing release tables.
-- ---------------------------------------------------------------------

alter table public.beta_invites enable row level security;
revoke all on table public.beta_invites from anon, authenticated;
grant select, insert, update, delete on table public.beta_invites to authenticated;
grant select, insert, update, delete on table public.beta_invites to service_role;

-- ---------------------------------------------------------------------
-- 7. Safe SECURITY DEFINER hardening.
--
-- Keep authenticated EXECUTE for create_organization and
-- seed_demo_for_member_type. Tighten safe helpers/RPCs by pinning empty
-- search_path and re-asserting grants.
-- ---------------------------------------------------------------------

create or replace function private.is_org_member(_org_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = _org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function private.is_org_admin(_org_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = _org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin')
  );
$$;

create or replace function private.shares_org(_user_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.org_members a
    join public.org_members b on a.org_id = b.org_id
    where a.user_id = auth.uid()
      and a.status = 'active'
      and b.user_id = _user_id
      and b.status = 'active'
  );
$$;

revoke all on function private.is_org_member(uuid) from public, anon;
revoke all on function private.is_org_admin(uuid) from public, anon;
revoke all on function private.shares_org(uuid) from public, anon;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.is_org_admin(uuid) to authenticated;
grant execute on function private.shares_org(uuid) to authenticated;

create or replace function public.award_trust_xp(
  _org uuid,
  _layer text,
  _entity_type text,
  _entity_id text
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _amount integer;
  _eid uuid;
  _new_xp integer;
begin
  if _uid is null then
    return null;
  end if;

  if not exists (
    select 1
    from public.org_members
    where user_id = _uid
      and org_id = _org
      and status = 'active'
  ) then
    return null;
  end if;

  _amount := case _layer
    when 'truth' then 15
    when 'concept' then 25
    when 'execution' then 40
    when 'work' then 60
    else 10
  end;

  begin
    _eid := _entity_id::uuid;
  exception when others then
    _eid := null;
  end;

  if exists (
    select 1
    from public.trust_events
    where actor_id = _uid
      and action = 'trust_complete'
      and metadata ->> 'entity_ref' = _entity_id
  ) then
    select xp into _new_xp
    from public.profiles
    where id = _uid;
    return _new_xp;
  end if;

  insert into public.trust_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    _org,
    _uid,
    'trust_complete',
    _entity_type,
    _eid,
    jsonb_build_object('layer', _layer, 'xp', _amount, 'entity_ref', _entity_id)
  );

  update public.profiles
     set xp = xp + _amount
   where id = _uid
   returning xp into _new_xp;

  return _new_xp;
end;
$$;

revoke all on function public.award_trust_xp(uuid, text, text, text) from public;
revoke execute on function public.award_trust_xp(uuid, text, text, text) from anon;
grant execute on function public.award_trust_xp(uuid, text, text, text) to authenticated;

create or replace function public.match_knowledge_chunks(
  query_embedding extensions.vector(1024),
  match_count int default 8,
  _org_id uuid default null
)
returns table (
  id uuid,
  document_id uuid,
  brain_id uuid,
  content text,
  similarity double precision
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.document_id,
    c.brain_id,
    c.content,
    1 - (c.embedding OPERATOR(extensions.<=>) query_embedding) as similarity
  from public.knowledge_chunks c
  where c.embedding is not null
    and (c.org_id is null or private.is_org_member(c.org_id))
    and (_org_id is null or c.org_id is null or c.org_id = _org_id)
  order by c.embedding OPERATOR(extensions.<=>) query_embedding
  limit match_count;
$$;

revoke all on function public.match_knowledge_chunks(extensions.vector, int, uuid) from public, anon;
grant execute on function public.match_knowledge_chunks(extensions.vector, int, uuid) to authenticated;

create or replace function public.store_diligence_chunks(
  _document_id uuid,
  _chunks jsonb
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _org_id uuid;
  _inserted integer;
begin
  if coalesce(jsonb_typeof(_chunks), '') <> 'array' then
    raise exception 'chunks must be a JSON array';
  end if;

  select d.org_id into _org_id
  from public.diligence_documents d
  where d.id = _document_id;

  if _org_id is null then
    raise exception 'diligence document % not found', _document_id;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(_chunks) as chunk(value)
    where nullif(btrim(chunk.value ->> 'content'), '') is null
      or chunk.value -> 'embedding' is null
  ) then
    raise exception 'each chunk must include non-empty content and an embedding';
  end if;

  insert into public.diligence_chunks (document_id, org_id, content, embedding)
  select
    _document_id,
    _org_id,
    chunk.value ->> 'content',
    (chunk.value ->> 'embedding')::extensions.vector(1024)
  from jsonb_array_elements(_chunks) as chunk(value);

  get diagnostics _inserted = row_count;
  return _inserted;
end;
$$;

create or replace function public.match_diligence_chunks(
  run_id uuid,
  query_embedding extensions.vector(1024),
  match_count int default 8
)
returns table (
  id uuid,
  document_id uuid,
  file_name text,
  storage_path text,
  content text,
  similarity double precision
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.document_id,
    d.file_name,
    d.storage_path,
    c.content,
    1 - (c.embedding OPERATOR(extensions.<=>) query_embedding) as similarity
  from public.diligence_chunks c
  join public.diligence_documents d
    on d.id = c.document_id
   and d.org_id = c.org_id
  join public.diligence_runs r
    on r.id = d.run_id
   and r.org_id = d.org_id
  where r.id = match_diligence_chunks.run_id
    and c.embedding is not null
  order by c.embedding OPERATOR(extensions.<=>) query_embedding
  limit least(greatest(coalesce(match_count, 8), 1), 50);
$$;

revoke all on function public.store_diligence_chunks(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.match_diligence_chunks(uuid, extensions.vector, int)
  from public, anon, authenticated;
grant execute on function public.store_diligence_chunks(uuid, jsonb)
  to service_role;
grant execute on function public.match_diligence_chunks(uuid, extensions.vector, int)
  to service_role;

