-- =====================================================================
-- Relationship Inbox — P4 in-app calls foundation (LiveKit).
--
-- Additive + idempotent. A `live_rooms` row is the server-side record of an
-- in-app call: a unique room name (the LiveKit room), soft links onto the deal
-- loop, and an optional link to the inbox_items 'call' row that surfaces it in
-- the inbox. Tokens are minted server-side from LIVEKIT_API_KEY/SECRET; this
-- table holds no secrets.
--
-- RLS mirrors inbox_items: members read their org's rooms; the service role
-- (server actions, after authorizing the caller) writes. The post-call
-- transcript -> Meeting Copilot finalize loop reads/writes via the service role.
-- =====================================================================

create table if not exists public.live_rooms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- The LiveKit room name. Unique so a join token always resolves one room.
  room_name text not null unique,
  -- The inbox 'call' item that surfaces this room, when one was created.
  inbox_item_id uuid references public.inbox_items (id) on delete set null,
  -- Soft links onto the deal loop (set null, never cascade — keep the record).
  deal_id uuid references public.deals (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  title text,
  status text not null default 'open',
  created_at timestamp with time zone not null default now(),
  ended_at timestamp with time zone
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.live_rooms'::regclass
      and conname = 'live_rooms_status_valid'
  ) then
    alter table public.live_rooms
      add constraint live_rooms_status_valid check (status in ('open', 'ended'));
  end if;
end$$;

create index if not exists live_rooms_org_created_idx
  on public.live_rooms (org_id, created_at desc);

alter table public.live_rooms enable row level security;

revoke all on table public.live_rooms from anon, authenticated;
grant select on table public.live_rooms to authenticated;
grant select, insert, update on table public.live_rooms to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'live_rooms'
      and policyname = 'members read own org live_rooms'
  ) then
    create policy "members read own org live_rooms"
      on public.live_rooms
      for select to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = live_rooms.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'live_rooms'
      and policyname = 'service_role writes live_rooms'
  ) then
    create policy "service_role writes live_rooms"
      on public.live_rooms
      for all to service_role
      using (true)
      with check (true);
  end if;
end$$;
