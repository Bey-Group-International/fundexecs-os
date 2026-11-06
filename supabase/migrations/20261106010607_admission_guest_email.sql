-- 20261106010607_admission_guest_email.sql
-- The email a guest gives at the door, so the report can reach them.
--
-- A guest who joins by link without signing in has no account, so nothing on
-- the meeting held an address for them: the report listed them as "no email on
-- file" and the follow-up went to everybody else. The join screen now asks for
-- one, optionally, and the knock stores it here beside the name they typed.
--
-- Self-asserted, like the display name in the same row: it says where the
-- guest asked to be written to, not who they are. It is read by the report and
-- the follow-up recipients, never used to admit anybody or to match an account.

ALTER TABLE live_meeting_admissions
  ADD COLUMN IF NOT EXISTS email text;

DO $$ BEGIN
  ALTER TABLE live_meeting_admissions
    ADD CONSTRAINT live_meeting_admissions_email_shape
    CHECK (email IS NULL OR (length(email) BETWEEN 3 AND 254 AND email LIKE '%_@_%'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN live_meeting_admissions.email IS
  'Optional address the guest typed at the door, for the report and follow-up. Self-asserted; never an identity.';
