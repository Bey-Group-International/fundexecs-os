import { relativeTime, FLOOR_ACTIVITY_META, type FloorActivityKind } from "./floor-activity";

describe("relativeTime", () => {
  const now = 1_000_000_000_000;

  it("shows 'now' within the first few seconds", () => {
    expect(relativeTime(now, now)).toBe("now");
    expect(relativeTime(now - 4_000, now)).toBe("now");
  });

  it("counts seconds under a minute", () => {
    expect(relativeTime(now - 45_000, now)).toBe("45s");
  });

  it("counts minutes under an hour", () => {
    expect(relativeTime(now - 12 * 60_000, now)).toBe("12m");
  });

  it("counts hours under a day", () => {
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h");
  });

  it("counts days beyond that", () => {
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2d");
  });

  it("never goes negative for a future timestamp", () => {
    expect(relativeTime(now + 10_000, now)).toBe("now");
  });
});

describe("FLOOR_ACTIVITY_META", () => {
  it("has metadata for every kind", () => {
    const kinds: FloorActivityKind[] = ["work", "meeting", "deal", "listing", "presence"];
    for (const k of kinds) {
      expect(FLOOR_ACTIVITY_META[k]).toBeDefined();
      expect(FLOOR_ACTIVITY_META[k].color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
