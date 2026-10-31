-- Run › Onboarding: the LP's own setup wizard.
--
-- A GP makes a unique link for a prospective LP. The LP proves who they are with
-- a code, then completes a short wizard (their details and owners, consent to
-- screening, how they qualify and where the funds come from), and waits for the
-- GP's decision. This adds what that needs, on top of lp_onboarding_sessions
-- and the checks, decisions and audit log from 20261031191852.
--
--   lp_onboarding_sessions   + lp_type, owner_threshold_pct, review_state, submitted_at
--   lp_onboarding_profiles   the LP's own details and statements (one row per session)
--   lp_onboarding_owners     owners and controlling persons an entity LP lists
--   lp_onboarding_consents   consent to screening, append-only
--   lp_link_codes            one-time access codes (hashed), service role only
--
-- What is stored about a person, deliberately: names, roles, ownership share and
-- country. Not dates of birth, tax ids, or identity documents; those stay with
-- the verification vendor.
--
-- The rule that holds the LP at "under review" is enforced here, not only in the
-- application: an LP can be approved only once they have submitted, approving
-- advances the LP to the next step, and only the system can change an LP's
-- review state or verification stamps. A signed-in member writing the session
-- row directly cannot mark an LP approved or verified.
--
-- Additive and re-runnable. The sessions table is empty in production, so the
-- new NOT NULL columns and constraints cannot be violated by existing rows.

-- ---------------------------------------------------------------------------
-- lp_onboarding_sessions: what kind of LP, and where its review stands
-- ---------------------------------------------------------------------------
alter table public.lp_onboarding_sessions
  add column if not exists lp_type text not null default 'individual',
  add column if not exists owner_threshold_pct integer not null default 25,
  add column if not exists review_state text not null default 'not_started',
  add column if not exists submitted_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lp_onboarding_sessions_lp_type_check'
                 and conrelid = 'public.lp_onboarding_sessions'::regclass) then
    alter table public.lp_onboarding_sessions
      add constraint lp_onboarding_sessions_lp_type_check
      check (lp_type in ('individual','entity','institutional'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lp_onboarding_sessions_owner_threshold_check'
                 and conrelid = 'public.lp_onboarding_sessions'::regclass) then
    alter table public.lp_onboarding_sessions
      add constraint lp_onboarding_sessions_owner_threshold_check
      check (owner_threshold_pct between 1 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lp_onboarding_sessions_review_state_check'
                 and conrelid = 'public.lp_onboarding_sessions'::regclass) then
    alter table public.lp_onboarding_sessions
      add constraint lp_onboarding_sessions_review_state_check
      check (review_state in ('not_started','in_progress','submitted','changes_requested','approved','rejected'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- lp_onboarding_profiles: the LP's own details and statements
-- ---------------------------------------------------------------------------
create table if not exists public.lp_onboarding_profiles (
  session_id               uuid primary key,
  organization_id          uuid not null references public.organizations (id) on delete cascade,
  legal_name               text check (char_length(legal_name) <= 200),
  entity_type              text check (entity_type in
                             ('individual','trust','company','partnership','fund','pension','endowment','family_office','other')),
  country                  text check (char_length(country) <= 100),
  contact_phone            text check (char_length(contact_phone) <= 40),
  signatory_name           text check (char_length(signatory_name) <= 200),
  signatory_title          text check (char_length(signatory_title) <= 100),
  source_of_funds          text check (char_length(source_of_funds) <= 1000),
  accreditation_basis      text check (accreditation_basis in
                             ('accredited_investor','qualified_purchaser','qualified_client','institutional')),
  accreditation_statement_at timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint lp_onboarding_profiles_session_org_fk
    foreign key (session_id, organization_id)
    references public.lp_onboarding_sessions (id, organization_id) on delete cascade
);

drop trigger if exists lp_onboarding_profiles_set_updated_at on public.lp_onboarding_profiles;
create trigger lp_onboarding_profiles_set_updated_at
  before update on public.lp_onboarding_profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- lp_onboarding_owners: owners and controlling persons of an entity LP
-- ---------------------------------------------------------------------------
create table if not exists public.lp_onboarding_owners (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id      uuid not null,
  full_name       text not null check (char_length(btrim(full_name)) between 1 and 200),
  role            text not null check (role in ('owner','controller')),
  ownership_pct   numeric(5,2) check (ownership_pct between 0 and 100),
  country         text check (char_length(country) <= 100),
  created_at      timestamptz not null default now(),
  constraint lp_onboarding_owners_session_org_fk
    foreign key (session_id, organization_id)
    references public.lp_onboarding_sessions (id, organization_id) on delete cascade
);

create index if not exists lp_onboarding_owners_session_idx on public.lp_onboarding_owners (session_id);

-- A list of owners, not a data store: cap it.
create or replace function public.lp_onboarding_owners_cap()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.lp_onboarding_owners where session_id = new.session_id) >= 25 then
    raise exception 'An LP can list at most 25 owners' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists lp_onboarding_owners_cap on public.lp_onboarding_owners;
create trigger lp_onboarding_owners_cap
  before insert on public.lp_onboarding_owners
  for each row execute function public.lp_onboarding_owners_cap();

-- ---------------------------------------------------------------------------
-- lp_onboarding_consents (append-only): what the LP agreed to, and when
-- ---------------------------------------------------------------------------
create table if not exists public.lp_onboarding_consents (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id      uuid not null,
  scope           text not null check (scope in ('identity_verification','background_screening')),
  text_version    text not null check (char_length(text_version) between 1 and 40),
  typed_name      text not null check (char_length(btrim(typed_name)) between 1 and 200),
  consented_at    timestamptz not null default now(),
  constraint lp_onboarding_consents_session_org_fk
    foreign key (session_id, organization_id)
    references public.lp_onboarding_sessions (id, organization_id) on delete cascade
);

create index if not exists lp_onboarding_consents_session_idx
  on public.lp_onboarding_consents (session_id, consented_at desc);

drop trigger if exists lp_onboarding_consents_append_only on public.lp_onboarding_consents;
create trigger lp_onboarding_consents_append_only
  before update or delete on public.lp_onboarding_consents
  for each row execute function public.onboarding_append_only();

-- ---------------------------------------------------------------------------
-- lp_link_codes: one-time access codes. Only the hash is kept. No policies and
-- no privileges for signed-in users: only the service role reads or writes it.
-- ---------------------------------------------------------------------------
create table if not exists public.lp_link_codes (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id      uuid not null,
  code_hash       text not null,
  kind            text not null check (kind in ('email','gp')),
  expires_at      timestamptz not null,
  attempts        integer not null default 0 check (attempts >= 0),
  consumed_at     timestamptz,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint lp_link_codes_session_org_fk
    foreign key (session_id, organization_id)
    references public.lp_onboarding_sessions (id, organization_id) on delete cascade
);

create index if not exists lp_link_codes_session_idx on public.lp_link_codes (session_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Only the system moves an LP's review state or verification stamps.
-- A signed-in user writing the row directly (the policy lets members) cannot
-- mark an LP approved, submitted or verified, nor create one that already is.
-- current_user is the invoking role; the service role and the decision trigger
-- below are not 'authenticated' or 'anon', so they pass.
-- ---------------------------------------------------------------------------
create or replace function public.lp_onboarding_state_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.review_state <> 'not_started'
         or new.submitted_at is not null
         or new.accreditation_verified_at is not null
         or new.kyc_verified_at is not null
         or new.kyc_status <> 'pending' then
        raise exception 'review and verification state are set by the system' using errcode = '42501';
      end if;
    elsif new.review_state is distinct from old.review_state
       or new.submitted_at is distinct from old.submitted_at
       or new.accreditation_verified_at is distinct from old.accreditation_verified_at
       or new.kyc_status is distinct from old.kyc_status
       or new.kyc_verified_at is distinct from old.kyc_verified_at then
      raise exception 'review and verification state are set by the system' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists lp_onboarding_state_guard on public.lp_onboarding_sessions;
create trigger lp_onboarding_state_guard
  before insert or update on public.lp_onboarding_sessions
  for each row execute function public.lp_onboarding_state_guard();

-- ---------------------------------------------------------------------------
-- A decision moves the LP. Approval needs a submitted wizard, and then opens the
-- next step (subscription documents). Runs as the table owner so it can write
-- the session row past the guard above.
-- ---------------------------------------------------------------------------
create or replace function public.onboarding_apply_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_state text;
begin
  select review_state into current_state
    from public.lp_onboarding_sessions
   where id = new.session_id and organization_id = new.organization_id
   for update;

  if new.decision = 'approved' then
    if current_state is distinct from 'submitted' then
      raise exception 'An LP can be approved only after they submit the wizard' using errcode = '23514';
    end if;
    update public.lp_onboarding_sessions
       set review_state = 'approved',
           status = case when status = 'pending' then 'accreditation' else status end,
           accreditation_verified_at = coalesce(accreditation_verified_at, now()),
           kyc_status = 'verified',
           kyc_verified_at = coalesce(kyc_verified_at, now())
     where id = new.session_id;
  elsif new.decision = 'more_info' then
    if current_state is distinct from 'submitted' then
      raise exception 'More information can be requested only after the LP submits' using errcode = '23514';
    end if;
    update public.lp_onboarding_sessions set review_state = 'changes_requested' where id = new.session_id;
  else
    if current_state = 'approved' then
      raise exception 'An approved LP cannot be rejected here' using errcode = '23514';
    end if;
    update public.lp_onboarding_sessions set review_state = 'rejected' where id = new.session_id;
  end if;
  return new;
end;
$$;

revoke all on function public.onboarding_apply_decision() from public, anon, authenticated;

drop trigger if exists onboarding_decisions_apply on public.onboarding_decisions;
create trigger onboarding_decisions_apply
  before insert on public.onboarding_decisions
  for each row execute function public.onboarding_apply_decision();

-- ---------------------------------------------------------------------------
-- Audit trail: extend the trigger function from 20261031191852 so consents and
-- review-state changes are logged too. Ids and statuses only, never free text.
-- ---------------------------------------------------------------------------
create or replace function public.onboarding_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'onboarding_checks' then
    if tg_op = 'INSERT' then
      insert into public.onboarding_audit_log (organization_id, session_id, actor_id, action, detail)
      values (new.organization_id, new.session_id, auth.uid(), 'check.recorded',
              jsonb_build_object('kind', new.kind, 'status', new.status, 'method', new.method));
    elsif old.status is distinct from new.status then
      insert into public.onboarding_audit_log (organization_id, session_id, actor_id, action, detail)
      values (new.organization_id, new.session_id, auth.uid(), 'check.updated',
              jsonb_build_object('kind', new.kind, 'from', old.status, 'to', new.status, 'method', new.method));
    end if;
  elsif tg_table_name = 'onboarding_decisions' then
    insert into public.onboarding_audit_log (organization_id, session_id, actor_id, action, detail)
    values (new.organization_id, new.session_id, auth.uid(), 'decision.recorded',
            jsonb_build_object('decision', new.decision));
  elsif tg_table_name = 'lp_onboarding_consents' then
    insert into public.onboarding_audit_log (organization_id, session_id, actor_id, action, detail)
    values (new.organization_id, new.session_id, auth.uid(), 'consent.granted',
            jsonb_build_object('scope', new.scope, 'text_version', new.text_version));
  elsif tg_table_name = 'lp_onboarding_sessions' then
    if old.review_state is distinct from new.review_state then
      insert into public.onboarding_audit_log (organization_id, session_id, actor_id, action, detail)
      values (new.organization_id, new.id, auth.uid(), 'review.state_changed',
              jsonb_build_object('from', old.review_state, 'to', new.review_state));
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.onboarding_audit() from public, anon, authenticated;

drop trigger if exists lp_onboarding_consents_audit on public.lp_onboarding_consents;
create trigger lp_onboarding_consents_audit
  after insert on public.lp_onboarding_consents
  for each row execute function public.onboarding_audit();

drop trigger if exists lp_onboarding_sessions_review_audit on public.lp_onboarding_sessions;
create trigger lp_onboarding_sessions_review_audit
  after update on public.lp_onboarding_sessions
  for each row when (old.review_state is distinct from new.review_state)
  execute function public.onboarding_audit();

-- ---------------------------------------------------------------------------
-- Row-level security. Owners and admins read what an LP submitted; nothing here
-- is written by a signed-in user (the LP wizard writes as the service role).
-- ---------------------------------------------------------------------------
alter table public.lp_onboarding_profiles enable row level security;
alter table public.lp_onboarding_owners   enable row level security;
alter table public.lp_onboarding_consents enable row level security;
alter table public.lp_link_codes          enable row level security;

drop policy if exists lp_onboarding_profiles_select on public.lp_onboarding_profiles;
create policy lp_onboarding_profiles_select on public.lp_onboarding_profiles
  for select using (public.is_org_admin(organization_id));

drop policy if exists lp_onboarding_owners_select on public.lp_onboarding_owners;
create policy lp_onboarding_owners_select on public.lp_onboarding_owners
  for select using (public.is_org_admin(organization_id));

drop policy if exists lp_onboarding_consents_select on public.lp_onboarding_consents;
create policy lp_onboarding_consents_select on public.lp_onboarding_consents
  for select using (public.is_org_admin(organization_id));

revoke all on public.lp_onboarding_profiles from anon;
revoke all on public.lp_onboarding_owners   from anon;
revoke all on public.lp_onboarding_consents from anon;
revoke all on public.lp_link_codes          from anon, authenticated;
revoke insert, update, delete on public.lp_onboarding_profiles from authenticated;
revoke insert, update, delete on public.lp_onboarding_owners   from authenticated;
revoke insert, update, delete on public.lp_onboarding_consents from authenticated;
