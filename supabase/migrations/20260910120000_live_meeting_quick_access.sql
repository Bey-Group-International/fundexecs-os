-- 20260910120000_live_meeting_quick_access.sql
-- Per-meeting "quick access" for the shareable guest link.
--
-- Every external guest arriving on /meeting-invite/<room_code> knocks, and the
-- host admits them one at a time (see live_meeting_admissions). That is the
-- right default for a firm whose meetings are LP and deal conversations, and it
-- stays the default here: the column is NOT NULL DEFAULT false, so every
-- meeting that already exists keeps the waiting room it has today.
--
-- It is the wrong behaviour for a thirty-person external call, where admitting
-- guests individually is the whole meeting. Turning this on lets anyone holding
-- the link walk straight in, exactly like Google Meet's Quick Access.
--
-- Deliberately a property of the MEETING, not of the organization: the decision
-- is "is this particular call open", and a firm-wide switch would silently
-- change the admission policy of every meeting already scheduled.

ALTER TABLE live_meetings
  ADD COLUMN IF NOT EXISTS guest_quick_access boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN live_meetings.guest_quick_access IS
  'When true, guests with the invite link join without knocking. Default false: external guests wait for the host to admit them.';
