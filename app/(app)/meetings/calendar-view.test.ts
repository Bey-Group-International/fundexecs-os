import { calendarViewUrl, isGoogleCopyStale, nextSchedulableStart, parseCalendarView } from "./calendar-view";

describe("parseCalendarView", () => {
  it("accepts the two real panes", () => {
    expect(parseCalendarView("calendar")).toBe("calendar");
    expect(parseCalendarView("settings")).toBe("settings");
  });

  // A missing or unrecognised value must read as "closed" — a stale link or a
  // param meant for something else should never drop a member into a
  // full-screen panel they didn't ask for.
  it("treats anything else as closed", () => {
    expect(parseCalendarView(null)).toBeNull();
    expect(parseCalendarView(undefined)).toBeNull();
    expect(parseCalendarView("")).toBeNull();
    expect(parseCalendarView("Calendar")).toBeNull();
    expect(parseCalendarView("grid")).toBeNull();
  });
});

describe("calendarViewUrl", () => {
  it("writes the pane onto the path", () => {
    expect(calendarViewUrl("/meetings", "", "calendar")).toBe("/meetings?view=calendar");
    expect(calendarViewUrl("/meetings", "", "settings")).toBe("/meetings?view=settings");
  });

  it("drops the param entirely when closing", () => {
    expect(calendarViewUrl("/meetings", "view=calendar", null)).toBe("/meetings");
  });

  it("preserves unrelated params in both directions", () => {
    expect(calendarViewUrl("/meetings", "tab=upcoming", "calendar")).toBe("/meetings?tab=upcoming&view=calendar");
    expect(calendarViewUrl("/meetings", "tab=upcoming&view=settings", null)).toBe("/meetings?tab=upcoming");
  });

  it("replaces an existing pane rather than appending a second one", () => {
    expect(calendarViewUrl("/meetings", "view=calendar", "settings")).toBe("/meetings?view=settings");
  });

  it("accepts a URLSearchParams as well as a string", () => {
    expect(calendarViewUrl("/meetings", new URLSearchParams("tab=upcoming"), "calendar")).toBe(
      "/meetings?tab=upcoming&view=calendar",
    );
  });
});

describe("nextSchedulableStart", () => {
  const at = (h: number, m: number, sec = 0) => new Date(2026, 8, 16, h, m, sec);
  const hm = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;

  it("lands on the next :00 or :30 at least half an hour away", () => {
    expect(hm(nextSchedulableStart(at(9, 0)))).toBe("9:30");
    expect(hm(nextSchedulableStart(at(9, 7)))).toBe("10:00");
    expect(hm(nextSchedulableStart(at(9, 31, 20)))).toBe("10:30");
    expect(hm(nextSchedulableStart(at(23, 45)))).toBe("0:30");
  });
});

describe("isGoogleCopyStale", () => {
  const now = Date.UTC(2026, 8, 30, 12, 0);
  it("is stale past ten minutes, or never synced", () => {
    expect(isGoogleCopyStale(true, new Date(now - 11 * 60_000).toISOString(), now)).toBe(true);
    expect(isGoogleCopyStale(true, null, now)).toBe(true);
    expect(isGoogleCopyStale(true, "garbage", now)).toBe(true);
  });
  it("is fresh within ten minutes, and never stale without a connection", () => {
    expect(isGoogleCopyStale(true, new Date(now - 9 * 60_000).toISOString(), now)).toBe(false);
    expect(isGoogleCopyStale(false, null, now)).toBe(false);
  });
});
