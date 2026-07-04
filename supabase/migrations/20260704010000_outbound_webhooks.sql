-- 20260704010000_outbound_webhooks.sql
-- Outbound event subscriptions for the v1 API (audit P2 — API-surface design:
-- "POST /api/v1/webhooks for event subscriptions delivered from
-- task_events/dispatch_log by the cron sweep, HMAC-signed").
--
-- One row per subscribed endpoint. The signing secret is generated server-side,
-- shown to the integrator exactly once, and stored AES-256-GCM encrypted (the
-- org_secrets idiom) — deliveries must SIGN with it, so a one-way hash won't do,
-- but the plaintext never sits in the database either.
--
-- Delivery bookkeeping lives on the row: `cursor_at` is the high-water mark of
-- delivered events (starts at creation, so a new endpoint never replays
-- history), `consecutive_failures` drives auto-disable so a dead endpoint
-- can't burn every future sweep.

create table if not exists public.webhook_endpoints (
  id                    uuid primary key default extensions.gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  url                   text not null,
  description           text,
  -- Subscribed event types (lib/webhooks-outbound.ts catalog). Empty = all.
  events                text[] not null default '{}',
  -- AES-256-GCM of the whsec_… signing secret (lib/vault.ts), plus a display
  -- fragment. Same shape as org_secrets.
  ciphertext            text not null,
  iv                    text not null,
  auth_tag              text not null,
  secret_last4          text not null,
  -- Delivery high-water mark: only events created after this are sent.
  cursor_at             timestamptz not null default now(),
  consecutive_failures  integer not null default 0,
  disabled_at           timestamptz,
  last_delivery_at      timestamptz,
  last_delivery_status  text,
  created_by            uuid references public.principals (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists webhook_endpoints_org_idx
  on public.webhook_endpoints (organization_id, created_at desc);
-- The sweep scans active endpoints only.
create index if not exists webhook_endpoints_active_idx
  on public.webhook_endpoints (organization_id)
  where disabled_at is null;

drop trigger if exists webhook_endpoints_set_updated_at on public.webhook_endpoints;
create trigger webhook_endpoints_set_updated_at
  before update on public.webhook_endpoints
  for each row execute function public.set_updated_at();

-- RLS — member-read / writer-write org tenancy, as elsewhere. The ciphertext is
-- readable by org members but useless without the server-side vault key; API
-- consumers go through the service role (key-verified) path instead.
alter table public.webhook_endpoints enable row level security;

drop policy if exists webhook_endpoints_select on public.webhook_endpoints;
create policy webhook_endpoints_select on public.webhook_endpoints
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists webhook_endpoints_write on public.webhook_endpoints;
create policy webhook_endpoints_write on public.webhook_endpoints
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
