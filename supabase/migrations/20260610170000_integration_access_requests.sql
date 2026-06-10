-- ============================================================================
-- integration_access_requests — capture interest in catalogued-but-not-yet-
-- wired providers.
--
-- The Integrations surface lists ~17 "coming soon" providers (Outlook, Teams,
-- Dropbox, HubSpot, Salesforce, DocuSign, Notion, …). Their card shows a
-- "Request access" button, but the click only flipped local React state — the
-- signal was lost on reload and ops never saw which providers members actually
-- want. This table persists one request per (org, user, provider) so the
-- button reflects a durable "Requested" state and ops can prioritize wiring by
-- real demand.
--
-- Mirrors the sibling integration_connections shape (org + user scoped, one row
-- per provider) and the snapshot tables' RLS posture: table-level RLS scoped to
-- org members for reads, writes go through the service-role API route (the
-- existing /api/integrations/* pattern), so authenticated needs no table-write
-- grant. Additive + idempotent.
-- ============================================================================

create table if not exists public.integration_access_requests (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- Free-text provider key from the static catalog (e.g. 'outlook', 'notion').
  -- Not an FK — the catalog is code-side, and providers graduate out of this
  -- table once wired, so we don't constrain to an enum here.
  provider    text not null,
  status      text not null default 'requested'
    check (status in ('requested', 'notified', 'fulfilled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- One standing request per member per provider; re-requesting just refreshes.
  unique (org_id, user_id, provider)
);

create index if not exists integration_access_requests_provider_idx
  on public.integration_access_requests (provider, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at'
      and tgrelid = 'public.integration_access_requests'::regclass
  ) then
    create trigger set_updated_at
      before update on public.integration_access_requests
      for each row execute function public.set_updated_at();
  end if;
end$$;

-- RLS — members read their own org's requests. Writes go through the
-- service-role API route, so authenticated gets select only.
alter table public.integration_access_requests enable row level security;

revoke all on table public.integration_access_requests from anon, authenticated;
grant select on table public.integration_access_requests to authenticated;
grant select, insert, update, delete on table public.integration_access_requests to service_role;

drop policy if exists "members read integration_access_requests"
  on public.integration_access_requests;
create policy "members read integration_access_requests"
  on public.integration_access_requests
  for select to authenticated
  using (private.is_org_member(org_id));
