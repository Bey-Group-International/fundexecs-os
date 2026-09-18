-- 20260918100000_meeting_chat.sql
-- Keeping what was said in the chat.
--
-- Meeting chat was a Realtime broadcast and a React array. Nothing stored it,
-- anywhere, so three things were true at once and none of them were intended:
-- a person joining ten minutes in saw an empty panel while the room referred
-- back to what had been said in it; a reload emptied your own copy; and the
-- whole conversation went when the call did — including the links people had
-- shared, which is the single commonest thing anyone puts in a meeting chat.
--
-- The transcript already had this problem and this is the same shape of fix,
-- with the same two properties that made that one work:
--
--   The sender mints the `id`. A post that timed out can be retried with the
--   same id and conflict harmlessly rather than saying it twice — which is
--   what makes retrying possible at all.
--
--   `author_id` is stamped from the SESSION by the route, never from the body.
--   A guest gets null. A display name is not protected and cannot be: a guest
--   picks their own at the door, and anybody willing to impersonate a
--   colleague in the chat could as easily say it out loud.

CREATE TABLE IF NOT EXISTS live_meeting_chat (
  -- Minted by the sender, so a retried post upserts instead of duplicating.
  id          uuid        PRIMARY KEY,
  meeting_id  uuid        NOT NULL REFERENCES live_meetings(id) ON DELETE CASCADE,
  -- The signed-in account, or null for a guest the host admitted.
  author_id   uuid        REFERENCES principals(id) ON DELETE SET NULL,
  -- What the room saw above the message. Not an identity; see above.
  author_name text        NOT NULL,
  body        text        NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  ts          timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE live_meeting_chat IS
  'What was said in a meeting''s chat. Read by the room, by the report, and by the export.';
COMMENT ON COLUMN live_meeting_chat.id IS
  'Client-minted per message so a retried post upserts instead of duplicating.';
COMMENT ON COLUMN live_meeting_chat.author_id IS
  'Stamped from the session by the route, never from the request body. Null for a guest.';

-- Reading a chat back is always "every message, oldest first".
CREATE INDEX IF NOT EXISTS live_meeting_chat_meeting_ts_idx
  ON live_meeting_chat (meeting_id, ts);

ALTER TABLE live_meeting_chat ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "live_meeting_chat_read" ON live_meeting_chat;

-- Readable by the people who were in the meeting — the same rule the
-- recordings and reports use. A chat is as revealing as a transcript, so this
-- is deliberately not widened to the organization.
--
-- There is no write policy on purpose. A guest has no `auth.uid()` for a
-- policy to read, so writes go through the route, which decides who is asking
-- and then writes with the service role. A policy here would reject exactly
-- the people this table exists to record.
do $$ begin
  CREATE POLICY "live_meeting_chat_read" ON live_meeting_chat
  FOR SELECT USING (
    meeting_id IN (
      SELECT id FROM live_meetings WHERE host_id = auth.uid()
      UNION
      SELECT meeting_id FROM live_meeting_participants WHERE user_id = auth.uid()
    )
  );
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;
