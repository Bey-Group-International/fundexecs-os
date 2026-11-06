-- 20261106010802_meeting_pinned_chat.sql
-- One chat message the host pins to the top of a meeting's chat.
--
-- The agenda link, the dial-in for the person on the road, the doc everyone
-- should have open: a host used to repeat these as people joined, because a
-- message sent at the start scrolled away and a latecomer never saw it at all.
-- The pin is stored on the meeting so somebody joining late sees it too.
--
-- A reference to a stored chat row, and nothing else: deleting the message
-- clears the pin, and the pin carries no text of its own to drift from it.

ALTER TABLE live_meetings
  ADD COLUMN IF NOT EXISTS pinned_chat_message_id uuid
    REFERENCES live_meeting_chat(id) ON DELETE SET NULL;

COMMENT ON COLUMN live_meetings.pinned_chat_message_id IS
  'The chat message the host pinned to the top of the meeting chat; null for none.';
