-- =====================================================================
-- Phase 7: Meeting Copilot — multi-agent meeting analysis (RUN verb).
--
-- Additive + idempotent. Mirrors the diligence_runs / diligence_findings
-- RLS pattern exactly: members SELECT by org, service_role writes only.
--
-- Tables:
--   meeting_runs    — one row per analysis; carries the final sentiment,
--                     commitment_probability, and summary.
--   meeting_findings — one finding row per agent (objection_analyst,
--                     sentiment_scorer, action_mapper, synthesis).
-- =====================================================================

-- 1. meeting_runs -------------------------------------------------------
create table if not exists public.meeting_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'queued',
  sentiment text,
  commitment_probability integer,
  summary text,
  contact_name text,
  deal_id uuid references public.deals (id) on delete set null,
  created_at timestamp with time zone not null default now(),
  unique (id, org_id)
);

-- 2. meeting_findings ---------------------------------------------------
create table if not exists public.meeting_findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  agent text not null,
  score integer,
  summary text not null,
  detail text,
  citations jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone not null default now(),
  foreign key (run_id, org_id)
    references public.meeting_runs (id, org_id)
    on delete cascade
);

-- 3. Constraints (idempotent) -------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'meeting_runs_status_check') then
    alter table public.meeting_runs
      add constraint meeting_runs_status_check
      check (status in ('queued', 'running', 'complete', 'error'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'meeting_runs_sentiment_check') then
    alter table public.meeting_runs
      add constraint meeting_runs_sentiment_check
      check (sentiment is null or sentiment in ('positive', 'neutral', 'negative'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'meeting_runs_commitment_check') then
    alter table public.meeting_runs
      add constraint meeting_runs_commitment_check
      check (commitment_probability is null or commitment_probability between 0 and 100);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'meeting_findings_agent_check') then
    alter table public.meeting_findings
      add constraint meeting_findings_agent_check
      check (agent in ('objection_analyst', 'sentiment_scorer', 'action_mapper', 'synthesis'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'meeting_findings_score_check') then
    alter table public.meeting_findings
      add constraint meeting_findings_score_check
      check (score is null or score between 0 and 100);
  end if;
end$$;

-- 4. Indexes ------------------------------------------------------------
create index if not exists meeting_runs_org_id_idx
  on public.meeting_runs (org_id, created_at desc);
create index if not exists meeting_runs_deal_id_idx
  on public.meeting_runs (deal_id);
create index if not exists meeting_findings_run_id_idx
  on public.meeting_findings (run_id, agent);
create index if not exists meeting_findings_org_id_idx
  on public.meeting_findings (org_id);

-- 5. Row Level Security -------------------------------------------------
alter table public.meeting_runs enable row level security;
alter table public.meeting_findings enable row level security;

revoke all on table public.meeting_runs from anon, authenticated;
revoke all on table public.meeting_findings from anon, authenticated;

grant select on table public.meeting_runs to authenticated;
grant select on table public.meeting_findings to authenticated;

grant select, insert, update, delete on table public.meeting_runs to service_role;
grant select, insert, update, delete on table public.meeting_findings to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'meeting_runs' and policyname = 'members read meeting_runs'
  ) then
    create policy "members read meeting_runs" on public.meeting_runs
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'meeting_runs' and policyname = 'service_role insert meeting_runs'
  ) then
    create policy "service_role insert meeting_runs" on public.meeting_runs
      for insert to service_role
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'meeting_runs' and policyname = 'service_role update meeting_runs'
  ) then
    create policy "service_role update meeting_runs" on public.meeting_runs
      for update to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'meeting_findings' and policyname = 'members read meeting_findings'
  ) then
    create policy "members read meeting_findings" on public.meeting_findings
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'meeting_findings' and policyname = 'service_role insert meeting_findings'
  ) then
    create policy "service_role insert meeting_findings" on public.meeting_findings
      for insert to service_role
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'meeting_findings' and policyname = 'service_role update meeting_findings'
  ) then
    create policy "service_role update meeting_findings" on public.meeting_findings
      for update to service_role
      using (true)
      with check (true);
  end if;
end$$;
