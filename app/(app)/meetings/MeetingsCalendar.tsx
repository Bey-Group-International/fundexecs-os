"use client";

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import CalendarLayers from "./CalendarLayers";
import { CALENDAR_RAIL_KEY, isGoogleCopyStale, nextSchedulableStart } from "./calendar-view";
import {
  type CalendarLayer,
  type ExternalEvent,
  colorForLayer,
  allDayEventsForDay,
  eventSpansForDay,
  layerIndex,
  visibleEvents,
  busyEvents as busyExternalEvents,
  busyMinutesForDay,
  overlapsBusy,
} from "@/lib/calendar/layers";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AGENTS } from "@/lib/agents";
import {
  calendarWhenLabel,
  deriveMeetingStatus,
  meetingTimeState,
  monthLabel,
  weekdayLabel,
  type MeetingDisplayStatus,
} from "@/lib/meetings/schedule";
import {
  addDays,
  monthDataWindow,
  addMonths,
  dayKey,
  emptyFilter,
  eventsForDay,
  eventSpanMinutes,
  filterCountActive,
  formatDayTitle,
  formatMonthTitle,
  formatWeekTitle,
  isSameDay,
  isSameMonth,
  layoutDayEvents,
  monthMatrix,
  applyCalendarFilter,
  CALENDAR_TYPE_ORDER,
  shortTime,
  startOfDay,
  typeMeta,
  weekDays,
  weekdayLabels,
  blocksForDay,
  type BlockSpan,
  type CalendarBlock,
  type CalendarFilter,
  type CalendarMeeting,
  type CalendarView,
} from "@/lib/meetings/calendar";
import { defaultBlockEnd } from "@/lib/meetings/blocks";
import { MEETING_KIND } from "@/lib/meetings/one-way";
import {
  bookingIdOf,
  isBookingRequest,
  moveRequestFor,
  requestToCalendarItem,
  type PendingBookingRequest,
} from "@/lib/meetings/booking-requests";
import {
  buildDayAgenda,
  summarizeDayAgenda,
  type DayAgendaItem,
} from "@/lib/meetings/day-agenda";
import { actionForKey, SHORTCUT_HELP } from "@/lib/meetings/calendar-shortcuts";
import {
  QUICK_DURATIONS,
  calendarConflicts,
  conflictLabel,
  joinableNow,
  quickCreatePayload,
  swipeStep,
  type Conflict,
} from "@/lib/meetings/calendar-insights";
import { parseAttendeeInput } from "@/lib/meetings/attendees";
import {
  MIN_DURATION_MINUTES,
  canDragMeeting,
  columnFromOffset,
  describeSpan,
  durationOf,
  drawsOwnMeeting,
  isNoOp,
  minuteFromOffset,
  needsDragVisitor,
  movedEnough,
  previewFor,
  previewStartIso,
  type DragMode,
  type DragOrigin,
  type DragPreview,
} from "@/lib/meetings/calendar-drag";
import { MeetingEditScreen, type MeetingEditInitial } from "./MeetingEditScreen";
import { seriesPositionLabel } from "@/lib/meetings/recurrence";
import { useNow, useLivePresence, nextChannelName, type RoomPresence } from "./hooks";
import { useFocusTrap } from "@/hooks/useFocusTrap";

/** How often the view re-reads the clock. */
const CLOCK_TICK_MS = 15_000;

const DAY_MS = 24 * 60 * 60 * 1000;

const CAL_SELECT =
  "id, room_code, title, status, host_id, created_at, started_at, ended_at, scheduled_at, duration_minutes, timezone, meeting_type, attendees, preparation_status, followup_status, assigned_copilot_agent, is_draft, locked_at, updated_at, description, location, meeting_url, objective, agenda, preparation_requirements, related_record_type, related_record_id, calendar_visibility, reminder_minutes, priority, tags, external_calendar_provider, external_calendar_sync_enabled, external_calendar_sync_status, guest_quick_access, series_id, series_index, series_rule";

const HOUR_PX = 46; // row height in the week/day time grid
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const DAY_SCROLL_HOUR = 7; // initial scroll position for time views

// The lifecycle statuses offered in the filter menu, in a sensible order.
const STATUS_ORDER: MeetingDisplayStatus[] = [
  "Scheduled",
  "Prep Needed",
  "Ready",
  "Updated",
  "Live",
  "Completed",
  "Missed",
  "Follow-Up Needed",
];

const VIEW_LABELS: Record<CalendarView, string> = {
  month: "Month",
  week: "Week",
  day: "Day",
  agenda: "Schedule",
};

function localIso(year: number, monthZeroBased: number, day: number, hour: number, minute: number): string {
  return new Date(year, monthZeroBased, day, hour, minute).toISOString();
}

function toEditInitial(m: CalendarMeeting): MeetingEditInitial {
  const internal = (m.attendees ?? []).filter((a) => a.type === "internal");
  const external = (m.attendees ?? []).filter((a) => a.type !== "internal");
  return {
    meetingId: m.id,
    isDraft: m.is_draft ?? false,
    title: m.title,
    meetingType: m.meeting_type ?? "internal_strategy",
    scheduledAt: m.scheduled_at,
    durationMinutes: m.duration_minutes,
    timezone: m.timezone,
    description: m.description,
    location: m.location,
    meetingUrl: m.meeting_url,
    objective: m.objective,
    agenda: m.agenda,
    preparationRequirements: m.preparation_requirements,
    // Structured, not re-serialised into "Name <email>" for the form to parse
    // back out again. Everyone is passed through, address or not: the edit
    // screen shows the address-less ones separately rather than dropping them,
    // so opening a meeting and saving it cannot quietly erase an attendee.
    attendees: [
      ...internal.map((a) => ({ name: a.name || a.email || "", email: a.email, type: "internal" as const })),
      ...external.map((a) => ({ name: a.name || a.email || "", email: a.email, type: "external" as const })),
    ].filter((a) => a.name || a.email),
    assignedCopilotAgent: m.assigned_copilot_agent,
    relatedRecordType: m.related_record_type,
    relatedRecordId: m.related_record_id,
    calendarVisibility: m.calendar_visibility,
    reminderMinutes: m.reminder_minutes,
    priority: m.priority,
    tags: m.tags,
    externalCalendarSyncEnabled: m.external_calendar_sync_enabled ?? false,
    externalCalendarProvider: m.external_calendar_provider,
    guestQuickAccess: m.guest_quick_access ?? false,
    seriesId: m.series_id ?? null,
    seriesRule: m.series_rule ?? null,
  };
}

export function MeetingsCalendar({
  initialMeetings,
  userId,
  orgId,
  openScheduler = false,
  onSchedulerOpened,
}: {
  initialMeetings: CalendarMeeting[];
  userId: string;
  orgId: string;
  /** Open the scheduler on top of the calendar ("Schedule for later"). */
  openScheduler?: boolean;
  /** Called once it has, so the request is not replayed on the next visit. */
  onSchedulerOpened?: () => void;
}) {
  const router = useRouter();
  const [meetings, setMeetings] = useState<CalendarMeeting[]>(initialMeetings);
  // Pending scheduling-link requests, drawn alongside the meetings. They have no
  // room until approved, so the meetings read never returns them.
  const [requests, setRequests] = useState<CalendarMeeting[]>([]);
  const [view, setView] = useState<CalendarView>("month");
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));
  const [filter, setFilter] = useState<CalendarFilter>(emptyFilter);
  const [filterOpen, setFilterOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [detail, setDetail] = useState<CalendarMeeting | null>(null);
  const [editing, setEditing] = useState<CalendarMeeting | null>(null);
  const [scheduleAt, setScheduleAt] = useState<string | null>(null);
  // What a quick-create had filled in when "More options" took it to the full
  // form, so nothing typed into the popover is typed twice.
  const [scheduleExtra, setScheduleExtra] = useState<Partial<MeetingEditInitial> | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  // Connected calendars and their events. Fetched per visible window rather
  // than all at once: a member with years of history should not pay for them
  // to look at one week.
  const [layers, setLayers] = useState<CalendarLayer[]>([]);
  const [externalEvents, setExternalEvents] = useState<ExternalEvent[]>([]);
  // Sources the server could not read. An empty grid must never be allowed to
  // read as an empty schedule.
  const [unavailable, setUnavailable] = useState<Array<"google" | "ics">>([]);
  const [connectedAs, setConnectedAs] = useState<string | null>(null);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  // What a click on empty calendar space offers: schedule, or block the time.
  const [slotMenu, setSlotMenu] = useState<{ iso: string; x: number; y: number } | null>(null);
  const [blockDraft, setBlockDraft] = useState<{ startsAt: string; endsAt: string } | null>(null);
  const [blockError, setBlockError] = useState<string | null>(null);
  // The day whose list is expanded under its week row in month view, and the
  // item inside it being read. Held here rather than in MonthView so that
  // navigating the month can collapse it — a panel left open under a week that
  // is no longer on screen is a panel nobody asked for.
  const [expandedDay, setExpandedDay] = useState<Date | null>(null);
  const [expandedItemKey, setExpandedItemKey] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeFrom = useRef<{ x: number; y: number } | null>(null);
  const requestsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [channelName] = useState(() => nextChannelName("calendar-meetings"));

  // Every label this clock drives is minute-grained ("in 5 min", "12 min
  // left", "Starts now"), so a per-second tick re-rendered the whole view for
  // text that had not changed. Fifteen seconds keeps each flip within a
  // quarter-minute of true; the hook re-reads the clock on return to the tab.
  const now = useNow(CLOCK_TICK_MS);
  // Coarsen the clock for the expensive re-derivations below. `now` ticks every
  // second, but the grid filter and the "today" highlight only change at minute /
  // day boundaries — keying their memos off the raw millisecond value re-filtered
  // every meeting and rebuilt all 42 day cells once per second.
  const dayStartMs = startOfDay(new Date(now)).getTime();
  const nowMinuteMs = Math.floor(now / 60_000) * 60_000;
  const today = useMemo(() => new Date(dayStartMs), [dayStartMs]);

  // ── Realtime refresh of the scheduled meetings that populate the grid ──────
  //
  // The months around the one on screen, not the organisation's whole history.
  // This read had no date bound and sorted ascending with a limit of 500, so it
  // fetched the OLDEST 500 meetings the organisation ever scheduled — and once
  // there were more than that, the months anybody would look at fell off the
  // end. Keyed to the month so moving between days and weeks inside it costs
  // nothing; wide enough for the month grid's spill and a 21-day agenda.
  // The agenda starts from today when the anchor is in the past, so its window
  // follows the day it actually draws from rather than the anchor's month.
  const windowBase = view === "agenda" && anchor < today ? today : anchor;
  const monthStartMs = new Date(windowBase.getFullYear(), windowBase.getMonth(), 1).getTime();
  const meetingWindow = useMemo(() => monthDataWindow(new Date(monthStartMs)), [monthStartMs]);
  const meetingWindowRef = useRef(meetingWindow);
  meetingWindowRef.current = meetingWindow;

  async function refresh() {
    const supabase = createClient();
    const { from, to } = meetingWindowRef.current;
    const { data } = await supabase
      .from("live_meetings")
      .select(CAL_SELECT)
      .eq("organization_id", orgId)
      // Meetings only, as every other meetings read filters: a recorded call is
      // a live_meetings row too, and is not something to put on a calendar.
      .eq("kind", MEETING_KIND)
      .is("deleted_at", null)
      .gte("scheduled_at", from)
      .lt("scheduled_at", to)
      .order("scheduled_at", { ascending: true })
      .limit(500);
    // A response for a window the member has already moved away from is
    // dropped rather than painted over the one they are looking at.
    if (meetingWindowRef.current.from !== from) return;
    setMeetings((data ?? []) as unknown as CalendarMeeting[]);
  }

  // Blocked time is the member's own, so it comes through the API (which scopes
  // to the session) rather than an org-wide table read like the meetings above.
  async function refreshBlocks() {
    try {
      const res = await fetch("/api/meetings/blocks");
      if (!res.ok) return;
      const json = (await res.json()) as { blocks?: CalendarBlock[] };
      setBlocks(json.blocks ?? []);
    } catch {
      // A failed load leaves the calendar without the shading; it must not
      // take the whole grid down with it.
    }
  }

  // The host's pending requests over the same window. Through the API, which
  // scopes to the session; a failure leaves them off the grid, never the grid
  // off the page.
  async function refreshRequests() {
    const { from, to } = meetingWindowRef.current;
    try {
      const res = await fetch(
        `/api/meetings/scheduling/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const json = (await res.json()) as { requests?: PendingBookingRequest[] };
      if (meetingWindowRef.current.from !== from) return;
      setRequests((json.requests ?? []).map((r) => requestToCalendarItem(r, userId)));
    } catch {
      // Left as they were.
    }
  }

  // Held by ref for the realtime handler and the drag handler, which outlive
  // the render that created them.
  const refreshRequestsRef = useRef(refreshRequests);

  // Re-read when the window moves to another month.
  useEffect(() => {
    void refresh();
    void refreshRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingWindow.from, meetingWindow.to]);

  useEffect(() => {
    const supabase = createClient();
    void refreshBlocks();
    function scheduleRefresh() {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void refresh(), 350);
    }
    // A request arriving, being cancelled by its invitee, or moved by them
    // from their manage link shows up while the calendar is open, rather than
    // on the next month change. RLS delivers only the host's own bookings; the
    // filter keeps the channel from carrying anyone else's.
    function scheduleRequestsRefresh() {
      if (requestsTimer.current) clearTimeout(requestsTimer.current);
      requestsTimer.current = setTimeout(() => void refreshRequestsRef.current(), 350);
    }
    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "live_meetings" }, () => scheduleRefresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "scheduling_blocks" }, () => void refreshBlocks())
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scheduling_bookings", filter: `host_user_id=eq.${userId}` },
        () => scheduleRequestsRefresh(),
      )
      .subscribe();
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (requestsTimer.current) clearTimeout(requestsTimer.current);
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const statusOf = useMemo(() => (m: CalendarMeeting) => deriveMeetingStatus(m, nowMinuteMs), [nowMinuteMs]);

  // Leaving the month (or the view) takes the expanded day with it: the panel
  // belongs to a week row, and that row is about to be replaced.
  const monthKey = `${anchor.getFullYear()}-${anchor.getMonth()}`;
  useEffect(() => {
    setExpandedDay(null);
    setExpandedItemKey(null);
  }, [monthKey, view]);

  // Clicking the day that is already open closes it, the way a disclosure
  // should — but only when it is the day itself being clicked. Clicking a chip
  // inside an open day switches to that item instead of collapsing under them.
  const openDay = useCallback((day: Date, itemKey?: string) => {
    setExpandedItemKey(itemKey ?? null);
    setExpandedDay((prev) => (prev && isSameDay(prev, day) && !itemKey ? null : startOfDay(day)));
  }, []);
  const closeDay = useCallback(() => {
    setExpandedDay(null);
    setExpandedItemKey(null);
  }, []);
  const selectDayItem = useCallback((itemKey: string | null) => setExpandedItemKey(itemKey), []);

  const calendarItems = useMemo(() => (requests.length > 0 ? [...meetings, ...requests] : meetings), [meetings, requests]);
  const visible = useMemo(
    () => applyCalendarFilter(calendarItems, filter, userId, statusOf),
    [calendarItems, filter, userId, statusOf],
  );

  // Presence only for meetings anyone could plausibly be sitting in: already
  // started, or scheduled from yesterday through tomorrow. The grid holds a
  // four-month window — up to 500 meetings — and asking after every one of
  // them sent their ids in a single URL on every month change and every join.
  // Bounded by the day rather than the minute so the set, and with it the
  // realtime channel, stays put while the page is open.
  const visibleIds = useMemo(() => {
    const from = dayStartMs - DAY_MS;
    const to = dayStartMs + 2 * DAY_MS;
    return visible
      .filter((m) => {
        // A request has no room for anyone to be sitting in.
        if (isBookingRequest(m)) return false;
        if (m.status === "active") return true;
        if (!m.scheduled_at) return true;
        const at = new Date(m.scheduled_at).getTime();
        return at >= from && at < to;
      })
      .map((m) => m.id);
  }, [visible, dayStartMs]);
  const { presence } = useLivePresence(visibleIds);

  // ── Navigation ─────────────────────────────────────────────────────────────
  function go(delta: number) {
    if (view === "month") setAnchor((a) => addMonths(a, delta));
    else if (view === "week") setAnchor((a) => addDays(a, 7 * delta));
    else if (view === "day") setAnchor((a) => addDays(a, delta));
    else setAnchor((a) => addDays(a, 14 * delta));
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  //
  // Suppressed while anything modal is up: a member reading an event detail
  // means "m" to close-and-go-to-month far less often than they mean to type.
  const modalOpen =
    Boolean(detail) || Boolean(editing) || scheduleOpen || Boolean(slotMenu) || Boolean(blockDraft);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && shortcutsOpen) {
        setShortcutsOpen(false);
        return;
      }
      if (modalOpen || shortcutsOpen) return;

      const action = actionForKey(e, e.target as HTMLElement | null);
      if (!action) return;
      e.preventDefault();

      if (action.kind === "view") setView(action.view);
      else if (action.kind === "today") setAnchor(startOfDay(new Date()));
      else if (action.kind === "next") go(1);
      else if (action.kind === "prev") go(-1);
      else if (action.kind === "help") setShortcutsOpen(true);
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `go` closes over `view`, so it is re-created each render; depending on
    // `view` rather than the function keeps this to one listener swap per view
    // change instead of one per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, modalOpen, shortcutsOpen]);

  const title = useMemo(() => {
    if (view === "month") return formatMonthTitle(anchor);
    if (view === "week") return formatWeekTitle(weekDays(anchor));
    if (view === "day") return formatDayTitle(anchor);
    return "Schedule";
  }, [view, anchor]);

  function openScheduleAt(iso: string, extra: Partial<MeetingEditInitial> | null = null) {
    setScheduleAt(iso);
    setScheduleExtra(extra);
    setScheduleOpen(true);
  }

  // A phone opens on the agenda: seven columns of a week on a 360px screen are
  // seven slivers, and a month grid is a field of dots. Only when nothing has
  // chosen a view yet — the member's own choice on this visit stands.
  const viewChosenRef = useRef(false);
  useEffect(() => {
    if (viewChosenRef.current) return;
    if (window.matchMedia?.("(max-width: 639px)").matches) setView("agenda");
  }, []);
  const chooseView = useCallback((v: CalendarView) => {
    viewChosenRef.current = true;
    setView(v);
  }, []);

  // "Schedule for later" arrives here wanting the scheduler, not a calendar to
  // find the button on.
  useEffect(() => {
    if (!openScheduler) return;
    openScheduleAt(nextSchedulableStart(new Date()).toISOString());
    onSchedulerOpened?.();
  }, [openScheduler, onSchedulerOpened]);

  // The side panel (mini month, calendars, upcoming, past) is folded away by
  // default so the grid gets the whole screen; the choice is remembered.
  const [railOpen, setRailOpen] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(CALENDAR_RAIL_KEY) === "open") setRailOpen(true);
    } catch {
      // Storage blocked: the panel simply starts folded.
    }
  }, []);
  const toggleRail = useCallback(() => {
    setRailOpen((open) => {
      const next = !open;
      try {
        window.localStorage.setItem(CALENDAR_RAIL_KEY, next ? "open" : "closed");
      } catch {
        // Not remembered, still toggled.
      }
      return next;
    });
  }, []);

  async function createBlock(title: string, startsAt: string, endsAt: string) {
    setBlockError(null);
    const res = await fetch("/api/meetings/blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, startsAt, endsAt }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setBlockError(json.error ?? "Couldn't block that time.");
      return;
    }
    setBlockDraft(null);
    await refreshBlocks();
  }

  async function clearBlock(id: string) {
    // Drop it locally first so the band disappears on click; the refresh below
    // is the correction if the delete actually failed.
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    await fetch(`/api/meetings/blocks/${id}`, { method: "DELETE" }).catch(() => undefined);
    await refreshBlocks();
  }

  // `refresh` is redeclared each render; hold it by ref so the drag handler
  // below stays stable instead of being rebuilt on every tick of the clock.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
    refreshRequestsRef.current = refreshRequests;
  });

  // ── Moving a meeting by dragging it ───────────────────────────────────────
  //
  // Optimistic: the block stays where it was dropped while the request is in
  // flight, because a meeting that snaps back for half a second and then
  // returns reads as a bug. A failure puts it back and says why.
  //
  // A pending booking request moves through the booking route instead: its
  // length is fixed by the meeting type the invitee chose, so only its start
  // changes, and the invitee is emailed the new time.
  const moveMeeting = useCallback(async (m: CalendarMeeting, startIso: string, durationMinutes: number) => {
    const bookingId = bookingIdOf(m);
    const before = { scheduled_at: m.scheduled_at, duration_minutes: m.duration_minutes };
    const setItems = bookingId ? setRequests : setMeetings;
    const applyLocal = (next: { scheduled_at: string | null; duration_minutes: number | null }) =>
      setItems((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...next } : x)));

    applyLocal(
      bookingId
        ? { scheduled_at: startIso, duration_minutes: m.duration_minutes }
        : { scheduled_at: startIso, duration_minutes: durationMinutes },
    );

    async function send(allowConflict: boolean) {
      const { url, body } = moveRequestFor(m, startIso, durationMinutes, allowConflict);
      return fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    }

    try {
      let res = await send(false);

      if (res.status === 409) {
        // The API refuses a clashing reschedule unless told otherwise. Ask,
        // rather than either silently double-booking or silently refusing —
        // but only when asking can change the answer: another booking on the
        // host's link holding the time is not something "anyway" clears.
        const body = (await res.json().catch(() => ({}))) as { error?: string; overridable?: boolean };
        if (body.overridable !== true) {
          applyLocal(before);
          setMoveError(`${body.error ?? "That time is no longer available."} It has been put back.`);
          return;
        }
        const proceed = window.confirm(`${body.error ?? "That time conflicts with something else."}\n\nMove it anyway?`);
        if (!proceed) {
          applyLocal(before);
          return;
        }
        res = await send(true);
      }

      if (!res.ok) {
        applyLocal(before);
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMoveError(`${body.error ?? "Could not move that meeting."} It has been put back.`);
        return;
      }
      setMoveError(null);
      // Re-read rather than trusting the local guess: the server clamps the
      // duration and may have touched sync status on the way through.
      await (bookingId ? refreshRequestsRef.current() : refreshRef.current());
    } catch {
      applyLocal(before);
      setMoveError("Could not reach the server. The meeting has been put back.");
    }
  }, []);

  // The same month-anchored window the meetings above read, not one centred on
  // `anchor`. Centred on the anchor, the window moved with every click: each
  // "next day" in day view and each "next week" in week view re-fetched the
  // calendar layers for a range it had mostly just read. Anchored to the month
  // (45 days back, 75 ahead), it covers every view of that month and only moves
  // when the month does — the same rule the meetings grid already follows.
  const windowRange = meetingWindow;

  const loadCalendars = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/meetings/calendars?from=${encodeURIComponent(windowRange.from)}&to=${encodeURIComponent(windowRange.to)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const body = (await res.json()) as {
        layers?: CalendarLayer[];
        events?: ExternalEvent[];
        connectedAs?: string | null;
        googleSyncedAt?: string | null;
        googleConfigured?: boolean;
        unavailable?: Array<"google" | "ics">;
      };
      setLayers(body.layers ?? []);
      setExternalEvents(body.events ?? []);
      setConnectedAs(body.connectedAs ?? null);
      setGoogleConfigured(Boolean(body.googleConfigured));
      setUnavailable(body.unavailable ?? []);
      return { connected: Boolean(body.connectedAs), syncedAt: body.googleSyncedAt ?? null };
    } catch {
      // A calendar rail that fails to load must not take the grid down with
      // it: the member's own meetings are the part that matters.
    }
  }, [windowRange.from, windowRange.to]);

  // Busy time is only as current as the last read of Google, and the hourly
  // sweep can leave that most of an hour old — long enough to miss a meeting
  // accepted there a moment ago, which this calendar refuses to book over only
  // if it knows about it. So the first load of an opening checks the copy's
  // age, and a stale one is refreshed quietly and the grid redrawn from it.
  // Later loads (the window moving) are not a reason to sync again.
  const freshenedRef = useRef(false);
  useEffect(() => {
    void loadCalendars().then(async (loaded) => {
      if (freshenedRef.current || !loaded) return;
      freshenedRef.current = true;
      if (!isGoogleCopyStale(loaded.connected, loaded.syncedAt, Date.now())) return;
      try {
        const res = await fetch("/api/meetings/calendars/sync", { method: "POST" });
        if (res.ok) await loadCalendars();
      } catch {
        // The stored copy stands; "Sync now" is still there.
      }
    });
  }, [loadCalendars]);

  // Only events from layers the member is showing, and indexed so each draws
  // in its own calendar's colour.
  const shownExternal = useMemo(() => visibleEvents(externalEvents, layers), [externalEvents, layers]);
  const layersById = useMemo(() => layerIndex(layers), [layers]);
  // Time a connected calendar has taken. Drawn as blocked and not bookable
  // from the grid, whether or not that calendar is showing: hiding a calendar
  // hides its events, not the fact that the time is gone.
  const busyExternal = useMemo(() => busyExternalEvents(externalEvents, layers), [externalEvents, layers]);

  const toggleLayer = useCallback(
    async (layer: CalendarLayer, isVisible: boolean) => {
      // Optimistic: a checkbox that waits on a round trip feels broken.
      setLayers((prev) => prev.map((l) => (l.id === layer.id ? { ...l, isVisible } : l)));
      await fetch("/api/meetings/calendars", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: layer.id, source: layer.source, isVisible }),
      }).catch(() => undefined);
      void loadCalendars();
    },
    [loadCalendars],
  );

  // "Sync now". Between hourly cron sweeps there was no way to ask for a
  // refresh, so a meeting accepted in Google minutes ago simply was not here
  // and the only remedy was to wait for the top of the hour.
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    setSyncNote(null);
    try {
      const res = await fetch("/api/meetings/calendars/sync", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        connections?: number;
        failed?: number;
        incomplete?: boolean;
        feedsRefreshed?: number;
        feedsFailed?: number;
      };
      if (!res.ok) throw new Error(body.error ?? "Couldn't sync your calendars.");

      // Each outcome needs its own words. "Synced" over an unchanged grid,
      // when the grant is actually broken, is the failure this whole feature
      // exists to stop — and so is telling a member with subscribed feeds that
      // they have nothing connected, which is what reading only the Google
      // half of this response used to do.
      const touched = (body.connections ?? 0) + (body.feedsRefreshed ?? 0) + (body.feedsFailed ?? 0);
      if (body.failed) setSyncNote("Some calendars didn't sync. Try reconnecting Google.");
      else if (body.feedsFailed) setSyncNote("A subscribed calendar didn't answer. Check its address in Calendar settings.");
      else if (body.incomplete) setSyncNote("Still catching up — this can take a moment.");
      else if (!touched) setSyncNote("Nothing connected to sync yet.");
      else setSyncNote("Up to date.");

      await loadCalendars();
    } catch (err) {
      setSyncNote(err instanceof Error ? err.message : "Couldn't sync your calendars.");
    } finally {
      setSyncing(false);
    }
  }, [loadCalendars]);

  const toggleLayerAvailability = useCallback(
    async (layer: CalendarLayer, blocksAvailability: boolean) => {
      setLayers((prev) => prev.map((l) => (l.id === layer.id ? { ...l, blocksAvailability } : l)));
      await fetch("/api/meetings/calendars", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: layer.id, source: layer.source, blocksAvailability }),
      }).catch(() => undefined);
    },
    [],
  );

  // Double bookings, and meetings on time a connected calendar has as busy.
  // Computed once for everything loaded rather than per view, so switching
  // between week and agenda does not redo it.
  const conflicts = useMemo(() => calendarConflicts(visible, busyExternal), [visible, busyExternal]);

  // The day lists the time grid draws, held stable so the grid's own per-day
  // work is not redone on every fifteen-second tick.
  const weekDayList = useMemo(() => weekDays(anchor), [anchor]);
  const oneDayList = useMemo(() => [anchor], [anchor]);

  const shared = {
    now,
    conflicts,
    today,
    presence,
    statusOf,
    blocks,
    onSelectEvent: (m: CalendarMeeting) => setDetail(m),
    onSelectBlock: (b: CalendarBlock) => clearBlock(b.id),
    onSelectSlot: (iso: string, x: number, y: number) => setSlotMenu({ iso, x, y }),
    externalEvents: shownExternal,
    busyEvents: busyExternal,
    layersById,
    onExpandDay: (d: Date) => {
      setAnchor(startOfDay(d));
      setView("day");
    },
    onMoveMeeting: moveMeeting,
  };

  return (
    <div className="flex flex-col">
      <Toolbar
        title={title}
        view={view}
        onView={chooseView}
        onPrev={() => go(-1)}
        onNext={() => go(1)}
        onToday={() => setAnchor(startOfDay(new Date()))}
        filter={filter}
        onFilter={setFilter}
        filterOpen={filterOpen}
        setFilterOpen={setFilterOpen}
        onShortcuts={() => setShortcutsOpen(true)}
        railOpen={railOpen}
        onToggleRail={toggleRail}
      />

      {moveError ? (
        <div
          role="status"
          className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-xs text-[var(--fg-secondary)]"
        >
          <span>{moveError}</span>
          <button
            type="button"
            onClick={() => setMoveError(null)}
            className="shrink-0 rounded px-1.5 py-0.5 text-[var(--fg-muted)] transition-colors hover:text-[var(--fg-primary)]"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className={`grid gap-6 pb-6 ${railOpen ? "lg:grid-cols-[minmax(0,1fr)_340px]" : ""}`}>
        {/* Calendar surface */}
        <div
          className="min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] p-2 sm:p-3"
          // A sideways swipe moves a period on a touch screen, the way every
          // phone calendar does; see swipeStep for what counts as one.
          onTouchStart={(e) => {
            const t = e.touches[0];
            swipeFrom.current = t ? { x: t.clientX, y: t.clientY } : null;
          }}
          onTouchEnd={(e) => {
            const from = swipeFrom.current;
            swipeFrom.current = null;
            const t = e.changedTouches[0];
            if (!from || !t || view === "agenda") return;
            const step = swipeStep(t.clientX - from.x, t.clientY - from.y);
            if (step !== 0) go(step);
          }}
        >
          {view === "month" ? (
            <MonthView
              anchor={anchor}
              meetings={visible}
              {...shared}
              expandedDay={expandedDay}
              expandedItemKey={expandedItemKey}
              onOpenDay={openDay}
              onSelectItem={selectDayItem}
              onCloseDay={closeDay}
              onNewMeeting={(d) => openScheduleAt(localIso(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0))}
              onBlockTime={(d) => {
                const iso = localIso(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0);
                setBlockDraft({ startsAt: iso, endsAt: defaultBlockEnd(iso) });
                setBlockError(null);
              }}
              // A booking request has nothing to edit; it opens as a request.
              onEditMeeting={(m) => (isBookingRequest(m) ? setDetail(m) : setEditing(m))}
            />
          ) : null}
          {view === "week" ? <TimeGridView days={weekDayList} meetings={visible} {...shared} /> : null}
          {view === "day" ? <TimeGridView days={oneDayList} meetings={visible} {...shared} /> : null}
          {view === "agenda" ? <AgendaView anchor={anchor} meetings={visible} {...shared} /> : null}
        </div>

        {/* Side rail */}
        <aside hidden={!railOpen} className="flex flex-col gap-6">
          <MiniMonth anchor={anchor} onPick={(d) => { setAnchor(startOfDay(d)); }} today={today} meetings={meetings} orgId={orgId} loaded={meetingWindow} />
          <CalendarLayers
            layers={layers}
            connectedAs={connectedAs}
            googleConfigured={googleConfigured}
            onToggle={toggleLayer}
            onToggleAvailability={toggleLayerAvailability}
            onSync={syncNow}
            syncing={syncing}
            syncNote={syncNote}
            unavailable={unavailable}
          />
          {/* Today, in a line each, with Join on whatever is starting. The
              upcoming and past lists that used to be here are the meetings
              workspace's own tabs now; the legend is in the filter menu, beside
              the types it explains. */}
          <TodayRail
            meetings={visible}
            today={today}
            now={now}
            presence={presence}
            conflicts={conflicts}
            onSelect={(m) => setDetail(m)}
          />
        </aside>
      </div>

      {detail && isBookingRequest(detail) ? (
        <RequestDetail
          request={detail}
          onClose={() => setDetail(null)}
          onDecided={() => {
            setDetail(null);
            void refreshRequests();
            void refresh();
          }}
          onStale={() => void refreshRequests()}
        />
      ) : detail ? (
        <EventDetail
          meeting={detail}
          presence={presence[detail.id]}
          status={statusOf(detail)}
          now={now}
          conflict={conflictLabel(conflicts.get(detail.id))}
          onClose={() => setDetail(null)}
          onEdit={() => {
            const m = detail;
            setDetail(null);
            setEditing(m);
          }}
        />
      ) : null}

      {editing ? (
        <MeetingEditScreen
          mode="edit"
          initial={toEditInitial(editing)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      ) : null}

      {scheduleOpen ? (
        <MeetingEditScreen
          mode="create"
          initial={scheduleAt ? { ...scheduleExtra, scheduledAt: scheduleAt } : undefined}
          onClose={() => setScheduleOpen(false)}
          onSaved={() => {
            setScheduleOpen(false);
            void refresh();
            router.refresh();
          }}
        />
      ) : null}

      {slotMenu ? (
        <QuickCreate
          iso={slotMenu.iso}
          x={slotMenu.x}
          y={slotMenu.y}
          onClose={() => setSlotMenu(null)}
          onCreated={() => {
            setSlotMenu(null);
            void refresh();
            router.refresh();
          }}
          onMoreOptions={(extra) => {
            openScheduleAt(slotMenu.iso, extra);
            setSlotMenu(null);
          }}
          onBlock={() => {
            setBlockDraft({ startsAt: slotMenu.iso, endsAt: defaultBlockEnd(slotMenu.iso) });
            setBlockError(null);
            setSlotMenu(null);
          }}
        />
      ) : null}

      {shortcutsOpen ? <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} /> : null}

      {blockDraft ? (
        <BlockDialog
          draft={blockDraft}
          error={blockError}
          onChange={setBlockDraft}
          onCancel={() => { setBlockDraft(null); setBlockError(null); }}
          onSave={(title) => void createBlock(title, blockDraft.startsAt, blockDraft.endsAt)}
        />
      ) : null}
    </div>
  );
}

// ── Shortcuts help ──────────────────────────────────────────────────────────
// Reachable by `?`, the way every calendar worth using does it, and by the
// button in the toolbar for anyone who would never think to press `?`.
function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 focus:outline-none"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <h3 className="text-sm font-semibold text-[var(--fg-primary)]">Keyboard shortcuts</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-xs text-[var(--fg-muted)] transition-colors hover:text-[var(--fg-primary)]"
          >
            Close
          </button>
        </div>
        <ul className="flex flex-col divide-y divide-[var(--line)]">
          {SHORTCUT_HELP.map((row) => (
            <li key={row.keys} className="flex items-center justify-between gap-4 px-4 py-2.5">
              <span className="font-mono text-xs text-[var(--fg-secondary)]">{row.keys}</span>
              <span className="text-xs text-[var(--fg-muted)]">{row.description}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── Quick create ────────────────────────────────────────────────────────────
// A click on empty calendar space used to ask "New meeting or Block time?" and
// then open the full scheduling screen — a dozen fields — for what is usually
// a title and a length. The grid already knows the time, so the popover asks
// for the rest in place and saves; "More options" carries what was typed into
// the full form, and blocking the time is still one press away.
function QuickCreate({
  iso,
  x,
  y,
  onClose,
  onCreated,
  onMoreOptions,
  onBlock,
}: {
  iso: string;
  x: number;
  y: number;
  onClose: () => void;
  onCreated: () => void;
  onMoreOptions: (extra: Partial<MeetingEditInitial>) => void;
  onBlock: () => void;
}) {
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState<number>(30);
  const [invitees, setInvitees] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the server refused the time as taken; the next press saves anyway.
  const [conflict, setConflict] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const start = new Date(iso);
  const when = `${start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${shortTime(iso)}`;

  const extra = (): Partial<MeetingEditInitial> => ({
    title: title.trim() || undefined,
    durationMinutes: minutes,
    attendees: parseAttendeeInput(invitees),
  });

  async function save(allowConflict: boolean) {
    if (!title.trim()) {
      setError("Give the meeting a title.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        ...quickCreatePayload({
          title,
          start,
          minutes,
          attendees: parseAttendeeInput(invitees),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        }),
        allowConflict,
      };
      const res = await fetch("/api/meetings/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          conflicts?: unknown[];
          blockedBy?: unknown[];
          busyElsewhere?: unknown[];
        };
        // Only the conflict kinds "anyway" can clear; another booking holding
        // the slot is final, and saying "save anyway" over it would be a lie.
        const overridable = Boolean(json.conflicts?.length || json.blockedBy?.length || json.busyElsewhere?.length);
        setConflict(overridable);
        setError(overridable ? "That time clashes with something else." : json.error ?? "That time is no longer available.");
        return;
      }
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? "Couldn't create the meeting.");
        return;
      }
      onCreated();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setSaving(false);
    }
  }

  // Beside the click on a wide screen, kept on screen near an edge; a sheet
  // from the bottom on a phone, where "beside the click" is under the thumb.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  const narrow = vw < 640;
  const style = narrow ? undefined : { left: Math.max(8, Math.min(x, vw - 328)), top: Math.max(8, Math.min(y, vh - 360)) };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/20 sm:bg-transparent" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-label="New meeting"
        onClick={(e) => e.stopPropagation()}
        className={`${narrow ? "fixed inset-x-0 bottom-0 rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]" : "absolute w-80 rounded-xl"} border border-[var(--line)] bg-[var(--surface-1)] p-4 shadow-2xl`}
        style={style}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save(conflict);
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-xs text-[var(--fg-muted)]">{when}</p>
          <input
            autoFocus
            value={title}
            onChange={(e) => { setTitle(e.target.value); setError(null); }}
            placeholder="Meeting title"
            aria-label="Meeting title"
            className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2 text-base text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)] sm:text-sm"
          />
          <div role="radiogroup" aria-label="Length" className="flex gap-1.5">
            {QUICK_DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={minutes === d}
                onClick={() => { setMinutes(d); setConflict(false); }}
                className={`min-h-9 flex-1 rounded-lg border text-xs font-medium transition-colors ${
                  minutes === d
                    ? "border-gold-400/60 bg-gold-400/10 text-[var(--gold-400)]"
                    : "border-[var(--line)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
                }`}
              >
                {d} min
              </button>
            ))}
          </div>
          <input
            value={invitees}
            onChange={(e) => setInvitees(e.target.value)}
            placeholder="Invite by email (optional)"
            aria-label="Invitees"
            className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2 text-base text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)] sm:text-sm"
          />
          {error ? <p role="alert" className="text-xs text-[var(--status-danger)]">{error}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={saving}
              className="min-h-9 rounded-lg bg-[var(--gold-400)] px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {saving ? "Saving…" : conflict ? "Create anyway" : "Create"}
            </button>
            <button
              type="button"
              onClick={() => onMoreOptions(extra())}
              className="min-h-9 rounded-lg border border-[var(--line)] px-3 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
            >
              More options
            </button>
            <button
              type="button"
              onClick={onBlock}
              className="ml-auto min-h-9 px-1 text-xs text-[var(--fg-muted)] underline-offset-2 hover:text-[var(--fg-primary)] hover:underline"
            >
              Block time instead
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Block dialog ────────────────────────────────────────────────────────────
/** Local wall-clock value for a datetime-local input, from an ISO instant. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function BlockDialog({
  draft,
  error,
  onChange,
  onCancel,
  onSave,
}: {
  draft: { startsAt: string; endsAt: string };
  error: string | null;
  onChange: (d: { startsAt: string; endsAt: string }) => void;
  onCancel: () => void;
  onSave: (title: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  // A failed save has to let the user try again, so clear the pending state
  // whenever a new error arrives rather than leaving the button stuck.
  useEffect(() => {
    if (error) setBusy(false);
  }, [error]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] p-5 shadow-2xl"
      >
        <h2 className="text-base font-semibold text-[var(--fg-primary)]">Block time</h2>
        <p className="mt-1 text-xs text-[var(--fg-muted)]">
          Keeps this time off your booking link and warns if you schedule over it.
        </p>

        <label className="mt-4 block text-xs font-medium text-[var(--fg-secondary)]">
          Label
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Busy"
            className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2 text-sm text-[var(--fg-primary)]"
          />
        </label>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="block text-xs font-medium text-[var(--fg-secondary)]">
            From
            <input
              type="datetime-local"
              value={toLocalInput(draft.startsAt)}
              onChange={(e) => {
                const iso = fromLocalInput(e.target.value);
                if (iso) onChange({ ...draft, startsAt: iso });
              }}
              className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-2 py-2 text-sm text-[var(--fg-primary)]"
            />
          </label>
          <label className="block text-xs font-medium text-[var(--fg-secondary)]">
            To
            <input
              type="datetime-local"
              value={toLocalInput(draft.endsAt)}
              onChange={(e) => {
                const iso = fromLocalInput(e.target.value);
                if (iso) onChange({ ...draft, endsAt: iso });
              }}
              className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-2 py-2 text-sm text-[var(--fg-primary)]"
            />
          </label>
        </div>

        {error ? <p className="mt-3 text-xs text-[var(--status-danger)]">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-2 text-sm text-[var(--fg-secondary)] hover:bg-[var(--surface-0)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => { setBusy(true); onSave(title); }}
            className="rounded-lg bg-[var(--gold-400)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Blocking…" : "Block time"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Toolbar (calendar view controls) ───────────────────────────────────────
// New meeting + join-by-code live in the lobby above; the calendar toolbar
// only navigates and filters. New meetings are still created from the calendar
// by clicking an empty day/slot.
function Toolbar({
  title,
  view,
  onView,
  onPrev,
  onNext,
  onToday,
  filter,
  onFilter,
  filterOpen,
  setFilterOpen,
  onShortcuts,
  railOpen,
  onToggleRail,
}: {
  title: string;
  view: CalendarView;
  onView: (v: CalendarView) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  filter: CalendarFilter;
  onFilter: (f: CalendarFilter) => void;
  filterOpen: boolean;
  setFilterOpen: (v: boolean) => void;
  onShortcuts: () => void;
  railOpen: boolean;
  onToggleRail: () => void;
}) {
  const filterRef = useRef<HTMLDivElement>(null);
  const activeFilters = filterCountActive(filter);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [setFilterOpen]);

  return (
    <div className="sticky top-0 z-20 -mx-4 mb-6 flex flex-col gap-3 border-b border-[var(--line)] bg-surface-0/80 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight text-[var(--fg-primary)]">Calendar</h2>
        </div>

        {/* Date navigation */}
        <div className="flex items-center gap-1">
          <button onClick={onToday} className="min-h-9 rounded-lg border border-[var(--line)] px-3 text-xs font-medium text-[var(--fg-secondary)] hover:bg-[var(--surface-1)] hover:text-[var(--fg-primary)] sm:min-h-0 sm:py-1.5">
            Today
          </button>
          <IconBtn label="Previous" onClick={onPrev}><ChevronLeft /></IconBtn>
          <IconBtn label="Next" onClick={onNext}><ChevronRight /></IconBtn>
          <span className="ml-1 min-w-0 truncate text-sm font-medium text-[var(--fg-primary)]">{title}</span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center rounded-lg border border-[var(--line)] p-0.5">
            {(Object.keys(VIEW_LABELS) as CalendarView[]).map((v) => (
              <button
                key={v}
                onClick={() => onView(v)}
                aria-pressed={view === v}
                className={`min-h-9 rounded-md px-2.5 text-xs font-medium transition-colors sm:min-h-0 sm:py-1 ${
                  view === v ? "bg-[var(--gold-400)] text-white" : "text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
                }`}
              >
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onShortcuts}
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
            className="hidden h-7 w-7 items-center justify-center rounded-lg border border-[var(--line)] font-mono text-xs text-[var(--fg-muted)] transition-colors hover:text-[var(--fg-primary)] sm:flex"
          >
            ?
          </button>

          {/* Filters */}
          <div className="relative" ref={filterRef}>
            <button
              onClick={() => setFilterOpen(!filterOpen)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                activeFilters > 0
                  ? "border-gold-400/50 bg-gold-400/10 text-[var(--gold-400)]"
                  : "border-[var(--line)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
              }`}
            >
              <FilterIcon />
              Filters{activeFilters > 0 ? ` · ${activeFilters}` : ""}
            </button>
            {filterOpen ? <FilterMenu filter={filter} onFilter={onFilter} /> : null}
          </div>

          {/* Mini month, connected calendars and today. */}
          <button
            type="button"
            onClick={onToggleRail}
            aria-pressed={railOpen}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${
              railOpen
                ? "border-gold-400/50 bg-gold-400/10 text-[var(--gold-400)]"
                : "border-[var(--line)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
            }`}
          >
            {railOpen ? "Hide side panel" : "Calendars & today"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FilterMenu({ filter, onFilter }: { filter: CalendarFilter; onFilter: (f: CalendarFilter) => void }) {
  function toggle(kind: "types" | "statuses", value: string) {
    const next = new Set(filter[kind]);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onFilter({ ...filter, [kind]: next });
  }
  return (
    <div className="absolute right-0 top-full z-30 mt-2 w-64 rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-3 shadow-2xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-muted)]">Filters</span>
        {filterCountActive(filter) > 0 ? (
          <button onClick={() => onFilter(emptyFilter())} className="text-[11px] text-[var(--gold-400)] hover:underline">Clear</button>
        ) : null}
      </div>
      <label className="mb-3 flex items-center gap-2 text-xs text-[var(--fg-secondary)]">
        <input type="checkbox" checked={filter.mineOnly} onChange={(e) => onFilter({ ...filter, mineOnly: e.target.checked })} />
        Only meetings I host
      </label>
      {/* The type chips are also the calendar's colour key: the side panel's
          separate legend repeated this list in another place. */}
      <p className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--fg-muted)]">Type · colour key</p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {CALENDAR_TYPE_ORDER.map((t) => {
          const meta = typeMeta(t);
          const active = filter.types.has(t);
          return (
            <button
              key={t}
              onClick={() => toggle("types", t)}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${active ? meta.chip : "border-[var(--line)] text-[var(--fg-muted)]"}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
              {meta.label}
            </button>
          );
        })}
      </div>
      <p className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--fg-muted)]">Status</p>
      <div className="flex flex-wrap gap-1.5">
        {STATUS_ORDER.map((s) => {
          const active = filter.statuses.has(s);
          return (
            <button
              key={s}
              onClick={() => toggle("statuses", s)}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${active ? "border-gold-400/50 bg-gold-400/10 text-[var(--gold-400)]" : "border-[var(--line)] text-[var(--fg-muted)]"}`}
            >
              {s}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Month view ─────────────────────────────────────────────────────────────
interface SharedViewProps {
  meetings: CalendarMeeting[];
  now: number;
  /** Double bookings and meetings on busy time, by meeting id. */
  conflicts: Map<string, Conflict>;
  today: Date;
  presence: Record<string, RoomPresence>;
  statusOf: (m: CalendarMeeting) => MeetingDisplayStatus;
  blocks: CalendarBlock[];
  onSelectEvent: (m: CalendarMeeting) => void;
  onSelectBlock: (b: CalendarBlock) => void;
  onSelectSlot: (iso: string, x: number, y: number) => void;
  externalEvents: ExternalEvent[];
  /** Events whose time is taken: busy, on a calendar that counts as busy. */
  busyEvents: ExternalEvent[];
  layersById: Map<string, CalendarLayer>;
  onExpandDay: (d: Date) => void;
  /** Commit a drag. Absent in views that cannot express one (month, agenda). */
  onMoveMeeting?: (m: CalendarMeeting, startIso: string, durationMinutes: number) => void;
}

/**
 * One day in the month grid.
 *
 * Memoised, because a fifteen-second clock re-renders this grid and NOT ONE of
 * these inputs comes from that clock: `today` is coarsened to the day, and the
 * buckets are keyed on the data. Measured over ten minutes of ticks, NOT ONE of
 * the 40 changed a single cell's label or text — and all 40 rebuilt all 42 cells
 * anyway. The grid's own render went from 10.2ms a tick to 4.3ms at thirty
 * meetings, and from 18.4ms to 6.9ms at eighty.
 *
 * So the props are the answers rather than the questions — the day's meetings,
 * blocks and external events, already bucketed upstream, and the spoken date
 * already formatted. `presence` is passed whole and deliberately DOES invalidate
 * this: presence is real data, and a cell whose room just filled should redraw.
 * That makes it the one prop a caller can ruin this with. `useLivePresence`
 * holds it in `useState`, so its identity survives a tick; anything handing this
 * a freshly built object per render puts the whole saving back. Measured, that
 * one object costs four fifths of it.
 */
const MonthDayCell = memo(function MonthDayCell({
  day,
  spokenLabel,
  inMonth,
  isToday,
  isOpen,
  evs,
  dayBlocks,
  externalToday,
  layersById,
  presence,
  onOpenDay,
}: {
  day: Date;
  spokenLabel: string;
  inMonth: boolean;
  isToday: boolean;
  isOpen: boolean;
  evs: CalendarMeeting[];
  dayBlocks: ReturnType<typeof blocksForDay>;
  externalToday: ExternalEvent[];
  layersById: Map<string, CalendarLayer>;
  presence: Record<string, RoomPresence>;
  onOpenDay: (day: Date, itemKey?: string) => void;
}) {
  // Blocks take the first row so a busy day reads as busy at a glance,
  // then meetings fill what's left of the three-chip budget.
  const shown = evs.slice(0, Math.max(1, 3 - dayBlocks.length));
  const extra = evs.length - shown.length;
  const count = evs.length + dayBlocks.length + externalToday.length;
  return (
    <button
      type="button"
      aria-expanded={isOpen}
      aria-label={`${spokenLabel} — ${count === 0 ? "nothing scheduled" : `${count} item${count === 1 ? "" : "s"}`}`}
      onClick={() => onOpenDay(day)}
      className={`flex min-h-[104px] flex-col gap-1 lg:min-h-[132px] border-b border-r border-[var(--line)] p-1.5 text-left transition-colors hover:bg-[var(--surface-0)] ${
        inMonth ? "" : "bg-surface-0/40"
      } ${isOpen ? "bg-[var(--surface-0)] ring-1 ring-inset ring-[var(--gold-400)]" : ""}`}
    >
      <span
        className={`inline-flex h-6 w-6 items-center justify-center self-start rounded-full text-xs ${
          isToday ? "bg-[var(--gold-400)] font-semibold text-white" : inMonth ? "text-[var(--fg-secondary)]" : "text-[var(--fg-muted)]"
        }`}
      >
        {day.getDate()}
      </span>
      {/* Once the day is open, the panel below lists every one of
          these in full. The cell stops being a summary and becomes
          the header for that list: the date, and nothing it would
          only say twice. The count stays in the label above, so a
          screen reader still hears what the day holds. */}
      {!isOpen && externalToday.length ? (
        <div className="flex flex-wrap items-center gap-1" title={externalToday.map((e) => e.title).join("\n")}>
          {externalToday.slice(0, 6).map((e) => {
            const layer = layersById.get(e.calendarId);
            return (
              <span
                key={e.id}
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: layer ? colorForLayer(layer) : "var(--fg-muted)" }}
              />
            );
          })}
          {externalToday.length > 6 ? (
            <span className="text-[10px] leading-none text-[var(--fg-muted)]">+{externalToday.length - 6}</span>
          ) : null}
        </div>
      ) : null}

      {isOpen ? null : (
        <div className="flex flex-col gap-0.5">
          {dayBlocks.map((b) => (
            <BlockChip key={b.id} b={b} onClick={(e) => { e.stopPropagation(); onOpenDay(day, `block:${b.id}`); }} />
          ))}
          {shown.map((m) => (
            <MonthChip key={m.id} m={m} live={(presence[m.id]?.count ?? 0) > 0} onClick={(e) => { e.stopPropagation(); onOpenDay(day, `meeting:${m.id}`); }} />
          ))}
          {extra > 0 ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onOpenDay(day); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onOpenDay(day); } }}
              className="cursor-pointer px-1 text-[11px] font-medium text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
            >
              +{extra} more
            </span>
          ) : null}
        </div>
      )}
    </button>
  );
});

function MonthView({
  anchor,
  meetings,
  blocks,
  externalEvents,
  layersById,
  now,
  today,
  presence,
  statusOf,
  onSelectBlock,
  onExpandDay,
  expandedDay,
  expandedItemKey,
  onOpenDay,
  onSelectItem,
  onCloseDay,
  onNewMeeting,
  onBlockTime,
  onEditMeeting,
}: SharedViewProps & {
  anchor: Date;
  /** The day whose list is open, or null. */
  expandedDay: Date | null;
  /** The row inside that list being read, or null for the list itself. */
  expandedItemKey: string | null;
  onOpenDay: (day: Date, itemKey?: string) => void;
  onSelectItem: (itemKey: string | null) => void;
  onCloseDay: () => void;
  onNewMeeting: (day: Date) => void;
  onBlockTime: (day: Date) => void;
  onEditMeeting: (m: CalendarMeeting) => void;
}) {
  // Memoised on the anchor: `monthMatrix` mints 42 fresh Date objects, and a
  // clock tick does not move the month. Without this every tick handed the cells
  // 42 new object identities, which no memo below could see through.
  const weeks = useMemo(() => monthMatrix(anchor), [anchor]);
  const labels = weekdayLabels();
  // The grid re-renders on every tick of the clock, and every cell carries a
  // spoken date. One reused formatter instead of 42 fresh ones a second.
  const spokenDate = useMemo(() => {
    const fmt = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });
    return (d: Date) => fmt.format(d);
  }, []);
  /**
   * What each of the 42 cells holds, worked out once per data change.
   *
   * `eventsForDay` and the external lookups already cache by list identity, but
   * `blocksForDay` does not: it rescanned every block for each of the 42 cells,
   * and the grid renders on every fifteen-second tick, so that was a 42x scan
   * four times a minute for an answer that had not changed. Measured at 0.61ms
   * a render with thirty meetings and five blocks, 1.85ms at eighty and twenty,
   * of which blocksForDay is 0.36ms — the bulk of it.
   *
   * The external concat is only 0.06ms, and is here for the other reason: it
   * mints a fresh array per cell per render, and a new identity four times a
   * minute is exactly what the memo below could not have seen through.
   *
   * Keyed on the data and the month, never on `now`, which is what lets the
   * memoised cell below bail out on a tick.
   */
  const buckets = useMemo(() => {
    const map = new Map<string, { evs: CalendarMeeting[]; dayBlocks: ReturnType<typeof blocksForDay>; externalToday: ExternalEvent[] }>();
    for (const week of weeks) {
      for (const day of week) {
        map.set(dayKey(day), {
          evs: eventsForDay(meetings, day),
          dayBlocks: blocksForDay(blocks, day),
          externalToday: [
            ...eventSpansForDay(externalEvents, day).map((sp) => sp.event),
            ...allDayEventsForDay(externalEvents, day),
          ],
        });
      }
    }
    return map;
  }, [weeks, meetings, blocks, externalEvents]);
  return (
    <div>
      <div className="grid grid-cols-7 border-b border-[var(--line)]">
        {labels.map((l) => (
          <div key={l} className="px-2 py-1.5 text-center font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-muted)]">{l}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {weeks.map((week, wi) => {
          // The panel is rendered as a full-width row after the week that owns
          // the expanded day, so the month above it stays readable and the
          // weeks below simply move down.
          const expandedHere = expandedDay ? week.some((d) => isSameDay(d, expandedDay)) : false;
          return (
            <Fragment key={wi}>
              {week.map((day, di) => {
                const bucket = buckets.get(dayKey(day));
                return (
                  <MonthDayCell
                    key={di}
                    day={day}
                    spokenLabel={spokenDate(day)}
                    inMonth={isSameMonth(day, anchor)}
                    isToday={isSameDay(day, today)}
                    isOpen={Boolean(expandedDay && isSameDay(day, expandedDay))}
                    evs={bucket?.evs ?? []}
                    dayBlocks={bucket?.dayBlocks ?? []}
                    externalToday={bucket?.externalToday ?? []}
                    layersById={layersById}
                    presence={presence}
                    onOpenDay={onOpenDay}
                  />
                );
              })}
              {expandedHere && expandedDay ? (
                <div className="col-span-7 border-b border-r border-[var(--line)] bg-[var(--surface-0)]">
                  <DayPanel
                    key={dayKey(expandedDay)}
                    day={expandedDay}
                    meetings={meetings}
                    blocks={blocks}
                    externalEvents={externalEvents}
                    layersById={layersById}
                    now={now}
                    presence={presence}
                    statusOf={statusOf}
                    selectedKey={expandedItemKey}
                    onSelectItem={onSelectItem}
                    onClose={onCloseDay}
                    onNewMeeting={onNewMeeting}
                    onBlockTime={onBlockTime}
                    onEditMeeting={onEditMeeting}
                    onClearBlock={onSelectBlock}
                    onOpenDayView={onExpandDay}
                  />
                </div>
              ) : null}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ── The day panel ───────────────────────────────────────────────────────────
//
// What a month cell cannot say. Three chips and a row of dots are a summary;
// clicking the day opens the whole of it — own meetings, blocked time, and the
// connected calendars — as collapsible groups, each row opening into its own
// detail. The detail replaces the list rather than stacking a dialog on top of
// it, and its close button returns to the list, so a member can read three
// things on a day without the day ever leaving the screen.
export function DayPanel({
  day,
  meetings,
  blocks,
  externalEvents,
  layersById,
  now,
  presence,
  statusOf,
  selectedKey,
  onSelectItem,
  onClose,
  onNewMeeting,
  onBlockTime,
  onEditMeeting,
  onClearBlock,
  onOpenDayView,
}: {
  day: Date;
  meetings: CalendarMeeting[];
  blocks: CalendarBlock[];
  externalEvents: ExternalEvent[];
  layersById: Map<string, CalendarLayer>;
  now: number;
  presence: Record<string, RoomPresence>;
  statusOf: (m: CalendarMeeting) => MeetingDisplayStatus;
  /** The row being read, or null for the list. Held by the caller so that
   *  clicking the same chip twice reopens it — state kept in here would see no
   *  change on the second click and quietly do nothing. */
  selectedKey: string | null;
  onSelectItem: (itemKey: string | null) => void;
  onClose: () => void;
  onNewMeeting: (day: Date) => void;
  onBlockTime: (day: Date) => void;
  onEditMeeting: (m: CalendarMeeting) => void;
  onClearBlock: (b: CalendarBlock) => void;
  onOpenDayView: (day: Date) => void;
}) {
  const agenda = useMemo(
    () => buildDayAgenda(day, { meetings, blocks, externalEvents }),
    [day, meetings, blocks, externalEvents],
  );
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Resolved every render rather than stored: a block cleared from its own
  // detail, or a meeting that a refresh moved off this day, must fall back to
  // the list instead of leaving a detail describing something that is gone.
  const selected = useMemo(() => {
    if (!selectedKey) return null;
    for (const section of agenda.sections) {
      const hit = section.items.find((i) => i.key === selectedKey);
      if (hit) return hit;
    }
    return null;
  }, [agenda, selectedKey]);

  // Escape backs out one level at a time — detail to list, list to closed —
  // because a member reading the third meeting of a day did not ask to lose
  // the day.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (selected) onSelectItem(null);
      else onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, onSelectItem, onClose]);

  return (
    <section
      aria-label={`${formatDayTitle(day)} schedule`}
      className="flex flex-col"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-[var(--fg-primary)]">{formatDayTitle(day)}</h3>
          <p className="text-[11px] text-[var(--fg-muted)]">{summarizeDayAgenda(agenda)}</p>
        </div>
        <button
          type="button"
          onClick={() => onNewMeeting(day)}
          className="rounded-lg bg-gold-400 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-gold-500"
        >
          New meeting
        </button>
        <button
          type="button"
          onClick={() => onBlockTime(day)}
          className="rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-[11px] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
        >
          Block time
        </button>
        <button
          type="button"
          onClick={() => onOpenDayView(day)}
          className="rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-[11px] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
        >
          Day view →
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${formatDayTitle(day)}`}
          className="rounded-full p-1.5 text-[var(--fg-muted)] hover:bg-[var(--surface-1)] hover:text-[var(--fg-primary)]"
        >
          <CloseIcon />
        </button>
      </header>

      {selected ? (
        <DayItemDetail
          item={selected}
          layersById={layersById}
          now={now}
          presence={selected.meeting ? presence[selected.meeting.id] : undefined}
          status={selected.meeting ? statusOf(selected.meeting) : undefined}
          onBack={() => onSelectItem(null)}
          onEditMeeting={onEditMeeting}
          onClearBlock={onClearBlock}
          onDone={onClose}
        />
      ) : agenda.total === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-[var(--fg-muted)]">
          Nothing on this day yet — start a meeting, or block the time.
        </p>
      ) : (
        <div className="flex flex-col">
          {agenda.sections.map((section) => {
            const open = !collapsed[section.kind];
            return (
              <div key={section.kind} className="border-b border-[var(--line)] last:border-b-0">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setCollapsed((c) => ({ ...c, [section.kind]: open }))}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--surface-1)]"
                >
                  <Caret open={open} />
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-secondary)]">
                    {section.label}
                  </span>
                  <span className="text-[11px] tabular-nums text-[var(--fg-muted)]">{section.items.length}</span>
                </button>
                {open ? (
                  <ul className="flex flex-col pb-1">
                    {section.items.map((item) => (
                      <li key={item.key}>
                        <button
                          type="button"
                          onClick={() => onSelectItem(item.key)}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--surface-1)]"
                        >
                          <ItemDot item={item} layersById={layersById} live={itemIsLive(item, presence)} />
                          <span className="w-24 shrink-0 truncate font-mono text-[11px] tabular-nums text-[var(--fg-muted)]">
                            {item.timeLabel}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-xs text-[var(--fg-primary)]">{item.title}</span>
                          {item.continuesNextDay ? (
                            <span className="shrink-0 text-[10px] text-[var(--fg-muted)]">continues</span>
                          ) : null}
                          <span className="shrink-0 text-[var(--fg-muted)]"><ChevronRight /></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Someone is in the room right now. Only ever true of this app's own meetings —
 *  an external calendar cannot tell us who is in a call. */
function itemIsLive(item: DayAgendaItem, presence: Record<string, RoomPresence>): boolean {
  return Boolean(item.meeting && (presence[item.meeting.id]?.count ?? 0) > 0);
}

/** The colour that tells a row what it is without reading it: meeting type,
 *  muted for blocked time, and the source calendar's own colour for events. */
function ItemDot({ item, layersById, live }: { item: DayAgendaItem; layersById: Map<string, CalendarLayer>; live: boolean }) {
  if (live) return <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--status-success)]" />;
  if (item.meeting) return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${typeMeta(item.meeting.meeting_type).dot}`} />;
  if (item.event) {
    const layer = layersById.get(item.event.calendarId);
    return (
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: layer ? colorForLayer(layer) : "var(--fg-muted)" }}
      />
    );
  }
  return <span className="h-1.5 w-1.5 shrink-0 rounded-full border border-dashed border-[var(--fg-muted)]" />;
}

// ── One row of the day, opened ──────────────────────────────────────────────
// Whatever the row is, the close button means the same thing here: back to the
// day it came from, never out of the calendar.
function DayItemDetail({
  item,
  layersById,
  now,
  presence,
  status,
  onBack,
  onEditMeeting,
  onClearBlock,
  onDone,
}: {
  item: DayAgendaItem;
  layersById: Map<string, CalendarLayer>;
  now: number;
  presence?: RoomPresence;
  status?: MeetingDisplayStatus;
  onBack: () => void;
  onEditMeeting: (m: CalendarMeeting) => void;
  onClearBlock: (b: CalendarBlock) => void;
  onDone: () => void;
}) {
  const layer = item.event ? layersById.get(item.event.calendarId) : undefined;
  return (
    <div>
      <div className="flex items-start gap-3 border-b border-[var(--line)] px-3 py-2.5">
        {/* Leading, not trailing. The panel's own close sits at the top right,
            and two identical × a thumb's width apart means the one that loses
            the whole day is the one hit by accident. */}
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to the day's list"
          title="Back to the day's list"
          className="mt-0.5 shrink-0 rounded-full p-1.5 text-[var(--fg-muted)] hover:bg-[var(--surface-1)] hover:text-[var(--fg-primary)]"
        >
          <CloseIcon />
        </button>
        <div className="min-w-0 flex-1">
          {item.meeting && status ? (
            <MeetingDetailHeading meeting={item.meeting} status={status} presence={presence} now={now} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-dashed border-[var(--line)] px-2 py-0.5 text-[11px] font-medium text-[var(--fg-muted)]">
                  {item.block ? "Blocked time" : layer?.name ?? "Connected calendar"}
                </span>
              </div>
              <h4 className="mt-2 text-base font-semibold text-[var(--fg-primary)]">{item.title}</h4>
              <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
                {item.allDay
                  ? "All day"
                  : `${item.startsEarlierDay ? "from earlier" : item.timeLabel}${
                      item.block ? ` – ${shortTime(item.block.endsAt)}` : item.event ? ` – ${shortTime(item.event.endsAt)}` : ""
                    }`}
                {item.continuesNextDay ? " · continues the next day" : ""}
              </p>
            </>
          )}
        </div>
      </div>

      {item.meeting && isBookingRequest(item.meeting) ? (
        <div className="flex flex-wrap items-center gap-2 p-3">
          <p className="min-w-0 flex-1 text-xs text-[var(--fg-muted)]">
            A request through your scheduling link, waiting on you. Drag it in week or day view to offer another time.
          </p>
          <button
            type="button"
            onClick={() => { const m = item.meeting!; onDone(); onEditMeeting(m); }}
            className="rounded-lg bg-[var(--gold-400)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--gold-500)]"
          >
            Approve or decline
          </button>
        </div>
      ) : item.meeting && status ? (
        <MeetingDetailBody
          meeting={item.meeting}
          presence={presence}
          now={now}
          onEdit={() => { const m = item.meeting!; onDone(); onEditMeeting(m); }}
          onAfterEarn={onDone}
        />
      ) : item.block ? (
        <div className="flex flex-wrap items-center gap-2 p-3">
          <p className="min-w-0 flex-1 text-xs text-[var(--fg-muted)]">
            Time you marked unavailable. Clearing it frees the slot for scheduling.
          </p>
          <button
            type="button"
            onClick={() => { onClearBlock(item.block!); onBack(); }}
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
          >
            Clear block
          </button>
        </div>
      ) : item.event ? (
        <div className="flex flex-col gap-2 p-3 text-sm">
          {item.event.location ? <DetailRow label="Location" value={item.event.location} /> : null}
          <DetailRow label="Shows as" value={item.event.isBusy ? "Busy" : "Free"} />
          {item.event.link ? (
            <a
              href={item.event.link}
              target="_blank"
              rel="noreferrer"
              className="self-start rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
            >
              Open in {layer?.source === "google" ? "Google Calendar" : "its calendar"} →
            </a>
          ) : null}
          <p className="text-[11px] text-[var(--fg-muted)]">
            This event belongs to a connected calendar — edit it there, not here.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-[var(--fg-muted)] transition-transform ${open ? "rotate-90" : ""}`}
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

/** A blocked span in the month grid. Muted and hatched so it never reads as a
 *  meeting — there is nothing to attend, only time that is spoken for. */
function BlockChip({ b, onClick }: { b: BlockSpan; onClick: (e: React.MouseEvent) => void }) {
  const label = b.startsEarlierDay ? "from earlier" : shortTime(b.startsAt);
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter") onClick(e as unknown as React.MouseEvent); }}
      className="flex items-center gap-1 truncate rounded border border-dashed border-[var(--line)] bg-[var(--surface-0)] px-1 py-0.5 text-[11px] font-medium text-[var(--fg-muted)]"
      title={`${b.title} — click to clear`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--fg-muted)]" />
      <span className="shrink-0 tabular-nums opacity-80">{label}</span>
      <span className="truncate">{b.title}</span>
    </span>
  );
}

/**
 * The mark a repeating meeting carries on the calendar, so a weekly series
 * reads as one thing rather than a dozen unrelated meetings.
 */
function RepeatMark({ m }: { m: CalendarMeeting }) {
  const label = m.series_id ? seriesPositionLabel(m.series_rule, m.series_index) : null;
  if (!label) return null;
  return (
    <span data-repeat="" role="img" aria-label={label} title={label} className="shrink-0 text-[10px] leading-none opacity-70">
      ↻
    </span>
  );
}

function MonthChip({ m, live, onClick }: { m: CalendarMeeting; live: boolean; onClick: (e: React.MouseEvent) => void }) {
  const meta = typeMeta(m.meeting_type);
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter") onClick(e as unknown as React.MouseEvent); }}
      className={`flex items-center gap-1 truncate rounded border px-1 py-0.5 text-[11px] font-medium ${meta.chip}`}
      title={m.title}
    >
      {live ? <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--status-success)]" /> : <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />}
      <span className="shrink-0 tabular-nums opacity-80">{m.scheduled_at ? shortTime(m.scheduled_at) : ""}</span>
      <span className="truncate">{m.title}</span>
      <RepeatMark m={m} />
    </span>
  );
}

// ── Week / Day time grid ────────────────────────────────────────────────────
function TimeGridView({ days, meetings, blocks, externalEvents, busyEvents, layersById, now, today, presence, conflicts, onSelectEvent, onSelectBlock, onSelectSlot, onMoveMeeting }: SharedViewProps & { days: Date[] }) {
  const busyIds = useMemo(() => new Set(busyEvents.map((e) => e.id)), [busyEvents]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = DAY_SCROLL_HOUR * HOUR_PX;
  }, [days.length]);

  const hours = HOURS;
  const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes();
  // Whether today is one of the columns: the now line is drawn across the
  // whole week then, faintly, so the hour reads across every day and not only
  // in today's column.
  const showsToday = days.some((d) => isSameDay(d, today));

  // Each column's meetings and their lanes, worked out when the meetings or the
  // days change — not on every fifteen-second tick of the clock, which is when
  // this view used to redo all of it for every column.
  const columns = useMemo(
    () => days.map((d) => {
      const evs = eventsForDay(meetings, d);
      return { evs, layout: layoutDayEvents(evs) };
    }),
    [days, meetings],
  );

  // ── Drag to move / resize ─────────────────────────────────────────────────
  //
  // A press is not yet a drag: the origin is recorded here and only promoted
  // once the pointer has travelled far enough, so a click still opens the
  // event. Everything about what the gesture MEANS lives in calendar-drag.ts;
  // this owns pixels and pointer events only.
  const pending = useRef<{ origin: DragOrigin; meeting: CalendarMeeting; clientX: number; clientY: number } | null>(null);
  const [drag, setDrag] = useState<{ origin: DragOrigin; meeting: CalendarMeeting; preview: DragPreview } | null>(null);
  const dragRef = useRef(drag);
  useEffect(() => { dragRef.current = drag; }, [drag]);
  // A completed drag still produces a click, and because pointerdown and
  // pointerup land on different elements the browser retargets it to their
  // common ancestor — the day column — which would open the "New meeting /
  // Block time" menu on every drop. This swallows exactly that one click.
  const swallowClick = useRef(false);

  const pointerToGrid = useCallback((clientX: number, clientY: number) => {
    const el = columnsRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      minute: minuteFromOffset(clientY - rect.top, HOUR_PX),
      dayIndex: columnFromOffset(clientX - rect.left, rect.width / Math.max(1, days.length), days.length),
    };
  }, [days.length]);

  const beginDrag = useCallback((e: React.PointerEvent, m: CalendarMeeting, mode: DragMode, dayIndex: number) => {
    if (!onMoveMeeting || !canDragMeeting(m)) return;
    if (mode !== "move" && isBookingRequest(m)) return;
    // Left button only: a right-click is a context menu, and a two-finger
    // gesture on a trackpad is a scroll.
    if (e.button !== 0) return;

    const [startMinute, endMinute] = eventSpanMinutes(m);
    const at = pointerToGrid(e.clientX, e.clientY);
    pending.current = {
      meeting: m,
      clientX: e.clientX,
      clientY: e.clientY,
      origin: {
        meetingId: m.id,
        mode,
        startMinute,
        endMinute,
        dayIndex,
        grabOffsetMinute: at ? Math.max(0, at.minute - startMinute) : 0,
      },
    };
  }, [onMoveMeeting, pointerToGrid]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const p = pending.current;
      if (!p) return;
      if (!dragRef.current && !movedEnough(e.clientX - p.clientX, e.clientY - p.clientY)) return;

      const at = pointerToGrid(e.clientX, e.clientY);
      if (!at) return;
      // Once dragging, stop the grid from selecting text under the cursor.
      e.preventDefault();
      setDrag({
        origin: p.origin,
        meeting: p.meeting,
        preview: previewFor(p.origin, at, { dayCount: days.length }),
      });
    }

    function onUp() {
      const active = dragRef.current;
      pending.current = null;
      if (!active) return;
      swallowClick.current = true;
      setDrag(null);
      if (isNoOp(active.origin, active.preview)) return;
      const day = days[active.preview.dayIndex] ?? days[active.origin.dayIndex];
      if (!day) return;
      onMoveMeeting?.(
        active.meeting,
        previewStartIso(day, active.preview),
        Math.max(MIN_DURATION_MINUTES, durationOf(active.preview)),
      );
    }

    function onCancel() {
      // Escape, or the browser taking the pointer away — abandon, do not save.
      // The pointer is still down, so a click is still coming; without this it
      // lands on the day column and opens the "New meeting / Block time" menu,
      // which is the opposite of cancelling.
      if (dragRef.current) swallowClick.current = true;
      pending.current = null;
      setDrag(null);
    }

    // Any new interaction clears a suppression left armed by a drop that never
    // produced its click, so a stale flag cannot eat an unrelated later click.
    function onDown() {
      swallowClick.current = false;
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }

    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
    };
  }, [days, onMoveMeeting, pointerToGrid]);

  return (
    <div ref={scrollRef} className="max-h-[70vh] overflow-y-auto">
      {/* Day headers */}
      <div className="sticky top-0 z-10 flex border-b border-[var(--line)] bg-[var(--surface-1)]">
        <div className="w-14 shrink-0" />
        {days.map((d) => {
          const isToday = isSameDay(d, today);
          return (
            <div key={dayKey(d)} className="flex-1 border-l border-[var(--line)] px-2 py-2 text-center">
              <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--fg-muted)]">
                {weekdayLabel(d)}
              </div>
              <div className={`mx-auto mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-sm ${isToday ? "bg-[var(--gold-400)] font-semibold text-white" : "text-[var(--fg-primary)]"}`}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Body */}
      <div className="flex">
        {/* Hour gutter */}
        <div className="relative w-14 shrink-0">
          {showsToday ? (
            <span
              className="pointer-events-none absolute right-1 z-10 -translate-y-1/2 rounded bg-[var(--status-danger)] px-1 text-[10px] font-semibold tabular-nums text-white"
              style={{ top: (nowMin / 60) * HOUR_PX }}
            >
              {shortTime(new Date(now).toISOString())}
            </span>
          ) : null}
          {hours.map((h) => (
            <div key={h} className="relative border-b border-transparent" style={{ height: HOUR_PX }}>
              <span className="absolute -top-2 right-1.5 text-[11px] text-[var(--fg-muted)]">
                {h === 0 ? "" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`}
              </span>
            </div>
          ))}
        </div>

        <div ref={columnsRef} className="flex flex-1">
        {days.map((d, dayIndex) => {
          const { evs, layout } = columns[dayIndex];
          // A meeting only appears in the column of the day it is scheduled on,
          // so dragging it to another day hid it in the old column and never
          // drew it in the new one — it simply vanished until dropped. Inject it
          // into whichever column the pointer is over.
          const visitor =
            drag &&
            needsDragVisitor({
              previewDayIndex: drag.preview.dayIndex,
              dayIndex,
              columnContainsMeeting: evs.some((e) => e.id === drag.meeting.id),
            })
              ? drag.meeting
              : null;
          const rendered = visitor ? [...evs, visitor] : evs;
          const dayBlocks = blocksForDay(blocks, d);
          const busySpans = busyMinutesForDay(busyEvents, d);
          const allDayBusy = allDayEventsForDay(busyEvents, d);
          const isToday = isSameDay(d, today);
          return (
            <div
              key={dayKey(d)}
              className="relative flex-1 border-l border-[var(--line)]"
              style={{ height: 24 * HOUR_PX }}
              onClick={(e) => {
                if (swallowClick.current) { swallowClick.current = false; return; }
                const rect = e.currentTarget.getBoundingClientRect();
                const y = e.clientY - rect.top;
                let minutes = Math.round((y / HOUR_PX) * 60 / 30) * 30;
                minutes = Math.max(0, Math.min(23 * 60 + 30, minutes));
                // Rounding can land a click just beside a busy block inside it.
                if (overlapsBusy(busySpans, minutes, minutes + 30)) return;
                onSelectSlot(
                  localIso(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(minutes / 60), minutes % 60),
                  e.clientX,
                  e.clientY,
                );
              }}
            >
              {/* Hour lines */}
              {hours.map((h) => (
                <div key={h} className="absolute left-0 right-0 border-b border-line/60" style={{ top: h * HOUR_PX, height: HOUR_PX }} />
              ))}

              {/* Events from connected calendars, drawn beneath everything
                  this app owns. They are context for a decision, not the
                  subject of one — and they are read-only, so nothing here is
                  clickable in a way that implies otherwise. */}
              {eventSpansForDay(externalEvents, d).map(({ event, startMinute, endMinute }) => {
                // Busy time is drawn as blocked, below.
                if (busyIds.has(event.id)) return null;
                const layer = layersById.get(event.calendarId);
                const color = layer ? colorForLayer(layer) : "var(--fg-muted)";
                return (
                  <div
                    key={event.id}
                    className="pointer-events-none absolute left-0 right-0 overflow-hidden rounded-sm border-l-2 px-1.5 py-0.5"
                    style={{
                      top: (startMinute / 60) * HOUR_PX,
                      height: Math.max(((endMinute - startMinute) / 60) * HOUR_PX, 16),
                      borderLeftColor: color,
                      // A free-marked event is visible but must not read as a
                      // conflict, so it is drawn fainter than a busy one.
                      backgroundColor: `color-mix(in srgb, ${color} ${event.isBusy ? 16 : 7}%, transparent)`,
                    }}
                    title={`${event.title}${layer ? ` — ${layer.name}` : ""}`}
                  >
                    <span className="truncate text-[11px] text-[var(--fg-secondary)]">{event.title}</span>
                  </div>
                );
              })}

              {/* Time a connected calendar has taken: blocked, and not a place
                  to start a meeting. The click stops here rather than falling
                  through to the column, which would offer "New meeting". */}
              {allDayBusy.length > 0 ? (
                <div
                  aria-disabled="true"
                  onClick={(e) => e.stopPropagation()}
                  className="absolute inset-0 cursor-not-allowed"
                  style={BUSY_STYLE}
                  title={`Busy all day — ${allDayBusy.map((ev) => busyLabel(ev, layersById)).join(", ")}`}
                >
                  <span className="block truncate px-1.5 py-0.5 text-[11px] font-medium text-[var(--fg-muted)]">
                    Busy all day
                  </span>
                </div>
              ) : null}
              {eventSpansForDay(busyEvents, d).map(({ event, startMinute, endMinute }) => (
                <div
                  key={`busy-${event.id}`}
                  aria-disabled="true"
                  data-busy="true"
                  onClick={(e) => e.stopPropagation()}
                  className="absolute left-0 right-0 cursor-not-allowed overflow-hidden border-y border-dashed border-[var(--line)] px-1.5 py-0.5"
                  style={{
                    ...BUSY_STYLE,
                    top: (startMinute / 60) * HOUR_PX,
                    height: Math.max(((endMinute - startMinute) / 60) * HOUR_PX, 16),
                  }}
                  title={`Busy — ${busyLabel(event, layersById)}`}
                >
                  <span className="truncate text-[11px] font-medium text-[var(--fg-muted)]">
                    {busyLabel(event, layersById)}
                  </span>
                </div>
              ))}

              {/* Blocked time sits under the events: a meeting deliberately
                  scheduled over a block must still be readable. */}
              {dayBlocks.map((b) => {
                const top = (b.startMin / 60) * HOUR_PX;
                const height = Math.max(((b.endMin - b.startMin) / 60) * HOUR_PX, 16);
                return (
                  <button
                    key={b.id}
                    onClick={(e) => { e.stopPropagation(); onSelectBlock(b); }}
                    className="absolute left-0 right-0 overflow-hidden border-y border-dashed border-[var(--line)] px-1.5 py-0.5 text-left"
                    style={{
                      top,
                      height,
                      backgroundColor: "color-mix(in srgb, var(--fg-muted) 12%, transparent)",
                      backgroundImage:
                        "repeating-linear-gradient(45deg, transparent, transparent 5px, color-mix(in srgb, var(--fg-muted) 10%, transparent) 5px, color-mix(in srgb, var(--fg-muted) 10%, transparent) 10px)",
                    }}
                    title={`${b.title} — click to clear`}
                  >
                    <span className="truncate text-[11px] font-medium text-[var(--fg-muted)]">
                      {b.title}
                      {b.continuesNextDay ? " →" : ""}
                    </span>
                  </button>
                );
              })}

              {/* Now. Bold in today's column, faint across the others so the
                  hour lines up across the week. Red, not the brand colour: the
                  gold was the same as the selected day and every accent, and
                  the line people look for first was the one they could not find. */}
              {showsToday ? (
                <div
                  className={`pointer-events-none absolute left-0 right-0 z-10 flex items-center ${isToday ? "" : "opacity-30"}`}
                  style={{ top: (nowMin / 60) * HOUR_PX }}
                >
                  {isToday ? <span className="h-2.5 w-2.5 -translate-x-1 rounded-full bg-[var(--status-danger)]" /> : null}
                  <span className={`flex-1 bg-[var(--status-danger)] ${isToday ? "h-0.5" : "h-px"}`} />
                </div>
              ) : null}

              {/* Events */}
              {rendered.map((m) => {
                const [rawStart, rawEnd] = eventSpanMinutes(m);
                // While this event is being dragged it follows the pointer, and
                // is drawn in the column the pointer is over rather than its own.
                const dragging = drag?.origin.meetingId === m.id;
                const inThisColumn = dragging && drawsOwnMeeting({ previewDayIndex: drag!.preview.dayIndex, dayIndex });
                if (dragging && !inThisColumn) return null;
                const startMin = inThisColumn ? drag!.preview.startMinute : rawStart;
                const endMin = inThisColumn ? drag!.preview.endMinute : rawEnd;

                const { lane, lanes } = layout.get(m.id) ?? { lane: 0, lanes: 1 };
                const meta = typeMeta(m.meeting_type);
                const top = (startMin / 60) * HOUR_PX;
                const height = Math.max(((endMin - startMin) / 60) * HOUR_PX, 22);
                // A dragged event takes the full column width: it is leaving its
                // old neighbours, and the lanes it lands among are not known
                // until it is dropped.
                const widthPct = dragging ? 100 : 100 / lanes;
                const laneOffset = dragging ? 0 : lane * widthPct;
                const inRoom = presence[m.id]?.count ?? 0;
                const live = inRoom > 0;
                const ts = meetingTimeState(m.scheduled_at, m.duration_minutes, now);
                const draggable = Boolean(onMoveMeeting) && canDragMeeting(m, now);
                const clash = dragging ? null : conflictLabel(conflicts.get(m.id));
                const joinable = !dragging && joinableNow(m, now, inRoom);
                // A request's length is the meeting type's; it moves, it does
                // not stretch. Drawn dashed: it is a hold, not yet a meeting.
                const request = isBookingRequest(m);
                return (
                  <Fragment key={m.id}>
                  <button
                    onPointerDown={(e) => { if (draggable) beginDrag(e, m, "move", dayIndex); }}
                    onClick={(e) => {
                      e.stopPropagation();
                      // A drag that just ended must not also open the event.
                      if (swallowClick.current) { swallowClick.current = false; return; }
                      onSelectEvent(m);
                    }}
                    aria-label={`${m.title}${m.scheduled_at ? `, ${shortTime(m.scheduled_at)}` : ""}${live ? ", live now" : ""}${clash ? `. ${clash}` : ""}`}
                    className={`absolute overflow-hidden rounded-md border-l-2 px-1.5 py-1 text-left shadow-sm ${
                      draggable ? "cursor-grab active:cursor-grabbing" : ""
                    } ${dragging ? "z-20 opacity-90 shadow-lg ring-2 ring-[var(--gold-400)]" : ""} ${
                      // A clash outlines the block in red; a live room rings it
                      // green and pulses, so both read at a glance across a week.
                      !dragging && clash ? "ring-1 ring-[var(--status-danger)]" : ""
                    } ${!dragging && live ? "ring-2 ring-[var(--status-success)] animate-[pulse_2.4s_ease-in-out_infinite]" : ""}`}
                    style={{
                      top,
                      height,
                      left: `calc(${laneOffset}% + 2px)`,
                      width: `calc(${widthPct}% - 4px)`,
                      borderLeftColor: request ? "var(--status-warning)" : meta.accent,
                      borderLeftStyle: request ? "dashed" : undefined,
                      backgroundColor: request
                        ? "color-mix(in srgb, var(--status-warning) 10%, var(--surface-1))"
                        : `color-mix(in srgb, ${meta.accent} 16%, var(--surface-1))`,
                      touchAction: draggable ? "none" : undefined,
                    }}
                    title={clash ?? m.title}
                  >
                    <div className="flex items-center gap-1">
                      {live ? <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--status-success)]" /> : null}
                      <span className="truncate text-[11px] font-medium text-[var(--fg-primary)]">{m.title}</span>
                      <RepeatMark m={m} />
                      {clash ? <ConflictMark label={clash} /> : null}
                    </div>
                    <div className="truncate text-[11px] text-[var(--fg-muted)]">
                      {inThisColumn
                        ? describeSpan(drag!.preview)
                        : (m.scheduled_at ? shortTime(m.scheduled_at) : "")}
                      {!dragging && ts && (ts.phase === "imminent" || ts.phase === "in_progress")
                        ? ` · ${ts.phase === "in_progress" ? "In progress" : ts.label}`
                        : ""}
                    </div>

                    {/* Resize handles. Rendered inside the block but above its
                        text, and only when the event can actually be moved —
                        offering a grip that does nothing is worse than none. */}
                    {draggable && !request ? (
                      <>
                        <span
                          onPointerDown={(e) => { e.stopPropagation(); beginDrag(e, m, "resize-start", dayIndex); }}
                          className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize"
                          style={{ touchAction: "none" }}
                          aria-hidden="true"
                        />
                        <span
                          onPointerDown={(e) => { e.stopPropagation(); beginDrag(e, m, "resize-end", dayIndex); }}
                          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                          style={{ touchAction: "none" }}
                          aria-hidden="true"
                        />
                      </>
                    ) : null}
                  </button>
                  {/* Join, at the block's top-right corner from shortly before
                      the start. A sibling rather than inside the block: a link
                      inside a button is not valid, and a press on it must not
                      also open the event or start a drag. */}
                  {joinable && height >= 30 ? (
                    <div
                      className="absolute z-[11]"
                      style={{ top: top + 3, left: `calc(${laneOffset + widthPct}% - 6px)`, transform: "translateX(-100%)" }}
                    >
                      <JoinButton roomCode={m.room_code} live={live} compact />
                    </div>
                  ) : null}
                  </Fragment>
                );
              })}
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}

// ── Agenda / Schedule view ──────────────────────────────────────────────────
function AgendaView({ anchor, meetings, now, today, presence, statusOf, conflicts, onSelectEvent }: SharedViewProps & { anchor: Date }) {
  // Show the 21 days starting at the later of the anchor or today, grouped by day.
  const startMs = (startOfDay(anchor).getTime() < today.getTime() ? today : startOfDay(anchor)).getTime();
  // Regrouped when the meetings or the starting day change, not every clock tick.
  const withEvents = useMemo(() => {
    const start = new Date(startMs);
    return Array.from({ length: 21 }, (_, i) => addDays(start, i))
      .map((d) => ({ d, evs: eventsForDay(meetings, d) }))
      .filter((g) => g.evs.length > 0);
  }, [startMs, meetings]);

  if (withEvents.length === 0) {
    return (
      <div className="p-10 text-center">
        <p className="text-sm font-medium text-[var(--fg-primary)]">Nothing on the schedule.</p>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">No meetings in the next three weeks. Schedule one from the toolbar.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-[var(--line)]">
      {withEvents.map(({ d, evs }) => (
        <div key={dayKey(d)} className="flex gap-4 px-2 py-3">
          <div className="w-16 shrink-0 text-center">
            <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--fg-muted)]">{weekdayLabel(d)}</div>
            <div className={`mx-auto mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full text-base font-semibold ${isSameDay(d, today) ? "bg-[var(--gold-400)] text-white" : "text-[var(--fg-primary)]"}`}>
              {d.getDate()}
            </div>
            <div className="text-[11px] text-[var(--fg-muted)]">{monthLabel(d)}</div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {evs.map((m) => {
              const meta = typeMeta(m.meeting_type);
              const inRoom = presence[m.id]?.count ?? 0;
              const live = inRoom > 0;
              const ts = meetingTimeState(m.scheduled_at, m.duration_minutes, now);
              const clash = conflictLabel(conflicts.get(m.id));
              const joinable = joinableNow(m, now, inRoom);
              return (
                <div key={m.id} className="flex items-center gap-2">
                <button
                  onClick={() => onSelectEvent(m)}
                  className={`flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-lg border bg-[var(--surface-0)] px-3 py-2 text-left hover:border-fg-muted/40 ${
                    clash ? "border-status-danger/50" : live ? "border-status-success/50" : "border-[var(--line)]"
                  }`}
                >
                  <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: meta.accent }} />
                  <div className="w-16 shrink-0 text-xs tabular-nums text-[var(--fg-secondary)] sm:w-20">{m.scheduled_at ? shortTime(m.scheduled_at) : ""}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {live ? <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--status-success)]" /> : null}
                      <span className="truncate text-sm font-medium text-[var(--fg-primary)]">{m.title}</span>
                      <RepeatMark m={m} />
                    </div>
                    <div className="truncate text-xs text-[var(--fg-muted)]">
                      {meta.label}
                      {m.duration_minutes ? ` · ${m.duration_minutes} min` : ""}
                      {ts && (ts.phase === "imminent" || ts.phase === "in_progress") ? ` · ${ts.phase === "in_progress" ? "In progress" : ts.label}` : ""}
                    </div>
                  </div>
                  {clash ? <ConflictMark label={clash} /> : null}
                  <span className="hidden shrink-0 font-mono text-[11px] uppercase tracking-wider text-[var(--fg-muted)] sm:inline">{statusOf(m)}</span>
                </button>
                {joinable ? <JoinButton roomCode={m.room_code} live={live} /> : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Mini month navigator ────────────────────────────────────────────────────
function MiniMonth({
  anchor, onPick, today, meetings, orgId, loaded,
}: {
  anchor: Date; onPick: (d: Date) => void; today: Date; meetings: CalendarMeeting[];
  orgId: string;
  /** The range `meetings` covers. The navigator pages independently of it. */
  loaded: { from: string; to: string };
}) {
  const [cursor, setCursor] = useState<Date>(startOfDay(anchor));
  useEffect(() => setCursor(startOfDay(anchor)), [anchor]);
  const weeks = monthMatrix(cursor);

  // The grid only holds the months around the one on screen, and this
  // navigator can page well beyond them. For a month outside that range it
  // reads just the dates it needs to draw its dots.
  const gridFrom = weeks[0][0];
  const gridTo = addDays(weeks[weeks.length - 1][6], 1);
  const covered = gridFrom.toISOString() >= loaded.from && gridTo.toISOString() <= loaded.to;
  const gridKey = gridFrom.getTime();
  const [extra, setExtra] = useState<{ key: number; days: Set<string> } | null>(null);
  useEffect(() => {
    if (covered) return;
    let cancelled = false;
    void (async () => {
      const { data } = await createClient()
        .from("live_meetings")
        .select("scheduled_at")
        .eq("organization_id", orgId)
        .eq("kind", MEETING_KIND)
        .is("deleted_at", null)
        .gte("scheduled_at", new Date(gridKey).toISOString())
        .lt("scheduled_at", addDays(new Date(gridKey), 42).toISOString())
        .limit(500);
      if (cancelled) return;
      const days = new Set<string>();
      for (const r of (data ?? []) as { scheduled_at: string | null }[]) {
        if (r.scheduled_at) days.add(dayKey(new Date(r.scheduled_at)));
      }
      setExtra({ key: gridKey, days });
    })();
    return () => { cancelled = true; };
  }, [covered, gridKey, orgId]);

  const daysWithEvents = useMemo(() => {
    if (!covered) return extra?.key === gridKey ? extra.days : new Set<string>();
    const s = new Set<string>();
    for (const m of meetings) if (m.scheduled_at) s.add(dayKey(new Date(m.scheduled_at)));
    return s;
  }, [covered, extra, gridKey, meetings]);

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-[var(--fg-primary)]">{formatMonthTitle(cursor)}</span>
        <div className="flex items-center gap-0.5">
          <IconBtn label="Previous month" small onClick={() => setCursor((c) => addMonths(c, -1))}><ChevronLeft /></IconBtn>
          <IconBtn label="Next month" small onClick={() => setCursor((c) => addMonths(c, 1))}><ChevronRight /></IconBtn>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {weekdayLabels().map((l) => (
          <div key={l} className="text-center text-[11px] font-medium uppercase text-[var(--fg-muted)]">{l[0]}</div>
        ))}
        {weeks.flat().map((d, i) => {
          const isToday = isSameDay(d, today);
          const inMonth = isSameMonth(d, cursor);
          const has = daysWithEvents.has(dayKey(d));
          return (
            <button
              key={i}
              onClick={() => onPick(d)}
              className={`relative flex h-7 items-center justify-center rounded-full text-[11px] ${
                isToday ? "bg-[var(--gold-400)] font-semibold text-white" : inMonth ? "text-[var(--fg-secondary)] hover:bg-[var(--surface-0)]" : "text-[var(--fg-muted)] hover:bg-[var(--surface-0)]"
              }`}
            >
              {d.getDate()}
              {has && !isToday ? <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-[var(--gold-400)]" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Today, in the side rail: one line per meeting, Join on whatever is starting
 * or running, and a mark on anything double-booked. The question the rail most
 * often answers is "what's next today", and the mini month above it does not.
 */
function TodayRail({
  meetings,
  today,
  now,
  presence,
  conflicts,
  onSelect,
}: {
  meetings: CalendarMeeting[];
  today: Date;
  now: number;
  presence: Record<string, RoomPresence>;
  conflicts: Map<string, Conflict>;
  onSelect: (m: CalendarMeeting) => void;
}) {
  const todays = eventsForDay(meetings, today);
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] p-3">
      <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-muted)]">
        Today{todays.length ? ` · ${todays.length}` : ""}
      </p>
      {todays.length === 0 ? (
        <p className="text-xs text-[var(--fg-muted)]">Nothing scheduled today.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {todays.map((m) => {
            const inRoom = presence[m.id]?.count ?? 0;
            const joinable = joinableNow(m, now, inRoom);
            const clash = conflictLabel(conflicts.get(m.id));
            const ended = m.status === "ended";
            return (
              <li key={m.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSelect(m)}
                  className={`flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 text-left hover:bg-[var(--surface-0)] ${ended ? "opacity-60" : ""}`}
                  title={clash ?? m.title}
                >
                  <span className="w-14 shrink-0 text-[11px] tabular-nums text-[var(--fg-muted)]">
                    {m.scheduled_at ? shortTime(m.scheduled_at) : ""}
                  </span>
                  {inRoom > 0 ? <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--status-success)]" /> : null}
                  <span className="truncate text-xs text-[var(--fg-primary)]">{m.title}</span>
                  {clash ? <ConflictMark label={clash} /> : null}
                </button>
                {joinable ? <JoinButton roomCode={m.room_code} live={inRoom > 0} /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** "Join" on an event, from shortly before it starts until it ends. */
function JoinButton({ roomCode, live, compact = false }: { roomCode: string; live: boolean; compact?: boolean }) {
  return (
    <Link
      href={`/meetings/${roomCode}`}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={`inline-flex shrink-0 items-center justify-center rounded-md font-semibold text-white transition-opacity hover:opacity-90 ${
        live ? "bg-[var(--status-success)]" : "bg-[var(--gold-400)]"
      } ${compact ? "h-5 px-1.5 text-[10px]" : "min-h-8 px-2.5 text-[11px]"}`}
    >
      Join
    </Link>
  );
}

/** The mark on a double-booked meeting, with the clash in words for anyone who asks. */
function ConflictMark({ label }: { label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-status-danger/15 text-[10px] font-bold text-[var(--status-danger)]"
    >
      !
    </span>
  );
}

// ── Meeting detail ──────────────────────────────────────────────────────────
// Split into a heading and a body so the same meeting reads identically in the
// popover (week / day / schedule views) and inside the month day panel, where
// the chrome around it is a disclosure rather than a dialog.

/** Live means someone is in the room, or the clock says it is happening now. */
function meetingIsLive(meeting: CalendarMeeting, presence: RoomPresence | undefined, now: number): boolean {
  const ts = meetingTimeState(meeting.scheduled_at, meeting.duration_minutes, now);
  return (presence?.count ?? 0) > 0 || ts?.phase === "in_progress";
}

function MeetingDetailHeading({
  meeting,
  status,
  presence,
  now,
}: {
  meeting: CalendarMeeting;
  status: MeetingDisplayStatus;
  presence?: RoomPresence;
  now: number;
}) {
  const meta = typeMeta(meeting.meeting_type);
  const ts = meetingTimeState(meeting.scheduled_at, meeting.duration_minutes, now);
  const live = meetingIsLive(meeting, presence, now);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.chip}`}>{meta.label}</span>
        <span className="rounded-full border border-[var(--line)] px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-[var(--fg-muted)]">{status}</span>
        {live ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-status-success/40 bg-status-success/10 px-2 py-0.5 text-[11px] font-medium text-[var(--status-success)]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--status-success)]" /> Live
          </span>
        ) : null}
      </div>
      <h3 className="mt-2 text-base font-semibold text-[var(--fg-primary)]">{meeting.title}</h3>
      <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
        {calendarWhenLabel(meeting.scheduled_at) ?? "Time TBD"}
        {meeting.duration_minutes ? ` · ${meeting.duration_minutes} min` : ""}
        {ts && ts.phase !== "ended" ? ` · ${ts.phase === "in_progress" ? "In progress" : ts.label}` : ""}
      </p>
      {meeting.series_id && seriesPositionLabel(meeting.series_rule, meeting.series_index) ? (
        <p className="mt-0.5 text-xs text-[var(--fg-muted)]">↻ {seriesPositionLabel(meeting.series_rule, meeting.series_index)}</p>
      ) : null}
    </>
  );
}

function MeetingDetailBody({
  meeting,
  presence,
  now,
  onEdit,
  onAfterEarn,
}: {
  meeting: CalendarMeeting;
  presence?: RoomPresence;
  now: number;
  onEdit: () => void;
  /** Called once Earn has been handed the meeting — the surface showing this
   *  detail steps out of the way so the conversation is what's on screen. */
  onAfterEarn: () => void;
}) {
  const live = meetingIsLive(meeting, presence, now);
  const copilot = meeting.assigned_copilot_agent ? AGENTS.find((a) => a.key === meeting.assigned_copilot_agent)?.name ?? meeting.assigned_copilot_agent : null;
  const attendees = meeting.attendees ?? [];

  // Open Earn with a clean one-liner and run it, carrying only the meeting id +
  // mode as chatContext. The rich institutional context (deal financials, lead
  // contacts, saved notes) is gathered and injected SERVER-SIDE from that id — it
  // never travels through the browser. This is the same no-leak path the meetings
  // list uses; the earlier `earn:set-composer-prompt` only pre-filled the composer
  // and dropped the context, so prep/follow-up ran without any of it.
  function runWithEarn(prompt: string, chatContext: { id: string; mode: "prep" | "followup" }) {
    window.dispatchEvent(
      new CustomEvent("earn:open-with-context", { detail: { prompt, autoSend: true, chatContext } }),
    );
    onAfterEarn();
  }

  return (
    <>
      <div className="flex flex-col gap-2 p-4 text-sm">
        {presence && presence.count > 0 ? (
          <p className="text-xs text-[var(--status-success)]">{presence.count} in the room · {presence.names.join(", ")}</p>
        ) : null}
        {meeting.objective ? <DetailRow label="Objective" value={meeting.objective} /> : null}
        {meeting.agenda ? <DetailRow label="Agenda" value={meeting.agenda} /> : null}
        {copilot ? <DetailRow label="Copilot" value={copilot} /> : null}
        {attendees.length ? <DetailRow label="Attendees" value={attendees.map((a) => a.email ?? a.name).join(", ")} /> : null}
        <DetailRow label="Room" value={meeting.room_code} />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] p-3">
        <Link href={`/meetings/${meeting.room_code}`} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${live ? "bg-[var(--status-success)] text-white hover:opacity-90" : "bg-gold-400 text-white hover:bg-gold-500"}`}>
          {live ? "Join live →" : "Join →"}
        </Link>
        <button onClick={onEdit} className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]">Edit</button>
        {meeting.status === "ended" ? (
          <>
            <Link href={`/meetings/${meeting.room_code}/report`} className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]">View report</Link>
            {/* Follow-up belongs after the meeting — the ended state is exactly when it's owed. */}
            <button onClick={() => runWithEarn(`Draft the follow-up for "${meeting.title}".`, { id: meeting.id, mode: "followup" })} className="ml-auto rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]">
              Follow up with Earn
            </button>
          </>
        ) : (
          <button onClick={() => runWithEarn(`Prepare me for "${meeting.title}".`, { id: meeting.id, mode: "prep" })} className="ml-auto rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]">
            Prepare with Earn
          </button>
        )}
      </div>
    </>
  );
}

/** The modal form, used by the views that have no room to expand a day inline. */
function EventDetail({
  meeting,
  presence,
  status,
  now,
  conflict = null,
  onClose,
  onEdit,
}: {
  meeting: CalendarMeeting;
  presence?: RoomPresence;
  status: MeetingDisplayStatus;
  now: number;
  /** What it clashes with, in words, when it does. */
  conflict?: string | null;
  onClose: () => void;
  onEdit: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const meta = typeMeta(meeting.meeting_type);

  return (
    // A sheet from the bottom on a phone, where a centred card sits out of the
    // thumb's reach; a card in the middle everywhere else.
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-label={meeting.title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border border-[var(--line)] bg-[var(--surface-1)] pb-[env(safe-area-inset-bottom)] shadow-2xl sm:max-w-md sm:rounded-2xl sm:pb-0"
      >
        <div className="flex items-start gap-3 border-b border-[var(--line)] p-4" style={{ borderLeft: `3px solid ${meta.accent}` }}>
          <div className="min-w-0 flex-1">
            <MeetingDetailHeading meeting={meeting} status={status} presence={presence} now={now} />
          </div>
          <button onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--fg-muted)] hover:bg-[var(--surface-0)] hover:text-[var(--fg-primary)]">
            <CloseIcon />
          </button>
        </div>
        {conflict ? (
          <p className="flex items-start gap-2 border-b border-[var(--line)] bg-status-danger/10 px-4 py-2 text-xs text-[var(--status-danger)]">
            <span aria-hidden="true">!</span>
            <span>{conflict}</span>
          </p>
        ) : null}
        <MeetingDetailBody meeting={meeting} presence={presence} now={now} onEdit={onEdit} onAfterEarn={onClose} />
      </div>
    </div>
  );
}

/**
 * A pending scheduling-link request, opened from the calendar. Not a meeting
 * yet — no room, nothing to edit — so it offers what the booking card offers:
 * approve it, or decline it. Moving it is a drag on the grid.
 */
function RequestDetail({
  request,
  onClose,
  onDecided,
  onStale,
}: {
  request: CalendarMeeting;
  onClose: () => void;
  onDecided: () => void;
  /** The request changed elsewhere (declined in another tab, cancelled by the invitee). */
  onStale: () => void;
}) {
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const invitee = request.attendees?.[0];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function decide(action: "approve" | "decline") {
    const bookingId = bookingIdOf(request);
    if (!bookingId) return;
    if (action === "decline" && !window.confirm(`Decline the request from ${invitee?.name ?? "this invitee"}? They'll be emailed.`)) return;
    setBusy(action);
    setError(null);
    const send = (allowConflict: boolean) =>
      fetch(`/api/meetings/scheduling/bookings/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(allowConflict ? { allowConflict: true } : {}) }),
      });
    try {
      let res = await send(false);
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; overridable?: boolean };
        if (body.overridable !== true) {
          // Not a clash to overrule: the request is no longer what this dialog
          // shows. Say why, and redraw the calendar from what is true now.
          setError(body.error ?? "That didn't work.");
          onStale();
          return;
        }
        if (!window.confirm(`${body.error ?? "That time overlaps something."}\n\nApprove anyway?`)) return;
        res = await send(true);
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "That didn't work.");
        return;
      }
      onDecided();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-label="Booking request"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] shadow-2xl"
      >
        <div className="flex items-start gap-3 border-b border-[var(--line)] p-4" style={{ borderLeft: "3px dashed var(--status-warning)" }}>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--status-warning)]">Waiting on you</p>
            <h3 className="mt-0.5 text-base font-semibold text-[var(--fg-primary)]">{request.title}</h3>
            <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
              {calendarWhenLabel(request.scheduled_at) ?? ""} · {request.duration_minutes} min
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-[var(--fg-muted)] hover:bg-[var(--surface-0)] hover:text-[var(--fg-primary)]">
            <CloseIcon />
          </button>
        </div>
        <div className="flex flex-col gap-3 p-4">
          {invitee?.email ? <DetailRow label="From" value={`${invitee.name} <${invitee.email}>`} /> : null}
          {request.description ? <DetailRow label="Note" value={request.description} /> : null}
          <p className="text-xs text-[var(--fg-muted)]">Drag it on the calendar to offer a different time.</p>
          {error ? <p role="alert" className="text-xs text-[var(--status-danger)]">{error}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void decide("approve")}
              className="rounded-lg bg-[var(--gold-400)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--gold-500)] disabled:opacity-50"
            >
              {busy === "approve" ? "Approving…" : "Approve"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void decide("decline")}
              className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--fg-secondary)] hover:text-[var(--status-danger)] disabled:opacity-50"
            >
              {busy === "decline" ? "Declining…" : "Decline"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 font-mono text-[11px] uppercase tracking-wider text-[var(--fg-muted)]">{label}</span>
      <span className="min-w-0 break-words text-xs text-[var(--fg-secondary)]">{value}</span>
    </div>
  );
}

// ── Small UI atoms ──────────────────────────────────────────────────────────
function IconBtn({ children, label, onClick, small }: { children: React.ReactNode; label: string; onClick: () => void; small?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`flex items-center justify-center rounded-lg text-[var(--fg-secondary)] hover:bg-[var(--surface-1)] hover:text-[var(--fg-primary)] ${small ? "h-6 w-6" : "h-9 w-9 border border-[var(--line)] sm:h-8 sm:w-8"}`}
    >
      {children}
    </button>
  );
}

function ChevronLeft() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>);
}
function ChevronRight() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>);
}
function FilterIcon() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>);
}
function CloseIcon() {
  return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>);
}

/** The hatched look shared with time blocked by hand. */
const BUSY_STYLE: React.CSSProperties = {
  backgroundColor: "color-mix(in srgb, var(--fg-muted) 14%, transparent)",
  backgroundImage:
    "repeating-linear-gradient(45deg, transparent, transparent 5px, color-mix(in srgb, var(--fg-muted) 12%, transparent) 5px, color-mix(in srgb, var(--fg-muted) 12%, transparent) 10px)",
};

/**
 * What a busy block says. A calendar the member is showing names the event;
 * a hidden one says only "Busy", since hiding it was a choice not to see it.
 */
function busyLabel(event: ExternalEvent, layersById: Map<string, CalendarLayer>): string {
  const layer = layersById.get(event.calendarId);
  if (!layer?.isVisible) return "Busy";
  return `${event.title || "Busy"} — ${layer.name}`;
}
