-- 20260711120000_live_meeting_admissions.sql
-- Server-backed waiting room.
--
-- Everyone except the host "knocks" to enter a meeting; the host admits or denies.
-- Guests joining via an invite link are unauthenticated, so the knock and the
-- status poll happen through service-role API routes keyed by (room_code,
-- guest_key) rather than RLS. The host reads the pending knocks for their
-- meeting over Supabase Realtime, gated by an org-membership SELECT policy that
-- mirrors live_meetings / live_meeting_participants. All writes (guest knock,
-- host admit/deny) go through service-role routes, so there are intentionally
-- no client INSERT/UPDATE policies.

CREATE TABLE IF NOT EXISTS live_meeting_admissions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id      uuid        NOT NULL REFERENCES live_meetings(id) ON DELETE CASCADE,
  organization_id uuid        REFERENCES organizations(id) ON DELETE CASCADE,
  guest_key       text        NOT NULL,
  user_id         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name    text        NOT NULL DEFAULT 'Guest',
  status          text        NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'admitted', 'denied')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz,
  decided_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (meeting_id, guest_key)
);

CREATE INDEX IF NOT EXISTS live_meeting_admissions_meeting_status_idx
  ON live_meeting_admissions (meeting_id, status);

ALTER TABLE live_meeting_admissions ENABLE ROW LEVEL SECURITY;

-- Org members (the host included) may read admissions for their org's meetings.
-- This drives the host's live "waiting to join" panel via Realtime. Writes are
-- service-role only, so no INSERT/UPDATE/DELETE policy is granted to clients.
DROP POLICY IF EXISTS "live_meeting_admissions_org_read" ON live_meeting_admissions;
do $$ begin
  CREATE POLICY "live_meeting_admissions_org_read" ON live_meeting_admissions
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()
    )
  );
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

-- Realtime so the host's waiting panel updates the instant a guest knocks.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'live_meeting_admissions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE live_meeting_admissions;
  END IF;
END $$;

COMMENT ON TABLE live_meeting_admissions IS 'Waiting-room knocks + host admit/deny decisions for meeting entry.';
