-- 0023_brains.sql
-- The Brain layer — the execution tier that sits between Workflows and Modules.
-- A Workflow ACTIVATES a Brain (goal + context + tools + constraints); the Brain
-- decides which modules/tools to run. This migration adds the two persistence
-- surfaces the layer needs:
--
--   brain_runs       — an audit + session-visualization log: every activation
--                      records the brain, goal, autonomy mode, tools used,
--                      reasoning, and output. Powers the "Brains at work" view
--                      inside a session and the institutional audit trail.
--   brain_documents  — pasted/uploaded source text the Diligence Brain reasons
--                      over (decks, CIMs, PPMs, call notes). Kept separate from
--                      the storage-oriented `documents` table so the inline text
--                      a Brain ingests has a clean, session-scoped home.
--
-- Both follow the same member-read / writer-write org tenancy as the rest of the
-- domain, and are session-scoped (nullable) so a Brain's work can surface inside
-- the session that produced it.

create table public.brain_runs (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id      uuid references public.sessions (id) on delete set null,
  brain_key       text not null,
  goal            text not null,
  autonomy_mode   text not null default 'manual',  -- manual | semi | auto
  status          text not null default 'completed', -- pending | running | awaiting_approval | completed | failed
  input           jsonb,
  output          jsonb,
  tools_used      text[],
  reasoning       text,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index brain_runs_org_idx on public.brain_runs (organization_id, created_at desc);
create index brain_runs_session_idx on public.brain_runs (session_id);
create index brain_runs_brain_idx on public.brain_runs (brain_key);

alter table public.brain_runs enable row level security;

create policy brain_runs_select on public.brain_runs
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy brain_runs_write on public.brain_runs
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

create table public.brain_documents (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id      uuid references public.sessions (id) on delete set null,
  name            text not null,
  doc_type        text,  -- deck | cim | ppm | lp_list | call_notes | financials | submission | other
  content         text not null,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index brain_documents_org_idx on public.brain_documents (organization_id, created_at desc);
create index brain_documents_session_idx on public.brain_documents (session_id);

alter table public.brain_documents enable row level security;

create policy brain_documents_select on public.brain_documents
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy brain_documents_write on public.brain_documents
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
