-- =====================================================================
-- Wave 2 data models: Capital Stack, Match Inbox, Credit Wallet.
--
-- Additive + idempotent. New public tables are org-scoped with RLS:
-- members SELECT via private.is_org_member(org_id); writes via service_role.
-- =====================================================================

-- 1. Capital Stack -----------------------------------------------------
create table if not exists public.capital_commitments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  lp_id uuid references public.capital_providers (id) on delete set null,
  amount numeric(18, 2) not null default 0,
  currency text not null default 'USD',
  stage text not null default 'target',
  tranche text,
  lp_type text,
  expected_close date,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists capital_commitments_org_stage_idx
  on public.capital_commitments (org_id, stage);
create index if not exists capital_commitments_org_lp_idx
  on public.capital_commitments (org_id, lp_id);
create index if not exists capital_commitments_lp_id_idx
  on public.capital_commitments (lp_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.capital_commitments'::regclass
      and conname = 'capital_commitments_stage_check'
  ) then
    alter table public.capital_commitments
      add constraint capital_commitments_stage_check
      check (stage in ('target', 'soft_circle', 'committed', 'closed', 'withdrawn'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.capital_commitments'::regclass
      and conname = 'capital_commitments_amount_check'
  ) then
    alter table public.capital_commitments
      add constraint capital_commitments_amount_check
      check (amount >= 0);
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at'
      and tgrelid = 'public.capital_commitments'::regclass
  ) then
    create trigger set_updated_at
      before update on public.capital_commitments
      for each row execute function public.set_updated_at();
  end if;
end$$;

create or replace function public.capital_stack_summary(_org_id uuid)
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
  gap_to_target numeric
)
language sql
stable
set search_path = ''
as $$
  with authorized as (
    select _org_id as org_id
    where (select auth.role()) = 'service_role'
       or private.is_org_member(_org_id)
  ),
  commitments as (
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
    left join commitments c on c.stage = s.stage
    group by s.stage
  ),
  by_lp_type as (
    select coalesce(nullif(c.lp_type, ''), 'unspecified') as lp_type,
           coalesce(sum(c.amount), 0)::numeric as total
    from commitments c
    group by coalesce(nullif(c.lp_type, ''), 'unspecified')
  ),
  totals as (
    select
      coalesce(sum(c.amount) filter (where c.stage = 'target'), 0)::numeric as target_total,
      coalesce(sum(c.amount) filter (where c.stage = 'soft_circle'), 0)::numeric as soft_circle_total,
      coalesce(sum(c.amount) filter (where c.stage = 'committed'), 0)::numeric as committed_total,
      coalesce(sum(c.amount) filter (where c.stage = 'closed'), 0)::numeric as closed_total,
      coalesce(sum(c.amount) filter (where c.stage = 'withdrawn'), 0)::numeric as withdrawn_total
    from commitments c
  )
  select
    a.org_id,
    coalesce((select c.currency from commitments c order by c.created_at desc limit 1), 'USD') as currency,
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
    )::numeric as gap_to_target
  from authorized a
  cross join totals t;
$$;

-- 2. Match Inbox -------------------------------------------------------
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null,
  subject_id uuid not null,
  score integer not null,
  rationale jsonb not null default '[]'::jsonb,
  status text not null default 'new',
  created_at timestamp with time zone not null default now(),
  acted_at timestamp with time zone
);

create index if not exists matches_org_status_score_idx
  on public.matches (org_id, status, score desc);
create index if not exists matches_subject_idx
  on public.matches (org_id, kind, subject_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.matches'::regclass
      and conname = 'matches_kind_check'
  ) then
    alter table public.matches
      add constraint matches_kind_check
      check (kind in ('lp', 'deal'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.matches'::regclass
      and conname = 'matches_score_check'
  ) then
    alter table public.matches
      add constraint matches_score_check
      check (score between 0 and 100);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.matches'::regclass
      and conname = 'matches_status_check'
  ) then
    alter table public.matches
      add constraint matches_status_check
      check (status in ('new', 'accepted', 'dismissed', 'snoozed'));
  end if;
end$$;

create or replace function public.act_on_match(_match_id uuid, _action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _match public.matches%rowtype;
  _status text;
  _pipeline_entry_id uuid;
begin
  _status := case lower(_action)
    when 'accept' then 'accepted'
    when 'accepted' then 'accepted'
    when 'dismiss' then 'dismissed'
    when 'dismissed' then 'dismissed'
    when 'snooze' then 'snoozed'
    when 'snoozed' then 'snoozed'
    when 'new' then 'new'
    else null
  end;

  if _status is null then
    raise exception 'Unsupported match action: %', _action;
  end if;

  select * into _match
  from public.matches
  where id = _match_id
  for update;

  if _match.id is null then
    raise exception 'Match % not found', _match_id;
  end if;

  update public.matches
     set status = _status,
         acted_at = case when _status = 'new' then null else now() end
   where id = _match_id
   returning * into _match;

  if _status = 'accepted' and _match.kind = 'lp' then
    select cc.id into _pipeline_entry_id
    from public.capital_commitments cc
    where cc.org_id = _match.org_id
      and cc.lp_id = _match.subject_id
      and cc.stage <> 'withdrawn'
    order by cc.created_at asc
    limit 1;

    if _pipeline_entry_id is null then
      insert into public.capital_commitments (
        org_id,
        lp_id,
        amount,
        stage,
        lp_type,
        notes
      )
      values (
        _match.org_id,
        _match.subject_id,
        0,
        'target',
        'matched',
        'Created by act_on_match for accepted LP match ' || _match.id::text
      )
      returning id into _pipeline_entry_id;
    end if;
  end if;

  return jsonb_build_object(
    'match_id', _match.id,
    'status', _match.status,
    'acted_at', _match.acted_at,
    'pipeline_entry_type', case when _pipeline_entry_id is null then null else 'capital_commitment' end,
    'pipeline_entry_id', _pipeline_entry_id
  );
end;
$$;

-- 3. Credit Wallet / Billing -----------------------------------------
create table if not exists public.credit_wallets (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  balance integer not null default 0,
  plan text not null default 'standard',
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  delta integer not null,
  reason text not null,
  ref_id uuid,
  balance_after integer not null,
  created_at timestamp with time zone not null default now()
);

create index if not exists credit_transactions_org_created_idx
  on public.credit_transactions (org_id, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.credit_wallets'::regclass
      and conname = 'credit_wallets_balance_check'
  ) then
    alter table public.credit_wallets
      add constraint credit_wallets_balance_check
      check (balance >= 0);
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at'
      and tgrelid = 'public.credit_wallets'::regclass
  ) then
    create trigger set_updated_at
      before update on public.credit_wallets
      for each row execute function public.set_updated_at();
  end if;
end$$;

create or replace function public.consume_credits(
  _org_id uuid,
  _amount integer,
  _reason text,
  _ref_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _new_balance integer;
  _current_balance integer;
begin
  if _amount is null or _amount <= 0 then
    raise exception 'Credit amount must be positive';
  end if;

  update public.credit_wallets
     set balance = balance - _amount,
         updated_at = now()
   where org_id = _org_id
     and balance >= _amount
   returning balance into _new_balance;

  if _new_balance is null then
    select balance into _current_balance
    from public.credit_wallets
    where org_id = _org_id;

    if _current_balance is null then
      raise exception 'Credit wallet not found for org %', _org_id;
    end if;

    raise exception 'Insufficient credits: balance %, requested %', _current_balance, _amount;
  end if;

  insert into public.credit_transactions (org_id, delta, reason, ref_id, balance_after)
  values (_org_id, -_amount, _reason, _ref_id, _new_balance);

  return _new_balance;
end;
$$;

create or replace function public.grant_credits(
  _org_id uuid,
  _amount integer,
  _reason text default 'grant',
  _ref_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _new_balance integer;
begin
  if _amount is null or _amount <= 0 then
    raise exception 'Credit amount must be positive';
  end if;

  insert into public.credit_wallets (org_id, balance, plan)
  values (_org_id, _amount, 'standard')
  on conflict (org_id) do update
    set balance = public.credit_wallets.balance + excluded.balance,
        updated_at = now()
  returning balance into _new_balance;

  insert into public.credit_transactions (org_id, delta, reason, ref_id, balance_after)
  values (_org_id, _amount, _reason, _ref_id, _new_balance);

  return _new_balance;
end;
$$;

insert into public.credit_wallets (org_id, balance, plan)
select o.id, 500, 'standard'
from public.organizations o
on conflict (org_id) do nothing;

-- 4. RLS / grants ------------------------------------------------------
alter table public.capital_commitments enable row level security;
alter table public.matches enable row level security;
alter table public.credit_wallets enable row level security;
alter table public.credit_transactions enable row level security;

revoke all on table public.capital_commitments from anon, authenticated;
revoke all on table public.matches from anon, authenticated;
revoke all on table public.credit_wallets from anon, authenticated;
revoke all on table public.credit_transactions from anon, authenticated;

grant select on table public.capital_commitments to authenticated;
grant select on table public.matches to authenticated;
grant select on table public.credit_wallets to authenticated;
grant select on table public.credit_transactions to authenticated;

grant select, insert, update, delete on table public.capital_commitments to service_role;
grant select, insert, update, delete on table public.matches to service_role;
grant select, insert, update, delete on table public.credit_wallets to service_role;
grant select, insert on table public.credit_transactions to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'capital_commitments' and policyname = 'members read capital_commitments'
  ) then
    create policy "members read capital_commitments" on public.capital_commitments
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'capital_commitments' and policyname = 'service_role insert capital_commitments'
  ) then
    create policy "service_role insert capital_commitments" on public.capital_commitments
      for insert to service_role
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'capital_commitments' and policyname = 'service_role update capital_commitments'
  ) then
    create policy "service_role update capital_commitments" on public.capital_commitments
      for update to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'capital_commitments' and policyname = 'service_role delete capital_commitments'
  ) then
    create policy "service_role delete capital_commitments" on public.capital_commitments
      for delete to service_role
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'matches' and policyname = 'members read matches'
  ) then
    create policy "members read matches" on public.matches
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'matches' and policyname = 'service_role insert matches'
  ) then
    create policy "service_role insert matches" on public.matches
      for insert to service_role
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'matches' and policyname = 'service_role update matches'
  ) then
    create policy "service_role update matches" on public.matches
      for update to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'matches' and policyname = 'service_role delete matches'
  ) then
    create policy "service_role delete matches" on public.matches
      for delete to service_role
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'credit_wallets' and policyname = 'members read credit_wallets'
  ) then
    create policy "members read credit_wallets" on public.credit_wallets
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'credit_wallets' and policyname = 'service_role insert credit_wallets'
  ) then
    create policy "service_role insert credit_wallets" on public.credit_wallets
      for insert to service_role
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'credit_wallets' and policyname = 'service_role update credit_wallets'
  ) then
    create policy "service_role update credit_wallets" on public.credit_wallets
      for update to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'credit_wallets' and policyname = 'service_role delete credit_wallets'
  ) then
    create policy "service_role delete credit_wallets" on public.credit_wallets
      for delete to service_role
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'credit_transactions' and policyname = 'members read credit_transactions'
  ) then
    create policy "members read credit_transactions" on public.credit_transactions
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'credit_transactions' and policyname = 'service_role insert credit_transactions'
  ) then
    create policy "service_role insert credit_transactions" on public.credit_transactions
      for insert to service_role
      with check (true);
  end if;
end$$;

revoke all on function public.capital_stack_summary(uuid) from public, anon;
grant execute on function public.capital_stack_summary(uuid) to authenticated, service_role;

revoke all on function public.act_on_match(uuid, text) from public, anon, authenticated;
revoke all on function public.consume_credits(uuid, integer, text, uuid) from public, anon, authenticated;
revoke all on function public.grant_credits(uuid, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.act_on_match(uuid, text) to service_role;
grant execute on function public.consume_credits(uuid, integer, text, uuid) to service_role;
grant execute on function public.grant_credits(uuid, integer, text, uuid) to service_role;
