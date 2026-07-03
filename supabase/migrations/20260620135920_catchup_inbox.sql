-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'inbox_channel') then
    create type inbox_channel as enum ('gmail','slack','calendly','google_calendar','zoom','google_meet','docusign');
  end if;
  if not exists (select 1 from pg_type where typname = 'inbox_category') then
    create type inbox_category as enum ('messaging','booking','video','signing');
  end if;
  if not exists (select 1 from pg_type where typname = 'inbox_thread_status') then
    create type inbox_thread_status as enum ('open','snoozed','done');
  end if;
  if not exists (select 1 from pg_type where typname = 'inbox_direction') then
    create type inbox_direction as enum ('inbound','outbound');
  end if;
end $$;

create table if not exists public.inbox_threads (
  id                 uuid primary key default extensions.gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  channel            inbox_channel not null,
  category           inbox_category not null,
  subject            text not null,
  counterparty_name  text,
  counterparty_email text,
  preview            text,
  status             inbox_thread_status not null default 'open',
  unread             boolean not null default true,
  priority           integer not null default 0 check (priority between 0 and 100),
  intent             text,
  ai_summary         text,
  last_message_at    timestamptz,
  meeting_at         timestamptz,
  meeting_url        text,
  deal_id            uuid references public.deals (id) on delete set null,
  investor_id        uuid references public.investors (id) on delete set null,
  created_by         uuid references public.principals (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists inbox_threads_org_idx on public.inbox_threads (organization_id);
create index if not exists inbox_threads_org_priority_idx
  on public.inbox_threads (organization_id, priority desc, last_message_at desc);
create index if not exists inbox_threads_deal_idx on public.inbox_threads (deal_id);
create index if not exists inbox_threads_investor_idx on public.inbox_threads (investor_id);

create table if not exists public.inbox_messages (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  thread_id       uuid not null references public.inbox_threads (id) on delete cascade,
  direction       inbox_direction not null,
  author          text,
  body            text not null,
  occurred_at     timestamptz not null default now(),
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists inbox_messages_thread_idx on public.inbox_messages (thread_id, occurred_at asc);
create index if not exists inbox_messages_org_idx on public.inbox_messages (organization_id);

drop trigger if exists inbox_threads_set_updated_at on public.inbox_threads;
create trigger inbox_threads_set_updated_at
  before update on public.inbox_threads
  for each row execute function public.set_updated_at();

alter table public.inbox_threads enable row level security;
alter table public.inbox_messages enable row level security;

drop policy if exists inbox_threads_select on public.inbox_threads;
create policy inbox_threads_select on public.inbox_threads
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists inbox_threads_write on public.inbox_threads;
create policy inbox_threads_write on public.inbox_threads
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

drop policy if exists inbox_messages_select on public.inbox_messages;
create policy inbox_messages_select on public.inbox_messages
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists inbox_messages_write on public.inbox_messages;
create policy inbox_messages_write on public.inbox_messages
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));;
