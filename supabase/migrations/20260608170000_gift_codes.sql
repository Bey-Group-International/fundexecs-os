-- ============================================================================
-- Gift credits — purchasable credit gifts redeemed into a recipient's workspace.
--
-- A buyer (logged-in or not) purchases a credit gift via Stripe. We record a
-- gift_codes row (pending → active on payment) carrying a url-safe redeem code.
-- The recipient opens /gift/claim?code=… and redeems it into their org, which
-- grants the credits via grant_credits — atomically and exactly once.
--
-- Reads/writes are mediated by SECURITY DEFINER RPCs (get_gift_by_code,
-- redeem_gift) and the service role (purchase + activation), so the table needs
-- no anon/authenticated table-level grants.
-- ============================================================================

create table if not exists public.gift_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  amount_cents integer not null check (amount_cents > 0),
  credits integer not null check (credits > 0),
  recipient_name text,
  recipient_email text,
  sender_name text,
  message text,
  occasion_date date,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'redeemed', 'refunded', 'canceled')),
  stripe_session_id text unique,
  purchaser_user_id uuid,
  redeemed_by_org_id uuid references public.organizations(id) on delete set null,
  redeemed_by_user_id uuid,
  redeemed_at timestamptz,
  email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gift_codes_status_idx on public.gift_codes (status, created_at desc);
create index if not exists gift_codes_redeemed_org_idx on public.gift_codes (redeemed_by_org_id);

-- keep updated_at fresh
create or replace function public.touch_gift_codes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_gift_codes_updated_at on public.gift_codes;
create trigger trg_gift_codes_updated_at
  before update on public.gift_codes
  for each row execute function public.touch_gift_codes_updated_at();

alter table public.gift_codes enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'gift_codes'
      and policyname = 'service_role all gift_codes'
  ) then
    create policy "service_role all gift_codes" on public.gift_codes
      for all to service_role using (true) with check (true);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- get_gift_by_code — safe public lookup for the claim page (no email exposed).
-- Returns NULL when the code is unknown. Knowing the code is the capability.
-- ---------------------------------------------------------------------------
create or replace function public.get_gift_by_code(_code text)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'credits', credits,
    'amount_cents', amount_cents,
    'sender_name', sender_name,
    'recipient_name', recipient_name,
    'message', message,
    'occasion_date', occasion_date,
    'status', status
  )
  from public.gift_codes
  where code = _code;
$$;

-- ---------------------------------------------------------------------------
-- redeem_gift — atomically claim an active gift for an org and grant credits.
-- One-time: a second call returns {ok:false, error:'redeemed'}. Returns the new
-- wallet balance on success.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_gift(_code text, _org_id uuid, _user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _gift public.gift_codes;
  _balance integer;
begin
  select * into _gift from public.gift_codes where code = _code for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if _gift.status = 'redeemed' then
    return jsonb_build_object('ok', false, 'error', 'redeemed');
  end if;
  if _gift.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'not_active');
  end if;

  update public.gift_codes
     set status = 'redeemed',
         redeemed_by_org_id = _org_id,
         redeemed_by_user_id = _user_id,
         redeemed_at = now(),
         updated_at = now()
   where id = _gift.id;

  -- Same transaction: a failed grant rolls back the redemption above.
  _balance := public.grant_credits(_org_id, _gift.credits, 'gift_redeem', _gift.id);

  return jsonb_build_object('ok', true, 'credits', _gift.credits, 'balance', _balance);
end;
$$;

revoke all on function public.get_gift_by_code(text) from public;
grant execute on function public.get_gift_by_code(text) to anon, authenticated, service_role;

revoke all on function public.redeem_gift(text, uuid, uuid) from public, anon;
grant execute on function public.redeem_gift(text, uuid, uuid) to authenticated, service_role;
