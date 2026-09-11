-- 20260911120000_data_rooms.sql
-- Split the Materials & Data Room from Documents.
--
-- Documents (`public.documents`) is the firm's library — it holds and creates
-- every document, drafts included. A data room is a *sharing* surface: a named,
-- curated set of documents plus the links, gates, and analytics that govern who
-- sees them. A firm runs several at once ("Fund III Raise", "Co-invest — Atlas"),
-- so rooms are rows, not a singleton derived from the whole library.
--
-- Nothing reaches a room implicitly: `data_room_documents` is an explicit
-- publish manifest, so a half-finished draft in the library can never leak to an
-- LP. Shares and views hang off a room.

-- ---------------------------------------------------------------------------
-- data_rooms — named rooms per organization.
-- ---------------------------------------------------------------------------
create table if not exists public.data_rooms (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  description     text,
  -- Exactly one room per org is the default: where Build's coverage prompts and
  -- the legacy single-room links point.
  is_default      boolean not null default false,
  archived_at     timestamptz,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists data_rooms_org_idx
  on public.data_rooms (organization_id, created_at desc);
create unique index if not exists data_rooms_one_default_idx
  on public.data_rooms (organization_id) where is_default;

-- ---------------------------------------------------------------------------
-- data_room_documents — the publish manifest. A document is visible in a room
-- only when it has a row here; removing the row unpublishes it without touching
-- the document itself.
-- ---------------------------------------------------------------------------
create table if not exists public.data_room_documents (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  room_id         uuid not null references public.data_rooms (id) on delete cascade,
  document_id     uuid not null references public.documents (id) on delete cascade,
  sort_order      integer not null default 0,
  added_by        uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (room_id, document_id)
);
create index if not exists data_room_documents_room_idx
  on public.data_room_documents (room_id, sort_order);
create index if not exists data_room_documents_document_idx
  on public.data_room_documents (document_id);
create index if not exists data_room_documents_org_idx
  on public.data_room_documents (organization_id);

-- ---------------------------------------------------------------------------
-- Scope shares and views to a room.
-- ---------------------------------------------------------------------------
alter table public.data_room_shares
  add column if not exists room_id uuid references public.data_rooms (id) on delete cascade;
create index if not exists data_room_shares_room_idx on public.data_room_shares (room_id);

alter table public.data_room_views
  add column if not exists room_id uuid references public.data_rooms (id) on delete set null;
create index if not exists data_room_views_room_idx
  on public.data_room_views (room_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Backfill. Every org that already has documents or share links gets a default
-- room, and the documents an LP can see *today* (status = 'ready', the filter
-- the public viewer applies) are published into it. Existing links keep showing
-- exactly the same set — the migration changes no one's access.
-- ---------------------------------------------------------------------------
insert into public.data_rooms (organization_id, name, is_default)
select o.id, 'Primary Data Room', true
from public.organizations o
where not exists (select 1 from public.data_rooms r where r.organization_id = o.id)
  and (
    exists (select 1 from public.documents d where d.organization_id = o.id)
    or exists (select 1 from public.data_room_shares s where s.organization_id = o.id)
  );

insert into public.data_room_documents (organization_id, room_id, document_id, sort_order)
select d.organization_id, r.id, d.id, d.sort_order
from public.documents d
join public.data_rooms r
  on r.organization_id = d.organization_id and r.is_default
where d.status = 'ready'
on conflict (room_id, document_id) do nothing;

update public.data_room_shares s
set room_id = r.id
from public.data_rooms r
where r.organization_id = s.organization_id and r.is_default and s.room_id is null;

update public.data_room_views v
set room_id = s.room_id
from public.data_room_shares s
where s.id = v.share_id and v.room_id is null;

-- ---------------------------------------------------------------------------
-- RLS — member-read / writer-write org tenancy, as elsewhere. Public room reads
-- are served by token-gated server routes using the service role.
-- ---------------------------------------------------------------------------
alter table public.data_rooms          enable row level security;
alter table public.data_room_documents enable row level security;

drop policy if exists data_rooms_select on public.data_rooms;
create policy data_rooms_select on public.data_rooms
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists data_rooms_write on public.data_rooms;
create policy data_rooms_write on public.data_rooms
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

drop policy if exists data_room_documents_select on public.data_room_documents;
create policy data_room_documents_select on public.data_room_documents
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists data_room_documents_write on public.data_room_documents;
create policy data_room_documents_write on public.data_room_documents
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
