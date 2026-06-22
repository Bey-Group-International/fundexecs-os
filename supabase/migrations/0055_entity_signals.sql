-- 0055_entity_signals.sql
-- Signals & Triggers — the market-intelligence layer on top of the Sourcing
-- Intelligence entity catalog (0042). Where sourcing_entities is the *who*
-- (the universe of companies/investors/funds/advisors/lenders/providers), this
-- table is the *what's happening*: discrete, time-stamped market signals about
-- those entities — funding rounds, hiring spikes, ownership changes, news,
-- growth, and the soft intent signals (raise_intent / sale_intent) that predict
-- a transaction. lib/sourcing-signals.ts turns a bundle of these into a
-- deterministic propensity score (likelihood-to-sell / likelihood-to-raise),
-- the FundExecs answer to SourceScrub/Cyndx triggers.
--
-- `entity_id` links to the sourcing_entities row when the subject is known, but
-- is nullable: a signal can land before its entity is in the catalog (we keep
-- the subject_name + kind on the row so the feed is self-describing). Signals
-- are generated deterministically today (and Claude-optional); a real third-
-- party feed plugs in behind the same insert seam (see lib/sourcing-signals.ts).
--
-- Org-scoped, append-style, with the same member-read / writer-write RLS as
-- dispatch_log (0030) and source_feedback (0041).

create table if not exists public.entity_signals (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- the catalog row this is about, when known (nullable: signal can precede entity).
  entity_id       uuid references public.sourcing_entities (id) on delete set null,
  -- self-describing subject so the feed reads even without a linked entity.
  subject_name    text not null,
  -- the entity kind: 'company' | 'investor' | 'fund' | 'advisor' | 'lender' | 'provider'.
  kind            text,
  -- 'funding_round' | 'hiring' | 'ownership_change' | 'news' | 'growth' |
  -- 'raise_intent' | 'sale_intent' — the trigger taxonomy propensity scores from.
  signal_type     text not null,
  -- 0–100 conviction/intensity of the signal.
  strength        integer not null default 50,
  summary         text,
  source_url      text,
  -- when the underlying event happened (may differ from created_at).
  occurred_at     timestamptz,
  -- open bag for feed-specific payload (amounts, headcount deltas, acquirer, …).
  metadata        jsonb not null default '{}'::jsonb,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists entity_signals_org_idx on public.entity_signals (organization_id);
create index if not exists entity_signals_org_entity_idx on public.entity_signals (organization_id, entity_id);
create index if not exists entity_signals_org_type_idx on public.entity_signals (organization_id, signal_type);

-- RLS: same member-read / writer-write org tenancy as the rest of the domain.
alter table public.entity_signals enable row level security;

-- CREATE POLICY has no IF NOT EXISTS, so drop-then-create to stay idempotent.
drop policy if exists entity_signals_select on public.entity_signals;
create policy entity_signals_select on public.entity_signals
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists entity_signals_write on public.entity_signals;
create policy entity_signals_write on public.entity_signals
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
