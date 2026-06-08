-- ============================================================================
-- Accreditation third-party provider verification scaffold.
--
-- Adds columns to raise_interests so we can track an external verification
-- provider (e.g. Parallel Markets, VerifyInvestor.com) request lifecycle:
--   · verification_provider        — which adapter handled this ('parallel_markets'|'verifyinvestor')
--   · verification_provider_ref    — provider-assigned inquiry / request id (for webhook mapping)
--   · verification_provider_status — raw status string from the provider
--   · verification_provider_url    — investor-facing URL to complete verification
--
-- Additive + idempotent. No new RLS needed — the existing "owners update raise
-- interests" policy (private.is_org_admin) already covers these new columns.
-- ============================================================================

alter table public.raise_interests
  add column if not exists verification_provider text;

alter table public.raise_interests
  add column if not exists verification_provider_ref text;

alter table public.raise_interests
  add column if not exists verification_provider_status text;

alter table public.raise_interests
  add column if not exists verification_provider_url text;

-- Constrain provider to known adapter ids (or null = manual/no provider).
-- Idempotent: drop-then-add so the constraint definition can evolve safely.
alter table public.raise_interests
  drop constraint if exists raise_interests_verification_provider_chk;

alter table public.raise_interests
  add constraint raise_interests_verification_provider_chk
  check (
    verification_provider is null
    or verification_provider in ('parallel_markets', 'verifyinvestor')
  );
