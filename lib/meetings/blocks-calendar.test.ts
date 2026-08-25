// How blocked time lands on the calendar grid: a block is clipped to each day
// it touches, so one crossing midnight renders correctly on both.
import { blocksForDay, type CalendarBlock } from "./calendar";

/** A local-time ISO instant, so the assertions don't depend on the test TZ. */
function local(y: number, m: number, d: number, h: number, min = 0): string {
  return new Date(y, m - 1, d, h, min).toISOString();
}

describe("blocksForDay", () => {
  it("places a same-day block at its minute offsets", () => {
    const b: CalendarBlock = { id: "b1", title: "Flight", startsAt: local(2026, 9, 1, 14), endsAt: local(2026, 9, 1, 18) };
    const [span] = blocksForDay([b], new Date(2026, 8, 1));
    expect(span).toMatchObject({
      id: "b1",
      startMin: 14 * 60,
      endMin: 18 * 60,
      continuesNextDay: false,
      startsEarlierDay: false,
    });
  });

  it("clips a block that runs past midnight onto both days", () => {
    const b: CalendarBlock = { id: "b1", title: "Redeye", startsAt: local(2026, 9, 1, 22), endsAt: local(2026, 9, 2, 6) };

    const [first] = blocksForDay([b], new Date(2026, 8, 1));
    expect(first).toMatchObject({ startMin: 22 * 60, endMin: 24 * 60, continuesNextDay: true, startsEarlierDay: false });

    const [second] = blocksForDay([b], new Date(2026, 8, 2));
    // Without clipping this would render at a negative offset.
    expect(second).toMatchObject({ startMin: 0, endMin: 6 * 60, continuesNextDay: false, startsEarlierDay: true });
  });

  it("excludes a block on a neighbouring day", () => {
    const b: CalendarBlock = { id: "b1", title: "Flight", startsAt: local(2026, 9, 1, 14), endsAt: local(2026, 9, 1, 18) };
    expect(blocksForDay([b], new Date(2026, 8, 2))).toEqual([]);
    expect(blocksForDay([b], new Date(2026, 7, 31))).toEqual([]);
  });

  it("treats a block ending exactly at midnight as belonging to the earlier day only", () => {
    const b: CalendarBlock = { id: "b1", title: "Evening", startsAt: local(2026, 9, 1, 20), endsAt: local(2026, 9, 2, 0) };
    expect(blocksForDay([b], new Date(2026, 8, 1))).toHaveLength(1);
    expect(blocksForDay([b], new Date(2026, 8, 2))).toEqual([]);
  });

  it("sorts a day's blocks by start", () => {
    const late: CalendarBlock = { id: "late", title: "PM", startsAt: local(2026, 9, 1, 16), endsAt: local(2026, 9, 1, 17) };
    const early: CalendarBlock = { id: "early", title: "AM", startsAt: local(2026, 9, 1, 9), endsAt: local(2026, 9, 1, 10) };
    expect(blocksForDay([late, early], new Date(2026, 8, 1)).map((b) => b.id)).toEqual(["early", "late"]);
  });

  it("drops rows that cannot be rendered rather than throwing", () => {
    const bad: CalendarBlock[] = [
      { id: "x", title: "junk", startsAt: "nope", endsAt: local(2026, 9, 1, 18) },
      { id: "y", title: "inverted", startsAt: local(2026, 9, 1, 18), endsAt: local(2026, 9, 1, 14) },
    ];
    expect(blocksForDay(bad, new Date(2026, 8, 1))).toEqual([]);
  });
});
