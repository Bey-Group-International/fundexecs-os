-- =====================================================================
-- Shareable public Profile links — revocable, token-gated, safe-subset.
--
-- An org owner/admin mints an unguessable token link to their Source-of-Truth
-- Profile. The public page (/p/<token>) is served by a server component using
-- the service-role admin client, which validates the token (not revoked, not
-- expired) and renders ONLY a safe subset of the profile (identity, headline,
-- focus areas, sectors/stage, member type, org name — never thesis, terms,
-- target raise, track record, team, bio, or draft).
--
-- No anon RLS is added: public reads go through the admin client on the public
-- route, mirroring the beta-links pattern. RLS here only governs owners/admins
-- managing their own org's share links.
--
-- Every statement is idempotent so the migration is safe to re-apply on the
-- Supabase preview branch (drop-if-exists for the trigger and policy; the active
-- index is a UNIQUE partial index so only one live link can exist per org).
-- =====================================================================

create table if not exists public.member_profile_shares (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  token text not null unique,
  label text,
  -- null = never expires; otherwise the link is dead past this instant.
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists member_profile_shares_org_id_idx
  on public.member_profile_shares (org_id);

-- One LIVE link per org — enforced at the DB so concurrent mints can't create
-- duplicate active tokens. (Supersedes the earlier non-unique active index.)
drop index if exists public.member_profile_shares_org_active_idx;
create unique index if not exists member_profile_shares_one_active_per_org_idx
  on public.member_profile_shares (org_id)
  where revoked_at is null;

drop trigger if exists set_updated_at on public.member_profile_shares;
create trigger set_updated_at before update on public.member_profile_shares
  for each row execute function public.set_updated_at();

alter table public.member_profile_shares enable row level security;

-- Owners/admins manage their own org's share links. Public reads do NOT use
-- RLS — they go through the service-role admin client on the public route.
drop policy if exists "owners manage profile shares" on public.member_profile_shares;
create policy "owners manage profile shares" on public.member_profile_shares
  for all to authenticated
  using (private.is_org_admin(org_id))
  with check (private.is_org_admin(org_id));
