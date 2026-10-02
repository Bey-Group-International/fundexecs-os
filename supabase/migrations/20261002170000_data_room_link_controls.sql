-- Data room link controls: who may open a link, and how many of them.
--
-- 1. `allowed_email_domains` limits a link to readers whose gate email is at
--    one of these domains (or a subdomain of one). Null means any address.
-- 2. `max_readers` caps how many distinct readers (by gate email) a link
--    admits. A reader already admitted can always come back; only new ones
--    are refused once the cap is reached. Null means no cap.
--
-- Both rules work on the email the reader gives the gate, so a link with
-- either must ask for one. The constraint holds that rule in the database;
-- the app sets require_email whenever it sets either.
--
-- 3. `data_room_link_readers` is the admission list the cap counts: one row per
--    (link, email), written by the public viewer through the service role
--    when a reader passes the email gate.

alter table public.data_room_shares
  add column if not exists allowed_email_domains text[],
  add column if not exists max_readers integer;

alter table public.data_room_shares
  drop constraint if exists data_room_shares_max_readers_positive;
alter table public.data_room_shares
  add constraint data_room_shares_max_readers_positive
  check (max_readers is null or max_readers > 0);

alter table public.data_room_shares
  drop constraint if exists data_room_shares_reader_rules_need_email;
alter table public.data_room_shares
  add constraint data_room_shares_reader_rules_need_email
  check (require_email or (allowed_email_domains is null and max_readers is null));

create table if not exists public.data_room_link_readers (
  share_id uuid not null references public.data_room_shares(id) on delete cascade,
  email text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  first_at timestamptz not null default now(),
  primary key (share_id, email)
);

create index if not exists data_room_link_readers_org_idx
  on public.data_room_link_readers (organization_id);

alter table public.data_room_link_readers enable row level security;

drop policy if exists data_room_link_readers_select on public.data_room_link_readers;
create policy data_room_link_readers_select on public.data_room_link_readers
  for select using (organization_id in (select public.current_principal_org_ids()));

grant select on public.data_room_link_readers to authenticated;
grant select, insert, update, delete on public.data_room_link_readers to service_role;
