-- Matching an inbox thread to a person by address, case-insensitively and with
-- an index.
--
-- The meeting report is about to show, beside the report, every inbox thread
-- belonging to the people who were in the room. That join is by address, and
-- `inbox_threads.counterparty_email` holds the address exactly as it was
-- ingested — a provider sends "Ana@Acme.com" and that is what is stored.
--
-- So a lookup that compares the raw column against a lowercased address (which
-- is the only shape a lowercasing rule can hand it) misses every thread whose
-- address arrived capitalised, and misses any index at the same time. PostgREST
-- cannot filter on lower(counterparty_email), so the lowercase becomes a column.
--
-- The same fix, for the same reason, as network_contacts.email_lower in
-- 20260930083000 — deliberately the same shape rather than a second approach to
-- one problem.

alter table public.inbox_threads
  add column if not exists counterparty_email_lower text
    generated always as (lower(counterparty_email)) stored;

comment on column public.inbox_threads.counterparty_email_lower is
  'lower(counterparty_email), as a column so a case-insensitive lookup can be expressed through PostgREST and use an index. Never written directly.';

-- Organization first, because every read of this table is already org-scoped by
-- RLS and by the query; the address is what narrows it from there. A meeting
-- with eight attendees asks for eight addresses at once, so this is the index
-- that decides whether that read is eight index probes or a scan of the org's
-- whole inbox.
create index if not exists inbox_threads_counterparty_lower_idx
  on public.inbox_threads (organization_id, counterparty_email_lower);
