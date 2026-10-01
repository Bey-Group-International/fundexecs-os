import {
  describeRepeat,
  occurrenceDates,
  parseRepeat,
  pickSeriesOccurrence,
  ruleFromRrule,
  seriesRrule,
} from "./recurrence";

describe("parseRepeat", () => {
  it("reads a weekly or monthly series", () => {
    expect(parseRepeat({ freq: "weekly", count: 12 })).toEqual({ freq: "weekly", count: 12 });
    expect(parseRepeat({ freq: "monthly", count: "6" })).toEqual({ freq: "monthly", count: 6 });
  });
  it("is null for a meeting that does not repeat", () => {
    expect(parseRepeat(undefined)).toBeNull();
    expect(parseRepeat(null)).toBeNull();
  });
  it("refuses what it cannot be sure of", () => {
    expect(parseRepeat({ freq: "daily", count: 5 })).toHaveProperty("error");
    expect(parseRepeat({ freq: "weekly", count: 1 })).toHaveProperty("error");
    expect(parseRepeat({ freq: "weekly", count: 53 })).toHaveProperty("error");
    expect(parseRepeat({ freq: "weekly", count: 2.5 })).toHaveProperty("error");
    expect(parseRepeat("weekly")).toHaveProperty("error");
  });
});

describe("occurrenceDates", () => {
  it("steps a week at a time", () => {
    expect(occurrenceDates("2026-10-06", { freq: "weekly", count: 3 })).toEqual([
      "2026-10-06",
      "2026-10-13",
      "2026-10-20",
    ]);
  });
  it("crosses a year", () => {
    expect(occurrenceDates("2026-12-29", { freq: "weekly", count: 2 })).toEqual(["2026-12-29", "2027-01-05"]);
  });
  it("keeps the day of the month, skipping months without it as RRULE does", () => {
    expect(occurrenceDates("2026-01-31", { freq: "monthly", count: 4 })).toEqual([
      "2026-01-31",
      "2026-03-31",
      "2026-05-31",
      "2026-07-31",
    ]);
    expect(occurrenceDates("2026-11-15", { freq: "monthly", count: 3 })).toEqual([
      "2026-11-15",
      "2026-12-15",
      "2027-01-15",
    ]);
  });
});

describe("the rule guests receive", () => {
  it("matches the dates made here, and reads back", () => {
    expect(seriesRrule({ freq: "weekly", count: 12 })).toBe("FREQ=WEEKLY;COUNT=12");
    expect(seriesRrule({ freq: "monthly", count: 6 })).toBe("FREQ=MONTHLY;COUNT=6");
    expect(ruleFromRrule("FREQ=MONTHLY;COUNT=6")).toEqual({ freq: "monthly", count: 6 });
    expect(ruleFromRrule(null)).toBeNull();
  });
  it("describes itself in the meeting's zone", () => {
    // 15:00Z on a Tuesday is 10:00 AM in Chicago.
    expect(describeRepeat({ freq: "weekly", count: 12 }, "2026-10-06T15:00:00.000Z", "America/Chicago")).toBe(
      "Weekly on Tuesday at 10:00 AM CDT, 12 times",
    );
    expect(describeRepeat({ freq: "monthly", count: 6 }, "2026-10-22T15:00:00.000Z", "America/Chicago")).toMatch(
      /^Monthly on the 22nd at 10:00 AM CDT, 6 times$/,
    );
  });
});

describe("pickSeriesOccurrence", () => {
  const row = (code: string, iso: string) => ({ room_code: code, scheduled_at: iso, duration_minutes: 60 });
  const rows = [row("a", "2026-10-06T15:00:00Z"), row("b", "2026-10-13T15:00:00Z"), row("c", "2026-10-20T15:00:00Z")];

  it("opens the meeting on now, or the next one", () => {
    expect(pickSeriesOccurrence(rows, Date.parse("2026-10-06T15:30:00Z"))).toBe("a");
    expect(pickSeriesOccurrence(rows, Date.parse("2026-10-07T00:00:00Z"))).toBe("b");
  });
  it("opens the last one once the series is over, and nothing for an empty series", () => {
    expect(pickSeriesOccurrence(rows, Date.parse("2027-01-01T00:00:00Z"))).toBe("c");
    expect(pickSeriesOccurrence([], Date.now())).toBeNull();
  });
});
