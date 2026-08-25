"use client";

import { useEffect, useMemo, useState } from "react";
import { formatSlotDate, formatSlotTime, groupSlotsByDate, type SlotWindow } from "@/lib/meetings/scheduling";

/**
 * Day rail + times for a public booking page. Slots arrive as absolute
 * instants and are grouped into days in the *viewer's* timezone, so an invitee
 * in Singapore sees a London host's afternoon on the right calendar day.
 */
export function SlotPicker({
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
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Available days">
        {days.map((day) => {
          const isActive = day.date === activeDate;
          const sample = day.slots[0].start;
          return (
            <button
              key={day.date}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveDate(day.date)}
              className={`flex shrink-0 flex-col items-center rounded-xl border px-3 py-2 transition-colors ${
                isActive
                  ? "border-[var(--gold-400)] bg-[var(--gold-400)]/10 text-[var(--fg-primary)]"
                  : "border-[var(--line)] bg-[var(--surface-1)] text-[var(--fg-secondary)] hover:border-[var(--gold-400)]/40"
              }`}
            >
              <span className="text-[11px] uppercase tracking-wide text-[var(--fg-muted)]">
                {new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(new Date(sample))}
              </span>
              <span className="text-sm font-medium">
                {new Intl.DateTimeFormat("en-US", { timeZone: timezone, day: "numeric", month: "short" }).format(
                  new Date(sample),
                )}
              </span>
              <span className="text-[11px] text-[var(--fg-muted)]">{day.slots.length} open</span>
            </button>
          );
        })}
      </div>

      {activeDay ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-[var(--fg-muted)]">{formatSlotDate(activeDay.slots[0].start, timezone)}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {activeDay.slots.map((slot) => {
              const isSelected = slot.start === selected;
              return (
                <button
                  key={slot.start}
                  type="button"
                  onClick={() => onSelect(slot.start)}
                  aria-pressed={isSelected}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                    isSelected
                      ? "border-[var(--gold-400)] bg-[var(--gold-400)] text-black"
                      : "border-[var(--line)] bg-[var(--surface-1)] text-[var(--fg-primary)] hover:border-[var(--gold-400)]"
                  }`}
                >
                  {formatSlotTime(slot.start, timezone)}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
