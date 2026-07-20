-- 20260720120000_office_layouts.sql
-- Per-organization Virtual Office layout — the persisted, editable floor plan
-- (MapMaker-style). One row per org holds the whole layout as jsonb; when a row
-- is absent the app falls back to the built-in default map (lib/office/layout).
--
-- The prior spatial-office tables (office_*) were dropped in
-- 20260719000000_drop_virtual_office; this is a fresh, non-colliding table with
-- the same member-read / writer-write org tenancy used across the domain.
-- Idempotent so a preview-branch replay is a no-op.

create table if not exists public.office_layouts (
  organization_id uuid primary key
    references public.organizations (id) on delete cascade,
  layout          jsonb not null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.principals (id) on delete set null
);

drop trigger if exists office_layouts_set_updated_at on public.office_layouts;
create trigger office_layouts_set_updated_at
  before update on public.office_layouts
  for each row execute function public.set_updated_at();

-- RLS — member-read / writer-write org tenancy, as elsewhere.
alter table public.office_layouts enable row level security;

drop policy if exists office_layouts_select on public.office_layouts;
create policy office_layouts_select on public.office_layouts
  for select using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists office_layouts_insert on public.office_layouts;
create policy office_layouts_insert on public.office_layouts
  for insert with check (public.is_org_writer(organization_id));

drop policy if exists office_layouts_update on public.office_layouts;
create policy office_layouts_update on public.office_layouts
  for update using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
