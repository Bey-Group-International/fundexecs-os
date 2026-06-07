-- =====================================================================
-- Shareable beta access links — no-email, reusable links with claim tracking.
--
-- Org admins generate a reusable, no-email beta link with label, role, 
-- max uses, and expiry. Recipients claim the link on a branded page via 
-- Google or email. Identity is captured at claim time.
--
-- Two tables:
--   beta_links: the link and its metadata (label, role, max_uses, expires_at)
--   beta_link_claims: audit trail of who claimed what and when
--
-- Claim flow is atomic via SECURITY DEFINER `claim_beta_link(_token, _user_id, _email)`:
--   - Verify token is not revoked, expired, or at max claims
--   - Insert a claim record with email + user_id
--   - Atomically enforce cap/expiry/revoke
--
-- Defaults: max_uses 25, expiry 14 days from creation.
-- =====================================================================

create table if not exists public.beta_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  token text not null unique,
  label text,
  role text not null default 'member',
  max_uses integer not null default 25,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists beta_links_org_id_idx
  on public.beta_links (org_id);
create index if not exists beta_links_token_idx
  on public.beta_links (token);
create index if not exists beta_links_org_active_idx
  on public.beta_links (org_id, revoked_at, expires_at)
  where revoked_at is null;

create table if not exists public.beta_link_claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  beta_link_id uuid not null references public.beta_links (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  email text not null,
  claimed_at timestamptz not null default now(),
  unique (beta_link_id, user_id, email)
);

create index if not exists beta_link_claims_org_id_idx
  on public.beta_link_claims (org_id);
create index if not exists beta_link_claims_beta_link_id_idx
  on public.beta_link_claims (beta_link_id);
create index if not exists beta_link_claims_user_id_idx
  on public.beta_link_claims (user_id);

create trigger set_updated_at before update on public.beta_links
  for each row execute function public.set_updated_at();

alter table public.beta_links enable row level security;
alter table public.beta_link_claims enable row level security;

-- Admins of the org manage beta_links (create, revoke, list).
create policy "admins manage beta links" on public.beta_links
  for all to authenticated
  using (private.is_org_admin(org_id))
  with check (private.is_org_admin(org_id));

-- Public read on claims (for analytics post-claim), but claims are inserted
-- only by the RPC. Admins can see all claims for their org's links.
create policy "admins view beta link claims" on public.beta_link_claims
  for select to authenticated
  using (private.is_org_admin(org_id));

-- =====================================================================
-- claim_beta_link(_token, _user_id, _email)
-- =====================================================================
-- Atomic RPC for email-based beta link claims. Type must be 'invite' so
-- a shared link cannot be used to sign an existing account into the app.
--
-- On success:
--   - Inserts a claim record
--   - Returns ok=true
--
-- On error (revoked, expired, at cap, email already has account):
--   - Returns error reason
--
-- No session or cookies set here. The consumer (app/beta/claim/complete/route.ts 
-- post-auth) calls the RPC and handles the response.

create or replace function public.claim_beta_link(
  _token text,
  _user_id uuid,
  _email text
) returns table (
  ok boolean,
  error_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  _link_id uuid;
  _org_id uuid;
  _role text;
  _claims_count integer;
  _max_uses integer;
begin
  _email := lower(trim(coalesce(_email, '')));
  if _email = '' then
    return query select false, 'Email is required.'::text;
    return;
  end if;

  -- Fetch the link; verify it exists, is not revoked, and has not expired.
  select id, org_id, role, max_uses
  into _link_id, _org_id, _role, _max_uses
  from public.beta_links
  where token = _token
    and revoked_at is null
    and expires_at > now();

  if _link_id is null then
    -- Determine reason: revoked, expired, or not found.
    if exists (select 1 from public.beta_links where token = _token and revoked_at is not null) then
      return query select false, 'Link revoked'::text;
    elsif exists (select 1 from public.beta_links where token = _token and expires_at <= now()) then
      return query select false, 'Link expired'::text;
    else
      return query select false, 'Invalid link'::text;
    end if;
    return;
  end if;

  -- Count existing claims for this link.
  select count(*)
  into _claims_count
  from public.beta_link_claims
  where beta_link_id = _link_id;

  -- Check if at max.
  if _claims_count >= _max_uses then
    return query select false, 'Link at max uses'::text;
    return;
  end if;

  -- Block existing accounts from using the shared link (enforce 'invite'-only flow).
  if exists (select 1 from auth.users where email = _email) then
    return query select false, 'Email already registered'::text;
    return;
  end if;

  -- Insert the claim record.
  insert into public.beta_link_claims (org_id, beta_link_id, user_id, email)
  values (_org_id, _link_id, _user_id, _email)
  on conflict (beta_link_id, user_id, email) do nothing;

  return query select true, null::text;
end;
$$;

revoke all on function public.claim_beta_link(text, uuid, text) from public, anon;
grant execute on function public.claim_beta_link(text, uuid, text) to authenticated, anon;
