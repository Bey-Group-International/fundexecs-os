-- 20260706130000_processed_stripe_events.sql
-- Idempotency ledger for inbound Stripe webhook events (app/api/stripe/webhook).
--
-- Stripe delivers each event at least once and redelivers on any non-2xx
-- response, so a renewal handler that grants credits with no dedupe will
-- double-grant on a redelivery. This table is that dedupe: one row per Stripe
-- event id, inserted before the event is applied. A row means "already
-- applied" — the webhook claims the id (insert-if-absent), processes only when
-- the claim is fresh, and skips redeliveries whose id is already present.
--
-- Rows are immutable (a claim is a fact, never edited), so there is no
-- updated_at column and no set_updated_at trigger. The claim is released
-- (row deleted) only when processing throws after a successful claim, so
-- Stripe's retry can re-process.

create table if not exists public.processed_stripe_events (
  id          text primary key,
  type        text not null,
  created_at  timestamptz not null default now()
);

-- RLS with NO policies: only the service role (which bypasses RLS) ever reads
-- or writes this ledger, from the signature-verified webhook route. There is no
-- org tenancy here — a Stripe event id is global — so no org member should ever
-- touch it, and the absence of policies denies all non-service access.
alter table public.processed_stripe_events enable row level security;
