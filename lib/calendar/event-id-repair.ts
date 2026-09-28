// lib/calendar/event-id-repair.ts
// Reattaching calendar events to the meetings they belong to.
//
// For as long as recordSync wrote a provider the check constraint rejected,
// every sync did half its job: the event went onto the host's Google Calendar
// and the UPDATE that was supposed to record its id was thrown out by Postgres.
// Those meetings have a real, correct event on a real calendar and a row that
// does not know it exists.
//
// THE OBVIOUS REPAIR IS THE WRONG ONE. "Just push them again" looks right and
// would email a lot of people: every write in google-write.server.ts goes out
// with `sendUpdates: "all"`, which is Google's instruction to notify every
// attendee. Re-pushing a backlog would send an "event updated" notice to every
// guest of every affected meeting, for a change none of them made and none of
// them would understand. A repair that spams the people it is repairing for is
// not a repair.
//
// So nothing here writes to a calendar. The event is already right; only the row
// is wrong. `findEventByMarker` can find it by the private marker the app stamps
// on everything it creates, which is a READ, and the id it returns is the one
// missing fact. That marker exists because a previous change anticipated exactly
// this failure — an event written whose id was never stored — and it is the
// reason this is a lookup rather than a rewrite.
//
// A meeting with no event at all is left alone. Creating one WOULD be the right
// thing eventually, and it would also notify, so it is somebody's decision
// rather than a sweep's.

/** The row shape this repair needs, and nothing more. */
export interface RepairableMeeting {
  id: string;
  host_id: string | null;
  external_calendar_sync_enabled: boolean | null;
  external_calendar_event_id: string | null;
  deleted_at: string | null;
  is_draft: boolean | null;
}

/**
 * Whether this meeting is one whose event id went missing.
 *
 * Sync on, no event id, and a real meeting. A draft was never pushed, and a
 * deleted meeting's event has its own removal path — neither is a row that lost
 * something.
 *
 * A meeting with no host cannot be repaired at all: the event lives on somebody's
 * personal calendar, and without knowing whose there is no calendar to look in.
 */
export function needsEventId(meeting: RepairableMeeting): boolean {
  if (meeting.external_calendar_sync_enabled !== true) return false;
  if (meeting.external_calendar_event_id) return false;
  if (meeting.deleted_at) return false;
  if (meeting.is_draft === true) return false;
  return typeof meeting.host_id === "string" && meeting.host_id.length > 0;
}

/**
 * The work grouped by whose calendar it is on.
 *
 * One host's meetings share one connection, one token and one calendar lookup,
 * so grouping turns a per-meeting cost into a per-host one. It also means a host
 * who has since disconnected their calendar is discovered once rather than once
 * per meeting.
 *
 * Insertion order is preserved, so a caller that selected newest-first repairs
 * newest-first.
 */
export function byHost(meetings: readonly RepairableMeeting[]): Map<string, RepairableMeeting[]> {
  const out = new Map<string, RepairableMeeting[]>();
  for (const meeting of meetings) {
    if (!needsEventId(meeting)) continue;
    const host = meeting.host_id as string;
    const list = out.get(host);
    if (list) list.push(meeting);
    else out.set(host, [meeting]);
  }
  return out;
}

/** What happened to one meeting. */
export type RepairOutcome =
  /** The event was found and its id is now on the row. */
  | "reattached"
  /** No event carries this meeting's marker, so there is nothing to reattach. */
  | "noEvent"
  /** The host has no writable calendar connected — nowhere to look. */
  | "noCalendar"
  /** The lookup or the write failed. Counted, and taken again next sweep. */
  | "failed";

export interface RepairStats {
  /** Meetings considered this sweep. */
  examined: number;
  reattached: number;
  noEvent: number;
  noCalendar: number;
  failed: number;
  /** Whether the bound cut the work short, so a backlog remains. */
  more: boolean;
}

export const NO_REPAIRS: RepairStats = {
  examined: 0,
  reattached: 0,
  noEvent: 0,
  noCalendar: 0,
  failed: 0,
  more: false,
};

/** Count one outcome. Returns a new object; the caller keeps a running total. */
export function countOutcome(stats: RepairStats, outcome: RepairOutcome): RepairStats {
  return {
    ...stats,
    examined: stats.examined + 1,
    reattached: stats.reattached + (outcome === "reattached" ? 1 : 0),
    noEvent: stats.noEvent + (outcome === "noEvent" ? 1 : 0),
    noCalendar: stats.noCalendar + (outcome === "noCalendar" ? 1 : 0),
    failed: stats.failed + (outcome === "failed" ? 1 : 0),
  };
}

/**
 * Whether this sweep did anything worth logging.
 *
 * An hourly job that reports "0 of 0" every hour for the rest of the product's
 * life trains everybody to ignore its output, which is how the next real number
 * goes unread.
 */
export function worthReporting(stats: RepairStats): boolean {
  return stats.examined > 0;
}

/** One line for the cron log. */
export function summarize(stats: RepairStats): string {
  const parts = [`${stats.reattached} reattached`];
  if (stats.noEvent > 0) parts.push(`${stats.noEvent} with no event`);
  if (stats.noCalendar > 0) parts.push(`${stats.noCalendar} with no calendar`);
  if (stats.failed > 0) parts.push(`${stats.failed} failed`);
  const tail = stats.more ? "; more remain" : "";
  return `${parts.join(", ")} of ${stats.examined} examined${tail}`;
}
