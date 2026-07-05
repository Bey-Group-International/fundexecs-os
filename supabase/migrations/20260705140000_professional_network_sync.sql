-- 20260705140000_professional_network_sync.sql
--
-- Professional Network backend sync layer. Extends the Professional Network
-- layer (20260705120000) with a durable record of backend connector sync runs
-- (Google Contacts, official LinkedIn API, future CRM/Microsoft Graph).
--
-- Backend connectors are the PRIMARY path; CSV stays the fallback. Every sync
-- run — including the honest "pending authorization" case where no provider
-- credentials exist yet — lands here so the UI can show last-sync status per
-- provider and the org keeps an audit trail. No secrets live in this table;
-- token storage/revocation is a separate SEAM (TODO(oauth)).

create table if not exists public.professional_network_sync_jobs (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  -- Nullable: a connection may not be established yet (pending authorization).
  connection_id     text,
  provider          text not null,
  status            text not null default 'queued'
                      check (status in ('queued','running','completed','failed','paused')),
  sync_type         text not null default 'manual_refresh'
                      check (sync_type in ('initial','incremental','manual_refresh')),
  records_seen      integer not null default 0,
  records_created   integer not null default 0,
  records_updated   integer not null default 0,
  records_deduped   integer not null default 0,
  error_message     text,
  started_at        timestamptz,
  completed_at      timestamptz,
  created_by        uuid references public.principals (id) on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists professional_network_sync_jobs_org_idx
  on public.professional_network_sync_jobs (organization_id, created_at desc);

alter table public.professional_network_sync_jobs enable row level security;

create policy professional_network_sync_jobs_select on public.professional_network_sync_jobs
  for select to authenticated
  using (organization_id in (select public.current_principal_org_ids()));

create policy professional_network_sync_jobs_insert on public.professional_network_sync_jobs
  for insert to authenticated
  with check (
    organization_id in (select public.current_principal_org_ids())
    and created_by = (select auth.uid())
  );

create policy professional_network_sync_jobs_update on public.professional_network_sync_jobs
  for update to authenticated
  using (organization_id in (select public.current_principal_org_ids()))
  with check (organization_id in (select public.current_principal_org_ids()));
