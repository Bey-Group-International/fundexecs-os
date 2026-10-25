-- Let a signed-in user edit their own profile fields, and nothing else.
--
-- The principals_update_self policy (0010_rls) lets a user UPDATE their own
-- row, and 0047_data_api_grants gave authenticated (and anon) UPDATE on the
-- whole table. Row-level security only decides WHICH rows; with a table-wide
-- grant it does not limit WHICH COLUMNS. So any signed-in user could send
--   PATCH /rest/v1/principals?id=eq.<me>  {"access_approved_at": "2026-01-01"}
-- and approve themselves past the access gate, or set identity_verified_at /
-- identity_verified_by to mark themselves KYC-verified, or reset
-- signup_alerted_at, or rewrite email and created_at.
--
-- Postgres column privileges are additive to table privileges, so the
-- table-wide UPDATE has to be revoked before a column list can mean anything.
--
-- The columns granted back are exactly the ones the app writes with a
-- user-scoped client:
--   full_name, title, phone  settings/actions.ts, onboarding/actions.ts
--   bio                      components/build/team-actions.ts
--   avatar_url               components/shared/avatar-actions.ts
--   intro_blurb, intro_blurb_updated_at   lib/network-outreach-profile.ts
--   updated_at               set by the same updates
--
-- Everything else is written by service-role code (access_approved_at in
-- lib/access-requests.ts, signup_alerted_at in lib/admin/signup-alert.ts) or
-- by the handle_new_user trigger, and the service role is unaffected. Nothing
-- in the app writes identity_verified_* with a user client.
--
-- New columns added to principals later are NOT user-updatable until they are
-- granted here, which is the safe default.

revoke update on table public.principals from anon, authenticated;

grant update (
  full_name,
  title,
  phone,
  bio,
  avatar_url,
  intro_blurb,
  intro_blurb_updated_at,
  updated_at
) on table public.principals to authenticated;
