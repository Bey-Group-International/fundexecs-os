-- 20260918140000_meeting_removals.sql
-- Making "Remove" mean something after the click.
--
-- Removing somebody from a meeting wrote nothing. The host's client broadcast
-- `{type:"kick", target}` over the signalling channel and closed its own
-- connection to them, and that was the whole of it. Two consequences, both
-- invisible from the host's screen, which is where the tile had just vanished:
--
--   THEY CAME BACK. A guest's `guest_key` is kept in localStorage against the
--   room code, and their admission row still said `admitted` — so a reload took
--   the knock route's "return the existing decision" path and put them straight
--   back in the call. A signed-in teammate had it easier still: the knock route
--   auto-admits any member of the meeting's organisation, so they never went
--   near the waiting room at all.
--
--   THEY NEVER LEFT. The kick is acted on only by its target, and only the
--   HOST closed a connection. Every other participant kept a live peer
--   connection to the removed person, so their camera and microphone carried on
--   reaching everyone but the host.
--
-- This table is the durable half. `live_meeting_admissions` could not carry it:
-- that row is keyed by a guest_key the client mints and can throw away, and it
-- is about a decision at the door rather than about one made inside.

CREATE TABLE IF NOT EXISTS live_meeting_removals (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id      uuid        NOT NULL REFERENCES live_meetings(id) ON DELETE CASCADE,
  organization_id uuid        REFERENCES organizations(id) ON DELETE CASCADE,

  -- Exactly one of these names the person, and which one it is decides what a
  -- re-entry has to defeat.
  --
  --   `user_id`   — a signed-in member. This is the one that matters, because
  --                 membership is what the knock route waves through: without
  --                 it a removed teammate walks back in past every check.
  --   `guest_key` — an invite-link guest, who has no account to key on. Weaker
  --                 by construction: clearing site data mints a new key and
  --                 knocks afresh. That is not a hole this table opened — it is
  --                 what an unauthenticated guest has always been — and the
  --                 host is then deciding on a new knock, at the door, which is
  --                 where they can see who it is.
  user_id         uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_key       text,

  -- What they were called at the moment they were removed, so the host's own
  -- list of removals reads as people rather than as identifiers. Frozen
  -- deliberately: a rename afterwards does not change who was removed.
  display_name    text        NOT NULL DEFAULT 'Guest',
  removed_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  removed_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT live_meeting_removals_subject
    CHECK ((user_id IS NULL) <> (guest_key IS NULL))
);

-- Removing the same person twice is one removal.
--
-- NOT partial, and the reason is worth writing down because the obvious version
-- of these is. `ON CONFLICT (meeting_id, user_id)` can only be inferred against
-- a partial index if the statement repeats the index's predicate —
-- `ON CONFLICT (...) WHERE user_id IS NOT NULL` — and PostgREST's `on_conflict`
-- takes column names and nothing else. A partial index here would therefore
-- have made every removal upsert fail with 42P10, which is EXACTLY the defect
-- this repo already shipped once on live_meeting_participants: a conflict
-- target no unique index matched, refused by Postgres, and nobody heard.
--
-- Two plain unique indexes do the job. Only one of the two columns is ever
-- populated (the CHECK above enforces it), and Postgres treats NULLs as
-- distinct by default — so every guest removal has user_id NULL without
-- colliding, and the same for members and guest_key.
CREATE UNIQUE INDEX IF NOT EXISTS live_meeting_removals_member_idx
  ON live_meeting_removals (meeting_id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS live_meeting_removals_guest_idx
  ON live_meeting_removals (meeting_id, guest_key);

ALTER TABLE live_meeting_removals ENABLE ROW LEVEL SECURITY;

-- Org members may read their own meetings' removals, which is what lets the
-- host's panel say who has been removed and offer to let them back in. Writes
-- are service-role only, through the host-verified route: a client-writable
-- removal would be one participant ejecting another.
DROP POLICY IF EXISTS "live_meeting_removals_org_read" ON live_meeting_removals;
do $$ begin
  CREATE POLICY "live_meeting_removals_org_read" ON live_meeting_removals
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()
    )
  );
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

COMMENT ON TABLE live_meeting_removals IS
  'Who the host removed from a live meeting, so a removal survives their reload.';

-- ── The admission column nobody ever wrote ─────────────────────────────────
--
-- `live_meeting_admissions.user_id` has existed since the waiting room shipped
-- and has been NULL on every row ever written: the knock route resolves the
-- caller's account to decide whether they are a teammate, and then throws it
-- away. So the one table that knows a signed-in person knocked cannot say who
-- they were, and a removal keyed on the account had nothing to read.
--
-- It is populated from here on. Nothing backfills the rows already written:
-- they belong to meetings that have finished.
COMMENT ON COLUMN live_meeting_admissions.user_id IS
  'The signed-in account that knocked, or NULL for an invite-link guest. Written by the knock route; read when removing somebody by account rather than by guest key.';

-- ── Liveness for the waiting room ──────────────────────────────────────────
--
-- A `waiting` row is cleared only by a decision, so a guest who knocks and then
-- closes the tab stays in the host's panel for the rest of the meeting —
-- chiming, badging the tab title, and being admitted into a room they are not
-- at. There was never a heartbeat to say otherwise.
--
-- Except there was, and it was being discarded. A waiting guest polls the knock
-- endpoint every second and a half for as long as they wait, and that handler
-- only ever SELECTed. Recording when it last ran turns the hottest read in the
-- meeting stack into the liveness signal the panel needed.
ALTER TABLE live_meeting_admissions
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

COMMENT ON COLUMN live_meeting_admissions.last_seen_at IS
  'When this guest last polled for their decision. A knock with no recent poll is somebody who has gone.';

-- ── The signalling id, so a removal can be resolved rather than claimed ────
--
-- The host's screen knows a participant only as a signalling id: a fresh uuid
-- minted per page load, meaningful inside the room and nowhere else. The first
-- version of the removal route closed that gap by having each peer ANNOUNCE its
-- own durable subject over the signalling channel, and the host send that back.
--
-- That was wrong, and not subtly. The announcement is a claim on a broadcast
-- channel anyone with the room code can publish to, so a participant could
-- announce somebody else's subject: the host removes the tile in front of them,
-- the service role writes a removal against the victim, and the attacker
-- reconnects as themselves. A removal must be resolved from a record the
-- server wrote, not from a name the target chose.
--
-- The knock is where the server already learns who somebody is, so the
-- signalling id is recorded there. The host then names a tile and the server
-- looks up whose it is.
ALTER TABLE live_meeting_admissions
  ADD COLUMN IF NOT EXISTS signal_id text;

CREATE INDEX IF NOT EXISTS live_meeting_admissions_signal_idx
  ON live_meeting_admissions (meeting_id, signal_id);

COMMENT ON COLUMN live_meeting_admissions.signal_id IS
  'The signalling id this person joined under. Resolves a host''s "remove that tile" to the account or guest key behind it.';
