-- Add role and website columns to deals (already present on investors, partners, service_providers).
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS role    text,
  ADD COLUMN IF NOT EXISTS website text;
