-- A returning LP's earlier ID check is now a PROPOSAL a person confirms (SOC 2 gap G-9).
--
-- Before: making a link for an email that had been approved before copied that
-- LP's government-ID check straight onto the new onboarding as "clear". The email
-- address was the only proof it was the same person, so an address that changed
-- hands, or a typo that happened to match someone else, inherited their check.
--
-- Now: the link is made with nothing carried over, and a row here records what
-- COULD be reused. A fund manager sees it next to the name on the earlier
-- onboarding, and confirms or declines it. Only a confirmation writes the check.
--
-- Written only by the service role (after the app has checked the caller is an
-- owner/admin of the organization). Readable by owners and admins. prior_name is
-- a copy of the earlier LP's name, kept so the comparison can be shown; it goes
-- when the session does (cascade), so erasing an LP erases it too.
create table if not exists public.lp_identity_carryover (
  session_id       uuid primary key,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  from_session_id  uuid,
  prior_name       text check (char_length(prior_name) <= 200),
  names_match      boolean not null,
  kind             text not null default 'identity' check (kind = 'identity'),
  method           text not null check (method in ('manual', 'stripe_identity')),
  vendor_ref       text check (char_length(vendor_ref) <= 200),
  summary          text check (char_length(summary) <= 500),
  checked_at       timestamptz not null,
  expires_at       timestamptz not null,
  status           text not null default 'proposed' check (status in ('proposed', 'confirmed', 'declined')),
  decided_by       uuid references public.principals (id) on delete set null,
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),
  constraint lp_identity_carryover_session_org_fk
    foreign key (session_id, organization_id)
    references public.lp_onboarding_sessions (id, organization_id) on delete cascade
);

create index if not exists lp_identity_carryover_org_idx on public.lp_identity_carryover (organization_id, status);

alter table public.lp_identity_carryover enable row level security;
drop policy if exists lp_identity_carryover_select on public.lp_identity_carryover;
create policy lp_identity_carryover_select on public.lp_identity_carryover
  for select using (public.is_org_admin(organization_id));
revoke all on public.lp_identity_carryover from anon;
revoke insert, update, delete on public.lp_identity_carryover from authenticated;
