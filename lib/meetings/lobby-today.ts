// lib/meetings/lobby-today.ts
// The Meetings home's "Today" line: what is left of the day and what is owed —
// meetings still to come, the time they take, prep and follow-ups waiting, and
// booking requests to decide — each a door to the list that holds it.
//
// Pure: no React. "Now" and the time zone are passed in.

import { dayKey } from "@/lib/meetings/workspace";

export interface TodayMeeting {
  scheduled_at: string | null;
  duration_minutes?: number | null;
  status?: string | null;
  is_draft?: boolean | null;
}

export interface TodaySummary {
  /** Meetings today that have not ended yet, the live one included. */
  remaining: number;
  /** Minutes those meetings still take from now. */
  minutesLeft: number;
  /** Today's meetings already over. */
  done: number;
  /** Items on the "Needs you" list, by kind. */
  prep: number;
  followUps: number;
  requests: number;
}

/**
 * The day so far and still to come, plus what is owed.
 *
 * A meeting under way counts as remaining for the minutes it has left. Drafts
 * are not on anybody's calendar yet and are left out.
 */
export function todaySummary(
  meetings: readonly TodayMeeting[],
  owed: { prep: number; followUps: number; requests: number },
  now: number,
  timeZone?: string,
): TodaySummary {
  const today = dayKey(now, timeZone);
  let remaining = 0;
  let minutesLeft = 0;
  let done = 0;
  for (const m of meetings) {
    if (m.is_draft || !m.scheduled_at) continue;
    const start = new Date(m.scheduled_at).getTime();
    if (!Number.isFinite(start) || dayKey(start, timeZone) !== today) continue;
    const end = start + (m.duration_minutes && m.duration_minutes > 0 ? m.duration_minutes : 60) * 60_000;
    if (m.status === "ended" || end <= now) {
      done += 1;
      continue;
    }
    remaining += 1;
    minutesLeft += Math.round((end - Math.max(start, now)) / 60_000);
  }
  return { remaining, minutesLeft, done, ...owed };
}

/** "2h 30m", "45m". */
export function minutesLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  return h ? `${h}h` : `${m}m`;
}

export type TodayChipTarget = "today" | "needs" | "requests";

export interface TodayChip {
  label: string;
  target: TodayChipTarget;
  tone: "neutral" | "warning" | "info";
}

/** The summary as chips, each saying where it leads; owed items only when there are some. */
export function todayChips(s: TodaySummary): TodayChip[] {
  const chips: TodayChip[] = [];
  if (s.remaining > 0) {
    chips.push({
      label: `${s.remaining} more today · ${minutesLabel(s.minutesLeft)}`,
      target: "today",
      tone: "neutral",
    });
  } else {
    chips.push({ label: s.done > 0 ? "No more meetings today" : "Nothing scheduled today", target: "today", tone: "neutral" });
  }
  if (s.requests > 0) {
    chips.push({ label: `${s.requests} booking request${s.requests === 1 ? "" : "s"}`, target: "requests", tone: "warning" });
  }
  if (s.prep > 0) chips.push({ label: `${s.prep} need${s.prep === 1 ? "s" : ""} prep`, target: "needs", tone: "warning" });
  if (s.followUps > 0) {
    chips.push({ label: `${s.followUps} follow-up${s.followUps === 1 ? "" : "s"} to send`, target: "needs", tone: "info" });
  }
  return chips;
}

/** Whether the up-next meeting is close enough to keep a Join button in a phone's thumb reach. */
export const STICKY_JOIN_MINUTES = 10;
export function wantsStickyJoin(live: boolean, scheduledAt: string | null, now: number): boolean {
  if (live) return true;
  if (!scheduledAt) return false;
  const until = new Date(scheduledAt).getTime() - now;
  return until <= STICKY_JOIN_MINUTES * 60_000;
}
