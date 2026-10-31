-- Run › Onboarding: checks, decisions and an audit trail for LP onboarding.
--
-- A GP takes each LP from invite to an approved decision. This adds the three
-- tables behind that, on top of lp_onboarding_sessions:
--
--   onboarding_checks     one current row per (session, kind): identity, sanctions,
--                         PEP, adverse media, litigation, accreditation.
--   onboarding_decisions  the GP's decision on an LP, with the reasoning. Append-only.
--   onboarding_audit_log  who did what and when, written by triggers so no code path
--                         can skip it. Append-only.
--
-- What is stored, deliberately: a check's status, date, method, a short summary
-- and the vendor's reference. NOT identity documents, selfies or government ids;
-- those stay with the verification vendor. That keeps the personal data in scope
-- to a minimum.
--
-- Who can see it: organization owners and admins (public.is_org_admin), for
-- reads and writes alike. Members cannot read these rows.
--
-- Cross-organization safety is enforced by the database, not the application:
-- every check and decision carries an organization_id that a composite foreign
-- key ties to the session's own organization, so a row can never point at another
-- organization's session.
--
-- Applied to production by hand (with the owner's approval) before this file
-- merged, as version 20261031191852; this file carries that version so the
-- repository and production agree. The executable SQL was compared with what
-- production recorded: identical.
--
-- Additive and re-runnable. The only change to an existing table is a unique
-- key on lp_onboarding_sessions (id, organization_id), which its primary key
-- already implies, so no row can violate it.

-- ---------------------------------------------------------------------------
-- Composite key the child tables reference
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'lp_onboarding_sessions_id_org_key'
      and conrelid = 'public.lp_onboarding_sessions'::regclass
  ) then
    alter table public.lp_onboarding_sessions
      add constraint lp_onboarding_sessions_id_org_key unique (id, organization_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- onboarding_checks
-- ---------------------------------------------------------------------------
create table if not exists public.onboarding_checks (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id      uuid not null,
  kind            text not null
                    check (kind in ('identity','sanctions','pep','adverse_media','litigation','accreditation')),
  status          text not null default 'pending'
                    check (status in ('pending','clear','flagged','failed')),
  method          text not null default 'manual'
                    check (method in ('manual','stripe_identity')),
  vendor_ref      text check (char_length(vendor_ref) <= 200),
  summary         text check (char_length(summary) <= 500),
  checked_at      timestamptz,
  expires_at      timestamptz,
  recorded_by     uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint onboarding_checks_session_org_fk
    foreign key (session_id, organization_id)
    references public.lp_onboarding_sessions (id, organization_id) on delete cascade,
  constraint onboarding_checks_session_kind_key unique (session_id, kind)
);

create index if not exists onboarding_checks_org_idx on public.onboarding_checks (organization_id);

drop trigger if exists onboarding_checks_set_updated_at on public.onboarding_checks;
create trigger onboarding_checks_set_updated_at
  before update on public.onboarding_checks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- onboarding_decisions (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.onboarding_decisions (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id      uuid not null,
  decision        text not null check (decision in ('approved','rejected','more_info')),
  reason          text not null check (char_length(btrim(reason)) between 1 and 2000),
  decided_by      uuid references public.principals (id) on delete set null,
  decided_at      timestamptz not null default now(),
  constraint onboarding_decisions_session_org_fk
    foreign key (session_id, organization_id)
    references public.lp_onboarding_sessions (id, organization_id) on delete cascade
);

create index if not exists onboarding_decisions_session_idx
  on public.onboarding_decisions (session_id, decided_at desc);

-- ---------------------------------------------------------------------------
-- onboarding_audit_log (append-only)
-- session_id is not a foreign key on purpose: the trail outlives the session.
-- ---------------------------------------------------------------------------
create table if not exists public.onboarding_audit_log (
  id              bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id      uuid,
  actor_id        uuid,
  action          text not null,
  detail          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists onboarding_audit_log_session_idx
  on public.onboarding_audit_log (session_id, created_at desc);
create index if not exists onboarding_audit_log_org_idx
  on public.onboarding_audit_log (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Append-only guard.
-- Rows in decisions and the audit log cannot be edited, and cannot be deleted
-- directly. A delete that arrives through a foreign-key cascade (an organization
-- or session being removed) is allowed, so erasing an account still works:
-- pg_trigger_depth() is 1 inside this trigger for a direct delete, and higher
-- when the foreign key's own trigger started it.
-- ---------------------------------------------------------------------------
create or replace function public.onboarding_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception '% is append-only: rows cannot be changed', tg_table_name
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' and pg_trigger_depth() <= 1 then
    raise exception '% is append-only: rows cannot be deleted directly', tg_table_name
      using errcode = '42501';
  end if;
  return coalesce(old, new);
end;
$$;

drop trigger if exists onboarding_decisions_append_only on public.onboarding_decisions;
create trigger onboarding_decisions_append_only
  before update or delete on public.onboarding_decisions
  for each row execute function public.onboarding_append_only();

drop trigger if exists onboarding_audit_log_append_only on public.onboarding_audit_log;
create trigger onboarding_audit_log_append_only
  before update or delete on public.onboarding_audit_log
  for each row execute function public.onboarding_append_only();

-- ---------------------------------------------------------------------------
-- Audit trail, written by triggers so it cannot be skipped.
-- SECURITY DEFINER because the log has no insert policy for users. The detail
-- holds ids and statuses only, never the free-text summary or reason.
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
  end if;
  return new;
end;
$$;

revoke all on function public.onboarding_audit() from public, anon, authenticated;
revoke all on function public.onboarding_append_only() from public, anon, authenticated;

drop trigger if exists onboarding_checks_audit on public.onboarding_checks;
create trigger onboarding_checks_audit
  after insert or update on public.onboarding_checks
  for each row execute function public.onboarding_audit();

drop trigger if exists onboarding_decisions_audit on public.onboarding_decisions;
create trigger onboarding_decisions_audit
  after insert on public.onboarding_decisions
  for each row execute function public.onboarding_audit();

-- ---------------------------------------------------------------------------
-- Row-level security: owners and admins only.
-- ---------------------------------------------------------------------------
alter table public.onboarding_checks    enable row level security;
alter table public.onboarding_decisions enable row level security;
alter table public.onboarding_audit_log enable row level security;

drop policy if exists onboarding_checks_select on public.onboarding_checks;
create policy onboarding_checks_select on public.onboarding_checks
  for select using (public.is_org_admin(organization_id));

drop policy if exists onboarding_checks_insert on public.onboarding_checks;
create policy onboarding_checks_insert on public.onboarding_checks
  for insert with check (public.is_org_admin(organization_id) and recorded_by = auth.uid());

drop policy if exists onboarding_checks_update on public.onboarding_checks;
create policy onboarding_checks_update on public.onboarding_checks
  for update using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id) and recorded_by = auth.uid());

drop policy if exists onboarding_decisions_select on public.onboarding_decisions;
create policy onboarding_decisions_select on public.onboarding_decisions
  for select using (public.is_org_admin(organization_id));

drop policy if exists onboarding_decisions_insert on public.onboarding_decisions;
create policy onboarding_decisions_insert on public.onboarding_decisions
  for insert with check (public.is_org_admin(organization_id) and decided_by = auth.uid());

drop policy if exists onboarding_audit_log_select on public.onboarding_audit_log;
create policy onboarding_audit_log_select on public.onboarding_audit_log
  for select using (public.is_org_admin(organization_id));

-- No delete policies exist, and the table privileges below match: signed-in
-- users can read these tables and write only what the policies above allow.
revoke all on public.onboarding_checks    from anon;
revoke all on public.onboarding_decisions from anon;
revoke all on public.onboarding_audit_log from anon;
revoke delete on public.onboarding_checks    from authenticated;
revoke update, delete on public.onboarding_decisions from authenticated;
revoke insert, update, delete on public.onboarding_audit_log from authenticated;
