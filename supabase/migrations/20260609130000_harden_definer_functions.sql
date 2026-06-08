-- Security hardening surfaced by the database linter (post org-admin launch).
--
-- 1) Pin search_path on two trigger functions that were missing it. A mutable
--    search_path on a function lets a caller's role-local search_path influence
--    name resolution; pinning to '' forces fully-qualified resolution. These two
--    only set updated_at, so '' is safe (now() lives in pg_catalog).
--
-- 2) Authorize redeem_gift. It is SECURITY DEFINER and callable by the
--    `authenticated` role via RPC, yet took _org_id / _user_id as parameters
--    without verifying the caller. A signed-in user could redeem a code they
--    hold into an arbitrary org, or attribute the redemption to another user.
--    The guard keeps the service_role path (checkout/provisioning) untouched and
--    matches the app, which always passes auth.uid() and the user's active org.

create or replace function public.touch_gift_codes_updated_at()
  returns trigger
  language plpgsql
  set search_path = ''
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

create or replace function public.touch_org_subscriptions_updated_at()
  returns trigger
  language plpgsql
  set search_path = ''
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

create or replace function public.redeem_gift(_code text, _org_id uuid, _user_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $function$
declare
  _gift public.gift_codes;
  _balance integer;
begin
  -- Authz: a signed-in caller may only redeem into their own active workspace.
  -- service_role (server-side provisioning) is trusted and bypasses the check.
  if (select auth.role()) <> 'service_role'
     and (auth.uid() is distinct from _user_id or not private.is_org_member(_org_id)) then
    raise exception 'Not authorized to redeem a gift into this workspace'
      using errcode = '42501';
  end if;

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
$function$;
