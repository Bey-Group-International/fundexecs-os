import { pointInArea, areaAt, SCRIPTED_AREAS, type ScriptedArea } from "./scriptedAreas";

const A: ScriptedArea = { id: "a", label: "A", x: 10, y: 10, w: 100, h: 50, trigger: { kind: "toast", text: "a" } };
const B: ScriptedArea = { id: "b", label: "B", x: 0, y: 0, w: 30, h: 30, trigger: { kind: "toast", text: "b" } };

describe("pointInArea", () => {
  it("includes the interior and edges, excludes the outside", () => {
    expect(pointInArea(A, 60, 30)).toBe(true);
    expect(pointInArea(A, 10, 10)).toBe(true); // top-left corner
    expect(pointInArea(A, 110, 60)).toBe(true); // bottom-right corner
    expect(pointInArea(A, 9, 30)).toBe(false); // just left
    expect(pointInArea(A, 60, 61)).toBe(false); // just below
  });
});

describe("areaAt", () => {
  it("returns null when no area contains the point", () => {
    expect(areaAt([A, B], 500, 500)).toBeNull();
  });

  it("returns the containing area", () => {
    expect(areaAt([A, B], 60, 30)?.id).toBe("a");
  });

  it("resolves overlaps in declaration order", () => {
    // (15,15) is inside both A and B; A is declared first.
    expect(areaAt([A, B], 15, 15)?.id).toBe("a");
    expect(areaAt([B, A], 15, 15)?.id).toBe("b");
  });
});

describe("SCRIPTED_AREAS defaults", () => {
  it("has unique ids and well-formed rectangles", () => {
    const ids = SCRIPTED_AREAS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of SCRIPTED_AREAS) {
      expect(a.w).toBeGreaterThan(0);
      expect(a.h).toBeGreaterThan(0);
      expect(typeof a.label).toBe("string");
      expect(a.label.length).toBeGreaterThan(0);
    }
  });

  it("fires the welcome greeting at the operator's spawn point (192,144)", () => {
    const hit = areaAt(SCRIPTED_AREAS, 192, 144);
    expect(hit?.id).toBe("welcome");
    expect(hit?.once).toBe(true);
    expect(hit?.trigger.kind).toBe("say");
  });

  it("broadcasts an all-hands announcement from the center-room auditorium", () => {
    // Center of the 3×3 grid's middle room (576,432) is inside the all-hands zone.
    const hit = areaAt(SCRIPTED_AREAS, 576, 432);
    expect(hit?.id).toBe("all-hands");
    expect(hit?.trigger.kind).toBe("broadcast");
    // Broadcast carries the announcement text shown floor-wide.
    if (hit?.trigger.kind === "broadcast") {
      expect(hit.trigger.text.length).toBeGreaterThan(0);
    }
    // Re-fires on re-entry (not a one-shot), so it can be convened again.
    expect(hit?.once).toBeFalsy();
  });

  it("keeps the welcome and all-hands areas from overlapping", () => {
    // The all-hands center room must not swallow the spawn greeting.
    expect(areaAt(SCRIPTED_AREAS, 192, 144)?.id).toBe("welcome");
    expect(areaAt(SCRIPTED_AREAS, 576, 432)?.id).toBe("all-hands");
  });
});
