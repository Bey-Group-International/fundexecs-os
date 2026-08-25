-- 20260825210000_calendar_feeds.sql
-- Two-way calendar interchange over iCalendar (RFC 5545), the format every
-- calendar product speaks. Two directions, two pieces of state:
--
--   IN  — calendar_feeds: external ICS URLs a member subscribes to. Events
--         found there become busy time, so a meeting booked in Google or
--         Outlook stops this app offering that slot. Read-only by design:
--         FundExecs stays the source of truth, and an imported event can
--         block a slot but can never edit a meeting here.
--
--   OUT — scheduling_pages.ics_feed_token: the secret path segment of this
--         member's published feed, which their own calendar subscribes to.
--
-- Why ICS rather than provider APIs: no OAuth, no restricted-scope review, and
-- one implementation covers Google, Outlook, Apple, and Calendly at once. The
-- cost is latency — subscribers refresh on their own schedule, often hourly —
-- so this is near-real-time, not instant. Provider APIs can layer on later
-- without changing this shape.

CREATE TABLE IF NOT EXISTS calendar_feeds (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid        REFERENCES organizations(id) ON DELETE CASCADE,
  -- What the member called it ("Google — work", "Outlook").
  label           text        NOT NULL DEFAULT 'External calendar',
  -- The secret ICS URL. Treated as a credential: whoever holds it can read that
  -- calendar, so it is never exposed to anyone but its owner.
  url             text        NOT NULL,
  -- Off without deleting, for a feed that is noisy or temporarily wrong.
  is_active       boolean     NOT NULL DEFAULT true,

  -- Fetch bookkeeping. A feed that has been failing for days must be visible as
  -- such: silently importing nothing looks identical to "you are free".
  last_fetched_at timestamptz,
  last_success_at timestamptz,
  last_error      text,
  consecutive_failures integer NOT NULL DEFAULT 0,
  -- Busy intervals from the last successful fetch: [{"start":…,"end":…}, …].
  -- Cached because availability is read on every booking-page slot lookup, and
  -- fetching a third-party URL inside that request would put someone else's
  -- uptime on the critical path of ours.
  cached_busy     jsonb       NOT NULL DEFAULT '[]',
  cached_at       timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- Subscribing to the same URL twice would double-count every event.
  UNIQUE (user_id, url)
);

CREATE INDEX IF NOT EXISTS calendar_feeds_user_idx ON calendar_feeds (user_id, is_active);
-- The refresh sweep wants the stalest active feeds first.
CREATE INDEX IF NOT EXISTS calendar_feeds_refresh_idx ON calendar_feeds (is_active, cached_at);

ALTER TABLE calendar_feeds ENABLE ROW LEVEL SECURITY;

-- A feed URL is a credential to someone else's calendar. Only its owner may
-- read or write it — not co-members of the org.
DROP POLICY IF EXISTS "calendar_feeds_owner" ON calendar_feeds;
do $$ begin
  CREATE POLICY "calendar_feeds_owner" ON calendar_feeds
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

-- The outbound half: the secret segment of this member's published ICS URL.
-- Nullable because a feed is only minted when someone asks for one; a null
-- token means "no published feed", which is the safe default for a calendar.
ALTER TABLE scheduling_pages
  ADD COLUMN IF NOT EXISTS ics_feed_token text;

-- Tokens address a feed globally, so a collision would serve one member's
-- calendar to another. The database refuses that rather than trusting the
-- generator.
CREATE UNIQUE INDEX IF NOT EXISTS scheduling_pages_ics_feed_token_idx
  ON scheduling_pages (ics_feed_token)
  WHERE ics_feed_token IS NOT NULL;

COMMENT ON TABLE calendar_feeds IS
  'External iCalendar (ICS) URLs a member subscribes to. Imported events become read-only busy time — they block booking slots but never edit a FundExecs meeting.';
COMMENT ON COLUMN calendar_feeds.cached_busy IS
  'Busy intervals from the last successful fetch. Availability reads this rather than fetching a third-party URL inside a request.';
COMMENT ON COLUMN scheduling_pages.ics_feed_token IS
  'Secret path segment of this member''s published ICS feed. Null means no feed has been published.';

-- Counting failures needs read-then-write, which races with the refresh sweep
-- (cron and an owner's "sync now" can overlap). Doing it in one statement makes
-- the count trustworthy, which matters because it drives whether the UI calls a
-- feed broken.
CREATE OR REPLACE FUNCTION increment_calendar_feed_failures(feed_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE calendar_feeds
     SET consecutive_failures = consecutive_failures + 1,
         updated_at = now()
   -- SECURITY DEFINER bypasses RLS, so ownership is re-checked here: without
   -- this any signed-in user could run up the failure count on someone else's
   -- feed and make a working calendar look broken. A null auth.uid() is the
   -- service role (cron), which legitimately sweeps every feed.
   WHERE id = feed_id
     AND (auth.uid() IS NULL OR user_id = auth.uid());
$$;

-- SECURITY DEFINER bypasses RLS, so the grant is narrowed to the roles that
-- actually run the sweep. anon has no business touching feed bookkeeping.
REVOKE ALL ON FUNCTION increment_calendar_feed_failures(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_calendar_feed_failures(uuid) TO authenticated, service_role;
