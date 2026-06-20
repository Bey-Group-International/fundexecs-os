-- 0038_source_intelligence.sql
-- The Source learning ledger. Every time an operator acts on an AI suggestion —
-- accepts a sourced candidate, skips one, or queues a recommended move — one
-- append-only row is written here. lib/source-intelligence.ts distills these
-- rows, per organization AND per user, into a short "learned preferences" digest
-- that is injected back into every Source prompt (lib/source-ai.ts ->
-- OperatorContext.learned). That closes the loop: the more the operator works
-- the surface, the more its suggestions reflect what THEY actually accept.
--
-- This is in-context learning (no model fine-tuning). The table deliberately
-- stores the candidate's text (subject_name, category, rationale, source_query)
-- so a future semantic-recall pass can embed these rows without a schema change.
--
-- Append-only, like dispatch_log (0030): rows are never updated or deleted by the
-- app, so there is no updated_at / trigger.

create table public.source_feedback (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- the operator whose behavior this records — the per-user personalization key.
  -- Nullable + set null so feedback survives a removed principal (org signal kept).
  principal_id    uuid references public.principals (id) on delete set null,
  -- full module key, e.g. "source/lp_pipeline", and the owning agent.
  module          text not null,
  agent           text,
  -- 'accepted' (added to pipeline) | 'rejected' (surfaced but skipped) |
  -- 'queued' (recommended action sent through the gate).
  signal          text not null,
  -- what the signal is about: the candidate/row name + its category/type.
  subject_name    text not null,
  category        text,
  -- the AI rationale and the operator's originating request — kept as text so a
  -- later embedding/recall pass can vectorize them with no migration.
  rationale       text,
  source_query    text,
  -- 0–100 fit at the time, and (for 'queued') the recommended ActionKind.
  fit_score       integer,
  action          text,
  -- the created/affected row + the task/session this came from, when known.
  record_id       uuid,
  task_id         uuid references public.tasks (id) on delete set null,
  session_id      uuid references public.sessions (id) on delete set null,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index source_feedback_org_idx on public.source_feedback (organization_id);
-- The digest reads the most-recent feedback for an org+user+module with this index.
create index source_feedback_lookup_idx
  on public.source_feedback (organization_id, principal_id, module, created_at desc);

-- RLS: same member-read / writer-write org tenancy as the rest of the domain.
alter table public.source_feedback enable row level security;

create policy source_feedback_select on public.source_feedback
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy source_feedback_write on public.source_feedback
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
