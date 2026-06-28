-- Add website column to service_providers table.
-- ServiceProviderDirectoryLive selects this column to extract domains for Apollo enrichment.
-- Without it the SELECT errors on a fresh database and the outer try/catch renders a blank directory.

ALTER TABLE public.service_providers
  ADD COLUMN IF NOT EXISTS website text;

COMMENT ON COLUMN public.service_providers.website IS 'Firm website URL — used for Apollo enrichment domain lookup';
