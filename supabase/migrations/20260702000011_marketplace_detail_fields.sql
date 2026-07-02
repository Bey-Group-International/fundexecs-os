-- 20260702000011_marketplace_detail_fields.sql
-- Adds structured deal-card fields and teaser attachment to marketplace_listings,
-- plus a marketplace_interests table to track expressed interest.

alter table public.marketplace_listings
  add column if not exists target_irr        numeric(6, 2),      -- e.g. 22.5 (%)
  add column if not exists hold_period_years numeric(4, 1),      -- e.g. 5.0
  add column if not exists geography         text,               -- free-form, e.g. "Southeast US"
  add column if not exists asset_class       text,               -- e.g. "multifamily", "venture"
  add column if not exists teaser_url        text;               -- link to teaser deck or data room

-- Track who has expressed interest in a listing.
create table if not exists public.marketplace_interests (
  id              uuid primary key default extensions.gen_random_uuid(),
  listing_id      uuid not null references public.marketplace_listings (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique (listing_id, organization_id)
);

create index if not exists marketplace_interests_listing_idx
  on public.marketplace_interests (listing_id);
create index if not exists marketplace_interests_org_idx
  on public.marketplace_interests (organization_id);

-- RLS: listing owners can see who expressed interest; expresser can see their own row.
alter table public.marketplace_interests enable row level security;

create policy marketplace_interests_owner_select on public.marketplace_interests
  for select using (
    exists (
      select 1 from public.marketplace_listings ml
      join public.organization_members om on om.organization_id = ml.organization_id
      where ml.id = marketplace_interests.listing_id
        and om.user_id = auth.uid()
    )
    or organization_id in (
      select organization_id from public.organization_members where user_id = auth.uid()
    )
  );

create policy marketplace_interests_insert on public.marketplace_interests
  for insert with check (
    user_id = auth.uid()
    and organization_id in (
      select organization_id from public.organization_members where user_id = auth.uid()
    )
  );

create policy marketplace_interests_delete on public.marketplace_interests
  for delete using (
    user_id = auth.uid()
  );
