-- 20260708180000_marketplace_rich_cards.sql
-- Structured deal-card fields for the marketplace, adopted from the public
-- business-for-sale listing pattern: a human reference code, country (for flag +
-- facet), reporting currency, EBITDA / gross-revenue sub-metrics, and a curated
-- "featured" flag. Purely additive — existing rows keep working and get a
-- backfilled reference code.

alter table public.marketplace_listings
  add column if not exists reference_code text,
  add column if not exists country       text,               -- free-form/slug, e.g. "united-states"
  add column if not exists currency       text not null default 'USD',
  add column if not exists ebitda         numeric(18, 2),
  add column if not exists gross_revenue  numeric(18, 2),
  add column if not exists featured       boolean not null default false;

-- Human-facing listing reference (L#NNNNNNNN). Continues the sequence space used
-- by the imported catalogue so codes don't collide with legacy ones.
create sequence if not exists public.marketplace_listing_ref_seq start with 20261102;

create or replace function public.marketplace_set_reference_code()
returns trigger
language plpgsql
as $$
begin
  if new.reference_code is null then
    new.reference_code := 'L#' || nextval('public.marketplace_listing_ref_seq')::text;
  end if;
  return new;
end;
$$;

drop trigger if exists marketplace_listings_set_reference_code on public.marketplace_listings;
create trigger marketplace_listings_set_reference_code
  before insert on public.marketplace_listings
  for each row execute function public.marketplace_set_reference_code();

-- Backfill any pre-existing rows so every listing has a stable code.
update public.marketplace_listings
  set reference_code = 'L#' || nextval('public.marketplace_listing_ref_seq')::text
  where reference_code is null;

-- Featured listings sort first on the public board; a partial index keeps that
-- ordering cheap without bloating the common (unfeatured) case.
create index if not exists marketplace_listings_featured_idx
  on public.marketplace_listings (featured)
  where featured = true;
