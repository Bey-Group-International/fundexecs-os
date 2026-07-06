-- Add compliance fields to investors so the allocator directory can surface
-- real accreditation and KYC state instead of hardcoded placeholders.
-- Nullable + idempotent: existing rows read as null and fall back to defaults.
alter table public.investors add column if not exists accreditation_status text;
alter table public.investors add column if not exists kyc_status text;
