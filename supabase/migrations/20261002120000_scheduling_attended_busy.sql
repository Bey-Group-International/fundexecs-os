-- 20261002120000_scheduling_attended_busy.sql
-- Meetings a host is INVITED to hold their time on their booking link too.
--
-- busyIntervals() read live_meetings by host_id alone, so a meeting a colleague
-- scheduled with the host as an attendee left that time open on the host's
-- public /book/<slug> page — an invitee could book straight over it. Attendees
-- are a jsonb array identified by email, and the host's address lives on their
-- principal row, so matching them in the app took two sequential round trips in
-- front of every public slot lookup. This function does it in one.
--
-- Scoped to the host's organisation: every scheduled_at index on live_meetings
-- leads with organization_id, so the time-range scan stays indexed. Meetings the
-- host hosts are left out — busyIntervals already reads those by host_id.
--
-- SECURITY INVOKER: the public booking routes call it service-role; a signed-in
-- caller sees only what RLS already shows them. It returns spans, never titles.

CREATE OR REPLACE FUNCTION public.scheduling_attended_busy(
  p_host uuid,
  p_org uuid,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE (scheduled_at timestamptz, duration_minutes integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT m.scheduled_at, m.duration_minutes
  FROM live_meetings m
  JOIN principals p ON p.id = p_host
  WHERE m.organization_id = p_org
    AND m.deleted_at IS NULL
    AND m.is_draft = false
    AND m.status <> 'ended'
    AND m.scheduled_at >= p_from
    AND m.scheduled_at < p_to
    AND m.host_id IS DISTINCT FROM p_host
    AND p.email IS NOT NULL
    -- CASE, not an AND'd typeof check: Postgres may evaluate AND operands in
    -- any order, and jsonb_array_elements raises on anything but an array.
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(m.attendees) = 'array' THEN m.attendees ELSE '[]'::jsonb END
      ) a
      WHERE lower(trim(a->>'email')) = lower(trim(p.email))
    )
  ORDER BY m.scheduled_at
  LIMIT 2000;
$$;

REVOKE ALL ON FUNCTION public.scheduling_attended_busy(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scheduling_attended_busy(uuid, uuid, timestamptz, timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.scheduling_attended_busy(uuid, uuid, timestamptz, timestamptz) IS
  'Start and length of live meetings in an org that list the host (by principal email) as an attendee but are hosted by someone else. Consumed by busyIntervals so a booking link never offers time the host was invited to.';
