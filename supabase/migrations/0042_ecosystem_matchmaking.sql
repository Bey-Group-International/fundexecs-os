-- 0042_ecosystem_matchmaking.sql
-- Instant ecosystem matchmaking. The moment a new organization finishes
-- onboarding, Earn scores its firm profile against every other discoverable org
-- and drops a professional alert into the matching orgs' Unified Inbox — across
-- the five ecosystem lanes the operator already thinks in: Capital/LP, Debt &
-- Capital, Partners, Providers, and Deals — plus a reciprocal digest into the
-- newcomer's own bell. The matching + fan-out live in lib/ecosystem-match*; this
-- migration adds the two pieces of schema they lean on.

-- 1. The opt-out switch. Default true, so a fresh org participates in matchmaking
--    the moment it onboards; a workspace can stand itself down from Settings to
--    go dark — no broadcast out, no match alerts in.
alter table public.organizations
  add column if not exists discoverable boolean not null default true;

comment on column public.organizations.discoverable is
  'When true, this org participates in instant ecosystem matchmaking: its firm '
  'profile may be surfaced to matching orgs and it receives match alerts. Opt '
  'out from Settings to go dark.';

-- 2. A first-class inbox channel for Earn's ecosystem match alerts, so a match
--    reads as the professional notification it is rather than borrowing an email
--    glyph. `add value if not exists` is idempotent; the value is only USED at
--    runtime (never in this transaction), so it is safe inside the migration.
alter type inbox_channel add value if not exists 'ecosystem';
