import { adviseReminder, reminderLabel, type ReminderContext } from "./reminder-advice";

// Wed 7 Oct 2026, 08:00 UTC.
const NOW = new Date("2026-10-07T08:00:00Z");

function ctx(over: Partial<ReminderContext> = {}): ReminderContext {
  return {
    meetingType: "internal_strategy",
    // Fri 9 Oct, 15:00 UTC — two days out, mid-afternoon.
    startIso: "2026-10-09T15:00:00Z",
    durationMinutes: 30,
    timezone: "UTC",
    guestCount: 2,
    externalCount: 0,
    offHoursGuests: 0,
    repeating: false,
    hasPrep: false,
    now: NOW,
    ...over,
  };
}

describe("adviseReminder", () => {
  it("gives a routine internal meeting a short nudge", () => {
    const a = adviseReminder(ctx());
    expect(a.minutes).toBe(15);
    expect(a.cautions.join(" ")).toMatch(/hourly sweep/);
  });

  it("sends board, LP and diligence meetings the day before", () => {
    for (const meetingType of ["board_meeting", "lp_review", "diligence"]) {
      expect(adviseReminder(ctx({ meetingType })).minutes).toBe(1440);
    }
  });

  it("gives meetings with outside guests a couple of hours' notice", () => {
    const a = adviseReminder(ctx({ guestCount: 3, externalCount: 2 }));
    expect(a.minutes).toBe(120);
    expect(a.reasons[0]).toMatch(/Outside guests/);
  });

  it("moves to the day before when people need to prepare", () => {
    expect(adviseReminder(ctx({ hasPrep: true })).minutes).toBe(1440);
    expect(adviseReminder(ctx({ needsPrep: true })).minutes).toBe(1440);
    expect(adviseReminder(ctx({ meetingType: "board_meeting", needsPrep: false, stakes: "routine" })).minutes).toBe(15);
  });

  it("honours the host's stakes over the inferred one", () => {
    expect(adviseReminder(ctx({ stakes: "critical" })).minutes).toBe(1440);
  });

  it("gives a long meeting at least an hour", () => {
    expect(adviseReminder(ctx({ durationMinutes: 150 })).minutes).toBe(60);
  });

  it("gives a big guest list more notice", () => {
    expect(adviseReminder(ctx({ guestCount: 10 })).minutes).toBe(30);
  });

  it("goes the day before for guests asked outside their working hours", () => {
    const a = adviseReminder(ctx({ offHoursGuests: 1 }));
    expect(a.minutes).toBe(1440);
    expect(a.reasons.join(" ")).toMatch(/outside working hours/);
  });

  it("keeps a series short, since it is already in everyone's calendar", () => {
    expect(adviseReminder(ctx({ meetingType: "board_meeting", repeating: true })).minutes).toBe(60);
  });

  it("only reminds the host when nobody else is invited", () => {
    const a = adviseReminder(ctx({ guestCount: 0, meetingType: "board_meeting" }));
    expect(a.minutes).toBe(15);
    expect(a.cautions.join(" ")).toMatch(/Add guests/);
  });

  it("recommends none for a meeting that is about to start or already has", () => {
    expect(adviseReminder(ctx({ startIso: "2026-10-07T08:10:00Z" })).minutes).toBeNull();
    expect(adviseReminder(ctx({ startIso: "2026-10-07T07:00:00Z" })).minutes).toBeNull();
  });

  it("shortens a lead that has already passed", () => {
    // Board meeting 5 hours away: a day before is gone; 2 hours fits.
    const a = adviseReminder(ctx({ meetingType: "board_meeting", startIso: "2026-10-07T13:00:00Z" }));
    expect(a.minutes).toBe(120);
    expect(a.reasons.join(" ")).toMatch(/shortened to fit/);
  });

  it("sends the day before for a start earlier than 9am", () => {
    const a = adviseReminder(ctx({ startIso: "2026-10-09T07:30:00Z" }));
    expect(a.minutes).toBe(1440);
    expect(a.reasons.join(" ")).toMatch(/before 9am/);
  });

  it("avoids a Sunday email for a Monday meeting that needs no prep", () => {
    // Mon 12 Oct 10:00, an external call: would be 120 anyway; use critical.
    const a = adviseReminder(ctx({ startIso: "2026-10-12T10:00:00Z", stakes: "critical", needsPrep: false }));
    expect(a.minutes).toBe(120);
    expect(a.cautions.join(" ")).toMatch(/Sunday/);
  });

  it("keeps the day-before for a Monday meeting that needs prep, and says so", () => {
    const a = adviseReminder(ctx({ startIso: "2026-10-12T10:00:00Z", meetingType: "board_meeting" }));
    expect(a.minutes).toBe(1440);
    expect(a.cautions.join(" ")).toMatch(/Sunday/);
  });

  it("says when there is no start yet instead of guessing at timing", () => {
    const a = adviseReminder(ctx({ startIso: null }));
    expect(a.minutes).toBe(15);
    expect(a.cautions.join(" ")).toMatch(/no start time/);
  });

  it("warns that a meeting beyond two weeks sends nothing yet", () => {
    const a = adviseReminder(ctx({ startIso: "2026-11-20T15:00:00Z", meetingType: "board_meeting" }));
    expect(a.cautions.join(" ")).toMatch(/two weeks/);
  });

  it("never offers an alternative that has already passed or the pick itself", () => {
    const a = adviseReminder(ctx({ meetingType: "board_meeting", startIso: "2026-10-07T13:00:00Z" }));
    expect(a.alternatives.map((x) => x.minutes)).not.toContain(1440);
    expect(a.alternatives.map((x) => x.minutes)).not.toContain(a.minutes);
  });
});

describe("reminderLabel", () => {
  it("names the standard leads and the absence of one", () => {
    expect(reminderLabel(1440)).toBe("1 day before");
    expect(reminderLabel(null)).toBe("No reminder");
    expect(reminderLabel(45)).toBe("45 minutes before");
  });
});
