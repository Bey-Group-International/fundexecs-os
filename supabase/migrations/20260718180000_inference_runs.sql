-- 20260718180000_inference_runs.sql
-- The inference-run telemetry ledger — a durable, append-only accountability
-- record for every inference-gateway call (lib/inference/gateway.ts). Providers
-- (Anthropic / OpenAI / Google / local) are interchangeable behind the gateway
-- seam; this table is how an org proves, after the fact, which provider + model
-- actually served each capability request, at what token/latency cost, and
-- whether the call degraded to a deterministic fallback.
--
-- One row = one runInference() call. It records the requested capability (null
-- for a pinned-model call), the resolved provider + model (null when degraded),
-- the requested tier + data sensitivity, the ok/degraded outcome, token usage,
-- latency, a caller-supplied purpose label, and the session / workflow task it
-- ran under. Org-scoped, member-read / writer-write RLS, same tenancy as the
-- rest of the domain. Idempotent so a preview-branch replay is a no-op.
--
-- IMMUTABLE LEDGER: like dispatch_log, this is append-only telemetry — there is
-- no updated_at column and no set_updated_at trigger; rows are never mutated.

create table if not exists public.inference_runs (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  -- The requested InferenceCapability (nullable — a pinned-model call has none).
  capability        text,
  -- The resolved provider key + model id (both null when degraded / no provider).
  provider          text,
  model             text,
  -- The optional requested tier + data sensitivity (public / internal / restricted).
  prefer_tier       text,
  sensitivity       text,
  -- Outcome: ok = provider returned text; degraded = fell back (no provider/model).
  ok                boolean not null default false,
  degraded          boolean not null default false,
  -- Token + latency telemetry.
  input_tokens      integer not null default 0,
  output_tokens     integer not null default 0,
  latency_ms        integer not null default 0,
  -- Caller-supplied label, e.g. "plan_generation", "skill:ic-memo" (nullable).
  purpose           text,
  -- The operating session + workflow task this ran under (both optional).
  session_id        uuid references public.sessions (id) on delete set null,
  workflow_task_id  uuid references public.tasks (id) on delete set null,
  error             text,
  created_by        uuid references public.principals (id) on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists inference_runs_org_created_idx
  on public.inference_runs (organization_id, created_at desc);
create index if not exists inference_runs_org_provider_model_idx
  on public.inference_runs (organization_id, provider, model);
create index if not exists inference_runs_org_capability_idx
  on public.inference_runs (organization_id, capability);

-- No set_updated_at trigger — immutable append-only ledger (see header).

-- RLS — member-read / writer-write org tenancy, as elsewhere.
alter table public.inference_runs enable row level security;

drop policy if exists inference_runs_select on public.inference_runs;
create policy inference_runs_select on public.inference_runs
  for select using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists inference_runs_write on public.inference_runs;
create policy inference_runs_write on public.inference_runs
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- Not added to supabase_realtime — a telemetry ledger is queried after the fact
-- for accountability/reporting; it needs no live subscription.
