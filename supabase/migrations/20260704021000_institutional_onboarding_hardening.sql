-- Institutional onboarding hardening.
-- Ensures first-run profile fields and strategy enums are present even for
-- environments that initialized before the original onboarding migrations.

alter table public.principals
  add column if not exists phone text default null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'organizations_primary_strategy_check'
      and conrelid = 'public.organizations'::regclass
  ) then
    alter table public.organizations
      add constraint organizations_primary_strategy_check
      check (
        primary_strategy is null
        or primary_strategy in ('real_estate', 'private_equity', 'credit', 'multi')
      );
  end if;
end $$;
