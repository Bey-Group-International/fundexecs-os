-- Market Pulse: a daily, mandate-matched feed of deals, investment
-- opportunities, and investors that Earn finds on the live web.
--
--   1. pulse_items — what Earn found. One row per opportunity, with Earn's
--      short take, why it fits the mandate, and the source it came from. An
--      operator adds it to the pipeline, asks Earn about it, or dismisses it;
--      dismissals feed back into later sweeps so the feed learns what to skip.
--   2. pulse_runs — one row per sweep (daily cron or a manual Refresh). It is
--      the cost ledger for the per-org daily web-search cap: the sweep sums
--      `searches` over the last 24 hours before it spends any more.
--
-- The unique (organization_id, dedupe_key) index makes a repeat finding a
-- no-op decided by the database, so overlapping sweeps can't double-post.

-- ── 1. pulse_items ───────────────────────────────────────────────────────────

create table if not exists public.pulse_items (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,

  -- deal: a company or asset raising or for sale; investment: a fund, co-invest,
  -- or other opportunity to deploy into; investor: an LP or allocator that fits
  -- the firm's raise.
  kind              text not null check (kind in ('deal', 'investment', 'investor')),
  entity_name       text not null,
  headline          text not null,
  take              text,
  why_it_fits       text,
  source_url        text,
  source_title      text,
  fit_score         integer check (fit_score between 0 and 100),
  -- Normalized entity name: what makes two findings "the same" opportunity.
  dedupe_key        text not null,

  status            text not null default 'new' check (status in ('new', 'added', 'dismissed')),
  -- Set when the item was added to the pipeline: which record it became.
  added_record_type text check (added_record_type in ('deal', 'investor')),
  added_record_id   uuid,
  acted_by          uuid references public.principals (id) on delete set null,
  acted_at          timestamptz,

  run_id            uuid,
  created_at        timestamptz not null default now()
);

create unique index if not exists pulse_items_org_dedupe_key
  on public.pulse_items (organization_id, dedupe_key);
create index if not exists pulse_items_org_status_created
  on public.pulse_items (organization_id, status, created_at desc);

comment on table public.pulse_items is
  'Market Pulse findings: mandate-matched deals, investments, and investors Earn found on the web.';

alter table public.pulse_items enable row level security;

-- Members read and triage their org's feed. Rows are written by the sweep
-- (service role) or by a member's manual Refresh, both org-scoped.
drop policy if exists pulse_items_select on public.pulse_items;
create policy pulse_items_select on public.pulse_items
  for select to authenticated
  using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists pulse_items_insert on public.pulse_items;
create policy pulse_items_insert on public.pulse_items
  for insert to authenticated
  with check (organization_id in (select public.current_principal_org_ids()));

drop policy if exists pulse_items_update on public.pulse_items;
create policy pulse_items_update on public.pulse_items
  for update to authenticated
  using (organization_id in (select public.current_principal_org_ids()))
  with check (organization_id in (select public.current_principal_org_ids()));

-- ── 2. pulse_runs ────────────────────────────────────────────────────────────

create table if not exists public.pulse_runs (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  trigger          text not null check (trigger in ('sweep', 'manual')),
  status           text not null check (status in ('ok', 'skipped', 'failed')),
  -- Why a run was skipped or failed (no mandate, cap reached, out of credits).
  detail           text,
  searches         integer not null default 0 check (searches >= 0),
  items_found      integer not null default 0 check (items_found >= 0),
  started_by       uuid references public.principals (id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists pulse_runs_org_created
  on public.pulse_runs (organization_id, created_at desc);

comment on table public.pulse_runs is
  'One row per Market Pulse sweep; the ledger behind the per-org daily web-search cap.';

alter table public.pulse_runs enable row level security;

drop policy if exists pulse_runs_select on public.pulse_runs;
create policy pulse_runs_select on public.pulse_runs
  for select to authenticated
  using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists pulse_runs_insert on public.pulse_runs;
create policy pulse_runs_insert on public.pulse_runs
  for insert to authenticated
  with check (organization_id in (select public.current_principal_org_ids()));
