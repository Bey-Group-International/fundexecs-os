-- Migration: LP signal fields for LP-fit scoring
--
-- Adds optional allocator-signal columns to `investors` so the LP Intelligence
-- scorer (lib/lp-scoring.ts) can evaluate sector alignment, emerging-manager
-- openness, and recent allocation activity — beyond the check-size / geography /
-- investor-type signals already present on the row. All nullable (sectors
-- defaults to empty): scoring degrades gracefully when absent and prompts the
-- operator to enrich. No RLS change — existing investors policies cover these.

alter table public.investors
  add column if not exists sectors text[] not null default '{}',
  add column if not exists open_to_emerging_managers boolean,
  add column if not exists allocation_signal text;

comment on column public.investors.sectors is
  'Investor sector / strategy focus areas — used for LP-fit sector alignment.';
comment on column public.investors.open_to_emerging_managers is
  'Whether this allocator backs emerging / first-time managers (LP-fit signal). Null = unknown.';
comment on column public.investors.allocation_signal is
  'Free-text recent-activity note (e.g. "actively allocating to buyout") — scanned for the LP-fit activity signal.';
