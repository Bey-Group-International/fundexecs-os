-- 0014_org_profile.sql
-- Firm-profile fields captured during the onboarding wizard. These extend the
-- Build-hub identity on `organizations` (the tenancy root).
alter table public.organizations
  add column hq_location     text,
  add column operator_role   text,
  add column aum_range       text,
  add column fund_count      int,
  add column primary_strategy text,
  add column first_hub       text;
