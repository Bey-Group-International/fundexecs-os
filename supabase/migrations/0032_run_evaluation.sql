-- 0032_run_evaluation.sql
-- Run-hub evaluation deepening. Three additions, all in service of taking a deal
-- from "in evaluation" to a defensible, recorded investment decision:
--
--   1. Risk depth on diligence_items — likelihood (paired with the existing
--      severity to form a heatmap), a mitigation note, and the residual severity
--      that remains once mitigated. Conviction reads the residual, so writing a
--      mitigation visibly buys back conviction.
--   2. ic_decisions — the append-only record of the committee's call on a deal
--      (go / conditional / hold / no-go), the rationale, and the conviction at
--      the moment of decision. The audit trail behind every commitment.
--   3. conviction_snapshots — point-in-time conviction per deal, written on every
--      evaluation mutation, so Run can show conviction *building* over time
--      rather than only its latest value.

-- ---------------------------------------------------------------------------
-- 1. Risk depth on diligence_items
-- ---------------------------------------------------------------------------
-- `risk_severity` already captures impact; `likelihood` is the other axis of the
-- heatmap. `mitigation` is the plan, `residual_severity` what survives it.
alter table public.diligence_items
  add column likelihood        risk_severity,
  add column mitigation        text,
  add column residual_severity risk_severity;

-- ---------------------------------------------------------------------------
-- 2. ic_decisions — the recorded committee call on a deal (append-only log).
-- ---------------------------------------------------------------------------
create type ic_decision as enum ('go', 'conditional', 'hold', 'no_go');

create table public.ic_decisions (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  deal_id         uuid not null references public.deals (id) on delete cascade,
  decision        ic_decision not null,
  rationale       text,
  -- the rolled-up conviction score (0–100) at the instant of the decision, so
  -- the log stands on its own without recomputation.
  conviction      int check (conviction between 0 and 100),
  decided_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index ic_decisions_org_idx on public.ic_decisions (organization_id);
create index ic_decisions_deal_idx on public.ic_decisions (deal_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. conviction_snapshots — per-deal conviction over time (append-only).
-- ---------------------------------------------------------------------------
create table public.conviction_snapshots (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  deal_id         uuid not null references public.deals (id) on delete cascade,
  score           int not null check (score between 0 and 100),
  stage           text not null,
  captured_at     timestamptz not null default now()
);

create index conviction_snapshots_deal_idx
  on public.conviction_snapshots (deal_id, captured_at desc);

-- ---------------------------------------------------------------------------
-- RLS — same member-read / writer-write org tenancy as the rest of the domain.
-- ---------------------------------------------------------------------------
alter table public.ic_decisions enable row level security;
alter table public.conviction_snapshots enable row level security;

create policy ic_decisions_select on public.ic_decisions
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy ic_decisions_write on public.ic_decisions
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

create policy conviction_snapshots_select on public.conviction_snapshots
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy conviction_snapshots_write on public.conviction_snapshots
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
