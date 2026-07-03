-- 20260703220000_inbound_ingest.sql
-- Inbound ingestion — the missing half of the dispatch loop. dispatch_log
-- (0030) records everything Earn SENT; until now nothing external could ARRIVE:
-- the Unified Inbox only ever held demo-seeded or internally-written threads,
-- and the only webhook in the app was Stripe's. This migration adds the storage
-- for a generic, signature-verified webhook surface
-- (app/api/webhooks/[channel]) that turns provider events into inbox threads.
--
-- Two pieces:
--   1. inbox_threads.external_id — the provider-side correlation key (a
--      Calendly scheduled-event URI, an email thread key) so a follow-up event
--      appends to its existing thread instead of minting a duplicate.
--   2. ingest_log — the append-only inbound ledger mirroring dispatch_log, one
--      row per received webhook event. Its unique (org, channel, external_id)
--      index doubles as the idempotency claim: provider retries of the same
--      event conflict on insert and are acknowledged without re-writing the
--      thread.

-- 1. Provider-side thread correlation key. Null for threads that predate
-- ingestion or are created internally (demo seed, deal shares, digests).
alter table public.inbox_threads
  add column if not exists external_id text;

-- One thread per provider object per org+channel. Partial so internal threads
-- (external_id null) are unconstrained.
create unique index if not exists inbox_threads_org_channel_external_idx
  on public.inbox_threads (organization_id, channel, external_id)
  where external_id is not null;

-- 2. The inbound ledger. Rows are inserted as the idempotency claim when an
-- event is accepted and finalized once (thread_id/ok/detail set after the
-- thread write); they are never deleted, and nothing user-facing writes here —
-- only the webhook route's service-role client does.
create table public.ingest_log (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- the webhook channel that delivered the event ("calendly", "resend", …).
  channel         text not null,
  -- the provider's event type verbatim ("invitee.created", "email.received").
  event_type      text not null,
  -- the provider's unique id for this delivery (event URI, email id). The
  -- idempotency key — retries of the same event are dropped by the unique
  -- index below.
  external_id     text not null,
  -- outcome of the ingest: false when the thread/message write failed after
  -- the claim (the row then documents the failure instead of the thread).
  ok              boolean not null default true,
  detail          text,
  -- the inbox thread the event landed in; null while claiming or on failure,
  -- set null if the thread is later removed.
  thread_id       uuid references public.inbox_threads (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index ingest_log_org_idx on public.ingest_log (organization_id);
-- The (future) inbound ledger view reads newest-first, same as the Outbox.
create index ingest_log_org_created_idx
  on public.ingest_log (organization_id, created_at desc);

-- Idempotency: one row per provider event per org+channel. A retried delivery
-- hits this index and is acknowledged without a second thread write.
create unique index ingest_log_org_channel_event_idx
  on public.ingest_log (organization_id, channel, external_id);

-- RLS: members can read their org's inbound ledger; there is deliberately NO
-- write policy — ingestion happens exclusively through the webhook route's
-- service-role client, so user sessions cannot forge inbound history.
alter table public.ingest_log enable row level security;

create policy ingest_log_select on public.ingest_log
  for select using (organization_id in (select public.current_principal_org_ids()));
