-- 0046_deal_shares.sql
-- (Renumbered from a duplicate 0044 — 0044_api_keys.sql and 0044_deal_shares.sql
-- shared the same version prefix, which collides on schema_migrations.version
-- during a preview-branch replay. Renamed to 0046 to give it a unique version.)
-- Share a deal across the ecosystem. One action does three things (lib/deal-
-- share*): Earn drafts a confidential teaser memo, the deal is matched
-- AngelList-style (check size · stage · sector · geography, via lib/matching)
-- to discoverable investors in OTHER orgs, and a tokenized public link is minted
-- for DocSend-style tracked sending. Matched orgs get a push alert in their bell
-- (an `inbox_threads` row on the new `deal_share` channel) and a standing pull
-- feed ("deals that fit you"). Confidential by construction: the full deal room
-- stays gated; only the teaser ever travels.
--
-- Tenancy follows the house pattern — member-read / writer-write on
-- organization_id — except the recipient + view rows, which are written by the
-- service role (cross-org matching, unauthenticated link views) and read by the
-- org they concern.

-- ---------------------------------------------------------------------------
-- deal_shares — one shareable teaser of a deal, with its public token + memo.
-- ---------------------------------------------------------------------------
create table public.deal_shares (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  deal_id         uuid not null references public.deals (id) on delete cascade,
  -- The public, unguessable link token. The full deal room is never exposed —
  -- only the teaser this row carries.
  token           text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  -- Earn's confidential teaser memo (AI-drafted, deterministic fallback).
  memo            text not null,
  created_by      uuid references public.principals (id) on delete set null,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index deal_shares_org_idx on public.deal_shares (organization_id, created_at desc);
create index deal_shares_deal_idx on public.deal_shares (deal_id);

create trigger deal_shares_set_updated_at
  before update on public.deal_shares
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- deal_share_recipients — the matched (or forwarded) target orgs. One row per
-- (share, matched investor); the recipient org reads these as its "deals that
-- fit you" feed. Written by the service role during cross-org matching.
-- ---------------------------------------------------------------------------
create table public.deal_share_recipients (
  id              uuid primary key default extensions.gen_random_uuid(),
  share_id        uuid not null references public.deal_shares (id) on delete cascade,
  -- The org receiving the deal in its feed/bell.
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Which of the recipient's own investor profiles the deal fit (their record,
  -- so the deep link resolves for them). Null for a non-investor forward.
  investor_id     uuid references public.investors (id) on delete set null,
  score           integer not null default 0 check (score between 0 and 100),
  rationale       jsonb not null default '[]'::jsonb,
  source          text not null default 'matched' check (source in ('matched', 'forwarded')),
  created_at      timestamptz not null default now()
);

create index deal_share_recipients_org_idx
  on public.deal_share_recipients (organization_id, created_at desc);
create index deal_share_recipients_share_idx on public.deal_share_recipients (share_id);

-- ---------------------------------------------------------------------------
-- deal_share_views — the access log behind the tracked link. `organization_id`
-- is the SHARER (so they read their own analytics); written by the service role
-- on each public view.
-- ---------------------------------------------------------------------------
create table public.deal_share_views (
  id              uuid primary key default extensions.gen_random_uuid(),
  share_id        uuid not null references public.deal_shares (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- The viewing org when known (a signed-in ecosystem member), else null (an
  -- anonymous link open). A short label for the activity line.
  viewer_org_id   uuid references public.organizations (id) on delete set null,
  viewer_label    text,
  created_at      timestamptz not null default now()
);

create index deal_share_views_share_idx on public.deal_share_views (share_id, created_at desc);
create index deal_share_views_org_idx on public.deal_share_views (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.deal_shares enable row level security;
alter table public.deal_share_recipients enable row level security;
alter table public.deal_share_views enable row level security;

-- Shares: the owning org manages them; public reads go through the service role.
create policy deal_shares_select on public.deal_shares
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy deal_shares_write on public.deal_shares
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- Recipients: only the recipient org sees its own feed rows. Inserts are
-- service-role (cross-org matching), so no write policy is granted.
create policy deal_share_recipients_select on public.deal_share_recipients
  for select using (organization_id in (select public.current_principal_org_ids()));

-- Views: only the sharer reads its own access log. Inserts are service-role
-- (the unauthenticated public page), so no write policy is granted.
create policy deal_share_views_select on public.deal_share_views
  for select using (organization_id in (select public.current_principal_org_ids()));

-- ---------------------------------------------------------------------------
-- A first-class inbox channel for shared-deal match alerts, so a deal reads as
-- the distinct professional alert it is. `add value if not exists` is
-- idempotent and the value is only USED at runtime, never in this transaction.
-- ---------------------------------------------------------------------------
alter type inbox_channel add value if not exists 'deal_share';
