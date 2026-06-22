-- 0051_stake_disputes.sql
-- Stake forfeiture DUE-PROCESS path (see docs/TOKENIZATION_LAYERS.md §9
-- "Forfeiture due process" and §4.2 stake-to-list). Today a stake can only be
-- returned; bad-faith forfeiture must first pass through an appealable dispute
-- before it burns real credits. This adds the dispute record; the credit
-- movement still flows through resolveStake (lib/stake.ts) so the credit_ledger
-- stays the single source of truth.
--
-- Lifecycle: open (filed, no credit moved) → upheld (forfeiture confirmed →
-- stake burned) | dismissed (staker cleared → stake returned). Resolution is
-- idempotent (only an 'open' dispute acts).
--
-- Idempotent (IF NOT EXISTS + drop/recreate policy) so it is safe to re-apply on
-- a stateful preview branch. Writes flow through server actions / the service
-- role; an org may read disputes filed against its own stakes.

-- ---------------------------------------------------------------------------
-- stake_disputes — an appealable challenge against a locked stake. `status`
-- tracks due process; `organization_id` is the staker under challenge, `stake_id`
-- the position at stake. No credit moves on filing — that is the whole point.
-- ---------------------------------------------------------------------------
create table if not exists public.stake_disputes (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  stake_id        uuid not null references public.stake_positions (id) on delete cascade,
  status          text not null default 'open'
                    check (status in ('open', 'upheld', 'dismissed')),
  reason          text,
  opened_by       uuid references public.principals (id) on delete set null,
  resolution_note text,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);
create index if not exists stake_disputes_org_idx on public.stake_disputes (organization_id, created_at desc);
create index if not exists stake_disputes_stake_idx on public.stake_disputes (stake_id);

alter table public.stake_disputes enable row level security;

-- stake_disputes: the staker org reads disputes filed against it. Writes via
-- server actions / the service role (resolution moves credits and must bypass
-- per-row RLS).
drop policy if exists stake_disputes_select on public.stake_disputes;
create policy stake_disputes_select on public.stake_disputes
  for select using (organization_id in (select public.current_principal_org_ids()));

-- ---------------------------------------------------------------------------
-- Data API grants. Supabase stopped auto-granting Data API privileges on new
-- public tables (CLI default flipped 2026-05-30), so we grant them explicitly to
-- the standard roles here. RLS (enabled above) is what actually governs row
-- access; these grants only make the table reachable through PostgREST.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.stake_disputes to anon, authenticated, service_role;
