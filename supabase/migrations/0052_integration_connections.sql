-- 0052_integration_connections.sql
-- The "merge gateway" connection ledger: per-organization records of which
-- dispatch channels (Gmail, Docusign, Slack, …) an org has connected through the
-- unified integration gateway. This moves "is this channel live?" from a
-- deploy-wide environment check to a real per-org connection — while the adapter
-- layer underneath is untouched. The gateway sits BEHIND the existing dispatch
-- SEAM: adapters keep their contract, and this table only records who is
-- connected. One row per (organization, channel); reconnecting overwrites it.
--
-- No secrets live here. The unified gateway (Merge / Zernio / …) holds the OAuth
-- tokens; we persist only a recognizable account handle and an opaque reference
-- the gateway resolves server-side, so a leaked row yields nothing usable.

create table if not exists public.integration_connections (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Dispatch channel name, matching lib/integrations adapters ("gmail", …).
  channel         text not null,
  -- 'connected' once the gateway link handshake completes; 'revoked' when the
  -- operator disconnects. A revoked row explicitly overrides any env-level
  -- default, so disconnect is honored even on a deploy that has the env var set.
  status          text not null default 'connected' check (status in ('connected', 'revoked')),
  -- Which unified gateway brokered the connection ("merge", "native", …).
  gateway         text not null default 'merge',
  -- Display label for the connected account (e.g. "ops@fund.com"). Never a
  -- secret — only a recognizable handle for the UI.
  account_label   text,
  -- Opaque gateway account handle used to address the connection on dispatch.
  -- Not a usable credential on its own; the gateway resolves it server-side.
  account_ref     text,
  connected_by    uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  unique (organization_id, channel)
);
create index if not exists integration_connections_org_idx
  on public.integration_connections (organization_id, channel);

drop trigger if exists integration_connections_set_updated_at on public.integration_connections;
create trigger integration_connections_set_updated_at
  before update on public.integration_connections
  for each row execute function public.set_updated_at();

-- RLS — member-read / writer-write org tenancy, as elsewhere.
alter table public.integration_connections enable row level security;

drop policy if exists integration_connections_select on public.integration_connections;
create policy integration_connections_select on public.integration_connections
  for select using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists integration_connections_write on public.integration_connections;
create policy integration_connections_write on public.integration_connections
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
