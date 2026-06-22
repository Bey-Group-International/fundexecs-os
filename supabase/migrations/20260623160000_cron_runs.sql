-- 20260623160000_cron_runs.sql
-- The cron-run ledger — last-run tracking so the scheduled pipeline's liveness is
-- observable. Three cron entrypoints drive the loop: /api/cron (hourly:
-- automations sweep + radar signal scan + SLA escalation), /api/digest (daily
-- act-now digest), /api/digest/weekly (weekly funnel rollup). Each appends one
-- row here at the end of its run, best-effort, so operators can see whether the
-- pipeline actually runs (and how stale each job is).
--
-- This is an OPS table, NOT org-scoped: the cron sweeps run without a user
-- session under the service role and span every org, so there is no single
-- organization_id to key tenancy on. Tenancy therefore differs from the rest of
-- the domain (which is member-read / writer-write per org): like the shared
-- brain_kb_chunks corpus (0024), RLS allows ANY authenticated user to read (so
-- any signed-in member can see pipeline health), and there is NO write policy —
-- rows are recorded only via the service role, which bypasses RLS. No
-- public/anon access.
--
-- Uses the repo's go-forward timestamp migration naming (not a 00NN prefix) to
-- avoid out-of-order/duplicate-prefix collisions across parallel branches.

create table if not exists public.cron_runs (
  id          uuid primary key default extensions.gen_random_uuid(),
  -- which cron entrypoint ran: 'cron' | 'digest' | 'digest_weekly'.
  job         text not null,
  -- terminal outcome of the run: 'ok' | 'error'.
  status      text not null,
  -- a small per-run summary (counts: swept, escalated, digests sent, …).
  detail      jsonb,
  -- when the route began (captured at entry) and finished (defaults to now()).
  started_at  timestamptz,
  finished_at timestamptz not null default now()
);

-- Latest-run-per-job lookups (the health surface) read newest-first per job.
create index if not exists cron_runs_job_finished_idx
  on public.cron_runs (job, finished_at desc);

-- RLS: org-agnostic ops table. Readable by any authenticated principal so any
-- signed-in member can see pipeline health; written only by the service role
-- (which bypasses RLS), so there is intentionally no write policy. No anon.
alter table public.cron_runs enable row level security;

-- CREATE POLICY has no IF NOT EXISTS, so drop-then-create to stay idempotent.
drop policy if exists cron_runs_select on public.cron_runs;
create policy cron_runs_select on public.cron_runs
  for select to authenticated using (true);
