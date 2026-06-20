-- 0047_tokenization.sql
-- Tokenization layers, persistence (see docs/TOKENIZATION_LAYERS.md). Promotes the
-- Phase 0 in-code resolvers to durable ledgers, following the exact append-only
-- pattern proven by credit_ledger (migration 0039):
--   • reputation_scores / reputation_ledger — earned, non-transferable standing.
--   • stake_positions                       — refundable credit holds (stake-to-list).
--   • attestations                          — immutable, signed, optionally-anchored claims.
-- Idempotent (IF NOT EXISTS + drop/recreate policies) so it is safe to re-apply on
-- a stateful preview branch. Writes flow through server actions / the service role;
-- orgs may read their own rows.

-- ---------------------------------------------------------------------------
-- reputation_scores — current standing per org. `score` is merit points (closed
-- deals dominate); `tier` is the derived band, maintained by the app on each
-- grant. One row per org, created on first grant.
-- ---------------------------------------------------------------------------
create table if not exists public.reputation_scores (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  score           integer not null default 0,
  tier            text not null default 'unranked'
                    check (tier in ('unranked', 'verified', 'established', 'principal')),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- reputation_ledger — append-only record of every reputation movement, so
-- standing is auditable and explainable (why an org is the tier it is). Positive
-- = earned, negative = penalty. `source_id` points at the deal/listing/attestation
-- that earned it; `source_type` names which.
-- ---------------------------------------------------------------------------
create table if not exists public.reputation_ledger (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  delta           integer not null,
  reason          text not null,
  source_type     text,
  source_id       uuid,
  note            text,
  created_at      timestamptz not null default now()
);
create index if not exists reputation_ledger_org_idx on public.reputation_ledger (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- stake_positions — a hold on an org's credits backing a marketplace action.
-- Locking debits the wallet (a credit_ledger 'stake_lock' row); resolving returns
-- (credit) or forfeits (burn) it. `ref_id` ties a listing stake to its listing.
-- The credit_ledger stays the single source of truth for credit movement; this
-- table just records the hold and its outcome.
-- ---------------------------------------------------------------------------
create table if not exists public.stake_positions (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  purpose         text not null check (purpose in ('listing', 'governance')),
  ref_id          uuid,
  amount          integer not null check (amount > 0),
  status          text not null default 'locked' check (status in ('locked', 'returned', 'forfeited')),
  note            text,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);
create index if not exists stake_positions_org_idx on public.stake_positions (organization_id, created_at desc);
create index if not exists stake_positions_ref_idx on public.stake_positions (ref_id);

-- ---------------------------------------------------------------------------
-- attestations — an immutable assertion that a gated outcome genuinely occurred,
-- signed by an accountable principal and optionally witnessed by a counterparty.
-- Never updated: a correction is a new row that supersedes. `settlement` carries
-- the on-chain bridge state ('internal' today; 'anchored' once a hash is committed
-- on-chain for third-party verifiability).
-- ---------------------------------------------------------------------------
create table if not exists public.attestations (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  subject_type    text not null,
  subject_id      uuid not null,
  claim           text not null,
  attested_by     uuid references public.principals (id) on delete set null,
  witness_org_id  uuid references public.organizations (id) on delete set null,
  evidence_hash   text,
  settlement      text not null default 'internal'
                    check (settlement in ('internal', 'anchored', 'onchain')),
  anchor_ref      text,
  created_at      timestamptz not null default now()
);
create index if not exists attestations_org_idx on public.attestations (organization_id, created_at desc);
create index if not exists attestations_subject_idx on public.attestations (subject_type, subject_id);

-- ---------------------------------------------------------------------------
-- increment_org_reputation — atomic standing grant that creates the score row if
-- absent and never lets standing go negative. Mirrors increment_org_credits.
-- Returns the new score. The app derives and writes `tier` from this value.
-- ---------------------------------------------------------------------------
create or replace function public.increment_org_reputation(p_org uuid, p_delta integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_score integer;
begin
  insert into public.reputation_scores (organization_id, score)
    values (p_org, greatest(0, p_delta))
  on conflict (organization_id)
    do update set score = greatest(0, reputation_scores.score + p_delta),
                  updated_at = now()
  returning score into new_score;
  return new_score;
end;
$$;

alter table public.reputation_scores enable row level security;
alter table public.reputation_ledger enable row level security;
alter table public.stake_positions   enable row level security;
alter table public.attestations      enable row level security;

-- reputation_scores: an org reads its own standing. Writes via the service role.
drop policy if exists reputation_scores_select on public.reputation_scores;
create policy reputation_scores_select on public.reputation_scores
  for select using (organization_id in (select public.current_principal_org_ids()));

-- reputation_ledger: an org reads its own movements. Writes via the service role.
drop policy if exists reputation_ledger_select on public.reputation_ledger;
create policy reputation_ledger_select on public.reputation_ledger
  for select using (organization_id in (select public.current_principal_org_ids()));

-- stake_positions: an org reads its own stakes. Writes via server actions /
-- service role (locking moves credits and must bypass per-row RLS).
drop policy if exists stake_positions_select on public.stake_positions;
create policy stake_positions_select on public.stake_positions
  for select using (organization_id in (select public.current_principal_org_ids()));

-- attestations: an org reads attestations it authored or is the witness on.
-- (A public-read policy can be layered later when verifiability goes external.)
drop policy if exists attestations_select on public.attestations;
create policy attestations_select on public.attestations
  for select using (
    organization_id in (select public.current_principal_org_ids())
    or witness_org_id in (select public.current_principal_org_ids())
  );
