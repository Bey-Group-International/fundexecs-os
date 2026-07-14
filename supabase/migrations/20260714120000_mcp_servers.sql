-- Migration: mcp_servers — per-org registry of custom MCP (Model Context
-- Protocol) servers an operator registers in Settings.
--
-- This is a REGISTRY only: it persists the connection details for a remote
-- (HTTP / SSE) MCP server so the org can manage them in one place. Nothing in
-- this migration connects to the server or executes its tools — runtime wiring
-- is a deliberate follow-up.
--
-- Auth is optional. When the server needs a bearer token, it is stored encrypted
-- at rest with the SAME AES-256-GCM envelope as org_secrets (see lib/vault.ts):
-- ciphertext + iv + auth_tag, all base64, plus a masked last-4 for display. The
-- plaintext token is never persisted and never returned to the client. A server
-- that needs no auth simply leaves the token columns null.
--
-- Follows the house tenancy pattern: member-read / writer-write on
-- organization_id, mirroring api_keys / org_secrets (migration 0044).

create table if not exists public.mcp_servers (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  -- Operator-facing display name; unique within the org so the list stays clean.
  name             text not null,
  -- Remote transport only: streamable HTTP or Server-Sent Events.
  transport        text not null default 'http' check (transport in ('http', 'sse')),
  -- The server endpoint. Application-level validation restricts this to http(s).
  url              text not null,
  -- Header the token is sent under at use-time (default Authorization: Bearer …).
  auth_header      text not null default 'Authorization',
  -- Encrypted bearer token (base64 ciphertext + nonce + tag). Null = no auth.
  token_ciphertext text,
  token_iv         text,
  token_auth_tag   text,
  -- Last 4 plaintext chars, for a recognizable masked display only.
  token_last4      text,
  -- Registered-but-paused servers stay in the list but are marked disabled.
  enabled          boolean not null default true,
  created_by       uuid references public.principals (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, name)
);

create index if not exists mcp_servers_org_idx
  on public.mcp_servers (organization_id, created_at desc);

drop trigger if exists mcp_servers_set_updated_at on public.mcp_servers;
create trigger mcp_servers_set_updated_at
  before update on public.mcp_servers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — member-read / writer-write org tenancy, as elsewhere. The ciphertext is
-- readable by org members but is useless without the server-side vault key.
-- ---------------------------------------------------------------------------
alter table public.mcp_servers enable row level security;

drop policy if exists mcp_servers_select on public.mcp_servers;
create policy mcp_servers_select on public.mcp_servers
  for select using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists mcp_servers_write on public.mcp_servers;
create policy mcp_servers_write on public.mcp_servers
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
