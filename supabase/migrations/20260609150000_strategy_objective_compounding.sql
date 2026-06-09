-- Strategy → compounding command surface, Phase 2b (data layer).
--
-- Additive columns on governance_objectives that let strategy objectives be
-- (1) classified into the four posture lanes, (2) traced to where they came
-- from (manual vs. an Earn/specialist draft off a market signal or lifecycle
-- gate), (3) chained parent→child for the cascade mechanic, and (4) held as a
-- draft until the operator approves them. Everything is nullable / defaulted so
-- existing rows and the current insert path keep working unchanged — no
-- backfill required. RLS is inherited from the table; no policy change.
--
-- See memory/STRATEGY_COMPOUNDING_BLUEPRINT.md (Phase 2b). The runtime read/
-- write wiring lands once this migration is applied.

-- 1. Posture lane. NULL = uncategorized (existing rows). The Adrian-owned
--    standing compliance tier (Phase 4) uses category = 'compliance'.
alter table public.governance_objectives
  add column if not exists category text;

-- 2. Capital weight — the value-at-stake multiplier for capital-weighted
--    scoring. NULL falls back to the priority-based proxy used in the UI today.
alter table public.governance_objectives
  add column if not exists capital_weight numeric;

-- 3. Provenance. 'manual' (hand-entered), 'signal' (drafted off a market
--    signal), 'lifecycle' (gate-derived), 'cascade' (spawned by a parent).
alter table public.governance_objectives
  add column if not exists source text not null default 'manual';

-- 4. The market signal this objective was drafted from, when source='signal'.
alter table public.governance_objectives
  add column if not exists source_signal_id uuid;

-- 5. Cascade parent: closing a 100-day bet spawns its 30-day children, etc.
alter table public.governance_objectives
  add column if not exists parent_objective_id uuid;

-- 6. Lifecycle stage this objective advances (one of the seven loop stages).
alter table public.governance_objectives
  add column if not exists lifecycle_stage text;

-- 7. Draft → approved. NULL = pending operator approval (a specialist draft);
--    set when the operator accepts it into the live plan. Manual objectives are
--    approved on creation (the insert path stamps now()).
alter table public.governance_objectives
  add column if not exists approved_at timestamptz;

-- Foreign keys + value constraints, guarded so re-running is safe (Postgres has
-- no IF NOT EXISTS for ADD CONSTRAINT).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'governance_objectives_source_signal_id_fkey'
  ) then
    alter table public.governance_objectives
      add constraint governance_objectives_source_signal_id_fkey
      foreign key (source_signal_id) references public.market_signals (id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'governance_objectives_parent_objective_id_fkey'
  ) then
    alter table public.governance_objectives
      add constraint governance_objectives_parent_objective_id_fkey
      foreign key (parent_objective_id) references public.governance_objectives (id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'governance_objectives_category_check'
  ) then
    alter table public.governance_objectives
      add constraint governance_objectives_category_check
      check (category is null or category in ('capital', 'governance', 'compliance', 'execution'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'governance_objectives_source_check'
  ) then
    alter table public.governance_objectives
      add constraint governance_objectives_source_check
      check (source in ('manual', 'signal', 'lifecycle', 'cascade'));
  end if;
end $$;

-- Cover the new foreign keys so joins / parent-delete checks don't seq-scan.
create index if not exists idx_governance_objectives_source_signal_id
  on public.governance_objectives (source_signal_id);

create index if not exists idx_governance_objectives_parent_objective_id
  on public.governance_objectives (parent_objective_id);

-- Cheap partial index for the future "pending drafts" inbox query.
create index if not exists idx_governance_objectives_pending_drafts
  on public.governance_objectives (org_id)
  where approved_at is null and deleted_at is null;

comment on column public.governance_objectives.category is
  'Posture lane: capital | governance | compliance | execution. NULL = uncategorized.';
comment on column public.governance_objectives.capital_weight is
  'Value-at-stake multiplier for capital-weighted scoring. NULL = use priority proxy.';
comment on column public.governance_objectives.source is
  'Provenance: manual | signal | lifecycle | cascade.';
comment on column public.governance_objectives.source_signal_id is
  'market_signals row this objective was drafted from, when source = signal.';
comment on column public.governance_objectives.parent_objective_id is
  'Cascade parent — child objectives spawned when the parent is completed.';
comment on column public.governance_objectives.lifecycle_stage is
  'Lifecycle loop stage this objective advances.';
comment on column public.governance_objectives.approved_at is
  'When the operator approved this objective into the live plan. NULL = pending draft.';
