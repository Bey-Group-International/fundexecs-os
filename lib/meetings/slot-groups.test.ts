import { earliestSlot, hourInTimezone, partOfDay, slotsByPartOfDay } from "./slot-groups";

const s = (start: string) => ({ start, end: start });

describe("partOfDay", () => {
  it("reads the hour on the viewer's clock, not UTC's", () => {
    // 15:00Z is 11:00 in New York (EDT) and 23:00 in Singapore.
    expect(partOfDay("2026-10-05T15:00:00Z", "America/New_York")).toBe("morning");
    expect(partOfDay("2026-10-05T15:00:00Z", "UTC")).toBe("afternoon");
    expect(partOfDay("2026-10-05T15:00:00Z", "Asia/Singapore")).toBe("evening");
  });

  it("puts noon in the afternoon and 5pm in the evening", () => {
    expect(partOfDay("2026-10-05T12:00:00Z", "UTC")).toBe("afternoon");
    expect(partOfDay("2026-10-05T17:00:00Z", "UTC")).toBe("evening");
  });

  it("falls back to UTC for a zone it does not know", () => {
    expect(hourInTimezone("2026-10-05T07:00:00Z", "Mars/Base")).toBe(7);
  });

  it("reads midnight as hour 0", () => {
    expect(hourInTimezone("2026-10-05T00:30:00Z", "UTC")).toBe(0);
  });
});

describe("slotsByPartOfDay", () => {
  it("keeps order and leaves out empty parts", () => {
    const groups = slotsByPartOfDay([s("2026-10-05T09:00:00Z"), s("2026-10-05T10:00:00Z"), s("2026-10-05T18:00:00Z")], "UTC");
    expect(groups.map((g) => [g.part, g.slots.length])).toEqual([
      ["morning", 2],
      ["evening", 1],
    ]);
  });
});

describe("earliestSlot", () => {
  it("finds the first start whatever order they come in", () => {
    expect(earliestSlot([s("2026-10-06T09:00:00Z"), s("2026-10-05T18:00:00Z")])?.start).toBe("2026-10-05T18:00:00Z");
    expect(earliestSlot([])).toBeNull();
  });
});
