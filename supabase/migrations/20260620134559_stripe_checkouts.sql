-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
-- Tracks hosted/embedded Stripe Checkout sessions so fulfillment (granting
-- credits, activating a plan, creating a paid gift) happens exactly once per
-- session. Idempotent. Depends only on organizations + principals.

create table if not exists public.stripe_checkouts (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id      text not null unique,
  kind            text not null check (kind in ('plan', 'pack', 'gift')),
  status          text not null default 'pending' check (status in ('pending', 'fulfilled', 'cancelled')),
  amount_usd      numeric,
  metadata        jsonb not null default '{}'::jsonb,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now(),
  fulfilled_at    timestamptz
);
create index if not exists stripe_checkouts_org_idx on public.stripe_checkouts (organization_id, created_at desc);

alter table public.stripe_checkouts enable row level security;

drop policy if exists stripe_checkouts_select on public.stripe_checkouts;
create policy stripe_checkouts_select on public.stripe_checkouts
  for select using (organization_id in (select public.current_principal_org_ids()));;
