-- Referrals & affiliate commissions (level-1).
--
-- A referred user owns their own org (handle_new_user provisions every non-Bey
-- signup as `owner` of a fresh org). When that org buys credits, the referrer's
-- org earns a 10% commission in Earn credits. This is level-1 only; the schema
-- (a per-org referrer link + a commission ledger) extends cleanly to a downline
-- later — adding the referrer's own referrer is a join, not a rewrite.
--
-- Attribution is first-touch and keyed to the referred user's OWN org, so a
-- per-email invitee who merely joins the inviter's org (same wallet) never
-- generates a self-paying commission.

-- ── 1) Durable, first-touch referral link ──────────────────────────────────
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  -- The referred user's own org — where their purchases (and the commission
  -- basis) live. One referrer per referred org (first touch wins).
  referred_org_id uuid not null unique references public.organizations (id) on delete cascade,
  referred_user_id uuid not null references public.profiles (id) on delete cascade,
  -- Who gets paid: the inviting user and the org whose wallet receives credits.
  referrer_user_id uuid not null references public.profiles (id) on delete cascade,
  referrer_org_id uuid not null references public.organizations (id) on delete cascade,
  source text not null check (source in ('beta_link', 'beta_invite')),
  source_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists referrals_referrer_org_idx on public.referrals (referrer_org_id);
create index if not exists referrals_referrer_user_idx on public.referrals (referrer_user_id);
create index if not exists referrals_source_idx on public.referrals (source, source_id);

-- ── 2) Commission ledger — one row per (referral, purchase), idempotent ─────
create table if not exists public.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.referrals (id) on delete cascade,
  source_ref text not null, -- the Stripe checkout-session / invoice id paid out on
  credits_purchased integer not null,
  commission_credits integer not null,
  created_at timestamptz not null default now(),
  -- Guards double-pay across Stripe webhook retries.
  unique (referral_id, source_ref)
);

create index if not exists referral_rewards_referral_idx on public.referral_rewards (referral_id);

-- ── RLS — admins of the referrer org read their own referrals + rewards ─────
alter table public.referrals enable row level security;
alter table public.referral_rewards enable row level security;

create policy "admins read their org referrals" on public.referrals
  for select to authenticated
  using (private.is_org_admin(referrer_org_id));

create policy "admins read their org referral rewards" on public.referral_rewards
  for select to authenticated
  using (
    exists (
      select 1
      from public.referrals r
      where r.id = referral_id and private.is_org_admin(r.referrer_org_id)
    )
  );

-- ── 3) record_referral — capture the first-touch link (service role) ────────
-- Resolves the referred user's OWN org and writes the link. No-ops on a
-- self-referral, a teammate (same org), a user without an own org, or a repeat.
create or replace function public.record_referral(
  _referred_user_id uuid,
  _referrer_user_id uuid,
  _referrer_org_id uuid,
  _source text,
  _source_id uuid default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _referred_org_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'record_referral requires service_role' using errcode = '42501';
  end if;

  if _referred_user_id is null or _referrer_user_id is null or _referrer_org_id is null then
    return;
  end if;
  if _referred_user_id = _referrer_user_id then
    return; -- no self-referral
  end if;

  -- The referred user's own org (handle_new_user makes them its owner).
  select om.org_id
    into _referred_org_id
    from public.org_members om
   where om.user_id = _referred_user_id
     and om.role = 'owner'
   order by om.created_at asc
   limit 1;

  if _referred_org_id is null then
    return; -- no own org to attribute purchases to
  end if;
  if _referred_org_id = _referrer_org_id then
    return; -- teammate in the inviter's org, not a referral
  end if;

  insert into public.referrals (
    referred_org_id,
    referred_user_id,
    referrer_user_id,
    referrer_org_id,
    source,
    source_id
  )
  values (
    _referred_org_id,
    _referred_user_id,
    _referrer_user_id,
    _referrer_org_id,
    _source,
    _source_id
  )
  on conflict (referred_org_id) do nothing; -- first touch wins
end;
$$;

revoke all on function public.record_referral(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;

-- ── 4) grant_referral_commission — pay the referrer on a purchase ───────────
-- Idempotent per (referral, source_ref). No-ops when the org wasn't referred or
-- the purchase was already paid out. 10% of purchased credits, floored.
create or replace function public.grant_referral_commission(
  _referred_org_id uuid,
  _source_ref text,
  _credits_purchased integer
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _ref public.referrals%rowtype;
  _commission integer;
  _reward_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'grant_referral_commission requires service_role' using errcode = '42501';
  end if;

  if _referred_org_id is null or coalesce(_credits_purchased, 0) <= 0 then
    return;
  end if;

  select * into _ref from public.referrals where referred_org_id = _referred_org_id;
  if _ref.id is null then
    return; -- not a referred org
  end if;

  _commission := floor(_credits_purchased * 0.10); -- 10%
  if _commission <= 0 then
    return;
  end if;

  -- Idempotent: the unique (referral_id, source_ref) makes a retry a no-op, and
  -- a null returning id means we already paid this purchase — do not grant twice.
  insert into public.referral_rewards (
    referral_id,
    source_ref,
    credits_purchased,
    commission_credits
  )
  values (_ref.id, _source_ref, _credits_purchased, _commission)
  on conflict (referral_id, source_ref) do nothing
  returning id into _reward_id;

  if _reward_id is null then
    return;
  end if;

  perform public.grant_credits(
    _ref.referrer_org_id,
    _commission,
    'referral_commission',
    _reward_id
  );

  insert into public.admin_actions (
    org_id,
    admin_user_id,
    action_type,
    target_type,
    target_id,
    metadata
  )
  values (
    _ref.referrer_org_id,
    _ref.referrer_user_id,
    'referral_commission',
    'referral',
    _ref.id,
    jsonb_build_object(
      'referred_org_id', _referred_org_id,
      'credits_purchased', _credits_purchased,
      'commission_credits', _commission,
      'source_ref', _source_ref
    )
  );
end;
$$;

revoke all on function public.grant_referral_commission(uuid, text, integer)
  from public, anon, authenticated;
