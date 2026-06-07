-- =====================================================================
-- Earn conversation persistence.
--
-- Stores the operator's Earn (AI COO) chat so the dock can restore the thread
-- on open and across devices. One flat, per-user rolling thread: each row is a
-- message with its role, content, and (for assistant turns) the brain sources
-- Earn cited. RLS scopes every row to its owner.
-- =====================================================================

create table if not exists public.earn_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  org_id uuid references public.organizations (id) on delete set null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  -- Brain/source citations for assistant turns: [{ brainId, snippet }].
  sources jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create index if not exists earn_messages_user_created_idx
  on public.earn_messages (user_id, created_at);

alter table public.earn_messages enable row level security;

-- A user reads and writes only their own messages.
drop policy if exists "own earn messages" on public.earn_messages;
create policy "own earn messages" on public.earn_messages
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
