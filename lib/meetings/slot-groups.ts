// lib/meetings/slot-groups.ts
// How a day of open times is laid out on a booking page: split into morning,
// afternoon and evening by the viewer's own clock, so somebody who only does
// afternoons goes straight to them instead of reading down a column of
// fifteen-minute starts.
//
// Pure: no DOM, no React.

import type { SlotWindow } from "@/lib/meetings/scheduling";

export type PartOfDay = "morning" | "afternoon" | "evening";

export const PART_OF_DAY_LABEL: Record<PartOfDay, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

const HOUR_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/** The hour (0-23) an instant falls on in a zone; UTC's for a zone this runtime does not know. */
export function hourInTimezone(iso: string, timezone: string): number {
  const at = new Date(iso);
  let fmt = HOUR_FORMATTERS.get(timezone);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: timezone });
    } catch {
      return at.getUTCHours();
    }
    HOUR_FORMATTERS.set(timezone, fmt);
  }
  const hour = Number(fmt.formatToParts(at).find((p) => p.type === "hour")?.value);
  // Some runtimes print midnight as "24" even with h23.
  return Number.isFinite(hour) ? hour % 24 : at.getUTCHours();
}

/** Morning before noon, afternoon until 5pm, evening after. */
export function partOfDay(iso: string, timezone: string): PartOfDay {
  const hour = hourInTimezone(iso, timezone);
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/**
 * One day's times, in parts of the day, in order, empty parts left out.
 *
 * The slots are expected to be one day's and already in time order, as
 * groupSlotsByDate leaves them.
 */
export function slotsByPartOfDay(
  slots: readonly SlotWindow[],
  timezone: string,
): Array<{ part: PartOfDay; slots: SlotWindow[] }> {
  const buckets: Record<PartOfDay, SlotWindow[]> = { morning: [], afternoon: [], evening: [] };
  for (const slot of slots) buckets[partOfDay(slot.start, timezone)].push(slot);
  return (["morning", "afternoon", "evening"] as const)
    .filter((part) => buckets[part].length > 0)
    .map((part) => ({ part, slots: buckets[part] }));
}

/**
 * Whether a day is long enough for headings to help. A handful of times reads
 * at a glance; headings over three buttons are just more to read.
 */
export const GROUP_FROM = 6;

/** The earliest open start, or null when there are none. */
export function earliestSlot(slots: readonly SlotWindow[]): SlotWindow | null {
  let best: SlotWindow | null = null;
  for (const slot of slots) {
    if (!best || new Date(slot.start).getTime() < new Date(best.start).getTime()) best = slot;
  }
  return best;
}
