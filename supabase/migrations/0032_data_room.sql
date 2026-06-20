-- 0032_data_room.sql
-- Materials & Data Room upgrades: in-app document creation (inline content),
-- explicit ordering, shareable read-only external links, and view tracking.

-- Documents gain inline content (for created notes/memos) and explicit ordering
-- within a section. Existing rows default to sort_order 0.
alter table public.documents add column if not exists content text;
alter table public.documents add column if not exists sort_order integer not null default 0;

-- ---------------------------------------------------------------------------
-- data_room_shares — read-only external links to a firm's materials. Public
-- reads are served by a server route using the service role (token-gated), so
-- no anon policy is needed here. A link is valid when not revoked and not past
-- its (optional) expiry.
-- ---------------------------------------------------------------------------
create table public.data_room_shares (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  token           text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  label           text,
  expires_at      timestamptz,
  revoked_at      timestamptz,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index data_room_shares_org_idx on public.data_room_shares (organization_id);

-- ---------------------------------------------------------------------------
-- data_room_views — access log. Rows are written by the public server route via
-- the service role (token-gated); members read their own org's log.
-- ---------------------------------------------------------------------------
create table public.data_room_views (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  share_id        uuid references public.data_room_shares (id) on delete set null,
  document_id     uuid references public.documents (id) on delete set null,
  kind            text not null default 'room' check (kind in ('room', 'document')),
  created_at      timestamptz not null default now()
);
create index data_room_views_org_idx on public.data_room_views (organization_id, created_at desc);

alter table public.data_room_shares enable row level security;
alter table public.data_room_views  enable row level security;

-- Member-read / writer-write org tenancy, as elsewhere.
create policy data_room_shares_select on public.data_room_shares
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy data_room_shares_write on public.data_room_shares
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

create policy data_room_views_select on public.data_room_views
  for select using (organization_id in (select public.current_principal_org_ids()));
-- No member insert policy: views are written by the public route via the
-- service role.
