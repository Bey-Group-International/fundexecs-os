"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  type CalendarFilter,
  type CalendarMeeting,
  type CalendarView,
} from "@/lib/meetings/calendar";
import { MeetingEditScreen, type MeetingEditInitial } from "./MeetingEditScreen";
import { UpcomingMeetingsList, type UpcomingMeeting } from "./UpcomingMeetingsList";
import { PastMeetingsList, type PastMeeting } from "./PastMeetingsList";
import { useNow, useLivePresence, type RoomPresence } from "./hooks";

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
  const [detail, setDetail] = useState<CalendarMeeting | null>(null);
  const [editing, setEditing] = useState<CalendarMeeting | null>(null);
  const [scheduleAt, setScheduleAt] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const now = useNow(1000);
  const today = useMemo(() => startOfDay(new Date(now)), [now]);

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

  useEffect(() => {
    const supabase = createClient();
    void refresh();
    function scheduleRefresh() {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void refresh(), 350);
    }
    const channel = supabase
      .channel("calendar-meetings-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "live_meetings" }, () => scheduleRefresh())
      .subscribe();
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const statusOf = useMemo(() => (m: CalendarMeeting) => deriveMeetingStatus(m, now), [now]);

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

  const shared = {
    now,
    today,
    presence,
    statusOf,
    onSelectEvent: (m: CalendarMeeting) => setDetail(m),
    onSelectSlot: openScheduleAt,
    onExpandDay: (d: Date) => {
      setAnchor(startOfDay(d));
      setView("day");
    },
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
        onNewInstant={async () => {
          const res = await fetch("/api/meetings/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "Meeting" }),
          });
          if (res.ok) {
            const data = (await res.json()) as { roomCode: string };
            router.push(`/meetings/${data.roomCode}`);
          }
        }}
        onNewScheduled={() => {
          setScheduleAt(null);
          setScheduleOpen(true);
        }}
        onJoin={(code) => router.push(`/meetings/${code}`)}
      />

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
    </div>
  );
}

// ── Toolbar (condensed lobby + calendar controls) ──────────────────────────
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
  onNewInstant,
  onNewScheduled,
  onJoin,
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
  onNewInstant: () => void;
  onNewScheduled: () => void;
  onJoin: (code: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [code, setCode] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const activeFilters = filterCountActive(filter);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [setFilterOpen]);

  return (
    <div className="sticky top-0 z-20 -mx-4 mb-6 flex flex-col gap-3 border-b border-[var(--line)] bg-[var(--surface-0)]/80 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-[var(--fg-primary)]">Meetings</h1>
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
                  view === v ? "bg-[var(--gold-400)] text-black" : "text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
                }`}
              >
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>

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

          {/* New meeting */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--gold-400)] px-3 py-1.5 text-xs font-semibold text-black hover:bg-[var(--gold-500)]"
            >
              <PlusIcon /> New meeting <CaretDown />
            </button>
            {menuOpen ? (
              <div role="menu" className="absolute right-0 top-full z-30 mt-2 w-60 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-1)] shadow-2xl">
                <MenuItem title="Start an instant meeting" subtitle="Create a room and join now" onClick={() => { setMenuOpen(false); onNewInstant(); }} />
                <div className="h-px bg-[var(--line)]" />
                <MenuItem title="Schedule for later" subtitle="Set a time, agenda, and attendees" onClick={() => { setMenuOpen(false); onNewScheduled(); }} />
              </div>
            ) : null}
          </div>

          {/* Join by code */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const c = code.trim().toLowerCase().replace(/\s/g, "");
              if (c) onJoin(c);
            }}
            className="hidden items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-2 py-1 focus-within:ring-2 focus-within:ring-[var(--gold-400)] sm:flex"
          >
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Join code"
              aria-label="Meeting code"
              className="w-24 bg-transparent text-xs text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none"
            />
            <button type="submit" disabled={!code.trim()} className={`text-xs font-semibold ${code.trim() ? "text-[var(--gold-400)]" : "cursor-not-allowed text-[var(--fg-muted)]"}`}>
              Join
            </button>
          </form>
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
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-muted)]">Filters</span>
        {filterCountActive(filter) > 0 ? (
          <button onClick={() => onFilter(emptyFilter())} className="text-[11px] text-[var(--gold-400)] hover:underline">Clear</button>
        ) : null}
      </div>
      <label className="mb-3 flex items-center gap-2 text-xs text-[var(--fg-secondary)]">
        <input type="checkbox" checked={filter.mineOnly} onChange={(e) => onFilter({ ...filter, mineOnly: e.target.checked })} />
        Only meetings I host
      </label>
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--fg-muted)]">Type</p>
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
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--fg-muted)]">Status</p>
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
  onSelectEvent: (m: CalendarMeeting) => void;
  onSelectSlot: (iso: string) => void;
  onExpandDay: (d: Date) => void;
}

function MonthView({ anchor, meetings, today, presence, onSelectEvent, onSelectSlot, onExpandDay }: SharedViewProps & { anchor: Date }) {
  const weeks = monthMatrix(anchor);
  const labels = weekdayLabels();
  return (
    <div>
      <div className="grid grid-cols-7 border-b border-[var(--line)]">
        {labels.map((l) => (
          <div key={l} className="px-2 py-1.5 text-center font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-muted)]">{l}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {weeks.flat().map((day, i) => {
          const inMonth = isSameMonth(day, anchor);
          const isToday = isSameDay(day, today);
          const evs = eventsForDay(meetings, day);
          const shown = evs.slice(0, 3);
          const extra = evs.length - shown.length;
          return (
            <button
              key={i}
              onClick={() => onSelectSlot(localIso(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0))}
              className={`flex min-h-[104px] flex-col gap-1 border-b border-r border-[var(--line)] p-1.5 text-left transition-colors hover:bg-[var(--surface-0)] ${
                inMonth ? "" : "bg-[var(--surface-0)]/40"
              }`}
            >
              <span
                className={`inline-flex h-6 w-6 items-center justify-center self-start rounded-full text-xs ${
                  isToday ? "bg-[var(--gold-400)] font-semibold text-black" : inMonth ? "text-[var(--fg-secondary)]" : "text-[var(--fg-muted)]"
                }`}
              >
                {day.getDate()}
              </span>
              <div className="flex flex-col gap-0.5">
                {shown.map((m) => (
                  <MonthChip key={m.id} m={m} live={(presence[m.id]?.count ?? 0) > 0} onClick={(e) => { e.stopPropagation(); onSelectEvent(m); }} />
                ))}
                {extra > 0 ? (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); onExpandDay(day); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onExpandDay(day); } }}
                    className="cursor-pointer px-1 text-[10px] font-medium text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
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

function MonthChip({ m, live, onClick }: { m: CalendarMeeting; live: boolean; onClick: (e: React.MouseEvent) => void }) {
  const meta = typeMeta(m.meeting_type);
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter") onClick(e as unknown as React.MouseEvent); }}
      className={`flex items-center gap-1 truncate rounded border px-1 py-0.5 text-[10px] font-medium ${meta.chip}`}
      title={m.title}
    >
      {live ? <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400" /> : <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />}
      <span className="shrink-0 tabular-nums opacity-80">{m.scheduled_at ? shortTime(m.scheduled_at) : ""}</span>
      <span className="truncate">{m.title}</span>
    </span>
  );
}

// ── Week / Day time grid ────────────────────────────────────────────────────
function TimeGridView({ days, meetings, now, today, presence, statusOf, onSelectEvent, onSelectSlot }: SharedViewProps & { days: Date[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = DAY_SCROLL_HOUR * HOUR_PX;
  }, [days.length]);

  const hours = Array.from({ length: 24 }, (_, h) => h);
  const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes();

  return (
    <div ref={scrollRef} className="max-h-[70vh] overflow-y-auto">
      {/* Day headers */}
      <div className="sticky top-0 z-10 flex border-b border-[var(--line)] bg-[var(--surface-1)]">
        <div className="w-14 shrink-0" />
        {days.map((d) => {
          const isToday = isSameDay(d, today);
          return (
            <div key={dayKey(d)} className="flex-1 border-l border-[var(--line)] px-2 py-2 text-center">
              <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--fg-muted)]">
                {d.toLocaleDateString("en-US", { weekday: "short" })}
              </div>
              <div className={`mx-auto mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-sm ${isToday ? "bg-[var(--gold-400)] font-semibold text-black" : "text-[var(--fg-primary)]"}`}>
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
              <span className="absolute -top-2 right-1.5 text-[10px] text-[var(--fg-muted)]">
                {h === 0 ? "" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`}
              </span>
            </div>
          ))}
        </div>

        {days.map((d) => {
          const evs = eventsForDay(meetings, d);
          const layout = layoutDayEvents(evs);
          const isToday = isSameDay(d, today);
          return (
            <div
              key={dayKey(d)}
              className="relative flex-1 border-l border-[var(--line)]"
              style={{ height: 24 * HOUR_PX }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const y = e.clientY - rect.top;
                let minutes = Math.round((y / HOUR_PX) * 60 / 30) * 30;
                minutes = Math.max(0, Math.min(23 * 60 + 30, minutes));
                onSelectSlot(localIso(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(minutes / 60), minutes % 60));
              }}
            >
              {/* Hour lines */}
              {hours.map((h) => (
                <div key={h} className="absolute left-0 right-0 border-b border-[var(--line)]/60" style={{ top: h * HOUR_PX, height: HOUR_PX }} />
              ))}

              {/* Now indicator */}
              {isToday ? (
                <div className="pointer-events-none absolute left-0 right-0 z-10 flex items-center" style={{ top: (nowMin / 60) * HOUR_PX }}>
                  <span className="h-2 w-2 -translate-x-1 rounded-full bg-[var(--gold-400)]" />
                  <span className="h-px flex-1 bg-[var(--gold-400)]" />
                </div>
              ) : null}

              {/* Events */}
              {evs.map((m) => {
                const [startMin, endMin] = eventSpanMinutes(m);
                const { lane, lanes } = layout.get(m.id) ?? { lane: 0, lanes: 1 };
                const meta = typeMeta(m.meeting_type);
                const top = (startMin / 60) * HOUR_PX;
                const height = Math.max(((endMin - startMin) / 60) * HOUR_PX, 22);
                const widthPct = 100 / lanes;
                const live = (presence[m.id]?.count ?? 0) > 0;
                const ts = meetingTimeState(m.scheduled_at, m.duration_minutes, now);
                return (
                  <button
                    key={m.id}
                    onClick={(e) => { e.stopPropagation(); onSelectEvent(m); }}
                    className="absolute overflow-hidden rounded-md border-l-2 px-1.5 py-1 text-left shadow-sm"
                    style={{
                      top,
                      height,
                      left: `calc(${lane * widthPct}% + 2px)`,
                      width: `calc(${widthPct}% - 4px)`,
                      borderLeftColor: meta.accent,
                      backgroundColor: `color-mix(in srgb, ${meta.accent} 16%, var(--surface-1))`,
                    }}
                    title={m.title}
                  >
                    <div className="flex items-center gap-1">
                      {live ? <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400" /> : null}
                      <span className="truncate text-[11px] font-medium text-[var(--fg-primary)]">{m.title}</span>
                    </div>
                    <div className="truncate text-[10px] text-[var(--fg-muted)]">
                      {m.scheduled_at ? shortTime(m.scheduled_at) : ""}
                      {ts && (ts.phase === "imminent" || ts.phase === "in_progress") ? ` · ${ts.phase === "in_progress" ? "In progress" : ts.label}` : ""}
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
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
            <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--fg-muted)]">{d.toLocaleDateString("en-US", { weekday: "short" })}</div>
            <div className={`mx-auto mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full text-base font-semibold ${isSameDay(d, today) ? "bg-[var(--gold-400)] text-black" : "text-[var(--fg-primary)]"}`}>
              {d.getDate()}
            </div>
            <div className="text-[10px] text-[var(--fg-muted)]">{d.toLocaleDateString("en-US", { month: "short" })}</div>
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
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-[var(--fg-muted)]">{statusOf(m)}</span>
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
          <div key={l} className="text-center text-[9px] font-medium uppercase text-[var(--fg-muted)]">{l[0]}</div>
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
                isToday ? "bg-[var(--gold-400)] font-semibold text-black" : inMonth ? "text-[var(--fg-secondary)] hover:bg-[var(--surface-0)]" : "text-[var(--fg-muted)] hover:bg-[var(--surface-0)]"
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
      <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-muted)]">Meeting types</p>
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

  function askEarn(prompt: string) {
    window.dispatchEvent(new CustomEvent("earn:set-composer-prompt", { detail: { prompt } }));
    onClose();
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] shadow-2xl">
        <div className="flex items-start gap-3 border-b border-[var(--line)] p-4" style={{ borderLeft: `3px solid ${meta.accent}` }}>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.chip}`}>{meta.label}</span>
              <span className="rounded-full border border-[var(--line)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--fg-muted)]">{status}</span>
              {live ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
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
          <Link href={`/meetings/${meeting.room_code}`} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${live ? "bg-emerald-500/15 text-emerald-400" : "bg-[var(--gold-400)] text-black hover:bg-[var(--gold-500)]"}`}>
            {live ? "Join live →" : "Join →"}
          </Link>
          <button onClick={onEdit} className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]">Edit</button>
          {meeting.status === "ended" ? (
            <Link href={`/meetings/${meeting.room_code}/report`} className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]">View report</Link>
          ) : null}
          <button onClick={() => askEarn(`Prepare me for "${meeting.title}" and surface likely questions, risks, and next steps.`)} className="ml-auto rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]">
            Prepare with Earn
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 font-mono text-[10px] uppercase tracking-wider text-[var(--fg-muted)]">{label}</span>
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

function MenuItem({ title, subtitle, onClick }: { title: string; subtitle: string; onClick: () => void }) {
  return (
    <button onClick={onClick} role="menuitem" className="flex w-full flex-col items-start px-4 py-3 text-left transition-colors hover:bg-[var(--surface-2)]">
      <span className="text-sm font-medium text-[var(--fg-primary)]">{title}</span>
      <span className="text-xs text-[var(--fg-muted)]">{subtitle}</span>
    </button>
  );
}

function ChevronLeft() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>);
}
function ChevronRight() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>);
}
function PlusIcon() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>);
}
function CaretDown() {
  return (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>);
}
function FilterIcon() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>);
}
function CloseIcon() {
  return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>);
}
