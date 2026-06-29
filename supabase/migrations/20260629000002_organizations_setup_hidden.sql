-- P0-4: Persist Setup Guide dismissal state server-side so it survives
-- new browsers, devices, and incognito sessions (was localStorage-only).
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS setup_hidden boolean NOT NULL DEFAULT false;
