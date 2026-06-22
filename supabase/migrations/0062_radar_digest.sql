-- 0062_radar_digest.sql
-- The Act-now Radar digest — the recurring push that turns the Source Radar's
-- ranked "act now" read (lib/source-radar.ts) into a daily/weekly nudge across
-- three channels: the in-app Unified Inbox, Slack, and email. Where buildRadar
-- composes the four sourcing clusters into one ranked RadarItem[], this layer
-- decides WHO gets it, HOW OFTEN, and at WHAT priority bar — so the whole
-- sourcing suite drives daily usage instead of waiting to be opened.
--
--   radar_digest_prefs — per-org, per-channel delivery settings (recipient,
--                        cadence, min-score bar, on/off).
--   radar_digest_log   — an append-only record of each digest sent: which
--                        channel, how many items, and the top items snapshot,
--                        so cadence is observable and re-sends are auditable.
--
-- Org-scoped, with the same member-read / writer-write RLS as the rest of the
-- sourcing domain (entity_signals 0055, ownership_intel 0056).

-- ---------------------------------------------------------------------------
-- radar_digest_prefs — delivery settings, one row per (org, channel).
-- ---------------------------------------------------------------------------
create table if not exists public.radar_digest_prefs (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- where the digest lands: the in-app inbox, a Slack channel, or an inbox.
  channel         text not null check (channel in ('in_app', 'slack', 'email')),
  -- the destination for the channel: a Slack channel id or an email address.
  -- null for in_app (the inbox is implicitly the org's own).
  recipient       text,
  cadence         text not null default 'daily' check (cadence in ('daily', 'weekly')),
  -- the minimum RadarItem.score that earns a place in the digest.
  min_score       integer not null default 60,
  enabled         boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, channel)
);

create index if not exists radar_digest_prefs_org_idx
  on public.radar_digest_prefs (organization_id);

-- ---------------------------------------------------------------------------
-- radar_digest_log — append-only send ledger, newest-first per org.
-- ---------------------------------------------------------------------------
create table if not exists public.radar_digest_log (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  channel         text not null,
  item_count      integer not null default 0,
  -- a compact snapshot of the top items in the digest, for the activity feed.
  top_items       jsonb not null default '[]'::jsonb,
  sent_at         timestamptz not null default now()
);

create index if not exists radar_digest_log_org_sent_idx
  on public.radar_digest_log (organization_id, sent_at desc);

-- RLS: same member-read / writer-write org tenancy as the rest of the domain.
alter table public.radar_digest_prefs enable row level security;
alter table public.radar_digest_log enable row level security;

-- CREATE POLICY has no IF NOT EXISTS, so drop-then-create to stay idempotent.
drop policy if exists radar_digest_prefs_select on public.radar_digest_prefs;
create policy radar_digest_prefs_select on public.radar_digest_prefs
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists radar_digest_prefs_write on public.radar_digest_prefs;
create policy radar_digest_prefs_write on public.radar_digest_prefs
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

drop policy if exists radar_digest_log_select on public.radar_digest_log;
create policy radar_digest_log_select on public.radar_digest_log
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists radar_digest_log_write on public.radar_digest_log;
create policy radar_digest_log_write on public.radar_digest_log
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- ---------------------------------------------------------------------------
-- A first-class inbox channel for the in-app digest, so the Act-now read lands
-- as the distinct recurring brief it is. `add value if not exists` is idempotent
-- and the value is only USED at runtime, never in this transaction.
-- ---------------------------------------------------------------------------
alter type inbox_channel add value if not exists 'radar_digest';
