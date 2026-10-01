-- 20261001180144_live_meeting_shared_documents.sql
-- What was handed over during a call.
--
-- Sharing a data-room document mid-meeting mints an ordinary
-- `data_room_shares` link -- the same row, the same token, the same gates, the
-- same revoke. This table is the join that says WHICH CALL it came out of, and
-- it exists for three reasons, in descending order of how badly its absence
-- would hurt:
--
--   1. A second tap must not mint a second link. Without a key on
--      (meeting_id, document_id) a host tapping twice -- or two co-hosts
--      sharing the same deck a minute apart -- produces rival links to one
--      document, each with its own expiry and its own line in the audit
--      export, and revoking "the" link revokes one of them. The unique index
--      is the whole mechanism: the second attempt reads back the first row.
--
--   2. "What did we send them?" is the first question asked after a call, and
--      until now the answer lived only in whatever the host happened to paste
--      into the chat. A row here puts it on the meeting's record alongside the
--      transcript, the recording and the chat.
--
--   3. A link minted in conversation needs attributing. `data_room_shares`
--      carries `created_by` and a label, which says who and roughly why; this
--      says in which meeting, which is what makes the Shares list legible a
--      month later.
--
-- `share_id` is deliberately NOT NULL. A row here with no link is a record of
-- a share that cannot be opened, which is worse than no record -- it would read
-- as "we sent them this" when nothing was sent. If the link is later deleted
-- outright the cascade takes this row with it, and the chat message remains as
-- the honest account of what happened.

CREATE TABLE IF NOT EXISTS live_meeting_shared_documents (
  id              uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  meeting_id      uuid NOT NULL REFERENCES live_meetings(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id     uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  -- The room the share was attributed to. A document published into several
  -- rooms resolves to one of them by a stable rule (default room first); see
  -- lib/meetings/doc-share.ts.
  room_id         uuid NOT NULL REFERENCES data_rooms(id) ON DELETE CASCADE,
  -- The link itself. See the header: never null.
  share_id        uuid NOT NULL REFERENCES data_room_shares(id) ON DELETE CASCADE,
  -- The member who shared it. Always a signed-in member of the organization at
  -- the time -- a guest cannot reach the route that writes here, which is the
  -- difference from live_meeting_chat.author_id, where null MEANS "a guest".
  -- Null here means only that the principal was since deleted, so the record of
  -- what went out survives the person leaving the firm.
  shared_by       uuid REFERENCES principals(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE live_meeting_shared_documents IS
  'Data-room documents handed over during a meeting, and the share link each produced.';
COMMENT ON COLUMN live_meeting_shared_documents.share_id IS
  'The data_room_shares row. Never null: a record of a share with no openable link would misrepresent what happened.';

-- The dedupe. Not merely an index: this is what makes a second tap return the
-- first link instead of minting a rival one.
CREATE UNIQUE INDEX IF NOT EXISTS live_meeting_shared_documents_once_idx
  ON live_meeting_shared_documents (meeting_id, document_id);

-- "What was shared in this meeting", oldest first -- the only order the panel
-- and the report read it in.
CREATE INDEX IF NOT EXISTS live_meeting_shared_documents_meeting_idx
  ON live_meeting_shared_documents (meeting_id, created_at);

-- "Which calls was this document shared in", for the document's own history.
CREATE INDEX IF NOT EXISTS live_meeting_shared_documents_document_idx
  ON live_meeting_shared_documents (document_id, created_at DESC);

ALTER TABLE live_meeting_shared_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "live_meeting_shared_documents_read" ON live_meeting_shared_documents;

-- Readable by the people who were in the meeting, plus the organization that
-- owns the documents.
--
-- The organization clause is the difference from live_meeting_chat's policy,
-- and it is deliberate: a chat is as revealing as a transcript and is scoped to
-- the room, but "which of our materials went out, to which call" is a question
-- the firm's compliance and IR people have to be able to ask without having
-- attended. The rows name documents the organization already owns and links it
-- already holds in `data_room_shares`, so this widens nothing that was private.
--
-- No write policy, deliberately: writes go through the route, which establishes
-- that the caller is a member of the meeting's organization and then writes.
-- The route refuses a guest outright -- unlike the chat, where a guest is
-- exactly who the table exists to record.
do $$ begin
  CREATE POLICY "live_meeting_shared_documents_read" ON live_meeting_shared_documents
  FOR SELECT USING (
    organization_id IN (SELECT public.current_principal_org_ids())
    OR meeting_id IN (
      SELECT id FROM live_meetings WHERE host_id = auth.uid()
      UNION
      SELECT meeting_id FROM live_meeting_participants WHERE user_id = auth.uid()
    )
  );
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;
