-- =====================================================================
-- FundExecs OS — Earn gamification: profiles.xp
-- Accumulated Earn points. The app derives level as floor(sqrt(xp/100)) + 1.
-- =====================================================================

alter table public.profiles
  add column if not exists xp integer not null default 0;

comment on column public.profiles.xp is
  'Earn gamification points. App derives level as floor(sqrt(xp/100)) + 1.';
