"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CalendarLayers from "./CalendarLayers";
import {
  type CalendarLayer,
  type ExternalEvent,
  colorForLayer,
  allDayEventsForDay,
  eventSpansForDay,
  layerIndex,
  visibleEvents,
} from "@/lib/calendar/layers";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AGENTS } from "@/lib/agents";
import {
  deriveMeetingStatus,
  meetingTimeState,
  type MeetingDisplayStatus,
} from "@/lib/meetings/schedule";
import {
  addDays,
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
import { actionForKey, SHORTCUT_HELP } from "@/lib/meetings/calendar-shortcuts";
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
import { UpcomingMeetingsList, type UpcomingMeeting } from "./UpcomingMeetingsList";
import { PastMeetingsList, type PastMeeting } from "./PastMeetingsList";
import { useNow, useLivePresence, nextChannelName, type RoomPresence } from "./hooks";

const CAL_SELECT =
  "id, room_code, title, status, host_id, created_at, started_at, ended_at, scheduled_at, duration_minutes, timezone, meeting_type, attendees, preparation_status, followup_status, assigned_copilot_agent, is_draft, locked_at, updated_at, description, location, meeting_url, objective, agenda, preparation_requirements, related_record_type, related_record_id, calendar_visibility, reminder_minutes, priority, tags, external_calendar_provider, external_calendar_sync_enabled, external_calendar_sync_status";

const HOUR_PX = 46; // row height in the week/day time grid
const DAY_SCROLL_HOUR = 7; // initial scroll position for time views

// The lifecycle statuses offered in the filter menu, in a sensible order.
const STATUS_ORDER: MeetingDisplayStatus[] = [
  "Scheduled",
  "Prep Needed",
  "Ready",
  "Updated",
  "Live",
  "Completed",
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
    internalAttendees: internal.map((a) => a.email ?? a.name).join("\n"),
    externalGuests: external.map((a) => (a.email ? `${a.name} <${a.email}>` : a.name)).join("\n"),
    assignedCopilotAgent: m.assigned_copilot_agent,
    relatedRecordType: m.related_record_type,
    relatedRecordId: m.related_record_id,
    calendarVisibility: m.calendar_visibility,
    reminderMinutes: m.reminder_minutes,
    priority: m.priority,
    tags: m.tags,
    externalCalendarSyncEnabled: m.external_calendar_sync_enabled ?? false,
    externalCalendarProvider: m.external_calendar_provider,
  };
}

export function MeetingsCalendar({
  initialMeetings,
  initialUpcoming,
  initialPast,
  userId,
  orgId,
}: {
  initialMeetings: CalendarMeeting[];
  initialUpcoming: UpcomingMeeting[];
  initialPast: PastMeeting[];
  userId: string;
  orgId: string;
}) {
  const router = useRouter();
  const [meetings, setMeetings] = useState<CalendarMeeting[]>(initialMeetings);
  const [view, setView] = useState<CalendarView>("month");
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));
  const [filter, setFilter] = useState<CalendarFilter>(emptyFilter);
  const [filterOpen, setFilterOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [detail, setDetail] = useState<CalendarMeeting | null>(null);
  const [editing, setEditing] = useState<CalendarMeeting | null>(null);
  const [scheduleAt, setScheduleAt] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  // Connected calendars and their events. Fetched per visible window rather
  // than all at once: a member with years of history should not pay for them
  // to look at one week.
  const [layers, setLayers] = useState<CalendarLayer[]>([]);
  const [externalEvents, setExternalEvents] = useState<ExternalEvent[]>([]);
  const [connectedAs, setConnectedAs] = useState<string | null>(null);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  // What a click on empty calendar space offers: schedule, or block the time.
  const [slotMenu, setSlotMenu] = useState<{ iso: string; x: number; y: number } | null>(null);
  const [blockDraft, setBlockDraft] = useState<{ startsAt: string; endsAt: string } | null>(null);
  const [blockError, setBlockError] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [channelName] = useState(() => nextChannelName("calendar-meetings"));

  const now = useNow(1000);
  // Coarsen the clock for the expensive re-derivations below. `now` ticks every
  // second, but the grid filter and the "today" highlight only change at minute /
  // day boundaries — keying their memos off the raw millisecond value re-filtered
  // every meeting and rebuilt all 42 day cells once per second.
  const dayStartMs = startOfDay(new Date(now)).getTime();
  const nowMinuteMs = Math.floor(now / 60_000) * 60_000;
  const today = useMemo(() => new Date(dayStartMs), [dayStartMs]);

  // ── Realtime refresh of the scheduled meetings that populate the grid ──────
  async function refresh() {
    const supabase = createClient();
    const { data } = await supabase
      .from("live_meetings")
      .select(CAL_SELECT)
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .not("scheduled_at", "is", null)
      .order("scheduled_at", { ascending: true })
      .limit(500);
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

  useEffect(() => {
    const supabase = createClient();
    void refresh();
    void refreshBlocks();
    function scheduleRefresh() {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void refresh(), 350);
    }
    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "live_meetings" }, () => scheduleRefresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "scheduling_blocks" }, () => void refreshBlocks())
      .subscribe();
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const statusOf = useMemo(() => (m: CalendarMeeting) => deriveMeetingStatus(m, nowMinuteMs), [nowMinuteMs]);

  const visible = useMemo(
    () => applyCalendarFilter(meetings, filter, userId, statusOf),
    [meetings, filter, userId, statusOf],
  );

  // Presence only needs the meetings currently rendered. Keep it bounded.
  const visibleIds = useMemo(() => visible.map((m) => m.id), [visible]);
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

  function openScheduleAt(iso: string) {
    setScheduleAt(iso);
    setScheduleOpen(true);
  }

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
  useEffect(() => { refreshRef.current = refresh; });

  // ── Moving a meeting by dragging it ───────────────────────────────────────
  //
  // Optimistic: the block stays where it was dropped while the request is in
  // flight, because a meeting that snaps back for half a second and then
  // returns reads as a bug. A failure puts it back and says why.
  const moveMeeting = useCallback(async (m: CalendarMeeting, startIso: string, durationMinutes: number) => {
    const before = { scheduled_at: m.scheduled_at, duration_minutes: m.duration_minutes };
    const applyLocal = (next: { scheduled_at: string | null; duration_minutes: number | null }) =>
      setMeetings((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...next } : x)));

    applyLocal({ scheduled_at: startIso, duration_minutes: durationMinutes });

    async function send(allowConflict: boolean) {
      return fetch(`/api/meetings/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt: startIso, durationMinutes, ...(allowConflict ? { allowConflict: true } : {}) }),
      });
    }

    try {
      let res = await send(false);

      if (res.status === 409) {
        // The API refuses a clashing reschedule unless told otherwise. Ask,
        // rather than either silently double-booking or silently refusing.
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const proceed = window.confirm(`${body.error ?? "That time conflicts with something else."}\n\nMove it anyway?`);
        if (!proceed) {
          applyLocal(before);
          return;
        }
        res = await send(true);
      }

      if (!res.ok) {
        applyLocal(before);
        setMoveError("Could not move that meeting. It has been put back.");
        return;
      }
      setMoveError(null);
      // Re-read rather than trusting the local guess: the server clamps the
      // duration and may have touched sync status on the way through.
      await refreshRef.current();
    } catch {
      applyLocal(before);
      setMoveError("Could not reach the server. The meeting has been put back.");
    }
  }, []);

  // The window the current view covers. Month and week views spill into
  // neighbouring months, so this widens rather than guessing from `anchor`.
  const windowRange = useMemo(() => {
    const from = startOfDay(addDays(anchor, view === "month" ? -45 : -10));
    const to = startOfDay(addDays(anchor, view === "month" ? 45 : 10));
    return { from: from.toISOString(), to: to.toISOString() };
  }, [anchor, view]);

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
        googleConfigured?: boolean;
      };
      setLayers(body.layers ?? []);
      setExternalEvents(body.events ?? []);
      setConnectedAs(body.connectedAs ?? null);
      setGoogleConfigured(Boolean(body.googleConfigured));
    } catch {
      // A calendar rail that fails to load must not take the grid down with
      // it: the member's own meetings are the part that matters.
    }
  }, [windowRange.from, windowRange.to]);

  useEffect(() => {
    void loadCalendars();
  }, [loadCalendars]);

  // Only events from layers the member is showing, and indexed so each draws
  // in its own calendar's colour.
  const shownExternal = useMemo(() => visibleEvents(externalEvents, layers), [externalEvents, layers]);
  const layersById = useMemo(() => layerIndex(layers), [layers]);

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

  const shared = {
    now,
    today,
    presence,
    statusOf,
    blocks,
    onSelectEvent: (m: CalendarMeeting) => setDetail(m),
    onSelectBlock: (b: CalendarBlock) => clearBlock(b.id),
    onSelectSlot: (iso: string, x: number, y: number) => setSlotMenu({ iso, x, y }),
    externalEvents: shownExternal,
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
        onView={setView}
        onPrev={() => go(-1)}
        onNext={() => go(1)}
        onToday={() => setAnchor(startOfDay(new Date()))}
        filter={filter}
        onFilter={setFilter}
        filterOpen={filterOpen}
        setFilterOpen={setFilterOpen}
        onShortcuts={() => setShortcutsOpen(true)}
      />

      {moveError ? (
        <div
          role="status"
          className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-[var(--status-danger)]/40 bg-[var(--status-danger)]/10 px-3 py-2 text-xs text-[var(--fg-secondary)]"
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

      <div className="grid gap-6 pb-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Calendar surface */}
        <div className="min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] p-2 sm:p-3">
          {view === "month" ? <MonthView anchor={anchor} meetings={visible} {...shared} /> : null}
          {view === "week" ? <TimeGridView days={weekDays(anchor)} meetings={visible} {...shared} /> : null}
          {view === "day" ? <TimeGridView days={[anchor]} meetings={visible} {...shared} /> : null}
          {view === "agenda" ? <AgendaView anchor={anchor} meetings={visible} {...shared} /> : null}
        </div>

        {/* Side rail */}
        <aside className="flex flex-col gap-6">
          <MiniMonth anchor={anchor} onPick={(d) => { setAnchor(startOfDay(d)); }} today={today} meetings={meetings} />
          <CalendarLayers
            layers={layers}
            connectedAs={connectedAs}
            googleConfigured={googleConfigured}
            onToggle={toggleLayer}
            onToggleAvailability={toggleLayerAvailability}
          />
          <Legend meetings={meetings} />
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] p-4">
            <UpcomingMeetingsList compact initialMeetings={initialUpcoming} />
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] p-4">
            <PastMeetingsList compact initialMeetings={initialPast} userId={userId} />
          </div>
        </aside>
      </div>

      {detail ? (
        <EventDetail
          meeting={detail}
          presence={presence[detail.id]}
          status={statusOf(detail)}
          now={now}
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
          initial={scheduleAt ? { scheduledAt: scheduleAt } : undefined}
          onClose={() => setScheduleOpen(false)}
          onSaved={() => {
            setScheduleOpen(false);
            void refresh();
            router.refresh();
          }}
        />
      ) : null}

      {slotMenu ? (
        <SlotMenu
          x={slotMenu.x}
          y={slotMenu.y}
          onClose={() => setSlotMenu(null)}
          onSchedule={() => {
            openScheduleAt(slotMenu.iso);
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
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
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

// ── Slot menu ───────────────────────────────────────────────────────────────
// Clicking empty calendar space is ambiguous — it could mean "meet then" or
// "keep that free". The grid already resolves the click to an exact time, so
// the menu just asks which of the two was meant.
function SlotMenu({
  x,
  y,
  onClose,
  onSchedule,
  onBlock,
}: {
  x: number;
  y: number;
  onClose: () => void;
  onSchedule: () => void;
  onBlock: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Keep the menu on screen when the click lands near the right or bottom edge.
  const left = Math.min(x, (typeof window !== "undefined" ? window.innerWidth : 1024) - 200);
  const top = Math.min(y, (typeof window !== "undefined" ? window.innerHeight : 768) - 110);

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        role="menu"
        onClick={(e) => e.stopPropagation()}
        className="absolute w-48 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-1)] shadow-xl"
        style={{ left, top }}
      >
        <button
          type="button"
          onClick={onSchedule}
          className="block w-full px-3 py-2.5 text-left text-sm text-[var(--fg-primary)] hover:bg-[var(--surface-0)]"
        >
          New meeting
        </button>
        <button
          type="button"
          onClick={onBlock}
          className="block w-full border-t border-[var(--line)] px-3 py-2.5 text-left text-sm text-[var(--fg-primary)] hover:bg-[var(--surface-0)]"
        >
          Block time
        </button>
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
    <div className="sticky top-0 z-20 -mx-4 mb-6 flex flex-col gap-3 border-b border-[var(--line)] bg-[var(--surface-0)]/80 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight text-[var(--fg-primary)]">Calendar</h2>
        </div>

        {/* Date navigation */}
        <div className="flex items-center gap-1">
          <button onClick={onToday} className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--fg-secondary)] hover:bg-[var(--surface-1)] hover:text-[var(--fg-primary)]">
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
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
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
                  ? "border-[var(--gold-400)]/50 bg-[var(--gold-400)]/10 text-[var(--gold-400)]"
                  : "border-[var(--line)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
              }`}
            >
              <FilterIcon />
              Filters{activeFilters > 0 ? ` · ${activeFilters}` : ""}
            </button>
            {filterOpen ? <FilterMenu filter={filter} onFilter={onFilter} /> : null}
          </div>
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
      <p className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--fg-muted)]">Type</p>
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
              className={`rounded-full border px-2 py-0.5 text-[11px] ${active ? "border-[var(--gold-400)]/50 bg-[var(--gold-400)]/10 text-[var(--gold-400)]" : "border-[var(--line)] text-[var(--fg-muted)]"}`}
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
  today: Date;
  presence: Record<string, RoomPresence>;
  statusOf: (m: CalendarMeeting) => MeetingDisplayStatus;
  blocks: CalendarBlock[];
  onSelectEvent: (m: CalendarMeeting) => void;
  onSelectBlock: (b: CalendarBlock) => void;
  onSelectSlot: (iso: string, x: number, y: number) => void;
  externalEvents: ExternalEvent[];
  layersById: Map<string, CalendarLayer>;
  onExpandDay: (d: Date) => void;
  /** Commit a drag. Absent in views that cannot express one (month, agenda). */
  onMoveMeeting?: (m: CalendarMeeting, startIso: string, durationMinutes: number) => void;
}

function MonthView({ anchor, meetings, blocks, externalEvents, layersById, today, presence, onSelectEvent, onSelectBlock, onSelectSlot, onExpandDay }: SharedViewProps & { anchor: Date }) {
  const weeks = monthMatrix(anchor);
  const labels = weekdayLabels();
  return (
    <div>
      <div className="grid grid-cols-7 border-b border-[var(--line)]">
        {labels.map((l) => (
          <div key={l} className="px-2 py-1.5 text-center font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-muted)]">{l}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {weeks.flat().map((day, i) => {
          const inMonth = isSameMonth(day, anchor);
          const isToday = isSameDay(day, today);
          const evs = eventsForDay(meetings, day);
          const dayBlocks = blocksForDay(blocks, day);
          // Connected-calendar events get a row of dots rather than chips. A
          // month cell has room for about three things, and this app's own
          // meetings are what a member came here to act on — but a day that
          // looks empty while Google says otherwise is the exact confusion
          // this whole feature exists to remove.
          const externalToday = [
            ...eventSpansForDay(externalEvents, day).map((s) => s.event),
            ...allDayEventsForDay(externalEvents, day),
          ];
          // Blocks take the first row so a busy day reads as busy at a glance,
          // then meetings fill what's left of the three-chip budget.
          const shown = evs.slice(0, Math.max(1, 3 - dayBlocks.length));
          const extra = evs.length - shown.length;
          return (
            <button
              key={i}
              onClick={(e) =>
                onSelectSlot(
                  localIso(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0),
                  e.clientX,
                  e.clientY,
                )
              }
              className={`flex min-h-[104px] flex-col gap-1 border-b border-r border-[var(--line)] p-1.5 text-left transition-colors hover:bg-[var(--surface-0)] ${
                inMonth ? "" : "bg-[var(--surface-0)]/40"
              }`}
            >
              <span
                className={`inline-flex h-6 w-6 items-center justify-center self-start rounded-full text-xs ${
                  isToday ? "bg-[var(--gold-400)] font-semibold text-white" : inMonth ? "text-[var(--fg-secondary)]" : "text-[var(--fg-muted)]"
                }`}
              >
                {day.getDate()}
              </span>
              {externalToday.length ? (
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

              <div className="flex flex-col gap-0.5">
                {dayBlocks.map((b) => (
                  <BlockChip key={b.id} b={b} onClick={(e) => { e.stopPropagation(); onSelectBlock(b); }} />
                ))}
                {shown.map((m) => (
                  <MonthChip key={m.id} m={m} live={(presence[m.id]?.count ?? 0) > 0} onClick={(e) => { e.stopPropagation(); onSelectEvent(m); }} />
                ))}
                {extra > 0 ? (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); onExpandDay(day); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onExpandDay(day); } }}
                    className="cursor-pointer px-1 text-[11px] font-medium text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
                  >
                    +{extra} more
                  </span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
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
      {live ? <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400" /> : <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />}
      <span className="shrink-0 tabular-nums opacity-80">{m.scheduled_at ? shortTime(m.scheduled_at) : ""}</span>
      <span className="truncate">{m.title}</span>
    </span>
  );
}

// ── Week / Day time grid ────────────────────────────────────────────────────
function TimeGridView({ days, meetings, blocks, externalEvents, layersById, now, today, presence, statusOf, onSelectEvent, onSelectBlock, onSelectSlot, onMoveMeeting }: SharedViewProps & { days: Date[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = DAY_SCROLL_HOUR * HOUR_PX;
  }, [days.length]);

  const hours = Array.from({ length: 24 }, (_, h) => h);
  const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes();

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
                {d.toLocaleDateString("en-US", { weekday: "short" })}
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
        <div className="w-14 shrink-0">
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
          const evs = eventsForDay(meetings, d);
          const layout = layoutDayEvents(evs);
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
                onSelectSlot(
                  localIso(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(minutes / 60), minutes % 60),
                  e.clientX,
                  e.clientY,
                );
              }}
            >
              {/* Hour lines */}
              {hours.map((h) => (
                <div key={h} className="absolute left-0 right-0 border-b border-[var(--line)]/60" style={{ top: h * HOUR_PX, height: HOUR_PX }} />
              ))}

              {/* Events from connected calendars, drawn beneath everything
                  this app owns. They are context for a decision, not the
                  subject of one — and they are read-only, so nothing here is
                  clickable in a way that implies otherwise. */}
              {eventSpansForDay(externalEvents, d).map(({ event, startMinute, endMinute }) => {
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

              {/* Now indicator */}
              {isToday ? (
                <div className="pointer-events-none absolute left-0 right-0 z-10 flex items-center" style={{ top: (nowMin / 60) * HOUR_PX }}>
                  <span className="h-2 w-2 -translate-x-1 rounded-full bg-[var(--gold-400)]" />
                  <span className="h-px flex-1 bg-[var(--gold-400)]" />
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
                const live = (presence[m.id]?.count ?? 0) > 0;
                const ts = meetingTimeState(m.scheduled_at, m.duration_minutes, now);
                const draggable = Boolean(onMoveMeeting) && canDragMeeting(m);
                return (
                  <button
                    key={m.id}
                    onPointerDown={(e) => { if (draggable) beginDrag(e, m, "move", dayIndex); }}
                    onClick={(e) => {
                      e.stopPropagation();
                      // A drag that just ended must not also open the event.
                      if (swallowClick.current) { swallowClick.current = false; return; }
                      onSelectEvent(m);
                    }}
                    className={`absolute overflow-hidden rounded-md border-l-2 px-1.5 py-1 text-left shadow-sm ${
                      draggable ? "cursor-grab active:cursor-grabbing" : ""
                    } ${dragging ? "z-20 opacity-90 shadow-lg ring-2 ring-[var(--gold-400)]" : ""}`}
                    style={{
                      top,
                      height,
                      left: `calc(${laneOffset}% + 2px)`,
                      width: `calc(${widthPct}% - 4px)`,
                      borderLeftColor: meta.accent,
                      backgroundColor: `color-mix(in srgb, ${meta.accent} 16%, var(--surface-1))`,
                      touchAction: draggable ? "none" : undefined,
                    }}
                    title={m.title}
                  >
                    <div className="flex items-center gap-1">
                      {live ? <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400" /> : null}
                      <span className="truncate text-[11px] font-medium text-[var(--fg-primary)]">{m.title}</span>
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
                    {draggable ? (
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
function AgendaView({ anchor, meetings, now, today, presence, statusOf, onSelectEvent }: SharedViewProps & { anchor: Date }) {
  // Show the 21 days starting at the later of the anchor or today, grouped by day.
  const start = startOfDay(anchor).getTime() < today.getTime() ? today : startOfDay(anchor);
  const days = Array.from({ length: 21 }, (_, i) => addDays(start, i));
  const withEvents = days
    .map((d) => ({ d, evs: eventsForDay(meetings, d) }))
    .filter((g) => g.evs.length > 0);

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
            <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--fg-muted)]">{d.toLocaleDateString("en-US", { weekday: "short" })}</div>
            <div className={`mx-auto mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full text-base font-semibold ${isSameDay(d, today) ? "bg-[var(--gold-400)] text-white" : "text-[var(--fg-primary)]"}`}>
              {d.getDate()}
            </div>
            <div className="text-[11px] text-[var(--fg-muted)]">{d.toLocaleDateString("en-US", { month: "short" })}</div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {evs.map((m) => {
              const meta = typeMeta(m.meeting_type);
              const live = (presence[m.id]?.count ?? 0) > 0;
              const ts = meetingTimeState(m.scheduled_at, m.duration_minutes, now);
              return (
                <button
                  key={m.id}
                  onClick={() => onSelectEvent(m)}
                  className="flex items-center gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2 text-left hover:border-[var(--fg-muted)]/40"
                >
                  <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: meta.accent }} />
                  <div className="w-20 shrink-0 text-xs tabular-nums text-[var(--fg-secondary)]">{m.scheduled_at ? shortTime(m.scheduled_at) : ""}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {live ? <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400" /> : null}
                      <span className="truncate text-sm font-medium text-[var(--fg-primary)]">{m.title}</span>
                    </div>
                    <div className="truncate text-xs text-[var(--fg-muted)]">
                      {meta.label}
                      {m.duration_minutes ? ` · ${m.duration_minutes} min` : ""}
                      {ts && (ts.phase === "imminent" || ts.phase === "in_progress") ? ` · ${ts.phase === "in_progress" ? "In progress" : ts.label}` : ""}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-[var(--fg-muted)]">{statusOf(m)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Mini month navigator ────────────────────────────────────────────────────
function MiniMonth({ anchor, onPick, today, meetings }: { anchor: Date; onPick: (d: Date) => void; today: Date; meetings: CalendarMeeting[] }) {
  const [cursor, setCursor] = useState<Date>(startOfDay(anchor));
  useEffect(() => setCursor(startOfDay(anchor)), [anchor]);
  const weeks = monthMatrix(cursor);
  const daysWithEvents = useMemo(() => {
    const s = new Set<string>();
    for (const m of meetings) if (m.scheduled_at) s.add(dayKey(new Date(m.scheduled_at)));
    return s;
  }, [meetings]);

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

function Legend({ meetings }: { meetings: CalendarMeeting[] }) {
  const present = useMemo(() => {
    const seen = new Set<string>();
    for (const m of meetings) seen.add(m.meeting_type ?? "other");
    return CALENDAR_TYPE_ORDER.filter((t) => seen.has(t));
  }, [meetings]);
  if (present.length === 0) return null;
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] p-3">
      <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-muted)]">Meeting types</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        {present.map((t) => {
          const meta = typeMeta(t);
          return (
            <span key={t} className="inline-flex items-center gap-1.5 text-[11px] text-[var(--fg-secondary)]">
              <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
              {meta.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── Event detail popover ────────────────────────────────────────────────────
function EventDetail({
  meeting,
  presence,
  status,
  now,
  onClose,
  onEdit,
}: {
  meeting: CalendarMeeting;
  presence?: RoomPresence;
  status: MeetingDisplayStatus;
  now: number;
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
  const ts = meetingTimeState(meeting.scheduled_at, meeting.duration_minutes, now);
  const live = (presence?.count ?? 0) > 0 || ts?.phase === "in_progress";
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
    onClose();
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] shadow-2xl">
        <div className="flex items-start gap-3 border-b border-[var(--line)] p-4" style={{ borderLeft: `3px solid ${meta.accent}` }}>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.chip}`}>{meta.label}</span>
              <span className="rounded-full border border-[var(--line)] px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-[var(--fg-muted)]">{status}</span>
              {live ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Live
                </span>
              ) : null}
            </div>
            <h3 className="mt-2 text-base font-semibold text-[var(--fg-primary)]">{meeting.title}</h3>
            <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
              {meeting.scheduled_at ? new Date(meeting.scheduled_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Time TBD"}
              {meeting.duration_minutes ? ` · ${meeting.duration_minutes} min` : ""}
              {ts && ts.phase !== "ended" ? ` · ${ts.phase === "in_progress" ? "In progress" : ts.label}` : ""}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-[var(--fg-muted)] hover:bg-[var(--surface-0)] hover:text-[var(--fg-primary)]">
            <CloseIcon />
          </button>
        </div>

        <div className="flex flex-col gap-2 p-4 text-sm">
          {presence && presence.count > 0 ? (
            <p className="text-xs text-emerald-400">{presence.count} in the room · {presence.names.join(", ")}</p>
          ) : null}
          {meeting.objective ? <DetailRow label="Objective" value={meeting.objective} /> : null}
          {meeting.agenda ? <DetailRow label="Agenda" value={meeting.agenda} /> : null}
          {copilot ? <DetailRow label="Copilot" value={copilot} /> : null}
          {attendees.length ? <DetailRow label="Attendees" value={attendees.map((a) => a.email ?? a.name).join(", ")} /> : null}
          <DetailRow label="Room" value={meeting.room_code} />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] p-3">
          <Link href={`/meetings/${meeting.room_code}`} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${live ? "bg-emerald-500/15 text-emerald-400" : "bg-[var(--gold-400)] text-white hover:bg-[var(--gold-500)]"}`}>
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
      className={`flex items-center justify-center rounded-lg text-[var(--fg-secondary)] hover:bg-[var(--surface-1)] hover:text-[var(--fg-primary)] ${small ? "h-6 w-6" : "h-8 w-8 border border-[var(--line)]"}`}
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
