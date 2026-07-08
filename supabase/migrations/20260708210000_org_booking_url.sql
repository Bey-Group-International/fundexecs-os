-- 20260708210000_org_booking_url.sql
-- Firm-wide default booking link. A firm sets its scheduling URL once in
-- Settings; every listing without its own booking_url falls back to it, so
-- buyers get a "Book a meeting" button across the marketplace without the firm
-- needing to connect the Calendly API. Admin-gated by the existing
-- organizations_update RLS policy.
alter table public.organizations
  add column if not exists booking_url text;
