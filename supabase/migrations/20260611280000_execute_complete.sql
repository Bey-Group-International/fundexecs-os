-- =====================================================================
-- Execute hub completion: Signatures & wires + Capital calls.
--
-- 20260611101000_hub_data_room_execute.sql created `capital_calls` and
-- `call_lp_status` with members read-only (writes via service_role). The
-- Execute interiors are operator-driven through the approve loop, so
-- active members need writes — mirroring 20260611240000 (closings).
--
-- New tables for the Signatures & wires module: `signatures` (e-sign
-- tracking ledger) and `wires` (wire-instruction ledger). Both are
-- records of instructions and confirmations the operator approves —
-- e-sign/banking rails attach later without schema change.
--
-- Additive + idempotent throughout.
-- =====================================================================

-- ── Capital calls: kind + label, member writes ───────────────────────

alter table public.capital_calls
  add column if not exists kind text not null default 'call';
alter table public.capital_calls
  add column if not exists label text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.capital_calls'::regclass
      and conname = 'capital_calls_kind_check'
  ) then
    alter table public.capital_calls
      add constraint capital_calls_kind_check
      check (kind in ('call', 'distribution'));
  end if;
end$$;

grant insert, update on table public.capital_calls to authenticated;
grant insert, update on table public.call_lp_status to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'capital_calls'
      and policyname = 'members write own org capital_calls'
  ) then
    create policy "members write own org capital_calls"
      on public.capital_calls
      for all to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = capital_calls.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      )
      with check (
        exists (
          select 1 from public.org_members om
          where om.org_id = capital_calls.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'call_lp_status'
      and policyname = 'members write own org call_lp_status'
  ) then
    create policy "members write own org call_lp_status"
      on public.call_lp_status
      for all to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = call_lp_status.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      )
      with check (
        exists (
          select 1 from public.org_members om
          where om.org_id = call_lp_status.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;
end$$;

-- ── Signatures: the e-sign tracking ledger ───────────────────────────

create table if not exists public.signatures (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  closing_id uuid references public.closings (id) on delete set null,
  document text not null,
  signer text not null,
  status text not null default 'out_for_signature',
  signed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists signatures_org_status_idx
  on public.signatures (org_id, status);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.signatures'::regclass
      and conname = 'signatures_status_check'
  ) then
    alter table public.signatures
      add constraint signatures_status_check
      check (status in ('out_for_signature', 'signed', 'declined'));
  end if;
end$$;

-- ── Wires: the wire-instruction ledger ───────────────────────────────

create table if not exists public.wires (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  closing_id uuid references public.closings (id) on delete set null,
  direction text not null,
  amount numeric not null,
  currency text not null default 'USD',
  counterparty text not null,
  reference text,
  status text not null default 'instructed',
  settled_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists wires_org_status_idx
  on public.wires (org_id, status);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.wires'::regclass
      and conname = 'wires_direction_check'
  ) then
    alter table public.wires
      add constraint wires_direction_check
      check (direction in ('in', 'out'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.wires'::regclass
      and conname = 'wires_status_check'
  ) then
    alter table public.wires
      add constraint wires_status_check
      check (status in ('instructed', 'sent', 'settled'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.wires'::regclass
      and conname = 'wires_amount_positive'
  ) then
    alter table public.wires
      add constraint wires_amount_positive
      check (amount > 0);
  end if;
end$$;

-- ── RLS for the new tables ───────────────────────────────────────────

alter table public.signatures enable row level security;
alter table public.wires enable row level security;

grant select, insert, update on table public.signatures to authenticated;
grant select, insert, update on table public.wires to authenticated;

do $$
declare
  tbl text;
begin
  foreach tbl in array array['signatures', 'wires'] loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = tbl
        and policyname = format('members read %s', tbl)
    ) then
      execute format(
        'create policy "members read %1$s" on public.%1$I
           for select to authenticated
           using (private.is_org_member(org_id))',
        tbl
      );
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = tbl
        and policyname = format('members write own org %s', tbl)
    ) then
      execute format(
        'create policy "members write own org %1$s" on public.%1$I
           for all to authenticated
           using (
             exists (
               select 1 from public.org_members om
               where om.org_id = %1$I.org_id
                 and om.user_id = auth.uid()
                 and om.status = ''active''
             )
           )
           with check (
             exists (
               select 1 from public.org_members om
               where om.org_id = %1$I.org_id
                 and om.user_id = auth.uid()
                 and om.status = ''active''
             )
           )',
        tbl
      );
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = tbl
        and policyname = format('service_role manage %s', tbl)
    ) then
      execute format(
        'create policy "service_role manage %1$s" on public.%1$I
           for all to service_role
           using (true)
           with check (true)',
        tbl
      );
    end if;
  end loop;
end$$;
