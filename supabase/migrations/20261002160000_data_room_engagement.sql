-- Data room engagement: what each investor did, and Earn's read of it.
--
-- 1. `data_room_views.action` says what a row records: 'open' (the room or a
--    document was opened), 'download', or 'read' (seconds spent reading one
--    document, measured in the viewer). Rows written before this are null and
--    are read by their old shape: a duration means reading, none means open.
--    Without it a download and an open were the same row.
--
-- 2. `data_room_engagement_reads` holds Earn's read of one investor's activity
--    in one room: a short summary, an interest signal and a suggested next
--    step. `activity_through` is the newest activity the read covered, so the
--    page can tell when there is newer activity than Earn has seen.

alter table public.data_room_views
  add column if not exists action text
    check (action is null or action in ('open', 'download', 'read'));

create index if not exists data_room_views_room_created_idx
  on public.data_room_views (room_id, created_at desc);

create table if not exists public.data_room_engagement_reads (
  room_id uuid not null references public.data_rooms(id) on delete cascade,
  -- `email:<address>` or `visitor:<browser id>`, the same key the open alerts use.
  viewer_key text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  summary text not null default '',
  -- 'hot' | 'warm' | 'cold'
  signal text not null default 'warm' check (signal in ('hot', 'warm', 'cold')),
  follow_up text not null default '',
  -- 'earn' when Claude wrote it, 'rules' for the offline fallback.
  source text not null default 'earn' check (source in ('earn', 'rules')),
  activity_through timestamptz,
  read_at timestamptz not null default now(),
  primary key (room_id, viewer_key)
);

create index if not exists data_room_engagement_reads_org_idx
  on public.data_room_engagement_reads (organization_id);

alter table public.data_room_engagement_reads enable row level security;

drop policy if exists data_room_engagement_reads_select on public.data_room_engagement_reads;
create policy data_room_engagement_reads_select on public.data_room_engagement_reads
  for select using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists data_room_engagement_reads_write on public.data_room_engagement_reads;
create policy data_room_engagement_reads_write on public.data_room_engagement_reads
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

grant select, insert, update, delete on public.data_room_engagement_reads to authenticated, service_role;
