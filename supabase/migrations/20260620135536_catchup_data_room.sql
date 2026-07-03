-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
-- catch-up: 0032_data_room.sql (idempotent)
alter table public.documents add column if not exists content text;
alter table public.documents add column if not exists sort_order integer not null default 0;

create table if not exists public.data_room_shares (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  token           text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  label           text,
  expires_at      timestamptz,
  revoked_at      timestamptz,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists data_room_shares_org_idx on public.data_room_shares (organization_id);

create table if not exists public.data_room_views (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  share_id        uuid references public.data_room_shares (id) on delete set null,
  document_id     uuid references public.documents (id) on delete set null,
  kind            text not null default 'room' check (kind in ('room', 'document')),
  created_at      timestamptz not null default now()
);
create index if not exists data_room_views_org_idx on public.data_room_views (organization_id, created_at desc);

alter table public.data_room_shares enable row level security;
alter table public.data_room_views  enable row level security;

drop policy if exists data_room_shares_select on public.data_room_shares;
create policy data_room_shares_select on public.data_room_shares
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists data_room_shares_write on public.data_room_shares;
create policy data_room_shares_write on public.data_room_shares
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

drop policy if exists data_room_views_select on public.data_room_views;
create policy data_room_views_select on public.data_room_views
  for select using (organization_id in (select public.current_principal_org_ids()));;
