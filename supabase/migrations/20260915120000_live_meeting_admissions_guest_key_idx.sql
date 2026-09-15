-- 20260915120000_live_meeting_admissions_guest_key_idx.sql
-- An index for the hottest read in the meeting stack.
--
-- A waiting guest polls GET /api/meetings/public/<room_code>/knock?key=<guest_key>
-- on a timer for as long as they wait. That query looks the guest up by
-- guest_key alone — it has the room code, not the meeting id, so the meeting is
-- reached through a join rather than used as a filter:
--
--   select status, live_meetings!inner(...) from live_meeting_admissions
--   where guest_key = $1 and live_meetings.room_code = $2
--
-- Every index this table had leads with meeting_id: the primary key is on id,
-- UNIQUE (meeting_id, guest_key) leads with meeting_id, and so does
-- live_meeting_admissions_meeting_status_idx. A btree cannot answer a predicate
-- on its SECOND column, so none of them applies and the poll falls back to a
-- sequential scan.
--
-- That is the worst possible place for one. The cost is paid per waiting guest
-- per tick, it is paid while somebody is staring at a spinner, and nothing ever
-- deletes from this table — so every knock anyone has ever made is one more row
-- scanned on every poll, forever. The table is small today, which is exactly
-- when this is free to fix.
--
-- guest_key is a random per-person key, so it is close to unique on its own; the
-- join to live_meetings then runs on that table's primary key. Not made UNIQUE:
-- one person legitimately holds a row per meeting they have knocked at, and the
-- real uniqueness rule — one row per (meeting, guest) — is already enforced by
-- the constraint above.

CREATE INDEX IF NOT EXISTS live_meeting_admissions_guest_key_idx
  ON live_meeting_admissions (guest_key);

COMMENT ON INDEX live_meeting_admissions_guest_key_idx IS
  'Serves the waiting guest''s status poll, which looks a knock up by guest_key alone.';
