-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
-- Gift Earn: referral downline, credit ledger, purchased credit gifts, and the
-- atomic increment_org_credits RPC. Idempotent. Depends only on organizations,
-- principals, wallets, and the existing RLS helper functions.

create table if not exists public.referral_codes (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  code            text not null unique,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now()
);
do $$ begin
  create index if not exists referral_codes_code_idx on public.referral_codes (code);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

create table if not exists public.referrals (
  id                       uuid primary key default extensions.gen_random_uuid(),
  referrer_organization_id uuid not null references public.organizations (id) on delete cascade,
  referred_organization_id uuid not null unique references public.organizations (id) on delete cascade,
  code                     text not null,
  status                   text not null default 'joined' check (status in ('pending', 'joined', 'subscribed')),
  created_at               timestamptz not null default now(),
  constraint referrals_no_self check (referrer_organization_id <> referred_organization_id)
);
do $$ begin
  create index if not exists referrals_referrer_idx on public.referrals (referrer_organization_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

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
do $$ begin
  create index if not exists credit_ledger_org_idx on public.credit_ledger (organization_id, created_at desc);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

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
do $$ begin
  create index if not exists credit_gifts_sender_idx on public.credit_gifts (sender_organization_id, created_at desc);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

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

drop policy if exists referral_codes_select on public.referral_codes;
create policy referral_codes_select on public.referral_codes
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists referral_codes_write on public.referral_codes;
create policy referral_codes_write on public.referral_codes
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

drop policy if exists referrals_select on public.referrals;
create policy referrals_select on public.referrals
  for select using (
    referrer_organization_id in (select public.current_principal_org_ids())
    or referred_organization_id in (select public.current_principal_org_ids())
  );

drop policy if exists credit_ledger_select on public.credit_ledger;
create policy credit_ledger_select on public.credit_ledger
  for select using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists credit_gifts_select on public.credit_gifts;
create policy credit_gifts_select on public.credit_gifts
  for select using (sender_organization_id in (select public.current_principal_org_ids()));;
