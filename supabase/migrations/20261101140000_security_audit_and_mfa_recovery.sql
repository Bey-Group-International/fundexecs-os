-- Account-level security audit trail, and one-time MFA recovery codes.
--
-- security_audit_log: who enrolled, challenged, removed or recovered a second
-- factor. Account events, not LP events, so it is not onboarding_audit_log.
-- Append-only (same rule as that table: no edits, no direct deletes; a delete
-- that arrives through a cascade is allowed). user_id is NOT a foreign key on
-- purpose: the trail outlives the account. Written only by the service role.
create table if not exists public.security_audit_log (
  id              bigint generated always as identity primary key,
  user_id         uuid not null,
  organization_id uuid references public.organizations (id) on delete cascade,
  action          text not null check (action in (
                    'mfa.enroll_started', 'mfa.enrolled', 'mfa.challenge_ok', 'mfa.challenge_failed',
                    'mfa.factor_removed', 'mfa.recovery_codes_generated',
                    'mfa.recovery_used', 'mfa.recovery_failed', 'mfa.recovery_locked')),
  detail          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists security_audit_log_user_idx on public.security_audit_log (user_id, created_at desc);
create index if not exists security_audit_log_org_idx  on public.security_audit_log (organization_id, created_at desc);

create or replace function public.security_audit_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception '% is append-only: rows cannot be changed', tg_table_name using errcode = '42501';
  end if;
  if tg_op = 'DELETE' and pg_trigger_depth() <= 1 then
    raise exception '% is append-only: rows cannot be deleted directly', tg_table_name using errcode = '42501';
  end if;
  return coalesce(old, new);
end;
$$;

drop trigger if exists security_audit_log_append_only on public.security_audit_log;
create trigger security_audit_log_append_only
  before update or delete on public.security_audit_log
  for each row execute function public.security_audit_append_only();

alter table public.security_audit_log enable row level security;
drop policy if exists security_audit_log_select on public.security_audit_log;
create policy security_audit_log_select on public.security_audit_log
  for select using (organization_id is not null and public.is_org_admin(organization_id));
revoke all on public.security_audit_log from anon;
revoke insert, update, delete on public.security_audit_log from authenticated;

-- mfa_recovery_codes: only a keyed hash of each code is stored, never the code.
-- No policy at all: users cannot read hashes; only the service role touches it.
create table if not exists public.mfa_recovery_codes (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  code_hash  text not null,
  used_at    timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, code_hash)
);
create index if not exists mfa_recovery_codes_user_idx on public.mfa_recovery_codes (user_id);

alter table public.mfa_recovery_codes enable row level security;
revoke all on public.mfa_recovery_codes from anon, authenticated;
