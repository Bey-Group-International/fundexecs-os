// lib/meetings/calendar-drag.ts
// Dragging a meeting to a new time, and dragging its edges to change duration.
//
// All of the geometry and every rule about what a drag is allowed to produce
// lives here, pure. The component owns pointer events and pixels; this owns
// "what does that gesture mean", so the awkward cases — a 15-minute floor, an
// event pushed past midnight, a click mistaken for a drag — are testable
// without a browser.

import type { CalendarMeeting } from "@/lib/meetings/calendar";

/** Drags land on quarter hours. Finer than that is noise on a 46px hour. */
export const SNAP_MINUTES = 15;

/** Shorter than this and the block is unreadable, and unbookable in practice. */
export const MIN_DURATION_MINUTES = 15;

/**
 * How far the pointer must travel before a press becomes a drag.
 *
 * Without it every click on an event nudges it, because no hand is perfectly
 * still between mousedown and mouseup.
 */
export const DRAG_THRESHOLD_PX = 4;

export const MINUTES_IN_DAY = 24 * 60;

export type DragMode = "move" | "resize-start" | "resize-end";

export interface DragOrigin {
  meetingId: string;
  mode: DragMode;
  /** The event's span when the drag began. */
  startMinute: number;
  endMinute: number;
  /** Which day column it started in. Always 0 in day view. */
  dayIndex: number;
  /**
   * Where inside the event the pointer grabbed, in minutes from its start.
   *
   * A move keeps this constant, so the event travels with the cursor instead of
   * jumping its top edge to wherever the pointer happens to be.
   */
  grabOffsetMinute: number;
}

export interface DragPointer {
  /** Minutes from midnight under the pointer, before snapping. */
  minute: number;
  dayIndex: number;
}

export interface DragPreview {
  startMinute: number;
  endMinute: number;
  dayIndex: number;
}

/** Round to the snap grid. */
export function snapMinute(minute: number, step: number = SNAP_MINUTES): number {
  if (!Number.isFinite(minute)) return 0;
  if (step <= 0) return Math.round(minute);
  return Math.round(minute / step) * step;
}

/** Minutes from midnight for a y offset inside a day column. */
export function minuteFromOffset(y: number, hourPx: number): number {
  if (!Number.isFinite(y) || !(hourPx > 0)) return 0;
  return clamp((y / hourPx) * 60, 0, MINUTES_IN_DAY);
}

/** Which day column an x offset falls in, clamped to the columns on screen. */
export function columnFromOffset(x: number, columnWidth: number, dayCount: number): number {
  if (!(columnWidth > 0) || dayCount <= 1) return 0;
  if (!Number.isFinite(x)) return 0;
  return clamp(Math.floor(x / columnWidth), 0, dayCount - 1);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Whether the pointer has travelled far enough to mean a drag, not a click. */
export function movedEnough(dx: number, dy: number, threshold: number = DRAG_THRESHOLD_PX): boolean {
  return Math.abs(dx) >= threshold || Math.abs(dy) >= threshold;
}

/**
 * Where the event should sit for the current pointer position.
 *
 * A move keeps its duration and may cross to another day; a resize keeps its
 * day and moves only the edge being dragged. Both stay inside the day: an event
 * dragged toward midnight stops at the boundary rather than silently spilling
 * into tomorrow, which is a different date and would surprise.
 */
export function previewFor(
  origin: DragOrigin,
  pointer: DragPointer,
  opts: { dayCount?: number; snap?: number } = {},
): DragPreview {
  const step = opts.snap ?? SNAP_MINUTES;
  const dayCount = opts.dayCount ?? 1;
  const duration = Math.max(MIN_DURATION_MINUTES, origin.endMinute - origin.startMinute);

  if (origin.mode === "move") {
    const rawStart = pointer.minute - origin.grabOffsetMinute;
    // Clamp the start so the whole event fits, then snap — snapping first could
    // push the tail back past midnight for an event that only just fit.
    const start = snapMinute(clamp(rawStart, 0, MINUTES_IN_DAY - duration), step);
    return {
      startMinute: clamp(start, 0, MINUTES_IN_DAY - duration),
      endMinute: clamp(start, 0, MINUTES_IN_DAY - duration) + duration,
      dayIndex: clamp(pointer.dayIndex, 0, Math.max(0, dayCount - 1)),
    };
  }

  if (origin.mode === "resize-end") {
    const end = clamp(
      snapMinute(pointer.minute, step),
      origin.startMinute + MIN_DURATION_MINUTES,
      MINUTES_IN_DAY,
    );
    return { startMinute: origin.startMinute, endMinute: end, dayIndex: origin.dayIndex };
  }

  const start = clamp(snapMinute(pointer.minute, step), 0, origin.endMinute - MIN_DURATION_MINUTES);
  return { startMinute: start, endMinute: origin.endMinute, dayIndex: origin.dayIndex };
}

/** Whether the drag ended where it started, so nothing should be saved. */
export function isNoOp(origin: DragOrigin, preview: DragPreview): boolean {
  return (
    origin.startMinute === preview.startMinute &&
    origin.endMinute === preview.endMinute &&
    origin.dayIndex === preview.dayIndex
  );
}

export function durationOf(preview: DragPreview): number {
  return preview.endMinute - preview.startMinute;
}

/**
 * Whether this meeting may be dragged at all.
 *
 * An unscheduled meeting has nowhere to be dragged from, and one that has ended
 * or been locked is a record of what happened rather than a plan — moving it
 * would rewrite history.
 */
export function canDragMeeting(m: Pick<CalendarMeeting, "scheduled_at" | "status" | "locked_at">): boolean {
  if (!m.scheduled_at) return false;
  if (m.status === "ended") return false;
  if (m.locked_at) return false;
  return true;
}

/** "10:15 AM" for a minute-of-day, matching how the grid labels times. */
export function formatMinute(minute: number): string {
  const m = clamp(Math.round(minute), 0, MINUTES_IN_DAY);
  // 1440 is midnight at the far edge; render it as 12:00 AM rather than 24:00.
  const hour24 = Math.floor(m / 60) % 24;
  const mins = m % 60;
  const suffix = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(mins).padStart(2, "0")} ${suffix}`;
}

/** The label shown on the event while it is being dragged. */
export function describeSpan(preview: DragPreview): string {
  return `${formatMinute(preview.startMinute)} – ${formatMinute(preview.endMinute)}`;
}

/**
 * The instant a preview corresponds to, as an ISO string.
 *
 * Built from local wall-clock parts, like the rest of the grid: the calendar
 * renders in the viewer's zone, and constructing the Date from local fields is
 * what makes "drop it on 10:00" mean 10:00 where the member is sitting.
 */
export function previewStartIso(day: Date, preview: DragPreview): string {
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
  d.setMinutes(preview.startMinute);
  return d.toISOString();
}
