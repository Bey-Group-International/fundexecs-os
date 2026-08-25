-- 20260825170000_scheduling_blocks.sql
-- Manually blocked time: "I'm on a flight Thursday 2–6pm."
--
-- Until now a host had exactly two ways to keep time free: edit the weekly
-- working hours on their scheduling page, which is recurring and therefore the
-- wrong shape for a one-off; or create a decoy meeting, which then shows up in
-- their upcoming list, prep queue, and follow-up counts as if it were real
-- work. Neither is what "block this afternoon" means.
--
-- A block is deliberately NOT a meeting. It has no room, no attendees, no prep
-- or follow-up lifecycle, and it never appears in meeting lists or analytics —
-- it exists only to make time unavailable. Two things consume it:
-- busyIntervals() (so the public /book/<slug> link stops offering the time)
-- and the meetings conflict check (so scheduling over your own blocked time
-- warns, the same way an overlapping meeting does).
--
-- Blocks belong to a person, not an organization: the time being protected is
-- one member's. organization_id is carried for scoping and cleanup only.

CREATE TABLE IF NOT EXISTS scheduling_blocks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid        REFERENCES organizations(id) ON DELETE CASCADE,
  -- What the host called it. Shown on their own calendar; never sent to an
  -- invitee, who only ever sees the slot missing.
  title           text        NOT NULL DEFAULT 'Busy',
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- A zero-length or inverted block would silently block nothing, so the
  -- database refuses it rather than letting it look saved.
  CONSTRAINT scheduling_blocks_span CHECK (ends_at > starts_at)
);

-- Every read is "this user's blocks overlapping this window", in start order.
CREATE INDEX IF NOT EXISTS scheduling_blocks_user_start_idx
  ON scheduling_blocks (user_id, starts_at);

ALTER TABLE scheduling_blocks ENABLE ROW LEVEL SECURITY;

-- A block is personal: only its owner reads or writes it. The public booking
-- routes run service-role and so are unaffected — they need to know the time is
-- taken without being told whose block it is or what it was called.
DROP POLICY IF EXISTS "scheduling_blocks_owner" ON scheduling_blocks;
do $$ begin
  CREATE POLICY "scheduling_blocks_owner" ON scheduling_blocks
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

-- The calendar redraws the moment a block is added or cleared, matching how it
-- already follows live_meetings.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'scheduling_blocks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE scheduling_blocks;
  END IF;
END $$;

COMMENT ON TABLE scheduling_blocks IS
  'Time a member has manually marked unavailable. Not a meeting: no room, attendees, or lifecycle — it only removes the time from booking slots and warns on internal scheduling.';
