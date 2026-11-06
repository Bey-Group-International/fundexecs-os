import { minutesLabel, todayChips, todaySummary, wantsStickyJoin } from "./lobby-today";

const NOW = new Date("2026-11-06T14:00:00Z").getTime();
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 6, h, m)).toISOString();
const none = { prep: 0, followUps: 0, requests: 0 };

describe("todaySummary", () => {
  it("counts what is left, what it takes, and what is done", () => {
    const s = todaySummary(
      [
        { scheduled_at: at(9), duration_minutes: 60 }, // done
        { scheduled_at: at(13, 30), duration_minutes: 60 }, // live, 30m left
        { scheduled_at: at(16), duration_minutes: 45 },
        { scheduled_at: at(16), duration_minutes: 30, is_draft: true },
        { scheduled_at: "2026-11-07T10:00:00Z", duration_minutes: 60 },
        { scheduled_at: at(15), duration_minutes: 30, status: "ended" },
      ],
      { prep: 1, followUps: 2, requests: 3 },
      NOW,
      "UTC",
    );
    expect(s).toEqual({ remaining: 2, minutesLeft: 75, done: 2, prep: 1, followUps: 2, requests: 3 });
  });
});

describe("todayChips", () => {
  it("leads with the day and adds only what is owed", () => {
    expect(todayChips({ remaining: 2, minutesLeft: 75, done: 0, ...none }).map((c) => c.label)).toEqual(["2 more today · 1h 15m"]);
    const chips = todayChips({ remaining: 0, minutesLeft: 0, done: 3, prep: 1, followUps: 2, requests: 1 });
    expect(chips.map((c) => [c.label, c.target])).toEqual([
      ["No more meetings today", "today"],
      ["1 booking request", "requests"],
      ["1 needs prep", "needs"],
      ["2 follow-ups to send", "needs"],
    ]);
    expect(todayChips({ remaining: 0, minutesLeft: 0, done: 0, ...none })[0].label).toBe("Nothing scheduled today");
  });

  it("labels minutes", () => {
    expect(minutesLabel(45)).toBe("45m");
    expect(minutesLabel(120)).toBe("2h");
  });
});

describe("wantsStickyJoin", () => {
  it("keeps Join in reach when live or within ten minutes", () => {
    expect(wantsStickyJoin(true, null, NOW)).toBe(true);
    expect(wantsStickyJoin(false, at(14, 9), NOW)).toBe(true);
    expect(wantsStickyJoin(false, at(14, 30), NOW)).toBe(false);
    expect(wantsStickyJoin(false, null, NOW)).toBe(false);
  });
});
