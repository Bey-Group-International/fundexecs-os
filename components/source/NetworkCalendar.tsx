"use client";

// The month — tasks and expected closes on the same grid.
//
// They belong together because they compete for the same days. A calendar that
// shows only follow-ups lets somebody book a week solid and then discover three
// deals were meant to close inside it; one that shows only closes hides the
// work that gets them there.
//
// Dragging an item moves its date. That is the same gesture the pipeline board
// uses for stage, and it is the reason this is a grid rather than a list: the
// point of a calendar is that "next Tuesday" is a place you can drop something.
// Keyboard users get a date input on each item for the same reason the board
// has a stage select — a drag-only affordance is a surface some people cannot
// reach at all.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  byDay,
  monthGrid,
  monthOf,
  shiftMonth,
  type ScheduleEntry,
} from "@/lib/network-workspace";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function monthLabel(month: string): string {
  const ms = Date.parse(`${month}-01T00:00:00Z`);
  if (Number.isNaN(ms)) return month;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function compactMoney(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  } catch {
    // An unknown currency code should not blank the cell.
    return `${currency} ${Math.round(n).toLocaleString()}`;
  }
}

export function NetworkCalendar() {
  const [month, setMonth] = useState(() => monthOf());
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<ScheduleEntry | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  // The one day currently showing all of its items. A cell only has room for
  // three, and the rest were unreachable: the overflow count was static text,
  // so a fourth follow-up had no drag handle and no date input and could not be
  // rescheduled by any means at all — on the busiest days, which are precisely
  // the ones somebody opens a calendar to sort out.
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const liveRegion = useRef<HTMLParagraphElement | null>(null);

  const load = useCallback(async (targetMonth: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/network/schedule?month=${encodeURIComponent(targetMonth)}`);
      const body = (await res.json().catch(() => null)) as
        | { entries?: ScheduleEntry[]; error?: string }
        | null;
      if (!res.ok) throw new Error(body?.error ?? "Couldn't load the calendar.");
      setEntries(body?.entries ?? []);
      setError(null);
    } catch (err) {
      // An empty month and an unreachable one look identical on a grid, so say
      // which one this is rather than drawing 30 empty squares.
      setError(err instanceof Error ? err.message : "Couldn't load the calendar.");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(month);
    setExpandedDay(null);
  }, [load, month]);

  const grid = useMemo(() => monthGrid(month), [month]);
  const scheduled = useMemo(() => byDay(entries), [entries]);

  const move = useCallback(
    async (entry: ScheduleEntry, toDate: string) => {
      if (entry.onDate === toDate) return;
      const from = entry.onDate;

      setBusy((b) => new Set(b).add(entry.id));
      setEntries((prev) =>
        prev.map((e) => (e.id === entry.id && e.kind === entry.kind ? { ...e, onDate: toDate } : e)),
      );
      if (liveRegion.current) {
        liveRegion.current.textContent = `${entry.title} moved to ${toDate}`;
      }

      try {
        const res =
          entry.kind === "task"
            ? await fetch(`/api/network/tasks/${entry.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                // Midday UTC: a due date is a day, and pinning it to midnight
                // makes it land on the previous day for anyone west of UTC.
                body: JSON.stringify({ dueAt: `${toDate}T12:00:00.000Z` }),
              })
            : await fetch(`/api/network/opportunities/${entry.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ expectedClose: toDate }),
              });

        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        if (!res.ok) throw new Error(body?.error ?? "Couldn't move that.");
        setError(null);
      } catch (err) {
        // Restore this one item only. Another item may have been moved while
        // this request was in flight, and a snapshot would undo that too.
        setEntries((prev) =>
          prev.map((e) => (e.id === entry.id && e.kind === entry.kind ? { ...e, onDate: from } : e)),
        );
        setError(err instanceof Error ? err.message : "Couldn't move that.");
      } finally {
        setBusy((b) => {
          const next = new Set(b);
          next.delete(entry.id);
          return next;
        });
      }
    },
    [],
  );

  return (
    <div className="flex flex-col gap-3">
      <p ref={liveRegion} aria-live="polite" className="sr-only" />

      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-lg font-semibold text-fg-primary">{monthLabel(month)}</h3>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
            aria-label="Previous month"
            className="rounded-md border border-hairline px-2 py-1 text-xs text-fg-muted transition hover:text-fg-primary"
          >
            ←
          </button>
          <button
            onClick={() => setMonth(monthOf())}
            className="rounded-md border border-hairline px-2.5 py-1 text-xs text-fg-muted transition hover:text-fg-primary"
          >
            Today
          </button>
          <button
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            aria-label="Next month"
            className="rounded-md border border-hairline px-2 py-1 text-xs text-fg-muted transition hover:text-fg-primary"
          >
            →
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
          <button
            onClick={() => void load(month)}
            className="ml-auto rounded px-2 py-0.5 text-fg-muted hover:text-fg-primary"
          >
            Retry
          </button>
        </div>
      )}

      <div className="fx-card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-hairline">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="px-2 py-1.5 text-center text-[11px] font-medium uppercase tracking-wide text-fg-muted"
            >
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {grid.map((day) => {
            const items = scheduled.get(day.date) ?? [];
            const isDropTarget = overDay === day.date;
            const isExpanded = expandedDay === day.date;
            const shown = isExpanded ? items : items.slice(0, 3);
            return (
              <div
                key={day.date}
                onDragOver={(e) => {
                  if (!dragging) return;
                  e.preventDefault();
                  setOverDay(day.date);
                }}
                onDragLeave={() => setOverDay((d) => (d === day.date ? null : d))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOverDay(null);
                  if (dragging) void move(dragging, day.date);
                  setDragging(null);
                }}
                className={`min-h-[5.5rem] border-b border-r border-hairline p-1 transition ${
                  day.inMonth ? "" : "bg-fg-primary/[0.015]"
                } ${day.isWeekend && day.inMonth ? "bg-fg-primary/[0.02]" : ""} ${
                  isDropTarget ? "bg-accent-300/10 ring-1 ring-inset ring-accent-300/40" : ""
                }`}
              >
                <div className="flex items-baseline justify-between px-1">
                  <span
                    className={`text-[11px] tabular-nums ${
                      day.isToday
                        ? "rounded bg-accent-300/20 px-1.5 font-semibold text-accent-300"
                        : day.inMonth
                          ? "text-fg-secondary"
                          : "text-fg-muted/50"
                    }`}
                  >
                    {Number(day.date.slice(8, 10))}
                  </span>
                  {items.length > 2 && (
                    <span className="text-[10px] tabular-nums text-fg-muted">{items.length}</span>
                  )}
                </div>

                <ul className="mt-0.5 flex flex-col gap-0.5">
                  {shown.map((item) => (
                    <li key={`${item.kind}-${item.id}`}>
                      <div
                        draggable={!busy.has(item.id)}
                        onDragStart={() => setDragging(item)}
                        onDragEnd={() => {
                          setDragging(null);
                          setOverDay(null);
                        }}
                        title={
                          item.kind === "close" && item.amount && item.currency
                            ? `${item.title} — ${compactMoney(item.amount, item.currency)}`
                            : item.title
                        }
                        className={`group cursor-grab truncate rounded px-1.5 py-0.5 text-[11px] active:cursor-grabbing ${
                          busy.has(item.id) ? "opacity-50" : ""
                        } ${
                          item.kind === "close"
                            ? "bg-accent-300/15 text-accent-200"
                            : item.overdue
                              ? "bg-rose-500/15 text-rose-200"
                              : item.status === "done"
                                ? "bg-fg-primary/5 text-fg-muted line-through"
                                : "bg-fg-primary/[0.07] text-fg-secondary"
                        }`}
                      >
                        {item.kind === "close" && <span aria-hidden>◆ </span>}
                        {item.title}
                      </div>
                      {/* Reachable without a pointer: the same move, as a date. */}
                      <label className="sr-only" htmlFor={`move-${item.kind}-${item.id}`}>
                        Move {item.title}
                      </label>
                      <input
                        id={`move-${item.kind}-${item.id}`}
                        type="date"
                        value={item.onDate}
                        disabled={busy.has(item.id)}
                        onChange={(e) => e.target.value && void move(item, e.target.value)}
                        className="sr-only focus:not-sr-only focus:mt-0.5 focus:block focus:w-full focus:rounded focus:border focus:border-hairline focus:bg-surface-raised focus:px-1 focus:text-[11px]"
                      />
                    </li>
                  ))}
                </ul>

                {items.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setExpandedDay(isExpanded ? null : day.date)}
                    aria-expanded={isExpanded}
                    className="px-1.5 pt-0.5 text-[10px] text-fg-muted transition hover:text-fg-primary"
                  >
                    {isExpanded ? "Show less" : `+${items.length - 3} more`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-fg-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-accent-300/40" aria-hidden /> Expected close
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-fg-primary/20" aria-hidden /> Follow-up
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-rose-500/40" aria-hidden /> Overdue
        </span>
        {loading && <span className="ml-auto">Loading…</span>}
      </div>
    </div>
  );
}
