-- 20261103120000_organization_invites.sql
-- Pending Team invites for people who do not have a FundExecs account yet.
--
-- Until now the Team invite form refused anyone without an account ("ask them to
-- sign up first"). An invite for an email with no account is now stored here and
-- emailed; the person is attached to the organization the moment they sign in
-- with that address, so they never have to be re-added.
--
--   * The email address is the credential, not a secret in a link: an invite is
--     only claimed by a principal whose address is CONFIRMED, so nobody can
--     claim someone else's invite by typing their address at sign-up.
--   * It expires (30 days) so an old invite to a reassigned mailbox is inert.
--   * invited_by_platform_admin records whether a platform admin sent it. Only
--     those invites let a brand-new person past the access-request gate
--     (lib/access-requests.ts); an ordinary org admin cannot admit people to the
--     platform just by typing an address.
--
-- Written only through the service role (lib/team-invites.server). Members can
-- read their own org's pending invites.

create table if not exists public.organization_invites (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.organizations(id) on delete cascade,
  email                     text not null,
  role                      public.member_role not null default 'member',
  invited_by                uuid references public.principals(id) on delete set null,
  invited_by_platform_admin boolean not null default false,
  created_at                timestamptz not null default now(),
  expires_at                timestamptz not null default (now() + interval '30 days'),
  accepted_at               timestamptz
);

-- One live invite per address per organization; re-inviting refreshes it.
create unique index if not exists organization_invites_open_idx
  on public.organization_invites (organization_id, lower(email))
  where accepted_at is null;

-- The sign-in claim looks invites up by address alone.
create index if not exists organization_invites_email_idx
  on public.organization_invites (lower(email))
  where accepted_at is null;

alter table public.organization_invites enable row level security;

drop policy if exists organization_invites_select on public.organization_invites;
create policy organization_invites_select on public.organization_invites
  for select using (organization_id in (select public.current_principal_org_ids()));
