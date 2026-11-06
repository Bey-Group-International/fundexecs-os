import {
  chipBadge,
  dayInsight,
  formatMinutes,
  freeSlots,
  loadLevel,
  mergeSpans,
  sumInsights,
} from "./calendar-week";

const h = (hours: number) => hours * 60;

describe("mergeSpans", () => {
  it("joins overlapping and touching spans, and clips to the day", () => {
    expect(mergeSpans([[h(10), h(11)], [h(9), h(10)], [h(10.5), h(12)], [h(23), h(25)]])).toEqual([
      [h(9), h(12)],
      [h(23), h(24)],
    ]);
  });
});

describe("freeSlots", () => {
  it("finds the open stretches in the working day", () => {
    expect(freeSlots([[h(10), h(11)], [h(13), h(15)]])).toEqual([
      [h(9), h(10)],
      [h(11), h(13)],
      [h(15), h(18)],
    ]);
  });

  it("drops gaps shorter than a slot and rounds starts to the half hour", () => {
    // 10:10 to 10:25 is too short; free time after 10:40 starts at 11:00.
    expect(freeSlots([[h(9), h(10) + 10], [h(10) + 25, h(10) + 40]], { to: h(12) })).toEqual([[h(11), h(12)]]);
  });

  it("leaves out time already gone", () => {
    expect(freeSlots([], { notBefore: h(16) + 5 })).toEqual([[h(16.5), h(18)]]);
  });

  it("finds nothing in a full day", () => {
    expect(freeSlots([[0, h(24)]])).toEqual([]);
  });
});

describe("dayInsight", () => {
  const m = (start: number, end: number, status = "Scheduled" as const) => ({ span: [start, end] as const, status });

  it("adds up meeting time once, focus time and back-to-back runs", () => {
    const day = dayInsight(
      [m(h(9), h(10)), m(h(10), h(11)), m(h(10.5), h(11.5)), m(h(14), h(15)), m(h(15) + 5, h(16))],
      [[h(12), h(13)]],
    );
    expect(day.meetingMinutes).toBe(h(2.5) + h(1) + 55);
    // Free 11:30-12:00 (too short), 13:00-14:00, 16:00-18:00.
    expect(day.focusMinutes).toBe(h(3));
    expect(day.backToBackRuns).toBe(2);
    expect(day.meetingCount).toBe(5);
  });

  it("counts prep and follow-up still owed", () => {
    const day = dayInsight([
      { span: [h(9), h(10)], status: "Prep Needed" },
      { span: [h(11), h(12)], status: "Follow-Up Needed" },
      { span: [h(13), h(14)], status: "Prep Needed" },
    ]);
    expect([day.prepNeeded, day.followUpNeeded, day.backToBackRuns]).toEqual([2, 1, 0]);
  });

  it("sums days", () => {
    const one = dayInsight([m(h(9), h(10))]);
    expect(sumInsights([one, one]).meetingMinutes).toBe(h(2));
  });
});

describe("labels", () => {
  it("formats minutes and load", () => {
    expect(formatMinutes(210)).toBe("3h 30m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(120)).toBe("2h");
    expect(loadLevel(h(7))).toBe("heavy");
    expect(loadLevel(h(4))).toBe("busy");
    expect(loadLevel(h(1))).toBe("light");
  });

  it("badges only the meetings with work owed", () => {
    expect(chipBadge("Prep Needed")?.label).toBe("Prep");
    expect(chipBadge("Follow-Up Needed")?.label).toBe("Follow-up");
    expect(chipBadge("Ready")).toBeNull();
  });
});
