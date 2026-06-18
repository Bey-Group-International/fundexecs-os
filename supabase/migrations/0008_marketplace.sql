-- 0008_marketplace.sql
-- Marketplace layer — co-invest opportunities, deal/LP listings surfaced
-- across organizations. Rows are owned by a listing org but may be made
-- discoverable beyond it (visibility handled in RLS).

create table public.marketplace_listings (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  title            text not null,
  listing_type     text not null,              -- 'co_invest' | 'lp_seeking' | 'deal' | 'service'
  summary          text,
  -- optional link back to a concrete object
  deal_id          uuid references public.deals (id) on delete set null,
  fund_id          uuid references public.funds (id) on delete set null,
  amount           numeric(18, 2),
  status           marketplace_status not null default 'draft',
  is_public        boolean not null default false,  -- visible to all orgs when listed
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index marketplace_listings_org_idx on public.marketplace_listings (organization_id);
create index marketplace_listings_public_idx on public.marketplace_listings (status, is_public)
  where is_public = true;

create trigger marketplace_listings_set_updated_at
  before update on public.marketplace_listings
  for each row execute function public.set_updated_at();
