-- 20260710120000_live_meeting_participants_org_read.sql
-- Real-time presence for the Meetings lobby.
--
-- live_meeting_participants historically carried a single self-only policy
-- ("live_meeting_participants_self", FOR ALL USING user_id = auth.uid()), so a
-- client could only ever read its own participant row. That is correct for
-- writes (you may only insert/update/delete your own attendance) but it makes
-- live presence impossible: the Upcoming Meetings cards cannot show "3 in the
-- room now" or a join-activity feed because the browser can't SELECT anyone
-- else's rows.
--
-- This adds a SECOND, read-only permissive policy that lets a member of a
-- meeting's organization SELECT that meeting's participant rows. It mirrors the
-- org-membership check already enforced on live_meetings' own SELECT policy, so
-- it exposes exactly the same trust boundary (org members can already see the
-- meeting; now they can see who is in it). Postgres OR's permissive policies
-- per command, so:
--   * SELECT  -> self OR org-member          (broadened, as intended)
--   * INSERT / UPDATE / DELETE -> self only   (unchanged; the new policy is
--                                              FOR SELECT and cannot widen writes)
--
-- Supabase Realtime applies these same RLS checks to postgres_changes, so org
-- members now also receive live INSERT/UPDATE events for participants joining
-- or leaving meetings in their org — powering the live join feed.

DROP POLICY IF EXISTS "live_meeting_participants_org_read" ON live_meeting_participants;

do $$ begin
  CREATE POLICY "live_meeting_participants_org_read" ON live_meeting_participants
  FOR SELECT USING (
    meeting_id IN (
      SELECT id FROM live_meetings
      WHERE organization_id IN (
        SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()
      )
    )
  );
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;
