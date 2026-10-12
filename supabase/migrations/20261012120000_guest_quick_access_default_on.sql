-- 20261012120000_guest_quick_access_default_on.sql
-- Quick access becomes the default for the shareable guest link.
--
-- 20260910120000_live_meeting_quick_access.sql added the switch with the
-- waiting room as the default: every guest knocked, and the host admitted them
-- one at a time. In practice the host is often not watching the panel at the
-- moment a guest arrives — they are the one person in the call with something
-- else to set up — so a guest who opened a perfectly good link sat on
-- "waiting for the host to let you in", and what reached us was that the link
-- did not work.
--
-- The link is the invitation. Holding it is the check, exactly as it is for a
-- Google Meet or Zoom link, so the default flips: a meeting created from now on
-- lets anyone with the link join straight away, and a host who wants a waiting
-- room for a particular call turns it on for that call. The switch itself, and
-- the knock flow behind it, are unchanged.
--
-- Only the default moves. Meetings that already exist keep the value they were
-- saved with: an existing `false` may be a host who chose the waiting room, and
-- a migration cannot tell that host apart from one who never looked at the box.
-- Flipping those is a one-line data change for whoever owns the decision.

ALTER TABLE live_meetings
  ALTER COLUMN guest_quick_access SET DEFAULT true;

COMMENT ON COLUMN live_meetings.guest_quick_access IS
  'When true (the default), guests with the invite link join without knocking. Set false on a meeting to make external guests wait for the host to admit them.';
