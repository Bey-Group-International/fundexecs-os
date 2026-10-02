-- Data room → CRM: reading activity on the contact's timeline, and a log of
-- follow-ups sent from the activity view.
--
-- 1. `network_activities.data_room_key` is generated from metadata, as
--    meeting_id and thread_id are (20260930083000 / 20260930090000), so the
--    daily writer has real columns to conflict on. The key is
--    `<room id>:<YYYY-MM-DD>`: one entry per contact per room per day, updated
--    in place as that day's reading grows instead of adding copies.
--
-- 2. `data_room_follow_ups` records each follow-up email sent to a reader from
--    the activity view, so the room shows "Followed up Oct 2" and nobody
--    emails the same investor twice by accident.

alter table public.network_activities
  add column if not exists data_room_key text
    generated always as (metadata ->> 'data_room_key') stored;

comment on column public.network_activities.data_room_key is
  'For data-room reading entries: <room id>:<day>, derived from metadata so the daily upsert has real columns to conflict on. Null for everything else.';

create unique index if not exists network_activities_data_room_contact_uniq
  on public.network_activities (organization_id, contact_id, data_room_key);

create table if not exists public.data_room_follow_ups (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  room_id uuid not null references public.data_rooms(id) on delete cascade,
  -- `email:<address>`, the key the activity view and Earn's reads use.
  viewer_key text not null,
  recipient_email text not null,
  subject text not null,
  body text not null,
  sent_by uuid references public.principals(id) on delete set null,
  sent_at timestamptz not null default now()
);

create index if not exists data_room_follow_ups_room_idx
  on public.data_room_follow_ups (room_id, viewer_key, sent_at desc);

alter table public.data_room_follow_ups enable row level security;

drop policy if exists data_room_follow_ups_select on public.data_room_follow_ups;
create policy data_room_follow_ups_select on public.data_room_follow_ups
  for select using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists data_room_follow_ups_insert on public.data_room_follow_ups;
create policy data_room_follow_ups_insert on public.data_room_follow_ups
  for insert with check (public.is_org_writer(organization_id));

grant select, insert on public.data_room_follow_ups to authenticated;
grant select, insert, update, delete on public.data_room_follow_ups to service_role;
