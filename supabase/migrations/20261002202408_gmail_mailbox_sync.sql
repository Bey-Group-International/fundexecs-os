-- Gmail mailbox sync: the org's connected mailbox reaches the inbox, and the
-- relationship timeline goes live.
--
-- Until now the only mail that reached inbox_threads came through the Resend
-- inbound webhook. The org's Gmail grant was send-only, so a conversation
-- somebody had in Gmail itself never reached the inbox, never reached the
-- contact's timeline, and never reached any report built from either.
--
-- 1. gmail_mailbox_sync — one row per org: the Gmail history cursor the hourly
--    sweep resumes from, and the state an operator needs to see when it stops
--    (a revoked grant, a grant made before the read scope existed). Written by
--    the service role only; members may read their own org's row.
--
-- 2. network_activities joins the realtime publication, so a contact record and
--    the report built on it update as mail and meetings land instead of on the
--    next reload. RLS still decides who receives what: realtime evaluates the
--    select policy per subscriber.

create table if not exists public.gmail_mailbox_sync (
  organization_id  uuid primary key references public.organizations (id) on delete cascade,
  mailbox_email    text,
  -- Gmail's historyId, as the string Gmail returns it (it exceeds 2^53).
  history_id       text,
  status           text not null default 'pending'
    check (status in ('pending', 'ok', 'needs_reconnect', 'error')),
  last_synced_at   timestamptz,
  last_error       text,
  consecutive_failures integer not null default 0,
  messages_ingested bigint not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.gmail_mailbox_sync is
  'Per-org Gmail read cursor for the hourly mailbox sweep (lib/integrations/gmail-sync). Service-role writes only.';

-- The sweep picks the stalest mailboxes first.
create index if not exists gmail_mailbox_sync_due_idx
  on public.gmail_mailbox_sync (last_synced_at asc nulls first);

drop trigger if exists gmail_mailbox_sync_set_updated_at on public.gmail_mailbox_sync;
create trigger gmail_mailbox_sync_set_updated_at
  before update on public.gmail_mailbox_sync
  for each row execute function public.set_updated_at();

alter table public.gmail_mailbox_sync enable row level security;

drop policy if exists gmail_mailbox_sync_select on public.gmail_mailbox_sync;
create policy gmail_mailbox_sync_select on public.gmail_mailbox_sync
  for select to authenticated
  using (organization_id in (select public.current_principal_org_ids()));

-- No insert/update/delete policies: only the service-role sweep writes here.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'network_activities'
     ) then
    alter publication supabase_realtime add table public.network_activities;
  end if;
end $$;
