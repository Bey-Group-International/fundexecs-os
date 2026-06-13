-- =====================================================================
-- Earn outcomes — the compounding ledger.
--
-- Additive + idempotent. Backend/data only. Introduces `earn_outcomes`:
-- one row per approved Earn action. Today the approve loop writes a
-- `trust_events` audit row and then evaporates from the operator's view
-- when the dock closes. This table is the durable, searchable record of
-- everything the executive team produced — the `/earn` ledger reads it.
--
-- Each row carries its full provenance so the work is both reusable and
-- provable:
--   · specialist_slug  — which desk produced it (the routing attribution)
--   · home_surface/href — where the outcome landed (the fan-out target)
--   · trust_event_id    — the Chain-of-Trust audit row it wrote
--   · entity_type/id    — what it acted on
--
-- The table is empty until the approve loop starts writing to it (see
-- lib/actions/earn-actions.ts). The /earn surface renders a tasteful empty
-- state until then. Nothing here touches an existing surface.
-- =====================================================================

create table if not exists public.earn_outcomes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- Who approved it. Set null (not cascade) so removing a member never
  -- destroys the firm's record of the work they approved.
  actor_id uuid references public.profiles (id) on delete set null,
  -- What kind of outcome — drives the ledger's filter chips + iconography.
  kind text not null,
  -- The desk that produced it, by roster slug (e.g. 'deal-sourcer'). The
  -- routing attribution that turns the ledger into institutional memory.
  specialist_slug text not null,
  title text not null,
  summary text,
  -- Where the outcome fanned out to — the home surface it now lives on, so
  -- the operator can jump straight from the ledger to the live record.
  home_surface text,
  home_href text,
  -- Soft provenance onto the Chain of Trust. Set null (not cascade) so the
  -- ledger row survives even if the audit row is ever pruned.
  trust_event_id uuid references public.trust_events (id) on delete set null,
  -- What it acted on (deal id, diligence run id, …). Text for flexibility
  -- across entity types.
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.earn_outcomes'::regclass
      and conname = 'earn_outcomes_kind_valid'
  ) then
    alter table public.earn_outcomes
      add constraint earn_outcomes_kind_valid
      check (kind in (
        'deal_sourced',
        'diligence_run',
        'lp_letter',
        'reactivation',
        'meeting_notes',
        'closing_opened',
        'data_room_grant',
        'target_scored'
      ));
  end if;
end$$;

-- The ledger view: newest first, scoped to the org.
create index if not exists earn_outcomes_org_created_idx
  on public.earn_outcomes (org_id, created_at desc);

-- Cheap per-kind filtered reads (the filter chips).
create index if not exists earn_outcomes_org_kind_idx
  on public.earn_outcomes (org_id, kind);

alter table public.earn_outcomes enable row level security;

revoke all on table public.earn_outcomes from anon, authenticated;
grant select, insert on table public.earn_outcomes to authenticated;
grant select, insert, update on table public.earn_outcomes to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'earn_outcomes'
      and policyname = 'members read earn_outcomes'
  ) then
    create policy "members read earn_outcomes"
      on public.earn_outcomes
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'earn_outcomes'
      and policyname = 'members append earn_outcomes'
  ) then
    create policy "members append earn_outcomes"
      on public.earn_outcomes
      for insert to authenticated
      with check (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'earn_outcomes'
      and policyname = 'service_role writes earn_outcomes'
  ) then
    create policy "service_role writes earn_outcomes"
      on public.earn_outcomes
      for all to service_role
      using (true)
      with check (true);
  end if;
end$$;
