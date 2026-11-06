"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  formatSlotDate,
  formatSlotFull,
  formatSlotDayMonth,
  formatSlotTime,
  formatSlotWeekday,
  groupSlotsByDate,
  type SlotWindow,
} from "@/lib/meetings/scheduling";
import { GROUP_FROM, PART_OF_DAY_LABEL, earliestSlot, slotsByPartOfDay } from "@/lib/meetings/slot-groups";

/**
 * Day rail + times for a public booking page. Slots arrive as absolute
 * instants and are grouped into days in the *viewer's* timezone, so an invitee
 * in Singapore sees a London host's afternoon on the right calendar day.
 *
 * Memoised because it sits directly above the form the invitee types their
 * name and email into, and that form's state lives in the page component. Every
 * keystroke re-rendered the whole grid — a fortnight of days and every time in
 * the open one — to paint characters in an input beneath it. None of the props
 * here change while somebody types: `slots`, `timezone` and `selected` are the
 * page's state, `onSelect` is a setState, and `emptyMessage` is a fresh string
 * each render but an equal one, which is all a shallow compare asks.
 */
export const SlotPicker = memo(function SlotPicker({
  slots,
  timezone,
  selected,
  onSelect,
  loading = false,
  emptyMessage = "No open times in the next few weeks.",
}: {
  slots: SlotWindow[];
  timezone: string;
  selected: string | null;
  onSelect: (startIso: string) => void;
  loading?: boolean;
  emptyMessage?: string;
}) {
  const days = useMemo(() => groupSlotsByDate(slots, timezone), [slots, timezone]);
  const [activeDate, setActiveDate] = useState<string | null>(null);

  // Keep a valid day selected as slots reload or the timezone shifts the
  // grouping — falling back to the first day with anything open.
  useEffect(() => {
    setActiveDate((current) => {
      if (current && days.some((d) => d.date === current)) return current;
      return days[0]?.date ?? null;
    });
  }, [days]);

  const activeDay = days.find((d) => d.date === activeDate) ?? null;
  const first = useMemo(() => earliestSlot(slots), [slots]);
  const firstDate = first ? (days.find((d) => d.slots.some((x) => x.start === first.start))?.date ?? null) : null;
  const parts = useMemo(
    () => (activeDay && activeDay.slots.length >= GROUP_FROM ? slotsByPartOfDay(activeDay.slots, timezone) : null),
    [activeDay, timezone],
  );
  const railRef = useRef<HTMLDivElement>(null);

  // Keep the picked day in view on a narrow rail: a day chosen with the arrow
  // keys, or by "first open time", can be off the edge of a phone screen.
  useEffect(() => {
    if (!activeDate) return;
    const tab = railRef.current?.querySelector<HTMLElement>(`[data-date="${activeDate}"]`);
    tab?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeDate]);

  /** Arrow keys move along the rail, as a tab list should. */
  function onRailKey(e: React.KeyboardEvent) {
    const at = days.findIndex((d) => d.date === activeDate);
    let next = -1;
    if (e.key === "ArrowRight") next = Math.min(days.length - 1, at + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, at - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = days.length - 1;
    if (next < 0 || next === at) return;
    e.preventDefault();
    setActiveDate(days[next].date);
    railRef.current?.querySelector<HTMLElement>(`[data-date="${days[next].date}"]`)?.focus();
  }

  function renderTimes(list: SlotWindow[]) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {list.map((slot) => {
          const isSelected = slot.start === selected;
          return (
            <button
              key={slot.start}
              type="button"
              onClick={() => onSelect(slot.start)}
              aria-pressed={isSelected}
              className={`min-h-[44px] rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                isSelected
                  ? "border-[var(--gold-400)] bg-[var(--gold-400)] text-white"
                  : "border-[var(--line)] bg-[var(--surface-1)] text-[var(--fg-primary)] hover:border-[var(--gold-400)]"
              }`}
            >
              {formatSlotTime(slot.start, timezone)}
            </button>
          );
        })}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-1)] px-4 py-6 text-sm text-[var(--fg-muted)]">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--gold-400)] border-t-transparent" />
        Finding open times…
      </div>
    );
  }

  if (days.length === 0) {
    return (
      <p className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] px-4 py-6 text-sm text-[var(--fg-muted)]">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Only once they have moved off the first day: on it, the first open
          time is already the first button in the grid. */}
      {first && firstDate && activeDate !== firstDate && first.start !== selected ? (
        <button
          type="button"
          onClick={() => {
            setActiveDate(firstDate);
            onSelect(first.start);
          }}
          className="flex w-fit items-center gap-2 rounded-full border border-[var(--gold-400)]/40 bg-[var(--gold-400)]/5 px-3 py-1.5 text-xs font-medium text-[var(--fg-primary)] transition-colors hover:border-[var(--gold-400)]"
        >
          <span className="text-[var(--gold-400)]">First open time</span>
          <span>{formatSlotFull(first.start, timezone)}</span>
        </button>
      ) : null}

      <div
        ref={railRef}
        className="flex snap-x gap-2 overflow-x-auto pb-1"
        role="tablist"
        aria-label="Available days"
        onKeyDown={onRailKey}
      >
        {days.map((day) => {
          const isActive = day.date === activeDate;
          const sample = day.slots[0].start;
          return (
            <button
              key={day.date}
              type="button"
              role="tab"
              data-date={day.date}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveDate(day.date)}
              className={`flex shrink-0 snap-start flex-col items-center rounded-xl border px-3 py-2 transition-colors ${
                isActive
                  ? "border-[var(--gold-400)] bg-[var(--gold-400)]/10 text-[var(--fg-primary)]"
                  : "border-[var(--line)] bg-[var(--surface-1)] text-[var(--fg-secondary)] hover:border-[var(--gold-400)]/40"
              }`}
            >
              <span className="text-[11px] uppercase tracking-wide text-[var(--fg-muted)]">
                {formatSlotWeekday(sample, timezone)}
              </span>
              <span className="text-sm font-medium">{formatSlotDayMonth(sample, timezone)}</span>
              <span className="text-[11px] text-[var(--fg-muted)]">{day.slots.length} open</span>
            </button>
          );
        })}
      </div>

      {activeDay ? (
        <div className="flex flex-col gap-2" role="tabpanel" aria-label={formatSlotDate(activeDay.slots[0].start, timezone)}>
          <p className="text-xs text-[var(--fg-muted)]">{formatSlotDate(activeDay.slots[0].start, timezone)}</p>
          {parts && parts.length > 1 ? (
            parts.map((group) => (
              <div key={group.part} className="flex flex-col gap-1.5">
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-muted)]">
                  {PART_OF_DAY_LABEL[group.part]}
                </p>
                {renderTimes(group.slots)}
              </div>
            ))
          ) : (
            renderTimes(activeDay.slots)
          )}
        </div>
      ) : null}
    </div>
  );
});
