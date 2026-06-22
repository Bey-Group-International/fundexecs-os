-- 0053_session_messages.sql
-- Persists Earn's conversational turns (the chat answer path) so they survive a
-- reload and become part of the session transcript — the workflow turns already
-- persist as tasks; this does the same for plain Q&A. One row per turn, ordered
-- by created_at. Chat answers are advisory information (ungated), so there is no
-- approval state here — just the message text.

create table if not exists public.session_messages (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id      uuid not null references public.sessions (id) on delete cascade,
  -- 'user' is the operator's message; 'assistant' is Earn's reply.
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  -- Reasoning engine that produced an assistant reply (style hint); null for user turns.
  model           text,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists session_messages_session_idx
  on public.session_messages (session_id, created_at);

-- RLS — member-read / writer-write org tenancy, as elsewhere.
alter table public.session_messages enable row level security;

drop policy if exists session_messages_select on public.session_messages;
create policy session_messages_select on public.session_messages
  for select using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists session_messages_write on public.session_messages;
create policy session_messages_write on public.session_messages
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
