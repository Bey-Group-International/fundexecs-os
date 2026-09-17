// lib/meetings/day-agenda.ts
// One day of the calendar, resolved into the list a member reads when they
// click that day in the month grid: their own meetings, the time they blocked,
// and whatever their connected calendars say — grouped, ordered, and counted.
//
// Pure on purpose. The month cell can only ever show about three chips, so the
// question "what is actually on this day" is answered here, once, by the same
// rules the grid draws by — not re-derived inline by a component that a browser
// has to run before anyone can check it.

import {
  blocksForDay,
  eventSpanMinutes,
  eventsForDay,
  shortTime,
  type BlockSpan,
  type CalendarBlock,
  type CalendarMeeting,
} from "./calendar";
import {
  allDayEventsForDay,
  eventSpansForDay,
  type ExternalEvent,
} from "../calendar/layers";

/** The three things that can occupy a day. They are never mixed: a block is not
 *  a meeting, and an event someone else owns is not one this app can run. */
export type DayAgendaKind = "meeting" | "block" | "external";

export interface DayAgendaItem {
  kind: DayAgendaKind;
  /** Stable across renders and unique within the day — a meeting and an
   *  external event are free to carry the same underlying id. */
  key: string;
  id: string;
  title: string;
  /** Minutes from this day's midnight. All-day items sit at ALL_DAY_MIN so they
   *  sort above the timed ones rather than pretending to start at 00:00. */
  startMin: number;
  endMin: number;
  /** What the row shows in its time column: "9:30 AM", "All day", "from earlier". */
  timeLabel: string;
  allDay: boolean;
  startsEarlierDay: boolean;
  continuesNextDay: boolean;
  /** Present only on the matching kind, so the renderer never has to guess. */
  meeting?: CalendarMeeting;
  block?: BlockSpan;
  event?: ExternalEvent;
}

export interface DayAgendaSection {
  kind: DayAgendaKind;
  label: string;
  items: DayAgendaItem[];
}

export interface DayAgenda {
  /** Sections carrying at least one item, in reading order. An empty section is
   *  a heading that answers nothing, so it is dropped rather than rendered as
   *  "(0)". */
  sections: DayAgendaSection[];
  total: number;
}

/** Sort key for an all-day item: before midnight, so it heads the list. */
export const ALL_DAY_MIN = -1;

const SECTION_LABELS: Record<DayAgendaKind, string> = {
  meeting: "Meetings",
  block: "Blocked time",
  external: "Connected calendars",
};

/** A block or event that began yesterday says so. Showing "12:00 AM" for
 *  something that started at 6pm the day before is a lie the clipping makes
 *  easy to tell. */
function timeLabelFor(startsAtIso: string, startsEarlierDay: boolean, allDay: boolean): string {
  if (allDay) return "All day";
  if (startsEarlierDay) return "from earlier";
  return shortTime(startsAtIso);
}

function byStart(a: DayAgendaItem, b: DayAgendaItem): number {
  if (a.startMin !== b.startMin) return a.startMin - b.startMin;
  return a.title.localeCompare(b.title);
}

/**
 * Everything on one day, grouped by kind and ordered by start time.
 *
 * `meetings` is expected to be the already-filtered set the grid is drawing —
 * the day list must agree with the cell it opened from, so a filtered-out
 * meeting must not reappear here.
 */
export function buildDayAgenda(
  day: Date,
  input: {
    meetings: CalendarMeeting[];
    blocks: CalendarBlock[];
    externalEvents: ExternalEvent[];
  },
): DayAgenda {
  const meetingItems: DayAgendaItem[] = eventsForDay(input.meetings, day).map((m) => {
    const [startMin, endMin] = eventSpanMinutes(m);
    return {
      kind: "meeting" as const,
      key: `meeting:${m.id}`,
      id: m.id,
      title: m.title,
      startMin,
      endMin,
      timeLabel: m.scheduled_at ? shortTime(m.scheduled_at) : "Time TBD",
      allDay: false,
      startsEarlierDay: false,
      continuesNextDay: false,
      meeting: m,
    };
  });

  const blockItems: DayAgendaItem[] = blocksForDay(input.blocks, day).map((b) => ({
    kind: "block" as const,
    key: `block:${b.id}`,
    id: b.id,
    title: b.title,
    startMin: b.startMin,
    endMin: b.endMin,
    timeLabel: timeLabelFor(b.startsAt, b.startsEarlierDay, false),
    allDay: false,
    startsEarlierDay: b.startsEarlierDay,
    continuesNextDay: b.continuesNextDay,
    block: b,
  }));

  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const timed: DayAgendaItem[] = eventSpansForDay(input.externalEvents, day).map((span) => ({
    kind: "external" as const,
    key: `external:${span.event.id}`,
    id: span.event.id,
    title: span.event.title,
    startMin: span.startMinute,
    endMin: span.endMinute,
    timeLabel: timeLabelFor(
      span.event.startsAt,
      new Date(span.event.startsAt).getTime() < dayStart,
      false,
    ),
    allDay: false,
    startsEarlierDay: new Date(span.event.startsAt).getTime() < dayStart,
    continuesNextDay: new Date(span.event.endsAt).getTime() > dayStart + 24 * 60 * 60_000,
    event: span.event,
  }));

  const allDay: DayAgendaItem[] = allDayEventsForDay(input.externalEvents, day).map((e) => ({
    kind: "external" as const,
    key: `external:${e.id}`,
    id: e.id,
    title: e.title,
    startMin: ALL_DAY_MIN,
    endMin: ALL_DAY_MIN,
    timeLabel: "All day",
    allDay: true,
    startsEarlierDay: false,
    continuesNextDay: false,
    event: e,
  }));

  const sections: DayAgendaSection[] = ([
    { kind: "meeting", label: SECTION_LABELS.meeting, items: meetingItems.sort(byStart) },
    { kind: "block", label: SECTION_LABELS.block, items: blockItems.sort(byStart) },
    { kind: "external", label: SECTION_LABELS.external, items: [...allDay, ...timed].sort(byStart) },
  ] satisfies DayAgendaSection[]).filter((s) => s.items.length > 0);

  return { sections, total: sections.reduce((n, s) => n + s.items.length, 0) };
}

/** A one-line summary for the panel header — "3 meetings · 1 block · 2 events"
 *  beats a bare count, because the three are not interchangeable. */
export function summarizeDayAgenda(agenda: DayAgenda): string {
  if (agenda.total === 0) return "Nothing scheduled";
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return agenda.sections
    .map((s) => {
      const n = s.items.length;
      if (s.kind === "meeting") return plural(n, "meeting", "meetings");
      if (s.kind === "block") return plural(n, "block", "blocks");
      return plural(n, "event", "events");
    })
    .join(" · ");
}
