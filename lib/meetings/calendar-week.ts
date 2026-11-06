// lib/meetings/calendar-week.ts
// What a day or a week on the calendar adds up to — hours in meetings, focus
// time left, back-to-back runs, prep still owed — and where the open time is,
// so the grid can show free slots to schedule into.
//
// Everything here works in minutes since local midnight on one day, the same
// unit the time grid draws in. Callers hand over the day's spans; nothing here
// reads a clock or a database.
//
// Pure: no React, no Supabase.

import type { MeetingDisplayStatus } from "@/lib/meetings/schedule";

export type Span = readonly [number, number];

const DAY_MINUTES = 24 * 60;

/** The working day the insights and free slots are measured against. */
export const WORK_START = 9 * 60;
export const WORK_END = 18 * 60;
/** Free time shorter than this is a gap, not a slot. */
export const MIN_SLOT = 30;
/** Unbroken free time at least this long counts as focus time. */
export const FOCUS_MIN = 60;
/** Meetings this close together are back to back: no time to reset. */
export const BACK_TO_BACK_GAP = 5;

/** Spans clipped to the day, sorted, and joined where they touch or overlap. */
export function mergeSpans(spans: readonly Span[]): Array<[number, number]> {
  const sorted = spans
    .map(([s, e]) => [Math.max(0, s), Math.min(DAY_MINUTES, e)] as [number, number])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/**
 * The open stretches inside a window, at least `min` long.
 *
 * `notBefore` drops time already gone today: a free slot at 10am read at 3pm
 * is not one anybody can use. Starts are rounded up to the next half hour so a
 * slot begins where a meeting would.
 */
export function freeSlots(
  taken: readonly Span[],
  opts: { from?: number; to?: number; min?: number; notBefore?: number } = {},
): Array<[number, number]> {
  const from = Math.max(opts.from ?? WORK_START, opts.notBefore ?? 0);
  const to = opts.to ?? WORK_END;
  const min = opts.min ?? MIN_SLOT;
  const out: Array<[number, number]> = [];
  let cursor = from;
  const roundUp = (m: number) => Math.ceil(m / 30) * 30;
  for (const [s, e] of mergeSpans(taken)) {
    if (e <= cursor) continue;
    if (s >= to) break;
    const start = roundUp(cursor);
    if (s - start >= min) out.push([start, s]);
    cursor = Math.max(cursor, e);
  }
  const start = roundUp(cursor);
  if (to - start >= min) out.push([start, to]);
  return out;
}

export interface DayInsight {
  /** Minutes in meetings, overlaps counted once. */
  meetingMinutes: number;
  /** Minutes of unbroken free working time in stretches of an hour or more. */
  focusMinutes: number;
  /** Runs of two or more meetings with no break between them. */
  backToBackRuns: number;
  /** Meetings still waiting on their preparation. */
  prepNeeded: number;
  /** Meetings whose follow-up has not gone out. */
  followUpNeeded: number;
  meetingCount: number;
}

/**
 * One day, summed up.
 *
 * `meetings` are the day's meeting spans, each with its derived status;
 * `otherBusy` is time taken by anything else (blocks, busy time on a connected
 * calendar), which costs focus time but is not a meeting.
 */
export function dayInsight(
  meetings: ReadonlyArray<{ span: Span; status: MeetingDisplayStatus }>,
  otherBusy: readonly Span[] = [],
): DayInsight {
  const spans = meetings.map((m) => m.span);
  const merged = mergeSpans(spans);
  const meetingMinutes = merged.reduce((sum, [s, e]) => sum + (e - s), 0);
  const focusMinutes = freeSlots([...spans, ...otherBusy], { min: FOCUS_MIN }).reduce((sum, [s, e]) => sum + (e - s), 0);

  // A run is consecutive meetings each starting within the gap of the last
  // one's end. Overlapping meetings are one run, not a double booking here —
  // conflicts are reported elsewhere.
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  let runs = 0;
  let runLength = 0;
  let runEnd = -Infinity;
  for (const [s, e] of sorted) {
    if (s - runEnd <= BACK_TO_BACK_GAP) {
      runLength += 1;
      if (runLength === 2) runs += 1;
    } else {
      runLength = 1;
    }
    runEnd = Math.max(runEnd, e);
  }

  return {
    meetingMinutes,
    focusMinutes,
    backToBackRuns: runs,
    prepNeeded: meetings.filter((m) => m.status === "Prep Needed").length,
    followUpNeeded: meetings.filter((m) => m.status === "Follow-Up Needed").length,
    meetingCount: meetings.length,
  };
}

/** Several days added together. */
export function sumInsights(days: readonly DayInsight[]): DayInsight {
  return days.reduce<DayInsight>(
    (acc, d) => ({
      meetingMinutes: acc.meetingMinutes + d.meetingMinutes,
      focusMinutes: acc.focusMinutes + d.focusMinutes,
      backToBackRuns: acc.backToBackRuns + d.backToBackRuns,
      prepNeeded: acc.prepNeeded + d.prepNeeded,
      followUpNeeded: acc.followUpNeeded + d.followUpNeeded,
      meetingCount: acc.meetingCount + d.meetingCount,
    }),
    { meetingMinutes: 0, focusMinutes: 0, backToBackRuns: 0, prepNeeded: 0, followUpNeeded: 0, meetingCount: 0 },
  );
}

/** "3h 30m", "45m", "0m". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** How heavy a day is, for colouring its cell: more than six hours is a lot. */
export function loadLevel(meetingMinutes: number): "light" | "busy" | "heavy" {
  if (meetingMinutes >= 6 * 60) return "heavy";
  if (meetingMinutes >= 3 * 60) return "busy";
  return "light";
}

/** What a chip shows about the work around a meeting, if anything. */
export function chipBadge(status: MeetingDisplayStatus): { label: string; tone: "warning" | "info" } | null {
  if (status === "Prep Needed") return { label: "Prep", tone: "warning" };
  if (status === "Follow-Up Needed") return { label: "Follow-up", tone: "info" };
  return null;
}
