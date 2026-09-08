-- calendar_feed_events — the events inside a subscribed ICS calendar.
--
-- Subscribing to a feed already worked, in the sense that its busy time
-- suppressed booking slots. What it never did was show anything: fetchFeed
-- parsed every event's summary, location and all-day flag and then threw all of
-- it away, keeping only merged {start,end} intervals in calendar_feeds
-- .cached_busy. So a member's own calendar silently made them unavailable while
-- the grid stayed empty, and the layers rail's promise — "Connecting one shows
-- its events here" — was false for every ICS feed. This table is the missing
-- half.
--
-- Why not external_events: that table is Google's shape, down to a NOT NULL
-- google_event_id, an html_link, an etag and a sync cursor. Widening it to hold
-- feed rows would mean nullable-ing half its columns and adding a discriminator
-- to tell the two apart — which reads as one table holding two things. A
-- sibling keyed to calendar_feeds says what it is.
--
-- Why this exists ALONGSIDE cached_busy rather than replacing it: they are
-- different derived views of the same fetch, wanted by different readers.
-- cached_busy is merged, opaque-events-only, and read by an anonymous visitor
-- on every booking-page slot lookup — a request that must stay fast. This table
-- is every event, unmerged, with the detail a grid draws. Recomputing one from
-- the other on read would put a merge on the booking hot path. Both are written
-- in the same call (recordFeedResult), so they cannot drift.

CREATE TABLE IF NOT EXISTS calendar_feed_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id     uuid        NOT NULL REFERENCES calendar_feeds(id) ON DELETE CASCADE,
  -- Denormalized from the feed so the grid's window query — "everything of
  -- mine between these instants" — needs no join, and so RLS can be stated on
  -- this row alone.
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The RFC 5545 UID. Not unique on its own: a recurring series is expanded
  -- into instances that all carry the UID of their parent, which is why the
  -- start time is part of the key below.
  uid         text        NOT NULL,

  summary     text,
  location    text,

  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  -- All-day events render as a banner rather than a block on the time grid.
  is_all_day  boolean     NOT NULL DEFAULT false,

  -- RFC 5545 TRANSP. A transparent event is shown but must not read as busy —
  -- the same distinction Google's `transparency` column carries next door.
  transparent boolean     NOT NULL DEFAULT false,
  -- CONFIRMED | TENTATIVE | CANCELLED, verbatim from the feed where it gave one.
  status      text,

  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Stamped with each refresh's own time, not a default: the refresh upserts
  -- everything it read and then deletes whatever it did not touch, and this is
  -- how it tells those apart.
  updated_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (feed_id, uid, starts_at)
);

-- The grid asks "what is in this window, for this member" on every view change.
CREATE INDEX IF NOT EXISTS calendar_feed_events_window_idx
  ON calendar_feed_events (user_id, starts_at, ends_at);
-- The refresh sweep's delete-what-I-did-not-touch pass, per feed.
CREATE INDEX IF NOT EXISTS calendar_feed_events_feed_idx
  ON calendar_feed_events (feed_id, updated_at);

ALTER TABLE calendar_feed_events ENABLE ROW LEVEL SECURITY;

-- Same reasoning as calendar_feeds itself: a subscribed calendar is personal.
-- Its contents are readable by its owner and by nobody else in the org.
DROP POLICY IF EXISTS "calendar_feed_events_owner" ON calendar_feed_events;
do $$ begin
  CREATE POLICY "calendar_feed_events_owner" ON calendar_feed_events
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

COMMENT ON TABLE calendar_feed_events IS
  'Events from a subscribed ICS feed, for display. Availability reads calendar_feeds.cached_busy, which is written from the same fetch.';
