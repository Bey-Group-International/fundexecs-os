import { buildDayAgenda, summarizeDayAgenda, ALL_DAY_MIN } from "./day-agenda";
import type { CalendarBlock, CalendarMeeting } from "./calendar";
import type { ExternalEvent } from "../calendar/layers";

function mkMeeting(over: Partial<CalendarMeeting> = {}): CalendarMeeting {
  return {
    id: over.id ?? "m1",
    room_code: "abc",
    title: "T",
    status: "waiting",
    host_id: "u1",
    created_at: "2026-01-01T00:00:00.000Z",
    started_at: null,
    ended_at: null,
    scheduled_at: null,
    duration_minutes: 60,
    timezone: null,
    meeting_type: "deal_review",
    attendees: null,
    preparation_status: null,
    followup_status: null,
    assigned_copilot_agent: null,
    is_draft: false,
    locked_at: null,
    updated_at: null,
    description: null,
    location: null,
    meeting_url: null,
    objective: null,
    agenda: null,
    preparation_requirements: null,
    related_record_type: null,
    related_record_id: null,
    calendar_visibility: null,
    reminder_minutes: null,
    priority: null,
    tags: null,
    external_calendar_provider: null,
    external_calendar_sync_enabled: null,
    external_calendar_sync_status: null,
    ...over,
  };
}

function mkEvent(over: Partial<ExternalEvent> = {}): ExternalEvent {
  return {
    id: over.id ?? "e1",
    calendarId: "cal1",
    title: "External",
    location: null,
    link: null,
    startsAt: localIso(2026, 9, 17, 11, 0),
    endsAt: localIso(2026, 9, 17, 12, 0),
    isAllDay: false,
    isBusy: true,
    ...over,
  };
}

// Local-time ISO, so day bucketing is deterministic in any runner zone.
function localIso(y: number, mo: number, d: number, h = 0, mi = 0): string {
  return new Date(y, mo - 1, d, h, mi).toISOString();
}

const DAY = new Date(2026, 8, 17); // Sep 17 2026, local

describe("buildDayAgenda", () => {
  it("groups the three kinds into their own sections, in reading order", () => {
    const agenda = buildDayAgenda(DAY, {
      meetings: [mkMeeting({ id: "m1", title: "IC", scheduled_at: localIso(2026, 9, 17, 9, 0) })],
      blocks: [{ id: "b1", title: "Focus", startsAt: localIso(2026, 9, 17, 13, 0), endsAt: localIso(2026, 9, 17, 14, 0) }],
      externalEvents: [mkEvent({ id: "e1" })],
    });

    expect(agenda.sections.map((s) => s.kind)).toEqual(["meeting", "block", "external"]);
    expect(agenda.total).toBe(3);
  });

  it("drops empty sections rather than rendering a zero count", () => {
    const agenda = buildDayAgenda(DAY, {
      meetings: [mkMeeting({ scheduled_at: localIso(2026, 9, 17, 9, 0) })],
      blocks: [],
      externalEvents: [],
    });
    expect(agenda.sections).toHaveLength(1);
    expect(agenda.sections[0].kind).toBe("meeting");
  });

  it("is empty for a day with nothing on it", () => {
    const agenda = buildDayAgenda(DAY, { meetings: [], blocks: [], externalEvents: [] });
    expect(agenda.sections).toEqual([]);
    expect(agenda.total).toBe(0);
    expect(summarizeDayAgenda(agenda)).toBe("Nothing scheduled");
  });

  it("excludes meetings, blocks and events belonging to other days", () => {
    const agenda = buildDayAgenda(DAY, {
      meetings: [mkMeeting({ id: "m1", scheduled_at: localIso(2026, 9, 18, 9, 0) })],
      blocks: [{ id: "b1", title: "Other", startsAt: localIso(2026, 9, 19, 9, 0), endsAt: localIso(2026, 9, 19, 10, 0) }],
      externalEvents: [mkEvent({ id: "e1", startsAt: localIso(2026, 9, 16, 9, 0), endsAt: localIso(2026, 9, 16, 10, 0) })],
    });
    expect(agenda.total).toBe(0);
  });

  it("orders each section by start time", () => {
    const agenda = buildDayAgenda(DAY, {
      meetings: [
        mkMeeting({ id: "late", title: "Late", scheduled_at: localIso(2026, 9, 17, 16, 0) }),
        mkMeeting({ id: "early", title: "Early", scheduled_at: localIso(2026, 9, 17, 8, 0) }),
      ],
      blocks: [],
      externalEvents: [],
    });
    expect(agenda.sections[0].items.map((i) => i.id)).toEqual(["early", "late"]);
  });

  it("sorts all-day external events above timed ones", () => {
    const agenda = buildDayAgenda(DAY, {
      meetings: [],
      blocks: [],
      externalEvents: [
        mkEvent({ id: "timed", startsAt: localIso(2026, 9, 17, 9, 0), endsAt: localIso(2026, 9, 17, 10, 0) }),
        mkEvent({
          id: "allday",
          title: "Offsite",
          isAllDay: true,
          startsAt: localIso(2026, 9, 17, 0, 0),
          endsAt: localIso(2026, 9, 18, 0, 0),
        }),
      ],
    });
    const items = agenda.sections[0].items;
    expect(items.map((i) => i.id)).toEqual(["allday", "timed"]);
    expect(items[0].startMin).toBe(ALL_DAY_MIN);
    expect(items[0].timeLabel).toBe("All day");
  });

  it("says 'from earlier' for a block that began the previous day", () => {
    const agenda = buildDayAgenda(DAY, {
      meetings: [],
      blocks: [{ id: "b1", title: "Travel", startsAt: localIso(2026, 9, 16, 18, 0), endsAt: localIso(2026, 9, 17, 9, 0) }],
      externalEvents: [],
    });
    const item = agenda.sections[0].items[0];
    expect(item.timeLabel).toBe("from earlier");
    expect(item.startsEarlierDay).toBe(true);
    expect(item.startMin).toBe(0);
  });

  it("keys items by kind so a meeting and an event sharing an id cannot collide", () => {
    const agenda = buildDayAgenda(DAY, {
      meetings: [mkMeeting({ id: "same", scheduled_at: localIso(2026, 9, 17, 9, 0) })],
      blocks: [],
      externalEvents: [mkEvent({ id: "same" })],
    });
    const keys = agenda.sections.flatMap((s) => s.items.map((i) => i.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("carries the source record on the matching kind only", () => {
    const agenda = buildDayAgenda(DAY, {
      meetings: [mkMeeting({ id: "m1", scheduled_at: localIso(2026, 9, 17, 9, 0) })],
      blocks: [{ id: "b1", title: "Focus", startsAt: localIso(2026, 9, 17, 13, 0), endsAt: localIso(2026, 9, 17, 14, 0) }],
      externalEvents: [mkEvent({ id: "e1" })],
    });
    const [meeting, block, external] = agenda.sections.map((s) => s.items[0]);
    expect(meeting.meeting?.id).toBe("m1");
    expect(meeting.block).toBeUndefined();
    expect(block.block?.id).toBe("b1");
    expect(block.meeting).toBeUndefined();
    expect(external.event?.id).toBe("e1");
    expect(external.meeting).toBeUndefined();
  });
});

describe("summarizeDayAgenda", () => {
  it("counts each kind separately and singularises", () => {
    const agenda = buildDayAgenda(DAY, {
      meetings: [
        mkMeeting({ id: "m1", scheduled_at: localIso(2026, 9, 17, 9, 0) }),
        mkMeeting({ id: "m2", scheduled_at: localIso(2026, 9, 17, 10, 0) }),
      ],
      blocks: [{ id: "b1", title: "Focus", startsAt: localIso(2026, 9, 17, 13, 0), endsAt: localIso(2026, 9, 17, 14, 0) }],
      externalEvents: [],
    });
    expect(summarizeDayAgenda(agenda)).toBe("2 meetings · 1 block");
  });
});
