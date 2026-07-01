-- 20260701200000_principal_phone.sql
-- Adds a phone field to principals so operators can supply contact info during
-- onboarding (user profile step). Nullable — existing rows are unaffected.

alter table principals
  add column if not exists phone text default null;
