-- 20260705150000_earn_browser_operator.sql
--
-- EPIC #2 — Earn Controlled Browser-Operator layer (Phase-1 foundation).
--
-- The durable, org-scoped, RLS-protected substrate for letting Earn drive a
-- browser on the operator's behalf SAFELY: an explicit session state machine, a
-- review-before-save queue, and an append-only audit trail. The live browser
-- driver and extraction are application-layer seams — this migration only owns
-- the permission + audit model.
--
--   1. earn_browser_sessions   — one row per browser task, tracking its status
--      through the lifecycle, the approved scope, the auth-handoff state, and
--      the save / external-action gate flags.
--   2. earn_browser_audit_logs — append-only record of everything Earn did.
--   3. earn_review_queue        — extracted data awaiting field-level operator
--      review; nothing is saved into the system until a row here is approved.
--
-- RLS mirrors 20260705120000_professional_network_layer.sql: reads/writes are
-- scoped to the caller's orgs via current_principal_org_ids(), and inserts tie
-- the acting principal to (select auth.uid()).

-- ── 1. earn_browser_sessions ────────────────────────────────────────────────

create table if not exists public.earn_browser_sessions (
  id                        uuid primary key default extensions.gen_random_uuid(),
  organization_id           uuid not null references public.organizations (id) on delete cascade,
  user_id                   uuid not null references public.principals (id) on delete cascade,
  -- Optional link to a task-engine task that spawned this session.
  task_id                   uuid,
  status                    text not null default 'planned'
                              check (status in (
                                'planned','awaiting_user_approval','opening_browser',
                                'navigating','paused_for_user_auth','user_auth_completed',
                                'extracting','normalizing','awaiting_user_review',
                                'approved_for_save','saved','rejected','cancelled','failed'
                              )),
  requested_prompt          text not null,
  -- The operator-approvable scope card (permitted sources/actions + gates).
  approved_scope            jsonb,
  requires_user_auth        boolean not null default false,
  auth_handoff_completed    boolean not null default false,
  current_url               text,
  -- Review-before-save is on by default and cannot be silently bypassed.
  review_required           boolean not null default true,
  save_approved             boolean not null default false,
  external_action_approved  boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  completed_at              timestamptz
);

create index if not exists earn_browser_sessions_org_idx
  on public.earn_browser_sessions (organization_id, status);
create index if not exists earn_browser_sessions_user_idx
  on public.earn_browser_sessions (user_id);

create trigger earn_browser_sessions_set_updated_at
  before update on public.earn_browser_sessions
  for each row execute function public.set_updated_at();

alter table public.earn_browser_sessions enable row level security;

create policy earn_browser_sessions_select on public.earn_browser_sessions
  for select to authenticated
  using (organization_id in (select public.current_principal_org_ids()));

create policy earn_browser_sessions_insert on public.earn_browser_sessions
  for insert to authenticated
  with check (
    organization_id in (select public.current_principal_org_ids())
    and user_id = (select auth.uid())
  );

create policy earn_browser_sessions_update on public.earn_browser_sessions
  for update to authenticated
  using (organization_id in (select public.current_principal_org_ids()))
  with check (organization_id in (select public.current_principal_org_ids()));

create policy earn_browser_sessions_delete on public.earn_browser_sessions
  for delete to authenticated
  using (organization_id in (select public.current_principal_org_ids()));

-- ── 2. earn_browser_audit_logs ──────────────────────────────────────────────
-- Append-only trail. Rows are never updated or deleted directly (no update
-- policy); the parent session cascade-deletes them.

create table if not exists public.earn_browser_audit_logs (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  session_id       uuid not null references public.earn_browser_sessions (id) on delete cascade,
  user_id          uuid references public.principals (id) on delete set null,
  action           text not null,
  url              text,
  source_type      text,
  summary          text,
  created_at       timestamptz not null default now()
);

create index if not exists earn_browser_audit_logs_session_idx
  on public.earn_browser_audit_logs (session_id, created_at);
create index if not exists earn_browser_audit_logs_org_idx
  on public.earn_browser_audit_logs (organization_id, created_at);

alter table public.earn_browser_audit_logs enable row level security;

create policy earn_browser_audit_logs_select on public.earn_browser_audit_logs
  for select to authenticated
  using (organization_id in (select public.current_principal_org_ids()));

create policy earn_browser_audit_logs_insert on public.earn_browser_audit_logs
  for insert to authenticated
  with check (
    organization_id in (select public.current_principal_org_ids())
    and user_id = (select auth.uid())
  );

-- ── 3. earn_review_queue ─────────────────────────────────────────────────────
-- Extracted data awaiting field-level operator review. `fields` holds the
-- ExtractedDataPoint[] with per-field decisions. Nothing is saved into the
-- system until a row here is 'approved'.

create table if not exists public.earn_review_queue (
  id                    uuid primary key default extensions.gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  session_id            uuid not null references public.earn_browser_sessions (id) on delete cascade,
  -- Where the approved data would land (e.g. 'network_contact').
  proposed_destination  text,
  fields                jsonb not null default '[]'::jsonb,
  status                text not null default 'pending'
                          check (status in ('pending','approved','rejected')),
  decided_by            uuid references public.principals (id) on delete set null,
  decided_at            timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists earn_review_queue_session_idx
  on public.earn_review_queue (session_id, status);
create index if not exists earn_review_queue_org_idx
  on public.earn_review_queue (organization_id, status);

alter table public.earn_review_queue enable row level security;

create policy earn_review_queue_select on public.earn_review_queue
  for select to authenticated
  using (organization_id in (select public.current_principal_org_ids()));

create policy earn_review_queue_insert on public.earn_review_queue
  for insert to authenticated
  with check (
    organization_id in (select public.current_principal_org_ids())
    -- Born pending: nothing enters the queue already decided.
    and status = 'pending'
  );

create policy earn_review_queue_update on public.earn_review_queue
  for update to authenticated
  using (organization_id in (select public.current_principal_org_ids()))
  with check (organization_id in (select public.current_principal_org_ids()));

create policy earn_review_queue_delete on public.earn_review_queue
  for delete to authenticated
  using (organization_id in (select public.current_principal_org_ids()));
