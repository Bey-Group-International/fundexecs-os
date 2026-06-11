-- =====================================================================
-- Structure & Governance: bodies + copiloted policies (Build hub).
--
-- `governance_bodies` holds each org's body rosters (fund management, IC,
-- advisory board, LPAC, capital partners, legal counsel) as a jsonb member
-- list per kind. `governance_policies` records adopted policies with the
-- operator's decisions. Named `governance_policies` (not the brief's bare
-- `policies`) to stay namespaced with the existing governance_* tables.
--
-- Org-scoped RLS — active members read and write their org's governance;
-- the service-role orchestrator may write too. Additive + idempotent.
--
-- NOTE: 20260611100000_hub_build_interior.sql (merged via #328) already
-- creates governance_bodies (without updated_by, members read-only) and a
-- generic `policies` table. This migration coexists: the create-table
-- no-ops, the alter below widens the existing table, and the grants +
-- member-write policies here enable the hub's operator-driven writes.
-- =====================================================================

create table if not exists public.governance_bodies (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  kind        text not null
                check (kind in ('fund_mgmt', 'ic', 'advisory', 'lpac',
                                'capital_partners', 'legal_counsel')),
  members     jsonb not null default '[]'::jsonb,
  updated_by  uuid references auth.users (id) on delete set null,
  created_at  timestamp with time zone not null default now(),
  updated_at  timestamp with time zone not null default now(),
  unique (org_id, kind)
);

alter table public.governance_bodies
  add column if not exists updated_by uuid references auth.users (id) on delete set null;

create table if not exists public.governance_policies (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  policy_id   text not null
                check (policy_id in ('valuation', 'conflicts', 'allocation',
                                     'compliance', 'ethics', 'cyber')),
  decisions   jsonb not null default '{}'::jsonb,
  adopted_by  uuid references auth.users (id) on delete set null,
  adopted_at  timestamp with time zone not null default now(),
  created_at  timestamp with time zone not null default now(),
  unique (org_id, policy_id)
);

create index if not exists governance_bodies_org_idx on public.governance_bodies (org_id);
create index if not exists governance_policies_org_idx on public.governance_policies (org_id);

alter table public.governance_bodies enable row level security;
alter table public.governance_policies enable row level security;

revoke all on table public.governance_bodies from anon;
revoke all on table public.governance_policies from anon;
grant select, insert, update on table public.governance_bodies to authenticated;
grant select, insert, update on table public.governance_policies to authenticated;
grant all on table public.governance_bodies to service_role;
grant all on table public.governance_policies to service_role;

-- Keep updated_at fresh on bodies (reuses the shared set_updated_at fn).
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at' and tgrelid = 'public.governance_bodies'::regclass
  ) then
    create trigger set_updated_at
      before update on public.governance_bodies
      for each row execute function public.set_updated_at();
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'governance_bodies'
      and policyname = 'members read own org governance bodies'
  ) then
    create policy "members read own org governance bodies"
      on public.governance_bodies
      for select to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = governance_bodies.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'governance_bodies'
      and policyname = 'members write own org governance bodies'
  ) then
    create policy "members write own org governance bodies"
      on public.governance_bodies
      for all to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = governance_bodies.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      )
      with check (
        exists (
          select 1 from public.org_members om
          where om.org_id = governance_bodies.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'governance_bodies'
      and policyname = 'service_role writes governance_bodies'
  ) then
    create policy "service_role writes governance_bodies"
      on public.governance_bodies
      for all to service_role
      using (true)
      with check (true);
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'governance_policies'
      and policyname = 'members read own org governance policies'
  ) then
    create policy "members read own org governance policies"
      on public.governance_policies
      for select to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = governance_policies.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'governance_policies'
      and policyname = 'members write own org governance policies'
  ) then
    create policy "members write own org governance policies"
      on public.governance_policies
      for all to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = governance_policies.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      )
      with check (
        exists (
          select 1 from public.org_members om
          where om.org_id = governance_policies.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'governance_policies'
      and policyname = 'service_role writes governance_policies'
  ) then
    create policy "service_role writes governance_policies"
      on public.governance_policies
      for all to service_role
      using (true)
      with check (true);
  end if;
end$$;
