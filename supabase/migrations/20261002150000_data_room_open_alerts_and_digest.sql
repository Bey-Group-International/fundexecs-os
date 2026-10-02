-- Data room alerts: one email per investor on first open, and a daily digest.
--
-- 1. `data_room_open_alerts` records that the link's creator has been told a
--    given viewer opened a given link. The primary key is the dedupe: the
--    first open inserts a row and sends one email; every later open conflicts
--    and sends nothing. Before this, "notify on open" fired from dwell
--    tracking — an email every time the reader changed section, and none at
--    all for a reader who opened the room and read without clicking.
--
--    viewer_key is the lower-cased email the reader gave the gate (or the
--    link's named recipient), else `visitor:<id>` from a per-browser id, so an
--    ungated link still alerts once per reader rather than once per page load.
--
-- 2. `data_room_shares.daily_digest` opts a link into a once-a-day email to its
--    creator summarising the last day's activity on it (sent only when there
--    was any). `digest_sent_at` marks the end of the window last reported, so
--    a re-run of the sweep the same day reports nothing twice.

create table if not exists public.data_room_open_alerts (
  share_id uuid not null references public.data_room_shares(id) on delete cascade,
  viewer_key text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  viewer_email text,
  created_at timestamptz not null default now(),
  primary key (share_id, viewer_key)
);

create index if not exists data_room_open_alerts_org_idx
  on public.data_room_open_alerts (organization_id);

alter table public.data_room_open_alerts enable row level security;

-- Readable by the org (it is who opened what, the same data as the views
-- table). Written only by the service role from the public viewer, so there
-- is no client write policy.
drop policy if exists data_room_open_alerts_select on public.data_room_open_alerts;
create policy data_room_open_alerts_select on public.data_room_open_alerts
  for select using (organization_id in (select public.current_principal_org_ids()));

grant select on public.data_room_open_alerts to authenticated;
grant select, insert, update, delete on public.data_room_open_alerts to service_role;

alter table public.data_room_shares
  add column if not exists daily_digest boolean not null default false,
  add column if not exists digest_sent_at timestamptz;

create index if not exists data_room_shares_daily_digest_idx
  on public.data_room_shares (organization_id) where daily_digest;
