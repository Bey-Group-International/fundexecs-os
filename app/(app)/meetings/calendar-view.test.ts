import { calendarViewUrl, parseCalendarView } from "./calendar-view";

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
