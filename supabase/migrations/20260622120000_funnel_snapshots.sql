-- 20260622120000_funnel_snapshots.sql
-- Weekly funnel rollup — the snapshot store that closes the funnel → digest loop.
-- The Source Outcome Funnel (lib/source-funnel.ts, buildFunnel) measures the
-- sourcing pipeline end-to-end (sourced → contacted → replied → met → mandate),
-- but until now it was pull-only: someone had to open it. This table captures a
-- serialized funnel read each week so the next run can diff against it ("what
-- changed in your funnel") and push the delta through the existing digest
-- channels (lib/funnel-rollup.ts + app/api/digest/weekly).
--
--   funnel_snapshots — one append-only row per (org, capture), holding the full
--                      serialized Funnel as jsonb. The most recent prior row is
--                      the baseline the next rollup diffs against.
--
-- Org-scoped, with the same member-read / writer-write RLS as the rest of the
-- sourcing domain (radar_digest 0062, entity_signals 0055).

-- ---------------------------------------------------------------------------
-- funnel_snapshots — append-only weekly snapshot of the serialized Funnel.
-- ---------------------------------------------------------------------------
create table if not exists public.funnel_snapshots (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- the serialized Funnel (lib/source-funnel.ts): counts, conversions, overall
  -- conversion, and the by-source / by-signal breakdowns.
  snapshot        jsonb not null,
  captured_at     timestamptz not null default now()
);

-- Newest-first per org: the rollup loads the most recent prior snapshot to diff.
create index if not exists funnel_snapshots_org_captured_idx
  on public.funnel_snapshots (organization_id, captured_at desc);

-- RLS: same member-read / writer-write org tenancy as the rest of the domain.
alter table public.funnel_snapshots enable row level security;

-- CREATE POLICY has no IF NOT EXISTS, so drop-then-create to stay idempotent.
drop policy if exists funnel_snapshots_select on public.funnel_snapshots;
create policy funnel_snapshots_select on public.funnel_snapshots
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists funnel_snapshots_write on public.funnel_snapshots;
create policy funnel_snapshots_write on public.funnel_snapshots
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
