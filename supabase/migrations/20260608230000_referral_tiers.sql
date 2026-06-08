-- Referral commission: configurable per-tier rates + a 2-level downline.
--
-- Extends the level-1 affiliate engine (20260608200000_referrals.sql) so the
-- referrer's referrer also earns when a referred org buys credits. Rates live in
-- a config table (basis points) so they can change without a code deploy, and
-- the payout walks the referral chain paying each level its configured rate.
--   tier 1 = 1000 bps (10%)  — the direct referrer
--   tier 2 =  500 bps (5%)   — the referrer's referrer

-- ── Per-tier commission rates (editable; add rows for deeper tiers later) ────
create table if not exists public.referral_tiers (
  tier integer primary key check (tier >= 1),
  rate_bps integer not null check (rate_bps >= 0 and rate_bps <= 10000)
);

insert into public.referral_tiers (tier, rate_bps)
values (1, 1000), (2, 500)
on conflict (tier) do nothing;

-- Read-only to authenticated users (the rate is not secret); writes are
-- service-role / dashboard only (no policy granted for write).
alter table public.referral_tiers enable row level security;

create policy "referral tiers are readable" on public.referral_tiers
  for select to authenticated using (true);

-- ── Record which level each commission was paid at (default 1 = direct) ─────
alter table public.referral_rewards
  add column if not exists tier integer not null default 1;

-- ── Multi-tier payout — replaces the single-level grant_referral_commission ──
-- Walks the referral chain up to the deepest configured tier, paying each level
-- its rate of the purchase. Idempotent per (referral, source_ref) at every
-- level, so Stripe retries never double-pay. No-ops when the org wasn't referred.
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
  _cursor_org uuid := _referred_org_id; -- the org whose referrer we resolve this level
  _level integer := 1;
  _max_tier integer;
  _ref public.referrals%rowtype;
  _rate integer;
  _commission integer;
  _reward_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'grant_referral_commission requires service_role' using errcode = '42501';
  end if;

  if _referred_org_id is null or coalesce(_credits_purchased, 0) <= 0 then
    return;
  end if;

  select max(tier) into _max_tier from public.referral_tiers;
  if _max_tier is null then
    return; -- no configured tiers
  end if;

  while _level <= _max_tier loop
    -- Who referred the current org in the chain?
    select * into _ref from public.referrals where referred_org_id = _cursor_org;
    exit when _ref.id is null; -- chain ends

    select rate_bps into _rate from public.referral_tiers where tier = _level;
    if coalesce(_rate, 0) > 0 then
      _commission := floor(_credits_purchased * _rate / 10000.0);
      if _commission > 0 then
        -- Idempotent: a null returning id means this (referral, purchase) was
        -- already paid — climb without re-granting.
        insert into public.referral_rewards (
          referral_id,
          source_ref,
          credits_purchased,
          commission_credits,
          tier
        )
        values (_ref.id, _source_ref, _credits_purchased, _commission, _level)
        on conflict (referral_id, source_ref) do nothing
        returning id into _reward_id;

        if _reward_id is not null then
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
              'tier', _level,
              'origin_org_id', _referred_org_id,
              'credits_purchased', _credits_purchased,
              'commission_credits', _commission,
              'source_ref', _source_ref
            )
          );
        end if;
      end if;
    end if;

    -- Climb: the current referrer becomes the next org whose referrer we seek.
    _cursor_org := _ref.referrer_org_id;
    _level := _level + 1;
  end loop;
end;
$$;

revoke all on function public.grant_referral_commission(uuid, text, integer)
  from public, anon, authenticated;
