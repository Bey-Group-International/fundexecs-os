-- ============================================================================
-- W4 — raise compliance: 506(b) / 506(c) exemption flag on the raise page.
--
-- The exemption choice gates the PUBLIC raise page (/r/<token>):
--   * 506(c)  → general solicitation permitted; the page shows the open
--               "express interest" CTA and may display dollar amounts.
--   * 506(b)  → no general solicitation; the page shows a gated "request
--               access" CTA and never broadcasts dollar amounts.
--   * null    → unset (treated like 506(c)'s open page until the owner chooses).
--
-- Additive + idempotent: a nullable column plus a CHECK constraint that only
-- allows the known values. Safe to re-apply on the Supabase preview branch.
-- ============================================================================

alter table public.raise_pages
  add column if not exists exemption text;

alter table public.raise_pages
  drop constraint if exists raise_pages_exemption_chk;
alter table public.raise_pages
  add constraint raise_pages_exemption_chk
  check (exemption is null or exemption in ('506b', '506c'));
