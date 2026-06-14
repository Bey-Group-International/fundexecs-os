-- Provider cache (Phase 2, P2-A) — dedupe external data-vendor calls.
--
-- Enrichment / web-research / signal providers are metered per call. This cache
-- collapses repeat lookups by canonical key (email / domain / URL hash / query)
-- so the same fact isn't paid for twice within its freshness window. Generic on
-- purpose: every Phase-2 provider category reuses it.
--
-- RLS mirrors sourcing_briefs: org members read/write their org's cache; admins
-- may delete. Helpers live in the non-exposed `private` schema.

create table if not exists public.provider_cache (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null,
  kind text not null,
  cache_key text not null,
  payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz,
  -- One row per (org, provider, kind, key); the wrapper upserts on conflict.
  constraint provider_cache_unique unique (org_id, provider, kind, cache_key)
);

-- Lookups are always by the unique tuple; an explicit index aids freshness scans.
create index if not exists provider_cache_expiry_idx
  on public.provider_cache (org_id, expires_at);

alter table public.provider_cache enable row level security;

drop policy if exists "members read provider_cache" on public.provider_cache;
create policy "members read provider_cache" on public.provider_cache
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists "members insert provider_cache" on public.provider_cache;
create policy "members insert provider_cache" on public.provider_cache
  for insert to authenticated with check (private.is_org_member(org_id));

drop policy if exists "members update provider_cache" on public.provider_cache;
create policy "members update provider_cache" on public.provider_cache
  for update to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

drop policy if exists "admins delete provider_cache" on public.provider_cache;
create policy "admins delete provider_cache" on public.provider_cache
  for delete to authenticated using (private.is_org_admin(org_id));
