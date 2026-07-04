-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
create table if not exists public.api_keys (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  mode            text not null default 'test' check (mode in ('test', 'live')),
  publishable_key text not null unique,
  secret_hash     text not null unique,
  secret_prefix   text not null,
  secret_last4    text not null,
  last_used_at    timestamptz,
  revoked_at      timestamptz,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
do $$ begin
  create index if not exists api_keys_org_idx on public.api_keys (organization_id, created_at desc);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  create index if not exists api_keys_secret_hash_idx on public.api_keys (secret_hash);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  drop trigger if exists api_keys_set_updated_at on public.api_keys;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;
do $$ begin
  create trigger api_keys_set_updated_at
  before update on public.api_keys
  for each row execute function public.set_updated_at();
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

create table if not exists public.org_secrets (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider        text not null,
  label           text,
  ciphertext      text not null,
  iv              text not null,
  auth_tag        text not null,
  last4           text not null,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, provider)
);
do $$ begin
  create index if not exists org_secrets_org_idx on public.org_secrets (organization_id, provider);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  drop trigger if exists org_secrets_set_updated_at on public.org_secrets;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;
do $$ begin
  create trigger org_secrets_set_updated_at
  before update on public.org_secrets
  for each row execute function public.set_updated_at();
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

do $$ begin
  alter table public.api_keys    enable row level security;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;
do $$ begin
  alter table public.org_secrets enable row level security;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

drop policy if exists api_keys_select on public.api_keys;
do $$ begin
  create policy api_keys_select on public.api_keys
  for select using (organization_id in (select public.current_principal_org_ids()));
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;
drop policy if exists api_keys_write on public.api_keys;
do $$ begin
  create policy api_keys_write on public.api_keys
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

drop policy if exists org_secrets_select on public.org_secrets;
do $$ begin
  create policy org_secrets_select on public.org_secrets
  for select using (organization_id in (select public.current_principal_org_ids()));
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;
drop policy if exists org_secrets_write on public.org_secrets;
do $$ begin
  create policy org_secrets_write on public.org_secrets
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;;
