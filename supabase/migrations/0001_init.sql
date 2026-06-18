-- 0001_init.sql
-- Foundation: extensions, shared enums, helper functions, and common triggers.
-- FundExecs OS follows a tenancy model rooted at `organizations`. A `principal`
-- (a person, 1:1 with auth.users) belongs to one or more organizations through
-- `organization_members`. Almost every domain row carries `organization_id`,
-- which is the boundary all RLS policies are written against.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto" with schema extensions;     -- gen_random_uuid()
create extension if not exists "pg_trgm" with schema extensions;      -- fuzzy search on names

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- The four operational hubs.
create type hub as enum ('build', 'source', 'run', 'execute');

-- The six native AI agents. Stored as a stable key, not a foreign key, so the
-- agent catalog can evolve without rewriting historical task rows.
create type agent_key as enum (
  'analyst',
  'associate',
  'investor_relations',
  'portfolio_ops',
  'diligence',
  'fund_admin'
);

-- Which of the three graphs an edge or mutation belongs to.
create type graph_kind as enum ('relationship', 'deal', 'capital');

-- Membership roles inside an organization.
create type member_role as enum ('owner', 'admin', 'member', 'viewer');

-- Investor classification (Capital graph nodes).
create type investor_type as enum (
  'lp',
  'family_office',
  'institution',
  'fund_of_funds',
  'lender',
  'bank',
  'co_gp',
  'other'
);

-- Pooled capital vehicles (Deal graph nodes).
create type fund_type as enum ('fund', 'spv', 'co_invest', 'separate_account');

-- Deal lifecycle stage (Deal graph).
create type deal_stage as enum (
  'sourced',
  'screening',
  'diligence',
  'underwriting',
  'ic_review',
  'closing',
  'owned',
  'exited',
  'passed',
  'dead'
);

-- Asset classification (post-close, Execute hub).
create type asset_type as enum (
  'real_estate',
  'operating_company',
  'portfolio_company',
  'fund_interest',
  'other'
);

-- Capital event types (Capital graph movements / Execute hub).
create type capital_event_type as enum (
  'capital_call',
  'distribution',
  'contribution',
  'fee',
  'return_of_capital',
  'carry'
);

-- Task engine status (the sacred /prompt -> /task -> /approve loop).
create type task_status as enum (
  'pending',
  'in_progress',
  'awaiting_approval',
  'blocked',
  'completed',
  'failed',
  'cancelled'
);

create type approval_decision as enum ('pending', 'approved', 'rejected', 'regenerate');

create type diligence_status as enum ('open', 'in_review', 'cleared', 'flagged', 'waived');

create type risk_severity as enum ('low', 'medium', 'high', 'critical');

create type marketplace_status as enum ('draft', 'listed', 'paused', 'closed');

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

-- Set of organization ids the current authenticated principal belongs to.
-- SECURITY DEFINER so RLS policies can call it without recursing into the
-- organization_members policy. Used by nearly every policy.
create or replace function public.current_principal_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.organization_members
  where principal_id = auth.uid();
$$;

-- True if the current principal has owner/admin rights in the given org.
create or replace function public.is_org_admin(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where principal_id = auth.uid()
      and organization_id = target_org
      and role in ('owner', 'admin')
  );
$$;

-- Generic updated_at maintenance trigger.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
