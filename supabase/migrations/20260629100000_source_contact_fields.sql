-- Add missing contact and source fields to source hub tables.
-- All columns are nullable to avoid breaking existing rows.

-- investors (LP Pipeline)
ALTER TABLE public.investors
  ADD COLUMN IF NOT EXISTS contact_name   text,
  ADD COLUMN IF NOT EXISTS contact_email  text,
  ADD COLUMN IF NOT EXISTS contact_phone  text,
  ADD COLUMN IF NOT EXISTS role           text,
  ADD COLUMN IF NOT EXISTS url_source     text;

-- deals (Deal Pipeline)
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS contact_name   text,
  ADD COLUMN IF NOT EXISTS contact_email  text,
  ADD COLUMN IF NOT EXISTS contact_phone  text,
  ADD COLUMN IF NOT EXISTS url_source     text;

-- partners
ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS contact_phone  text,
  ADD COLUMN IF NOT EXISTS website        text,
  ADD COLUMN IF NOT EXISTS role           text,
  ADD COLUMN IF NOT EXISTS url_source     text;

-- service_providers
ALTER TABLE public.service_providers
  ADD COLUMN IF NOT EXISTS contact_phone  text,
  ADD COLUMN IF NOT EXISTS role           text,
  ADD COLUMN IF NOT EXISTS url_source     text;
