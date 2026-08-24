-- 20260722120000_scheduling_links.sql
-- Calendly-style scheduling links.
--
-- A member publishes a public booking page at /book/<slug>. The page carries the
-- host's weekly working hours, timezone, buffer and minimum-notice rules; each
-- bookable "event type" (15 min intro, 30 min LP call, …) hangs off it with its
-- own duration and copy. An invitee with the link picks an open slot and books
-- without a FundExecs account.
--
-- Open slots are derived from the weekly rules minus the host's existing
-- meetings (live_meetings) and minus slots already held by a booking. Nothing
-- here mirrors a third-party calendar: the native calendar stays the source of
-- truth, exactly as the schedule-meeting flow already assumes.
--
-- Invitees are anonymous, so every public read/write goes through service-role
-- API routes keyed by (slug, event slug) or by a booking's unguessable
-- manage_token. RLS therefore grants the host access to their own rows only;
-- there are deliberately no anon policies.

CREATE TABLE IF NOT EXISTS scheduling_pages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid        REFERENCES organizations(id) ON DELETE CASCADE,
  -- Public handle: the /book/<slug> path segment. Lowercase, unique platform-wide.
  slug            text        NOT NULL UNIQUE,
  display_name    text        NOT NULL DEFAULT 'FundExecs member',
  headline        text,
  bio             text,
  timezone        text        NOT NULL DEFAULT 'UTC',
  -- Weekly working hours: [{ "day": 1, "start": "09:00", "end": "17:00" }, …]
  -- with day 0 = Sunday, times as host-local wall clock.
  availability    jsonb       NOT NULL DEFAULT '[]',
  -- Padding kept clear on both sides of every booked meeting.
  buffer_minutes  integer     NOT NULL DEFAULT 0 CHECK (buffer_minutes BETWEEN 0 AND 120),
  -- Nothing may be booked closer to now than this.
  min_notice_minutes integer  NOT NULL DEFAULT 240 CHECK (min_notice_minutes BETWEEN 0 AND 20160),
  -- How far ahead the page offers slots.
  booking_window_days integer NOT NULL DEFAULT 30 CHECK (booking_window_days BETWEEN 1 AND 365),
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- One public page per member for now; multiple pages can come later by
  -- dropping this constraint.
  UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS scheduling_event_types (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id          uuid        NOT NULL REFERENCES scheduling_pages(id) ON DELETE CASCADE,
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id  uuid        REFERENCES organizations(id) ON DELETE CASCADE,
  -- Path segment under the page: /book/<page slug>/<slug>.
  slug             text        NOT NULL,
  title            text        NOT NULL,
  description      text,
  duration_minutes integer     NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 480),
  -- Slot granularity on the public page (offer :00/:15/:30/:45 starts, etc.).
  slot_interval_minutes integer NOT NULL DEFAULT 15 CHECK (slot_interval_minutes BETWEEN 5 AND 240),
  -- Meeting type stamped onto the live_meetings row a booking creates.
  meeting_type     text        NOT NULL DEFAULT 'external_meeting',
  -- When true a booking lands as 'pending' and waits on the host's approval.
  requires_approval boolean    NOT NULL DEFAULT false,
  is_active        boolean     NOT NULL DEFAULT true,
  sort_order       integer     NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id, slug)
);

CREATE TABLE IF NOT EXISTS scheduling_bookings (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id          uuid        NOT NULL REFERENCES scheduling_pages(id) ON DELETE CASCADE,
  event_type_id    uuid        NOT NULL REFERENCES scheduling_event_types(id) ON DELETE CASCADE,
  host_user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id  uuid        REFERENCES organizations(id) ON DELETE CASCADE,
  -- The room this booking created. Null while the booking is still pending the
  -- host's approval — a request that was never accepted must not put a meeting
  -- on anyone's calendar.
  meeting_id       uuid        REFERENCES live_meetings(id) ON DELETE SET NULL,
  invitee_name     text        NOT NULL,
  invitee_email    text        NOT NULL,
  invitee_notes    text,
  invitee_timezone text        NOT NULL DEFAULT 'UTC',
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  status           text        NOT NULL DEFAULT 'confirmed'
                     CHECK (status IN ('pending', 'confirmed', 'declined', 'cancelled')),
  -- Who ended it, and why — surfaced on the manage page and in the host's list.
  cancelled_by     text        CHECK (cancelled_by IS NULL OR cancelled_by IN ('host', 'invitee')),
  cancellation_reason text,
  -- Unguessable capability: the invitee's link to reschedule or cancel without
  -- an account. This is the only credential an anonymous invitee holds.
  manage_token     text        NOT NULL UNIQUE,
  rescheduled_at   timestamptz,
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Slot availability is read per host over a date window, and the host's list
-- reads their own bookings newest-first.
CREATE INDEX IF NOT EXISTS scheduling_bookings_host_window_idx
  ON scheduling_bookings (host_user_id, starts_at);
CREATE INDEX IF NOT EXISTS scheduling_bookings_page_status_idx
  ON scheduling_bookings (page_id, status, starts_at);
CREATE INDEX IF NOT EXISTS scheduling_event_types_page_idx
  ON scheduling_event_types (page_id, sort_order);

ALTER TABLE scheduling_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling_event_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling_bookings ENABLE ROW LEVEL SECURITY;

-- The host owns their page and event types outright: read and write. Public
-- reads never touch RLS — they run service-role, and only return the handful of
-- non-sensitive fields the booking page renders.
DROP POLICY IF EXISTS "scheduling_pages_owner" ON scheduling_pages;
do $$ begin
  CREATE POLICY "scheduling_pages_owner" ON scheduling_pages
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

DROP POLICY IF EXISTS "scheduling_event_types_owner" ON scheduling_event_types;
do $$ begin
  CREATE POLICY "scheduling_event_types_owner" ON scheduling_event_types
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

-- Bookings are written only by the service-role booking routes (an anonymous
-- invitee has no JWT), so the host gets SELECT only. Approve / decline / cancel
-- go through authenticated API routes that re-check ownership.
DROP POLICY IF EXISTS "scheduling_bookings_host_read" ON scheduling_bookings;
do $$ begin
  CREATE POLICY "scheduling_bookings_host_read" ON scheduling_bookings
  FOR SELECT USING (host_user_id = auth.uid());
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

-- The host's "requests waiting on you" queue updates the moment someone books.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'scheduling_bookings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE scheduling_bookings;
  END IF;
END $$;

COMMENT ON TABLE scheduling_pages IS 'Public per-member booking page (/book/<slug>): handle, weekly hours, buffer and notice rules.';
COMMENT ON TABLE scheduling_event_types IS 'Bookable meeting types on a scheduling page — duration, copy, approval requirement.';
COMMENT ON TABLE scheduling_bookings IS 'Slots claimed through a scheduling link, and the meeting each confirmed booking created.';
