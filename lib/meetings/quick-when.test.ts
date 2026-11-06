import { describeQuickWhen, parseQuickWhen } from "./quick-when";

// Friday 6 November 2026, 10:00 in UTC.
const NOW = new Date("2026-11-06T10:00:00Z");
const q = (text: string, tz = "UTC") => parseQuickWhen(text, NOW, tz);

describe("parseQuickWhen", () => {
  it("reads a day, a time and a length in any order", () => {
    expect(q("tue 3pm 30m")).toEqual({ date: "2026-11-10", time: "15:00", minutes: 30 });
    expect(q("for 1h tomorrow at 9:30")).toEqual({ date: "2026-11-07", time: "09:30", minutes: 60 });
    expect(q("1.5h nov 12 noon")).toEqual({ date: "2026-11-12", time: "12:00", minutes: 90 });
    expect(q("1h30 wednesday 2:15pm")).toEqual({ date: "2026-11-11", time: "14:15", minutes: 90 });
  });

  it("puts a time with no day today if still to come, else tomorrow", () => {
    expect(q("4pm")).toEqual({ date: "2026-11-06", time: "16:00", minutes: null });
    expect(q("9am")).toEqual({ date: "2026-11-07", time: "09:00", minutes: null });
  });

  it("reads 'today' in the meeting's own zone", () => {
    // 10:00Z on the 6th is already the 7th on Kiritimati (UTC+14).
    expect(q("today", "Pacific/Kiritimati")?.date).toBe("2026-11-07");
  });

  it("takes this weekday's next occurrence, and a week on for the same day", () => {
    expect(q("fri")?.date).toBe("2026-11-13");
    expect(q("mon")?.date).toBe("2026-11-09");
    expect(q("next mon")?.date).toBe("2026-11-09");
    // Saturday is still to come this week, so "next sat" is the one after.
    expect(q("next sat")?.date).toBe("2026-11-14");
  });

  it("rolls a date already gone into next year, and refuses one that does not exist", () => {
    expect(q("jan 3")?.date).toBe("2027-01-03");
    expect(q("3rd december")?.date).toBe("2026-12-03");
    expect(q("feb 31")).toBeNull();
  });

  it("reads a bare 'at 3' as the afternoon, and 12am/12pm properly", () => {
    expect(q("at 3")?.time).toBe("15:00");
    expect(q("12am")?.time).toBe("00:00");
    expect(q("12pm")?.time).toBe("12:00");
  });

  it("refuses rather than half-reading", () => {
    expect(q("")).toBeNull();
    expect(q("lunch with priya")).toBeNull();
    expect(q("tue 3pm sharp")).toBeNull();
    expect(q("25:00")).toBeNull();
    expect(q("2m")).toBeNull();
  });
});

describe("describeQuickWhen", () => {
  it("says back what was understood", () => {
    expect(describeQuickWhen({ date: "2026-11-10", time: "15:00", minutes: 90 })).toBe("Tue, Nov 10 · 3:00 PM · 1h 30m");
    expect(describeQuickWhen({ date: null, time: null, minutes: 30 })).toBe("30 min");
  });
});
