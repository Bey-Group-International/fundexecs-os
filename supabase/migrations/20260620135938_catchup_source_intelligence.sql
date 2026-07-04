-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
create table if not exists public.source_feedback (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  principal_id    uuid references public.principals (id) on delete set null,
  module          text not null,
  agent           text,
  signal          text not null,
  subject_name    text not null,
  category        text,
  rationale       text,
  source_query    text,
  fit_score       integer,
  action          text,
  record_id       uuid,
  task_id         uuid references public.tasks (id) on delete set null,
  session_id      uuid references public.sessions (id) on delete set null,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
do $$ begin
  create index if not exists source_feedback_org_idx on public.source_feedback (organization_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  create index if not exists source_feedback_lookup_idx
  on public.source_feedback (organization_id, principal_id, module, created_at desc);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

alter table public.source_feedback enable row level security;

drop policy if exists source_feedback_select on public.source_feedback;
create policy source_feedback_select on public.source_feedback
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists source_feedback_write on public.source_feedback;
create policy source_feedback_write on public.source_feedback
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));;
