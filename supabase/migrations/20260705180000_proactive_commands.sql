-- 20260705180000_proactive_commands.sql
-- The Proactive Initiative layer — Earn's self-authored Commands.
--
-- Where a normal workflow starts from an operator prompt, a proactive_command
-- starts from a SIGNAL nobody asked about (an LP going cold, a stale mark, a
-- sub-doc expiring). Earn runs it through the SAME loop and gates: it prioritizes
-- against a trust budget (lib/proactive/prioritize.ts), authors a Command,
-- pre-runs the draftable work, and surfaces the finished item on the Report
-- dashboard for approve / edit / dismiss / snooze. Those verdicts are the
-- training signal the trust budget decays on (lib/proactive/learn.ts).
--
-- One row = one surfaced proactive item. It links to the workflow Earn authored
-- (tasks) and the pre-run draft (artifacts). Org-scoped, member-read /
-- writer-write RLS, same tenancy as the rest of the domain. Fully idempotent so
-- a preview-branch replay is a no-op.

create table if not exists public.proactive_commands (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  -- the trigger that produced this (lib/proactive/triggers) — drives learning.
  trigger_key       text not null,
  hub               text not null,
  -- 'internal' (raise state) | 'market' (external intelligence-grounded).
  signal_class      text not null default 'internal'
                      check (signal_class in ('internal', 'market')),
  -- the subject the signal is about (polymorphic; no FK).
  subject_type      text,
  subject_id        uuid,
  subject_name      text not null,
  title             text not null,
  rationale         text,
  -- prioritizer inputs/output (0–100 except blast_radius 1–3).
  urgency           integer not null default 0,
  confidence        integer not null default 0,
  blast_radius      integer not null default 2 check (blast_radius between 1 and 3),
  priority          integer not null default 0,
  status            text not null default 'surfaced'
                      check (status in ('surfaced', 'approved', 'dismissed', 'snoozed', 'expired')),
  -- the Command Earn authored + pre-ran for the draft.
  workflow_id       uuid references public.tasks (id) on delete set null,
  -- the pre-run draft deliverable, ready for approve/edit/send.
  draft_artifact_id uuid references public.artifacts (id) on delete set null,
  -- the outward ActionKind (lib/gates.ts) the approval would authorize.
  send_action       text not null default 'send_outreach',
  -- PMI claims embedded in the draft, each with source + as-of + confidence.
  claims            jsonb not null default '[]'::jsonb,
  snooze_until      timestamptz,
  decided_by        uuid references public.principals (id) on delete set null,
  decided_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists proactive_commands_org_status_idx
  on public.proactive_commands (organization_id, status, priority desc);
-- Learning aggregates over (org, trigger_key, status) — index the path.
create index if not exists proactive_commands_org_trigger_idx
  on public.proactive_commands (organization_id, trigger_key);

create trigger proactive_commands_set_updated_at
  before update on public.proactive_commands
  for each row execute function public.set_updated_at();

-- RLS: same member-read / writer-write org tenancy as the rest of the domain.
alter table public.proactive_commands enable row level security;

-- CREATE POLICY has no IF NOT EXISTS, so drop-then-create to stay idempotent.
drop policy if exists proactive_commands_select on public.proactive_commands;
create policy proactive_commands_select on public.proactive_commands
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists proactive_commands_write on public.proactive_commands;
create policy proactive_commands_write on public.proactive_commands
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
