-- =====================================================================
-- Shareable beta access links — no-email, reusable links with claim tracking.
-- (Implements docs/BETA_ACCESS_LINKS.md.)
--
-- Org owners/admins generate a reusable, no-email link (label, role, max_uses,
-- expiry). Recipients claim it on a branded page via Google or their own email;
-- identity is captured at claim time. Usage is tracked by counting rows in
-- `beta_link_claims` (no denormalized counter to drift).
--
-- `claim_beta_link` is the only write path for claims: a SECURITY DEFINER RPC,
-- called POST-auth (service role) from /beta/claim/complete with a real user id.
-- It locks the link row, is idempotent per user, and enforces revoke/expiry/cap
-- atomically. Existing-account protection for the email path is handled in the
-- server action via generateLink(type:'invite'), so the RPC needs no
-- auth.users probe and is never invoked before identity is proven.
-- =====================================================================

create table if not exists public.beta_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  token text not null unique,
  label text,
  role public.org_member_role not null default 'member',
  max_uses integer not null default 25,
  expires_at timestamptz not null default (now() + interval '14 days'),
  revoked_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- DB-level invariant so no write path can persist a non-positive cap.
  constraint beta_links_max_uses_positive check (max_uses > 0)
);

create index if not exists beta_links_org_id_idx on public.beta_links (org_id);
create index if not exists beta_links_org_active_idx
  on public.beta_links (org_id, expires_at)
  where revoked_at is null;

create table if not exists public.beta_link_claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  beta_link_id uuid not null references public.beta_links (id) on delete cascade,
  -- Claims are only ever recorded post-auth, so the claimant is always known.
  user_id uuid not null references public.profiles (id) on delete cascade,
  email text not null,
  claimed_at timestamptz not null default now(),
  -- One claim per user per link → idempotent re-claims, honest cap counting.
  unique (beta_link_id, user_id)
);

create index if not exists beta_link_claims_org_id_idx on public.beta_link_claims (org_id);
create index if not exists beta_link_claims_beta_link_id_idx
  on public.beta_link_claims (beta_link_id);

create trigger set_updated_at before update on public.beta_links
  for each row execute function public.set_updated_at();

alter table public.beta_links enable row level security;
alter table public.beta_link_claims enable row level security;

-- Org owners/admins manage their links; claims insert only via the definer RPC.
create policy "admins manage beta links" on public.beta_links
  for all to authenticated
  using (private.is_org_admin(org_id))
  with check (private.is_org_admin(org_id));

create policy "admins view beta link claims" on public.beta_link_claims
  for select to authenticated
  using (private.is_org_admin(org_id));

-- =====================================================================
-- claim_beta_link(_token, _user_id, _email) — atomic, idempotent.
-- Locks the link row, checks for an existing claim by this user FIRST (so a
-- retry once the link is full still succeeds), then enforces revoke/expiry/cap.
-- Service-role only; called post-auth from /beta/claim/complete.
-- =====================================================================
create or replace function public.claim_beta_link(
  _token text,
  _user_id uuid,
  _email text
) returns table (ok boolean, error_reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  _link public.beta_links;
  _claims_count integer;
begin
  if _user_id is null then
    return query select false, 'Not signed in.'::text;
    return;
  end if;

  -- Serialize concurrent claims on this link.
  select * into _link from public.beta_links where token = _token for update;

  if not found then
    return query select false, 'Invalid link.'::text;
    return;
  end if;

  -- Idempotent: a repeat claim by the same user is a no-op success, even if the
  -- link is now revoked / expired / full.
  if exists (
    select 1 from public.beta_link_claims
    where beta_link_id = _link.id and user_id = _user_id
  ) then
    return query select true, null::text;
    return;
  end if;

  if _link.revoked_at is not null then
    return query select false, 'This link has been revoked.'::text;
    return;
  end if;
  if _link.expires_at <= now() then
    return query select false, 'This link has expired.'::text;
    return;
  end if;

  select count(*) into _claims_count
  from public.beta_link_claims
  where beta_link_id = _link.id;

  if _claims_count >= _link.max_uses then
    return query select false, 'This link has reached its limit.'::text;
    return;
  end if;

  insert into public.beta_link_claims (org_id, beta_link_id, user_id, email)
  values (_link.org_id, _link.id, _user_id, lower(trim(coalesce(_email, ''))));

  return query select true, null::text;
end;
$$;

revoke all on function public.claim_beta_link(text, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_beta_link(text, uuid, text) to service_role;
