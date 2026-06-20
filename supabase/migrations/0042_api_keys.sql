-- 0042_api_keys.sql
-- Settings → APIs. Two related but distinct subsystems:
--
--   1. api_keys  — FundExecs-ISSUED credentials. Each row is a Stripe-style
--      publishable/secret pair an org generates to authenticate to the FundExecs
--      OS API. The publishable key is stored in the clear (it is meant to be
--      shared); the secret key is shown to the operator exactly once at creation
--      and only its SHA-256 hash is persisted, so a leaked database never yields a
--      working secret. `mode` separates test from live credentials.
--
--   2. org_secrets — a vault for THIRD-PARTY secrets an org pastes in (their own
--      Anthropic / Stripe / etc. keys) for FundExecs to use on their behalf.
--      Values are encrypted at rest (AES-256-GCM, see lib/vault.ts) so they can be
--      decrypted server-side when used; the UI only ever shows a masked last-4.
--
-- Both follow the house tenancy pattern: member-read / writer-write on
-- organization_id, with the service role (which bypasses RLS) doing the
-- token-gated verification lookups for inbound API calls.

-- ---------------------------------------------------------------------------
-- api_keys — issued publishable/secret credential pairs.
-- ---------------------------------------------------------------------------
create table if not exists public.api_keys (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  mode            text not null default 'test' check (mode in ('test', 'live')),
  -- Public by design (e.g. fxpk_live_…); safe to display in full.
  publishable_key text not null unique,
  -- SHA-256 hex of the secret. The secret itself is never stored.
  secret_hash     text not null unique,
  -- Non-secret display fragments so the UI can show "fxsk_live_••••1234".
  secret_prefix   text not null,
  secret_last4    text not null,
  last_used_at    timestamptz,
  revoked_at      timestamptz,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists api_keys_org_idx on public.api_keys (organization_id, created_at desc);
-- Verification path looks up live keys by their secret hash.
create index if not exists api_keys_secret_hash_idx on public.api_keys (secret_hash);

drop trigger if exists api_keys_set_updated_at on public.api_keys;
create trigger api_keys_set_updated_at
  before update on public.api_keys
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- org_secrets — encrypted vault for third-party provider credentials. One row
-- per (organization, provider); re-saving a provider overwrites it.
-- ---------------------------------------------------------------------------
create table if not exists public.org_secrets (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider        text not null,
  label           text,
  -- AES-256-GCM ciphertext + nonce + auth tag, all base64. Never the plaintext.
  ciphertext      text not null,
  iv              text not null,
  auth_tag        text not null,
  -- Last 4 plaintext chars, kept for a recognizable masked display only.
  last4           text not null,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, provider)
);
create index if not exists org_secrets_org_idx on public.org_secrets (organization_id, provider);

drop trigger if exists org_secrets_set_updated_at on public.org_secrets;
create trigger org_secrets_set_updated_at
  before update on public.org_secrets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — member-read / writer-write org tenancy, as elsewhere. The secret hash
-- and ciphertext are readable by org members, but neither yields a usable
-- credential on its own (hash is one-way; ciphertext needs the server key).
-- ---------------------------------------------------------------------------
alter table public.api_keys    enable row level security;
alter table public.org_secrets enable row level security;

drop policy if exists api_keys_select on public.api_keys;
create policy api_keys_select on public.api_keys
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists api_keys_write on public.api_keys;
create policy api_keys_write on public.api_keys
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

drop policy if exists org_secrets_select on public.org_secrets;
create policy org_secrets_select on public.org_secrets
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists org_secrets_write on public.org_secrets;
create policy org_secrets_write on public.org_secrets
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
