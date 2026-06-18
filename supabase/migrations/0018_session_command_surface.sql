-- 0018_session_command_surface.sql
-- The session command surface: per-session color + archive, a credit wallet
-- (the top-bar "Balance"), and shareable session links.

-- 1) Sessions gain an accent color and a reversible archive.
alter table public.sessions add column color text;
alter table public.sessions add column archived_at timestamptz;

create index sessions_archived_idx on public.sessions (organization_id, archived_at);

-- 2) Wallet — credits + plan per organization. "Balance" reads this; it shows 0
--    when the org has no credits. Plans (pricing/allotments) live in app config
--    (lib/billing.ts); this table just holds the org's current state.
create table public.wallets (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  credits         integer not null default 0,
  plan            text,                    -- e.g. 'starter' | 'pro' | 'scale' (null = no plan)
  plan_interval   text,                    -- 'monthly' | 'annual'
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger wallets_set_updated_at
  before update on public.wallets
  for each row execute function public.set_updated_at();

-- 3) Session shares — a read-only link (scope 'public', resolved by token via a
--    server route) or an org-only share (scope 'org').
create table public.session_shares (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id      uuid not null references public.sessions (id) on delete cascade,
  token           text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  scope           text not null default 'org' check (scope in ('public', 'org')),
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index session_shares_session_idx on public.session_shares (session_id);

-- RLS: member-read / writer-write org tenancy, as elsewhere. Public link reads
-- are served by a server route using the service role (token-gated), so no
-- anon policy is needed here.
alter table public.wallets enable row level security;
alter table public.session_shares enable row level security;

create policy wallets_select on public.wallets
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy wallets_write on public.wallets
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

create policy session_shares_select on public.session_shares
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy session_shares_write on public.session_shares
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
