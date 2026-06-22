-- 0057_outreach_sequences.sql
-- Outbound Outreach Sequences — multi-touch cadences (the Hypergen / CapTarget
-- core), built ON TOP of the existing gate + dispatch layer rather than beside
-- it. A sequence is an ordered set of steps (email / LinkedIn / call), each with
-- a delay and a gated ActionKind (lib/gates.ts). Targets are ENROLLED into a
-- sequence; advancing an enrollment computes the next due step and routes the
-- SEND through the same gate path the rest of Source uses (queueSourceAction →
-- gateDecision → lib/integrations dispatch). So Tier-1 steps dispatch
-- immediately and Tier-2/3 steps land in approvals — never a new uncontrolled
-- send path. The gate task id is recorded back on the enrollment (task_id).
--
-- This is the OUTREACH half of the cluster; the deal-network half (deal_shares,
-- ecosystem_matchmaking) already exists (0045 / 0046) and is not duplicated here.
--
-- Org-scoped, with the same member-read / writer-write RLS as dispatch_log
-- (0030). Fully idempotent (create … if not exists / drop policy if exists then
-- create) so a preview-branch replay is a no-op rather than an error.

-- ---------------------------------------------------------------------------
-- outreach_sequences — one named, multi-touch cadence for a channel + audience.
-- ---------------------------------------------------------------------------
create table if not exists public.outreach_sequences (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  -- 'email' | 'linkedin' | 'call' — the primary channel the cadence runs on.
  channel         text not null default 'email',
  -- free-text description of who this cadence targets (e.g. "anchor LPs").
  audience        text,
  -- 'draft' | 'active' | 'paused' | 'archived'.
  status          text not null default 'draft',
  metadata        jsonb not null default '{}'::jsonb,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists outreach_sequences_org_idx
  on public.outreach_sequences (organization_id);
create index if not exists outreach_sequences_org_status_idx
  on public.outreach_sequences (organization_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- outreach_steps — the ordered touches within a sequence. Each step names the
-- gated ActionKind (lib/gates.ts) the send maps to, so advancing routes through
-- the gate exactly like any other Source action.
-- ---------------------------------------------------------------------------
create table if not exists public.outreach_steps (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  sequence_id     uuid not null references public.outreach_sequences (id) on delete cascade,
  -- 1-based position of this touch within its sequence.
  step_order      integer not null default 1,
  -- days to wait after the prior step (0 = the first / immediate touch).
  delay_days      integer not null default 0,
  subject         text,
  body            text,
  -- an ActionKind label from lib/gates (e.g. 'send_outreach') — what the send is.
  action          text not null default 'send_outreach',
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists outreach_steps_org_idx
  on public.outreach_steps (organization_id);
create index if not exists outreach_steps_sequence_idx
  on public.outreach_steps (sequence_id, step_order);

-- ---------------------------------------------------------------------------
-- outreach_enrollments — one target's progress through a sequence. current_step
-- is how many steps have been sent; last_sent_at + task_id record the most
-- recent gated dispatch (task_id is the gate task from queueSourceAction).
-- ---------------------------------------------------------------------------
create table if not exists public.outreach_enrollments (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  sequence_id     uuid not null references public.outreach_sequences (id) on delete cascade,
  subject_name    text not null,
  subject_email   text,
  -- optional link to a sourcing_entities catalog row (0042) when the target came
  -- from discovery. Set null so the enrollment survives a removed entity.
  entity_id       uuid references public.sourcing_entities (id) on delete set null,
  -- count of steps already sent (0 = nothing sent yet; the next due step is
  -- current_step + 1 in 1-based step_order terms).
  current_step    integer not null default 0,
  -- 'active' | 'completed' | 'replied' | 'stopped'.
  status          text not null default 'active',
  last_sent_at    timestamptz,
  -- the gate task created for the most recent dispatched step.
  task_id         uuid references public.tasks (id) on delete set null,
  metadata        jsonb not null default '{}'::jsonb,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists outreach_enrollments_org_idx
  on public.outreach_enrollments (organization_id);
create index if not exists outreach_enrollments_sequence_idx
  on public.outreach_enrollments (sequence_id, status);
create index if not exists outreach_enrollments_org_status_idx
  on public.outreach_enrollments (organization_id, status, updated_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers (same set_updated_at used across the domain).
-- ---------------------------------------------------------------------------
drop trigger if exists outreach_sequences_set_updated_at on public.outreach_sequences;
create trigger outreach_sequences_set_updated_at
  before update on public.outreach_sequences
  for each row execute function public.set_updated_at();

drop trigger if exists outreach_enrollments_set_updated_at on public.outreach_enrollments;
create trigger outreach_enrollments_set_updated_at
  before update on public.outreach_enrollments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — member-read / writer-write org tenancy, exactly like dispatch_log (0030).
-- ---------------------------------------------------------------------------
alter table public.outreach_sequences enable row level security;
alter table public.outreach_steps enable row level security;
alter table public.outreach_enrollments enable row level security;

drop policy if exists outreach_sequences_select on public.outreach_sequences;
create policy outreach_sequences_select on public.outreach_sequences
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists outreach_sequences_write on public.outreach_sequences;
create policy outreach_sequences_write on public.outreach_sequences
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

drop policy if exists outreach_steps_select on public.outreach_steps;
create policy outreach_steps_select on public.outreach_steps
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists outreach_steps_write on public.outreach_steps;
create policy outreach_steps_write on public.outreach_steps
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

drop policy if exists outreach_enrollments_select on public.outreach_enrollments;
create policy outreach_enrollments_select on public.outreach_enrollments
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists outreach_enrollments_write on public.outreach_enrollments;
create policy outreach_enrollments_write on public.outreach_enrollments
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
