-- 0038_inbox.sql
-- The Unified Inbox — one intelligence-ranked stream for every counterparty
-- touchpoint that today lives across a dozen disconnected tools: email/chat
-- messages, booking requests, and video meetings. It is the inbound counterpart
-- to the dispatch_log (the outbox): where dispatch_log records what Earn SENT,
-- the inbox records what arrived and needs a decision.
--
-- Each thread carries an AI triage layer (priority, intent, summary) so the
-- operator reads less and acts faster, plus first-class deep links to the deal
-- or investor it concerns — so an inbox item is never an orphan, it always opens
-- straight into its Command Center context. The gated "next action" on a thread
-- (reply, propose a time, spin up a video room, share Command Center details)
-- routes through the same lib/gates tier layer + lib/integrations dispatch as
-- every other outward move, and is audited in dispatch_log. Inbox in, outbox out,
-- one ledger.

-- The provider a thread flows through. Mirrors the integration adapter channels
-- (lib/integrations/adapters) plus the booking/video providers the inbox adds.
create type inbox_channel as enum (
  'gmail',            -- email (messaging)
  'slack',            -- chat (messaging)
  'calendly',         -- scheduling (booking)
  'google_calendar',  -- scheduling (booking)
  'zoom',             -- video
  'google_meet',      -- video
  'docusign'          -- signature status (signing)
);

-- The pillar a thread belongs to — the inbox's three intelligence lanes plus
-- signing, which rides along so capital-binding follow-ups surface in context.
create type inbox_category as enum ('messaging', 'booking', 'video', 'signing');

-- A thread's triage state. `open` needs attention; `snoozed` is deferred;
-- `done` has been actioned or dismissed.
create type inbox_thread_status as enum ('open', 'snoozed', 'done');

-- Whether a message arrived from the counterparty or went out from the operator.
create type inbox_direction as enum ('inbound', 'outbound');

create table public.inbox_threads (
  id                 uuid primary key default extensions.gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  channel            inbox_channel not null,
  category           inbox_category not null,
  subject            text not null,
  -- The counterparty on the other side of the thread, when known.
  counterparty_name  text,
  counterparty_email text,
  -- A one-line snippet of the most recent message, for the list view.
  preview            text,
  status             inbox_thread_status not null default 'open',
  unread             boolean not null default true,
  -- AI triage: 0-100 priority (urgency x relevance), a short intent label, and a
  -- one-paragraph summary. Populated by lib/inbox/intelligence; nullable so a raw
  -- thread can exist before it is scored.
  priority           integer not null default 0 check (priority between 0 and 100),
  intent             text,
  ai_summary         text,
  last_message_at    timestamptz,
  -- Booking/video specifics: the proposed/confirmed time and the meeting link.
  meeting_at         timestamptz,
  meeting_url        text,
  -- Deep links into Command Center context. Null when the thread isn't (yet)
  -- tied to a deal or investor; set null if the linked record is removed.
  deal_id            uuid references public.deals (id) on delete set null,
  investor_id        uuid references public.investors (id) on delete set null,
  created_by         uuid references public.principals (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index inbox_threads_org_idx on public.inbox_threads (organization_id);
-- The inbox list reads the org's threads ranked hottest-first, newest activity
-- first within a tier.
create index inbox_threads_org_priority_idx
  on public.inbox_threads (organization_id, priority desc, last_message_at desc);
create index inbox_threads_deal_idx on public.inbox_threads (deal_id);
create index inbox_threads_investor_idx on public.inbox_threads (investor_id);

create table public.inbox_messages (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  thread_id       uuid not null references public.inbox_threads (id) on delete cascade,
  direction       inbox_direction not null,
  -- Display name of who wrote it (counterparty or the operator/Earn).
  author          text,
  body            text not null,
  occurred_at     timestamptz not null default now(),
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index inbox_messages_thread_idx
  on public.inbox_messages (thread_id, occurred_at asc);
create index inbox_messages_org_idx on public.inbox_messages (organization_id);

create trigger inbox_threads_set_updated_at
  before update on public.inbox_threads
  for each row execute function public.set_updated_at();

-- RLS: same member-read / writer-write org tenancy as the rest of the domain.
alter table public.inbox_threads enable row level security;
alter table public.inbox_messages enable row level security;

create policy inbox_threads_select on public.inbox_threads
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy inbox_threads_write on public.inbox_threads
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

create policy inbox_messages_select on public.inbox_messages
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy inbox_messages_write on public.inbox_messages
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
