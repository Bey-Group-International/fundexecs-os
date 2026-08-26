-- 20260826040000_google_calendar_sync.sql
-- Google Calendar as a first-class, two-way sync source.
--
-- Last month's ICS work made external calendars *opaque*: a feed became busy
-- intervals that suppressed booking slots, and nothing more. You could not see
-- what the conflict was. This adds the richer path for Google specifically —
-- real events, with titles and colors, on the grid.
--
-- Three tables, one per level of the hierarchy Google exposes:
--
--   google_calendar_connections  one OAuth grant per member
--   google_calendars             the calendars that grant can see
--   external_events              the events inside them
--
-- Why per-USER and not per-org: the Gmail and People grants in this codebase
-- are org-level, because an org has one outbound mailbox and one contacts
-- import. A calendar is personal — every member connects their own, and one
-- member's grant must never expose another's schedule. So the refresh token
-- lives here, keyed by user, rather than in org_secrets.
--
-- External events are cached and READ-ONLY by design. FundExecs stays
-- authoritative for meetings it owns; an event that originated in Google is
-- shown here but edited there. Keeping them out of live_meetings is what makes
-- that guarantee structural rather than a rule someone has to remember.

-- ---------------------------------------------------------------------------
-- google_calendar_connections — one row per member who has connected Google.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS google_calendar_connections (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id   uuid        REFERENCES organizations(id) ON DELETE CASCADE,

  -- Which Google account this grant belongs to, so the UI can say "connected as
  -- rae@example.com" and a member notices when they authorized the wrong one.
  google_email      text,

  -- The refresh token, encrypted with the same AES-256-GCM helpers as
  -- org_secrets (lib/vault.ts). Stored in three parts because GCM needs the IV
  -- and auth tag to decrypt, and an auth tag that travels with the ciphertext
  -- is what makes tampering detectable rather than silent.
  refresh_ciphertext text       NOT NULL,
  refresh_iv         text       NOT NULL,
  refresh_auth_tag   text       NOT NULL,

  -- Recorded so a scope downgrade is visible: if Google returns fewer scopes
  -- than asked for, writes will fail later and this is the evidence why.
  granted_scope     text,

  connected_at      timestamptz NOT NULL DEFAULT now(),
  last_sync_at      timestamptz,
  last_error        text,
  consecutive_failures integer  NOT NULL DEFAULT 0,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE google_calendar_connections ENABLE ROW LEVEL SECURITY;

-- A refresh token is a key to someone's whole calendar. Owner-only, never
-- org-wide: co-members have no business reading it.
DROP POLICY IF EXISTS "google_calendar_connections_owner" ON google_calendar_connections;
do $$ begin
  CREATE POLICY "google_calendar_connections_owner" ON google_calendar_connections
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- google_calendars — the calendars a connection can see. One row per entry in
-- the member's Google calendar list, which is what the layers sidebar renders.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS google_calendars (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id     uuid        NOT NULL REFERENCES google_calendar_connections(id) ON DELETE CASCADE,
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  google_calendar_id text       NOT NULL,
  summary           text        NOT NULL DEFAULT 'Calendar',
  description       text,
  time_zone         text,

  -- Google's own colors, so a calendar looks the same here as it does there.
  -- A member who colour-codes their calendars should not have to relearn them.
  background_color  text,
  foreground_color  text,

  -- owner | writer | reader | freeBusyReader. Decides whether write-back is
  -- even possible for this calendar, and whether we may show event details.
  access_role       text,
  is_primary        boolean     NOT NULL DEFAULT false,

  -- The show/hide checkbox in the layers sidebar. Defaults on: a member who
  -- connects a calendar expects to see it.
  is_visible        boolean     NOT NULL DEFAULT true,
  -- Whether this calendar's events count against availability. Separate from
  -- visibility on purpose: a birthdays calendar is worth seeing and worth
  -- ignoring when deciding whether someone is free.
  blocks_availability boolean   NOT NULL DEFAULT true,

  -- Google's incremental sync cursor. Holding it is the difference between
  -- fetching a member's whole year on every sweep and fetching what changed.
  sync_token        text,
  last_synced_at    timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (connection_id, google_calendar_id)
);

CREATE INDEX IF NOT EXISTS google_calendars_user_idx ON google_calendars (user_id, is_visible);

ALTER TABLE google_calendars ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "google_calendars_owner" ON google_calendars;
do $$ begin
  CREATE POLICY "google_calendars_owner" ON google_calendars
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- external_events — cached events from a connected calendar.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS external_events (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id       uuid        NOT NULL REFERENCES google_calendars(id) ON DELETE CASCADE,
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  google_event_id   text        NOT NULL,
  -- The RFC 5545 UID. This is how an event we pushed to Google is recognized on
  -- the way back, so a FundExecs meeting does not return as a second, duplicate
  -- event sitting on top of itself.
  ical_uid          text,

  summary           text,
  description       text,
  location          text,
  html_link         text,

  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  -- All-day events are date-valued in Google, not instants. Kept as a flag
  -- because they render as a banner rather than a block on the time grid.
  is_all_day        boolean     NOT NULL DEFAULT false,

  -- confirmed | tentative | cancelled. Cancelled rows arrive through
  -- incremental sync as tombstones and are deleted rather than kept.
  status            text,
  -- opaque | transparent — Google's "show me as busy/free". A transparent
  -- event is visible on the grid but must not block a booking slot.
  transparency      text,

  -- Set on an instance of a recurring series, pointing at its parent.
  recurring_event_id text,

  -- Google's version marker, so an unchanged event is not rewritten.
  etag              text,
  google_updated_at timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (calendar_id, google_event_id)
);

-- The grid asks "what is in this window, for this member" on every view change.
CREATE INDEX IF NOT EXISTS external_events_window_idx
  ON external_events (user_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS external_events_calendar_idx
  ON external_events (calendar_id, starts_at);
-- Matching a pushed meeting back to its Google copy.
CREATE INDEX IF NOT EXISTS external_events_ical_uid_idx
  ON external_events (ical_uid) WHERE ical_uid IS NOT NULL;

ALTER TABLE external_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "external_events_owner" ON external_events;
do $$ begin
  CREATE POLICY "external_events_owner" ON external_events
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

COMMENT ON TABLE google_calendar_connections IS
  'One Google OAuth grant per member. Per-user rather than per-org because a calendar is personal — one member''s grant must never expose another''s schedule.';
COMMENT ON TABLE external_events IS
  'Cached events from connected Google calendars. Read-only by design: FundExecs is authoritative for meetings it owns, and an event that originated in Google is edited in Google.';
COMMENT ON COLUMN google_calendars.sync_token IS
  'Google''s incremental sync cursor. Without it every sweep refetches the member''s whole year.';
COMMENT ON COLUMN google_calendars.blocks_availability IS
  'Separate from is_visible on purpose: a birthdays calendar is worth seeing and worth ignoring when deciding whether someone is free.';

-- Counting failures needs read-then-write, which races with a concurrent sweep
-- (cron and a member's own "sync now" can overlap). One statement makes the
-- count trustworthy, which matters because it decides whether the UI calls a
-- connection broken.
CREATE OR REPLACE FUNCTION increment_google_calendar_failures(connection_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE google_calendar_connections
     SET consecutive_failures = consecutive_failures + 1,
         updated_at = now()
   -- SECURITY DEFINER bypasses RLS, so ownership is re-checked here: without
   -- it any signed-in user could run up the failure count on someone else's
   -- connection and make a working calendar look broken. A null auth.uid() is
   -- the service role (cron), which legitimately sweeps every connection.
   WHERE id = connection_id
     AND (auth.uid() IS NULL OR user_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION increment_google_calendar_failures(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_google_calendar_failures(uuid) TO authenticated, service_role;
