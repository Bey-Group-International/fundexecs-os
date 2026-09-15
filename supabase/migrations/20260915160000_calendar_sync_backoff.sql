-- Letting a failing calendar connection yield its place.
--
-- `consecutive_failures` has been written on every sync since Google calendar
-- sync existed, and read by nothing. That was worse than a missing feature,
-- because of how the sweep chooses its work: it takes the 25 connections with
-- the OLDEST `last_sync_at`. A connection that fails never updates that
-- timestamp, so it stays old, so it sorts to the front — forever.
--
-- One member revoking Google's access in their account settings therefore meant
-- their dead connection was retried at full cost every hour, AND held a slot at
-- the head of the queue that a healthy connection never reached. The more
-- broken a connection was, the more of the sweep it consumed.
--
-- `next_attempt_at` is the fix: a connection that fails is told when it may be
-- tried again, and until then the sweep passes over it. Nullable and null by
-- default, so every existing connection is immediately eligible — this must not
-- quietly pause sync for anyone on deploy.

ALTER TABLE google_calendar_connections
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

COMMENT ON COLUMN google_calendar_connections.next_attempt_at IS
  'When a failing connection may next be synced; null means now. See retryDelayMs in lib/calendar/google.ts.';

-- The sweep's query is "due, oldest first". Partial, because a connection that
-- is backing off is exactly the one it does not want to read.
CREATE INDEX IF NOT EXISTS google_calendar_connections_due_idx
  ON google_calendar_connections (last_sync_at NULLS FIRST)
  WHERE next_attempt_at IS NULL;
