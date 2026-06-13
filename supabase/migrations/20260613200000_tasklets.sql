-- =====================================================================
-- Tasklets — the signal-armed, approve-ready work queue.
--
-- Additive + idempotent. Backend/data only. Introduces `tasklets`: one
-- row per real, observed signal that the executive team has shaped into a
-- pre-drafted, approve-ready action. A tasklet is the atomic unit of the
-- firm's work (see docs/EARN_LIFECYCLE_EXPANSION.md §3):
--
--   one real signal → one routed draft → one approval → one provable record
--
-- The queue is fed by `refreshTasklets` (lib/tasklets/queries.ts), which
-- evaluates three honest signal sources the operator already produces —
-- the relationship inbox (`inbox_items`), the operating-loop telemetry
-- (`loop_events`), and the public inbound funnel (`deal_submissions` /
-- `deal_interest_captures`) — and upserts one tasklet per observed signal.
--
-- Honest-data rule: a tasklet only ever exists because a real row exists.
-- `dedupe_key` (unique per org) makes the evaluation idempotent — a signal
-- can never produce two tasklets, and a dismissed/approved tasklet never
-- re-appears, because its key stays on the record.
--
-- Draft-only: nothing here executes. Approval routes through the existing
-- approve loop (lib/earn/record-outcome.ts) and lands one `earn_outcomes`
-- row + one `trust_events` audit row — the same chokepoint Earn already
-- uses. The table is empty until the queue runs; surfaces render a
-- tasteful empty state until then. Nothing here touches an existing table.
-- =====================================================================

create table if not exists public.tasklets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- pending → the operator hasn't decided yet; approved/dismissed are terminal.
  status text not null default 'pending',
  -- Which honest signal source armed this tasklet.
  signal_source text not null,
  -- Idempotency key: one tasklet per observed signal (e.g. 'inbox:<uuid>').
  -- Unique per org — the evaluator upserts on conflict, so re-running it
  -- never duplicates, and a decided tasklet never resurfaces.
  dedupe_key text not null,
  -- The outcome it will produce on approval — maps 1:1 to earn_outcomes.kind.
  kind text not null,
  -- The desk that owns it, by roster slug (the routing attribution).
  specialist_slug text not null,
  title text not null,
  -- The approve-ready draft the operator reads before deciding.
  draft text,
  -- Plain-language provenance — "why now", stated honestly.
  signal_summary text,
  -- Where the approved outcome fans out to.
  home_surface text,
  home_href text,
  -- What the signal acted on (inbox_item id, deal id, submission id, …).
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  -- Set when the operator decides.
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamp with time zone,
  -- Soft link to the Chain-of-Trust row written on approval (provability).
  outcome_trust_event_id uuid references public.trust_events (id) on delete set null,
  created_at timestamp with time zone not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tasklets'::regclass and conname = 'tasklets_status_valid'
  ) then
    alter table public.tasklets add constraint tasklets_status_valid
      check (status in ('pending', 'approved', 'dismissed'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tasklets'::regclass and conname = 'tasklets_signal_source_valid'
  ) then
    alter table public.tasklets add constraint tasklets_signal_source_valid
      check (signal_source in ('inbox', 'loop_event', 'public_surface'));
  end if;

  -- Kinds mirror the earn_outcomes_kind_valid constraint exactly, so an
  -- approved tasklet always lands a valid ledger row.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tasklets'::regclass and conname = 'tasklets_kind_valid'
  ) then
    alter table public.tasklets add constraint tasklets_kind_valid
      check (kind in (
        'deal_sourced', 'diligence_run', 'lp_letter', 'reactivation',
        'meeting_notes', 'closing_opened', 'data_room_grant', 'target_scored'
      ));
  end if;
end$$;

-- Idempotent evaluation: one tasklet per observed signal, per org.
create unique index if not exists tasklets_org_dedupe_idx
  on public.tasklets (org_id, dedupe_key);

-- The queue read: pending first, newest first, scoped to the org.
create index if not exists tasklets_org_status_created_idx
  on public.tasklets (org_id, status, created_at desc);

alter table public.tasklets enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tasklets'
      and policyname = 'members read tasklets'
  ) then
    create policy "members read tasklets"
      on public.tasklets for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tasklets'
      and policyname = 'members append tasklets'
  ) then
    create policy "members append tasklets"
      on public.tasklets for insert to authenticated
      with check (private.is_org_member(org_id));
  end if;

  -- Members decide (approve/dismiss) tasklets in their own org.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tasklets'
      and policyname = 'members decide tasklets'
  ) then
    create policy "members decide tasklets"
      on public.tasklets for update to authenticated
      using (private.is_org_member(org_id))
      with check (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tasklets'
      and policyname = 'service_role writes tasklets'
  ) then
    create policy "service_role writes tasklets"
      on public.tasklets for all to service_role
      using (true) with check (true);
  end if;
end$$;
