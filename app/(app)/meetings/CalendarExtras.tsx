"use client";

// The calendar's helpers that sit around the grid rather than inside it: the
// week-at-a-glance strip, the badges on a chip, the right-click menu, and the
// search overlay. Kept out of MeetingsCalendar.tsx, which is the grid itself.

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MEETING_KIND } from "@/lib/meetings/one-way";
import { blocksForDay, eventSpanMinutes, eventsForDay, type CalendarBlock, type CalendarMeeting } from "@/lib/meetings/calendar";
import { busyMinutesForDay, type ExternalEvent } from "@/lib/calendar/layers";
import { isBookingRequest } from "@/lib/meetings/booking-requests";
import { weekdayLabel, type MeetingDisplayStatus } from "@/lib/meetings/schedule";
import {
  chipBadge,
  dayInsight,
  formatMinutes,
  loadLevel,
  sumInsights,
  type DayInsight,
  type Span,
} from "@/lib/meetings/calendar-week";
import { searchMeetings, type SearchableMeeting } from "@/lib/meetings/calendar-search";

// ── Badges ──────────────────────────────────────────────────────────────────

/** "Prep" or "Follow-up" on a chip, when there is work owed around the meeting. */
export function ChipBadge({ status }: { status: MeetingDisplayStatus }) {
  const badge = chipBadge(status);
  if (!badge) return null;
  return (
    <span
      data-badge={badge.label}
      className={`shrink-0 rounded px-1 text-[9px] font-semibold uppercase leading-[14px] tracking-wide ${
        badge.tone === "warning"
          ? "bg-status-warning/20 text-[var(--status-warning)]"
          : "bg-[var(--gold-400)]/20 text-[var(--gold-400)]"
      }`}
    >
      {badge.label}
    </span>
  );
}

// ── Week at a glance ────────────────────────────────────────────────────────

/** Each day's insight, from what the grid already holds. */
export function insightsForDays(
  days: readonly Date[],
  meetings: CalendarMeeting[],
  blocks: CalendarBlock[],
  busyEvents: ExternalEvent[],
  statusOf: (m: CalendarMeeting) => MeetingDisplayStatus,
): DayInsight[] {
  return days.map((d) => {
    const evs = eventsForDay(meetings, d);
    const own = evs.filter((m) => !isBookingRequest(m));
    // A pending request holds the time but is not yet a meeting.
    const held: Span[] = evs.filter((m) => isBookingRequest(m)).map((m) => eventSpanMinutes(m));
    const other: Span[] = [
      ...blocksForDay(blocks, d).map((b) => [b.startMin, b.endMin] as Span),
      ...busyMinutesForDay(busyEvents, d),
      ...held,
    ];
    return dayInsight(
      own.map((m) => ({ span: eventSpanMinutes(m), status: statusOf(m) })),
      other,
    );
  });
}

const LOAD_BAR: Record<ReturnType<typeof loadLevel>, string> = {
  light: "bg-[var(--status-success)]",
  busy: "bg-[var(--status-warning)]",
  heavy: "bg-[var(--status-danger)]",
};

/**
 * Hours in meetings, focus time left, back-to-back runs and work owed, for the
 * days on screen — and, for more than one day, a cell per day that opens it.
 */
export function WeekInsightsStrip({
  days,
  insights,
  onPickDay,
}: {
  days: readonly Date[];
  insights: DayInsight[];
  onPickDay?: (d: Date) => void;
}) {
  const total = useMemo(() => sumInsights(insights), [insights]);
  const parts = [
    `${formatMinutes(total.meetingMinutes)} in meetings`,
    `${formatMinutes(total.focusMinutes)} focus time`,
    total.backToBackRuns ? `${total.backToBackRuns} back-to-back run${total.backToBackRuns === 1 ? "" : "s"}` : null,
    total.prepNeeded ? `${total.prepNeeded} need${total.prepNeeded === 1 ? "s" : ""} prep` : null,
    total.followUpNeeded ? `${total.followUpNeeded} follow-up${total.followUpNeeded === 1 ? "" : "s"} to send` : null,
  ].filter(Boolean);

  return (
    <section aria-label={days.length > 1 ? "Week at a glance" : "Day at a glance"} className="mb-2 flex flex-col gap-2 px-1">
      <p className="text-xs text-[var(--fg-secondary)]">{parts.join(" · ")}</p>
      {days.length > 1 ? (
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          {days.map((d, i) => {
            const day = insights[i];
            const level = loadLevel(day.meetingMinutes);
            const pct = Math.min(100, Math.round((day.meetingMinutes / (9 * 60)) * 100));
            return (
              <button
                key={d.toISOString()}
                type="button"
                onClick={() => onPickDay?.(d)}
                title={`${weekdayLabel(d)}: ${formatMinutes(day.meetingMinutes)} in meetings, ${formatMinutes(day.focusMinutes)} focus`}
                className="flex min-h-11 flex-col items-start gap-1 rounded-lg border border-[var(--line)] px-2 py-1.5 text-left transition-colors hover:border-[var(--gold-400)]/50 sm:min-h-0"
              >
                <span className="flex w-full items-center justify-between gap-1 text-[11px]">
                  <span className="font-medium text-[var(--fg-primary)]">{formatMinutes(day.meetingMinutes)}</span>
                  {day.backToBackRuns ? (
                    <span className="text-[10px] text-[var(--status-warning)]" title="Back-to-back meetings">
                      ⇉{day.backToBackRuns}
                    </span>
                  ) : null}
                </span>
                <span className="h-1 w-full overflow-hidden rounded-full bg-[var(--line)]">
                  <span className={`block h-full ${LOAD_BAR[level]}`} style={{ width: `${pct}%` }} />
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

// ── Right-click / long-press menu ───────────────────────────────────────────

export interface MenuAction {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  hint?: string;
}

/** A small menu at the pointer, for a meeting's quick actions. */
export function MeetingMenu({
  title,
  x,
  y,
  actions,
  onClose,
}: {
  title: string;
  x: number;
  y: number;
  actions: MenuAction[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDown(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("touchstart", onDown);
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("touchstart", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Kept on screen: a right-click near the edge must not open a menu half off it.
  const left = typeof window === "undefined" ? x : Math.min(x, window.innerWidth - 220);
  const top = typeof window === "undefined" ? y : Math.min(y, window.innerHeight - (actions.length * 40 + 48));

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Actions for ${title}`}
      className="fixed z-50 w-52 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-1)] py-1 shadow-xl"
      style={{ left: Math.max(8, left), top: Math.max(8, top) }}
    >
      <p className="truncate border-b border-[var(--line)] px-3 py-1.5 text-[11px] font-medium text-[var(--fg-muted)]">{title}</p>
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          role="menuitem"
          disabled={a.disabled}
          title={a.hint}
          onClick={() => {
            a.onSelect();
            onClose();
          }}
          className="flex min-h-10 w-full items-center px-3 text-left text-sm text-[var(--fg-primary)] hover:bg-[var(--surface-0)] disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-8 sm:text-xs"
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

/** Quick actions as a row of buttons, for the event detail sheet on a phone. */
export function MeetingActionRow({ actions }: { actions: MenuAction[] }) {
  return (
    <div className="flex flex-wrap gap-2 border-t border-[var(--line)] px-4 py-3">
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          disabled={a.disabled}
          title={a.hint}
          onClick={a.onSelect}
          className="min-h-9 rounded-lg border border-[var(--line)] px-3 text-xs font-medium text-[var(--fg-secondary)] transition-colors hover:text-[var(--fg-primary)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

// ── Search ──────────────────────────────────────────────────────────────────

/** The columns search reads: enough to match and to say what matched, no more. */
const SEARCH_SELECT = "id, title, scheduled_at, duration_minutes, meeting_type, attendees, agenda, objective";
/** How far back and forward search reaches, in meetings. */
const SEARCH_ROWS = 1000;

type SearchRow = SearchableMeeting & { id: string };

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Find a meeting by title, person or company, across the organisation's past
 * and upcoming meetings — not only the months the grid has loaded.
 */
export function CalendarSearch({
  orgId,
  now,
  onPick,
  onClose,
}: {
  orgId: string;
  now: number;
  onPick: (id: string, scheduledAt: string | null) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<SearchRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    let live = true;
    (async () => {
      try {
        const { data, error } = await createClient()
          .from("live_meetings")
          .select(SEARCH_SELECT)
          .eq("organization_id", orgId)
          .eq("kind", MEETING_KIND)
          .is("deleted_at", null)
          .not("scheduled_at", "is", null)
          .order("scheduled_at", { ascending: false })
          .limit(SEARCH_ROWS);
        if (!live) return;
        if (error) setFailed(true);
        setRows((data ?? []) as unknown as SearchRow[]);
      } catch {
        if (live) {
          setFailed(true);
          setRows([]);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [orgId]);

  const hits = useMemo(() => (rows ? searchMeetings(rows, query, now) : []), [rows, query, now]);
  useEffect(() => setActive(0), [query]);

  function pick(i: number) {
    const hit = hits[i];
    if (hit) onPick(hit.meeting.id, hit.meeting.scheduled_at);
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-[12vh] backdrop-blur-sm">
      <div
        role="dialog"
        aria-label="Search meetings"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] shadow-2xl"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(hits.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(active);
            }
          }}
          placeholder="Search by title, person or company…"
          aria-label="Search meetings"
          className="w-full border-b border-[var(--line)] bg-transparent px-4 py-3.5 text-base text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none sm:text-sm"
        />
        <div className="flex-1 overflow-y-auto">
          {rows === null ? (
            <p className="px-4 py-6 text-sm text-[var(--fg-muted)]">Loading meetings…</p>
          ) : query.trim().length < 2 ? (
            <p className="px-4 py-6 text-sm text-[var(--fg-muted)]">
              {failed ? "Couldn't load meetings to search." : "Type a title, a name, or a company like “acme”."}
            </p>
          ) : hits.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[var(--fg-muted)]">No meetings match “{query.trim()}”.</p>
          ) : (
            <ul role="listbox" aria-label="Results">
              {hits.map((hit, i) => {
                const first = i === 0 || hits[i - 1].upcoming !== hit.upcoming;
                return (
                  <li key={hit.meeting.id} role="presentation">
                    {first ? (
                      <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-muted)]">
                        {hit.upcoming ? "Upcoming" : "Past"}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(i)}
                      className={`flex w-full flex-col px-4 py-2 text-left ${i === active ? "bg-[var(--surface-0)]" : ""}`}
                    >
                      <span className="truncate text-sm font-medium text-[var(--fg-primary)]">{hit.meeting.title || "Untitled"}</span>
                      <span className="truncate text-xs text-[var(--fg-muted)]">
                        {formatWhen(hit.meeting.scheduled_at)}
                        {hit.matched ? ` · ${hit.matched}` : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
