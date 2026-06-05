-- =====================================================================
-- FundExecs OS — Proof of Truth: member type + member_profiles
-- User-level member classification and the AI-assembled verified profile
-- Earn builds during onboarding. Owner-only RLS (each user owns exactly one).
-- =====================================================================

-- ---------- profiles.member_type ----------
alter table public.profiles
  add column if not exists member_type text;

do $$ begin
  alter table public.profiles
    add constraint profiles_member_type_check
    check (member_type in (
      'investment_firm', 'service_provider', 'startup', 'student', 'individual_investor'
    ));
exception when duplicate_object then null; end $$;

-- ---------- member_profiles ----------
create table if not exists public.member_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  display_name text,
  headline text,
  bio text,
  focus_areas text[] not null default '{}',
  links jsonb not null default '{}'::jsonb,
  details jsonb not null default '{}'::jsonb,
  draft jsonb not null default '{}'::jsonb,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'complete')),
  completion_pct integer not null default 0
    check (completion_pct between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- updated_at trigger ----------
drop trigger if exists set_updated_at on public.member_profiles;
create trigger set_updated_at before update on public.member_profiles
  for each row execute function public.set_updated_at();

-- ---------- RLS (owner-only) ----------
alter table public.member_profiles enable row level security;

drop policy if exists "view own member profile" on public.member_profiles;
create policy "view own member profile" on public.member_profiles
  for select using (user_id = auth.uid());

drop policy if exists "insert own member profile" on public.member_profiles;
create policy "insert own member profile" on public.member_profiles
  for insert with check (user_id = auth.uid());

drop policy if exists "update own member profile" on public.member_profiles;
create policy "update own member profile" on public.member_profiles
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
