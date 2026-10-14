import { copyInitialFrom } from "./MeetingsCalendar";
import type { DayAgendaItem } from "@/lib/meetings/day-agenda";

const base = { kind: "meeting", key: "m:1", id: "1", title: "x", startMin: 0, endMin: 30, timeLabel: "", allDay: false, startsEarlierDay: false, continuesNextDay: false } as const;

describe("copyInitialFrom — New meeting from the open meeting", () => {
  it("keeps guests and settings, drops identity and time", () => {
    const meeting = {
      id: "m1", title: "30 Minute Meeting with Thomas", scheduled_at: "2026-10-09T15:15:00.000Z", duration_minutes: 30,
      meeting_type: "external_call", agenda: "Intro", meeting_url: "https://zoom.example/j/1", location: "Zoom", tags: ["lp"], series_id: "s1", series_rule: "FREQ=WEEKLY;COUNT=3",
      attendees: [{ name: "Thomas", email: "t@x.com", type: "external" }],
    } as never;
    const out = copyInitialFrom({ ...base, meeting } as unknown as DayAgendaItem)!;
    expect(out).toMatchObject({ title: "30 Minute Meeting with Thomas", durationMinutes: 30, agenda: "Intro", blankTime: true });
    expect(out.attendees).toEqual([{ name: "Thomas", email: "t@x.com", type: "external" }]);
    expect(out.meetingId).toBeUndefined();
    expect(out.seriesId).toBeUndefined();
    expect(out.seriesRule).toBeUndefined();
    expect(out.meetingUrl).toBeUndefined();
    expect(out.location).toBeUndefined();
    expect(out.tags).toBeUndefined();
  });

  it("copies title and length from a connected-calendar event", () => {
    const event = { id: "e", calendarId: "c", title: "Intro", location: "Zoom", link: null, startsAt: "2026-10-09T15:00:00Z", endsAt: "2026-10-09T15:45:00Z", isAllDay: false, isBusy: true };
    expect(copyInitialFrom({ ...base, kind: "event", event } as unknown as DayAgendaItem)).toMatchObject({ title: "Intro", durationMinutes: 45, blankTime: true });
  });

  it("is null for a block", () => {
    expect(copyInitialFrom({ ...base, kind: "block" } as unknown as DayAgendaItem)).toBeNull();
  });
});
