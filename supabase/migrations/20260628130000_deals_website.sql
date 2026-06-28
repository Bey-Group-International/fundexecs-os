-- Add website column to deals table.
-- DealPipelineLive selects this column to extract domains for Apollo enrichment.
-- Without it the SELECT errors, Supabase returns null data, and the pipeline
-- renders empty even after sourcing automation has written rows.

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS website text;

COMMENT ON COLUMN public.deals.website IS 'Company / asset website URL — used for Apollo enrichment domain lookup';
