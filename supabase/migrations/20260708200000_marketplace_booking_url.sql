-- 20260708200000_marketplace_booking_url.sql
-- Per-listing booking link. Sellers can attach their own scheduling URL (any
-- https scheduler — Calendly, Cal.com, Google, etc.) so potential buyers can
-- book a meeting directly from the listing. When null, surfaces fall back to
-- the firm's connected Calendly, then a deploy-wide link (resolved in app code).
alter table public.marketplace_listings
  add column if not exists booking_url text;
