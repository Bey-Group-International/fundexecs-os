-- =====================================================================
-- Beta invites — magic-link invitations for the private beta.
--
-- Org owners/admins generate a one-time magic invite link (via the
-- Supabase Admin `generateLink` API, called from a trusted server action)
-- and share it with a prospective beta user. This table tracks each
-- invite so the admin portal can show who was invited, who accepted, and
-- offer resend / revoke. The magic-link secret itself is NEVER stored
-- here — only the invite's lifecycle state.
--
-- A new beta user who clicks the link is provisioned automatically: the
-- existing `handle_new_user` trigger gives them their own org + baseline
-- seed, and the onboarding gate routes them into Proof of Truth.
--
-- Acceptance is recorded by /auth/confirm (service role) when the invited
-- email verifies the link for the first time.
-- =====================================================================

create table if not exists public.beta_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  status text not null default 'pending',
  note text,
  invited_by uuid references public.profiles (id) on delete set null,
  invited_at timestamptz not null default now(),
  last_sent_at timestamptz not null default now(),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beta_invites_status_check check (status in ('pending', 'accepted', 'revoked'))
);

-- One invite row per email per org. Re-inviting upserts (bumps last_sent_at).
create unique index if not exists beta_invites_org_email_key
  on public.beta_invites (org_id, lower(email));
create index if not exists beta_invites_org_status_idx
  on public.beta_invites (org_id, status);
create index if not exists beta_invites_email_idx
  on public.beta_invites (lower(email));

create trigger set_updated_at before update on public.beta_invites
  for each row execute function public.set_updated_at();

alter table public.beta_invites enable row level security;

-- Only org owners/admins manage invites for their org. Reuses the
-- security-definer helper from the core schema so the policy never
-- recurses into org_members.
create policy "admins manage beta invites" on public.beta_invites
  for all to authenticated
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));
