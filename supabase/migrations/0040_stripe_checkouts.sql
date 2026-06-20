-- 0040_stripe_checkouts.sql
-- Tracks hosted Stripe Checkout sessions so fulfillment (granting credits,
-- activating a plan, creating a paid gift) happens exactly once per session.
-- Rows are written by the server (service role) when a session is created and
-- flipped to 'fulfilled' on the success redirect / webhook. Idempotent so it is
-- safe to re-apply on a stateful preview branch.

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

-- An org reads its own checkout history. All writes go through the service role
-- (session creation + fulfillment), so no member write policy.
drop policy if exists stripe_checkouts_select on public.stripe_checkouts;
create policy stripe_checkouts_select on public.stripe_checkouts
  for select using (organization_id in (select public.current_principal_org_ids()));
