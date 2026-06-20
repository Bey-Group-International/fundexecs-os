-- 0039_referrals_and_gifts.sql
-- Gift Earn: a multi-level referral ("downline") program, purchased credit
-- gifts, and an append-only credit ledger that records every credit movement so
-- referral earnings can be shown and audited. Idempotent (IF NOT EXISTS +
-- drop/recreate policies) so it is safe to re-apply on a stateful preview branch.

-- ---------------------------------------------------------------------------
-- referral_codes — one shareable code per org. The code is the org's invite
-- handle; a join link is /join?ref=<code>.
-- ---------------------------------------------------------------------------
create table if not exists public.referral_codes (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  code            text not null unique,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists referral_codes_code_idx on public.referral_codes (code);

-- ---------------------------------------------------------------------------
-- referrals — the downline forest. Each org is referred at most once
-- (referred_organization_id unique), so referrer edges form a forest; an org's
-- downline is the transitive set of its descendants. Status tracks the
-- lifecycle (joined → subscribed) for richer rewards later.
-- ---------------------------------------------------------------------------
create table if not exists public.referrals (
  id                       uuid primary key default extensions.gen_random_uuid(),
  referrer_organization_id uuid not null references public.organizations (id) on delete cascade,
  referred_organization_id uuid not null unique references public.organizations (id) on delete cascade,
  code                     text not null,
  status                   text not null default 'joined' check (status in ('pending', 'joined', 'subscribed')),
  created_at               timestamptz not null default now(),
  constraint referrals_no_self check (referrer_organization_id <> referred_organization_id)
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_organization_id);

-- ---------------------------------------------------------------------------
-- credit_ledger — append-only record of every credit movement, so referral
-- earnings, gifts, and grants can be shown and audited. Positive = credited,
-- negative = spent/sent. `level` records downline depth for referral overrides.
-- ---------------------------------------------------------------------------
create table if not exists public.credit_ledger (
  id                     uuid primary key default extensions.gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete cascade,
  amount                 integer not null,
  reason                 text not null,
  source_organization_id uuid references public.organizations (id) on delete set null,
  level                  integer,
  note                   text,
  created_at             timestamptz not null default now()
);
create index if not exists credit_ledger_org_idx on public.credit_ledger (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- credit_gifts — credits purchased FOR someone else, redeemable by token/link.
-- Payment is mocked until a provider is wired; the gift still moves real credits
-- on redemption.
-- ---------------------------------------------------------------------------
create table if not exists public.credit_gifts (
  id                          uuid primary key default extensions.gen_random_uuid(),
  sender_organization_id      uuid not null references public.organizations (id) on delete cascade,
  recipient_email             text not null,
  credits                     integer not null,
  amount_usd                  numeric not null,
  message                     text,
  status                      text not null default 'pending' check (status in ('pending', 'redeemed', 'cancelled')),
  redeem_token                text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  redeemed_by_organization_id uuid references public.organizations (id) on delete set null,
  created_by                  uuid references public.principals (id) on delete set null,
  created_at                  timestamptz not null default now(),
  redeemed_at                 timestamptz
);
create index if not exists credit_gifts_sender_idx on public.credit_gifts (sender_organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- increment_org_credits — atomic credit grant that creates the wallet if it
-- doesn't exist yet and never lets a balance go negative. Used by the referral
-- reward engine and gift redemption (which credit OTHER orgs' wallets, so they
-- run with the service role and need this to bypass per-row read-modify-write).
-- ---------------------------------------------------------------------------
create or replace function public.increment_org_credits(p_org uuid, p_delta integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance integer;
begin
  insert into public.wallets (organization_id, credits)
    values (p_org, greatest(0, p_delta))
  on conflict (organization_id)
    do update set credits = greatest(0, wallets.credits + p_delta)
  returning credits into new_balance;
  return new_balance;
end;
$$;

alter table public.referral_codes enable row level security;
alter table public.referrals      enable row level security;
alter table public.credit_ledger  enable row level security;
alter table public.credit_gifts   enable row level security;

-- referral_codes: an org reads/writes its own code.
drop policy if exists referral_codes_select on public.referral_codes;
create policy referral_codes_select on public.referral_codes
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists referral_codes_write on public.referral_codes;
create policy referral_codes_write on public.referral_codes
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- referrals: an org sees rows where it is the referrer (its downline) or the
-- referred org. Writes happen through the service-role reward engine.
drop policy if exists referrals_select on public.referrals;
create policy referrals_select on public.referrals
  for select using (
    referrer_organization_id in (select public.current_principal_org_ids())
    or referred_organization_id in (select public.current_principal_org_ids())
  );

-- credit_ledger: an org reads its own entries. Writes via the service role.
drop policy if exists credit_ledger_select on public.credit_ledger;
create policy credit_ledger_select on public.credit_ledger
  for select using (organization_id in (select public.current_principal_org_ids()));

-- credit_gifts: the sender reads its sent gifts. Writes via server actions /
-- service role (redemption credits another org).
drop policy if exists credit_gifts_select on public.credit_gifts;
create policy credit_gifts_select on public.credit_gifts
  for select using (sender_organization_id in (select public.current_principal_org_ids()));
