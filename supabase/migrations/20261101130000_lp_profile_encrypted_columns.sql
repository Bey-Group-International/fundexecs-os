-- LP profile: allow application-level ciphertext in contact_phone and source_of_funds.
--
-- The app now encrypts these two columns (lib/lp-pii.ts, lib/crypto/field-encryption.ts)
-- as "fx1.<keyId>.<iv>.<ciphertext>.<tag>". Ciphertext is longer than the text it
-- hides, so the original length checks (40 and 1000 characters) would reject it.
--
-- The bound is not loosened for plaintext: a value is accepted if it is EITHER
-- within the old limit OR an fx1.* ciphertext within the new, larger limit. The
-- application still validates what the LP typed (lib/lp-wizard.ts) before sealing.

alter table public.lp_onboarding_profiles
  drop constraint if exists lp_onboarding_profiles_contact_phone_check,
  drop constraint if exists lp_onboarding_profiles_source_of_funds_check;

alter table public.lp_onboarding_profiles
  add constraint lp_onboarding_profiles_contact_phone_check
    check (
      contact_phone is null
      or char_length(contact_phone) <= 40
      or (contact_phone like 'fx1.%' and char_length(contact_phone) <= 512)
    ),
  add constraint lp_onboarding_profiles_source_of_funds_check
    check (
      source_of_funds is null
      or char_length(source_of_funds) <= 1000
      or (source_of_funds like 'fx1.%' and char_length(source_of_funds) <= 8192)
    );
