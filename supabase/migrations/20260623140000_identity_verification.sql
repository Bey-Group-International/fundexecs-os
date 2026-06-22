-- 20260623140000_identity_verification.sql
-- Trust layer: internal identity verification for principals and orgs.
--
-- The compounding loop couples verification to standing: when an operator
-- approval verifies a workflow's artifacts, the org earns reputation — but only
-- when the verifying principal is itself identity-verified. This migration adds
-- the columns that gate is read from. The grant is a SOFT coupling (verification
-- itself is never blocked); these columns only decide whether standing is minted.
--
-- Per the prior product decision, verification is "internal attestation now,
-- external-KYC provider hook later":
--   - principals.identity_verified_at / _by  — an owner/admin internally attests
--     a principal's identity (lib/identity.ts attestPrincipalIdentity). When an
--     external KYC/identity provider is wired up, its verified result simply sets
--     these same columns instead of the internal attestation (see PROVIDER HOOK).
--   - organizations.kyc_status / kyc_verified_at — org-level KYC posture, defaulting
--     to 'unverified' so nothing is retroactively treated as verified.
--
-- All columns are additive and nullable (or defaulted), so no existing row is
-- invalidated and no one is locked out before anyone is marked verified.

alter table public.principals
  add column if not exists identity_verified_at timestamptz,
  add column if not exists identity_verified_by uuid references public.principals(id) on delete set null;

alter table public.organizations
  add column if not exists kyc_status text not null default 'unverified',
  add column if not exists kyc_verified_at timestamptz;
