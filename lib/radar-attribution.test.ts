// lib/radar-attribution.test.ts
// Unit tests for the pure attribution math behind Radar → outcome attribution —
// the accepted-move rollup per recommendation kind, the stage-to-stage conversion,
// and the headline accepted → mandate rate. No DB: every helper is deterministic
// and runnable in CI.
import {
  __test,
  ATTRIBUTION_STAGES,
  EMPTY_ATTRIBUTION,
  MOVE_KINDS,
  NO_PROGRESS,
  type AcceptedMove,
  type AttributionStage,
  type EntityProgress,
} from "@/lib/radar-attribution";

const {
  pct,
  normalizeName,
  furthestStage,
  rollupByMoveKind,
  totalCounts,
  attributionConversions,
  overallConversion,
  summarizeAttribution,
} = __test;

const allReached: EntityProgress = { contacted: true, replied: true, met: true, mandate: true };

describe("pct (safe percentage)", () => {
  it("computes a rounded 0–100 percentage", () => {
    expect(pct(50, 200)).toBe(25);
    expect(pct(1, 3)).toBe(33);
    expect(pct(2, 3)).toBe(67);
  });
  it("returns 0 on divide-by-zero rather than NaN/Infinity", () => {
    expect(pct(5, 0)).toBe(0);
    expect(pct(0, 0)).toBe(0);
  });
  it("clamps to 100 and to 0", () => {
    expect(pct(300, 100)).toBe(100);
    expect(pct(-5, 100)).toBe(0);
  });
});

describe("normalizeName", () => {
  it("lower-cases and collapses whitespace", () => {
    expect(normalizeName("  Acme   Capital ")).toBe("acme capital");
  });
  it("returns '' for null/blank", () => {
    expect(normalizeName(null)).toBe("");
    expect(normalizeName("   ")).toBe("");
  });
});

describe("furthestStage", () => {
  it("returns the highest reached stage", () => {
    expect(furthestStage(allReached)).toBe("mandate");
    expect(furthestStage({ ...NO_PROGRESS, met: true })).toBe("met");
    expect(furthestStage({ ...NO_PROGRESS, replied: true })).toBe("replied");
    expect(furthestStage({ ...NO_PROGRESS, contacted: true })).toBe("contacted");
  });
  it("falls back to 'accepted' when nothing downstream was reached", () => {
    expect(furthestStage(NO_PROGRESS)).toBe("accepted");
  });
  it("prefers mandate even if intermediate flags are unset (independent tallies)", () => {
    expect(furthestStage({ contacted: false, replied: false, met: false, mandate: true })).toBe("mandate");
  });
});

describe("rollupByMoveKind", () => {
  const moves: AcceptedMove[] = [
    { entityId: "1", entityName: "A", moveKind: "outreach" },
    { entityId: "2", entityName: "B", moveKind: "outreach" },
    { entityId: "3", entityName: "C", moveKind: "buyers" },
  ];
  // A → mandate, B → contacted only, C → met.
  const progress = (m: AcceptedMove): EntityProgress => {
    if (m.entityId === "1") return allReached;
    if (m.entityId === "2") return { ...NO_PROGRESS, contacted: true };
    if (m.entityId === "3") return { contacted: true, replied: true, met: true, mandate: false };
    return NO_PROGRESS;
  };

  it("includes a zero-filled row for every move kind", () => {
    const rows = rollupByMoveKind([], () => NO_PROGRESS);
    expect(rows).toHaveLength(MOVE_KINDS.length);
    expect(rows.every((r) => r.accepted === 0 && r.conversion === 0)).toBe(true);
  });

  it("tallies each stage independently per move kind and derives conversion", () => {
    const rows = rollupByMoveKind(moves, progress);
    const outreach = rows.find((r) => r.moveKind === "outreach")!;
    expect(outreach).toMatchObject({
      accepted: 2,
      contacted: 2,
      replied: 1,
      met: 1,
      mandate: 1,
      conversion: 50, // 1 mandate / 2 accepted
    });
    const buyers = rows.find((r) => r.moveKind === "buyers")!;
    expect(buyers).toMatchObject({ accepted: 1, contacted: 1, replied: 1, met: 1, mandate: 0, conversion: 0 });
  });

  it("ignores moves with a null or unknown kind", () => {
    const rows = rollupByMoveKind(
      [
        { entityId: null, entityName: "X", moveKind: null },
        { entityId: null, entityName: "Y", moveKind: "not_a_kind" as never },
      ],
      () => allReached,
    );
    expect(rows.every((r) => r.accepted === 0)).toBe(true);
  });

  it("sorts by accepted desc, then move kind, for stable order", () => {
    const rows = rollupByMoveKind(moves, progress);
    // outreach (2) first, then the 1-accepted/zero rows sorted by kind name.
    expect(rows[0].moveKind).toBe("outreach");
    const tail = rows.slice(1).map((r) => r.moveKind);
    expect(tail).toEqual([...tail].sort((a, b) => a.localeCompare(b)));
  });

  it("is deterministic — same input, same output", () => {
    expect(rollupByMoveKind(moves, progress)).toEqual(rollupByMoveKind(moves, progress));
  });

  it("guards divide-by-zero: zero accepted → 0% conversion, never NaN", () => {
    const rows = rollupByMoveKind([], () => NO_PROGRESS);
    expect(rows.every((r) => Number.isFinite(r.conversion) && r.conversion === 0)).toBe(true);
  });
});

describe("totalCounts", () => {
  it("sums each stage across move kinds", () => {
    const rows = rollupByMoveKind(
      [
        { entityId: "1", entityName: "A", moveKind: "outreach" },
        { entityId: "2", entityName: "B", moveKind: "buyers" },
      ],
      () => allReached,
    );
    expect(totalCounts(rows)).toEqual({ accepted: 2, contacted: 2, replied: 2, met: 2, mandate: 2 });
  });
  it("is all zeros for empty rows", () => {
    expect(totalCounts(rollupByMoveKind([], () => NO_PROGRESS))).toEqual({
      accepted: 0,
      contacted: 0,
      replied: 0,
      met: 0,
      mandate: 0,
    });
  });
});

describe("attributionConversions", () => {
  it("derives each adjacent accepted → … → mandate rate", () => {
    const counts: Record<AttributionStage, number> = {
      accepted: 100,
      contacted: 50,
      replied: 25,
      met: 10,
      mandate: 5,
    };
    const conv = attributionConversions(counts);
    expect(conv).toHaveLength(ATTRIBUTION_STAGES.length - 1);
    expect(conv[0]).toMatchObject({ from: "accepted", to: "contacted", rate: 50 });
    expect(conv[1]).toMatchObject({ from: "contacted", to: "replied", rate: 50 });
    expect(conv[2]).toMatchObject({ from: "replied", to: "met", rate: 40 });
    expect(conv[3]).toMatchObject({ from: "met", to: "mandate", rate: 50 });
  });
  it("yields 0% (no divide-by-zero) when a prior stage is empty", () => {
    const counts: Record<AttributionStage, number> = {
      accepted: 0,
      contacted: 0,
      replied: 0,
      met: 0,
      mandate: 0,
    };
    expect(attributionConversions(counts).every((c) => c.rate === 0)).toBe(true);
  });
});

describe("overallConversion", () => {
  it("is mandate / accepted as a 0–100 rate", () => {
    expect(
      overallConversion({ accepted: 200, contacted: 50, replied: 20, met: 10, mandate: 10 }),
    ).toBe(5);
  });
  it("is 0 when nothing was accepted", () => {
    expect(overallConversion({ accepted: 0, contacted: 0, replied: 0, met: 0, mandate: 0 })).toBe(0);
  });
});

describe("summarizeAttribution", () => {
  it("assembles counts, conversions, the overall rate, and per-kind rows", () => {
    const moves: AcceptedMove[] = [
      { entityId: "1", entityName: "A", moveKind: "outreach" },
      { entityId: "2", entityName: "B", moveKind: "outreach" },
    ];
    const a = summarizeAttribution(moves, (m) =>
      m.entityId === "1" ? allReached : { ...NO_PROGRESS, contacted: true },
    );
    expect(a.counts).toEqual({ accepted: 2, contacted: 2, replied: 1, met: 1, mandate: 1 });
    expect(a.overallConversion).toBe(50);
    expect(a.conversions).toHaveLength(4);
    expect(a.byMoveKind).toHaveLength(MOVE_KINDS.length);
  });

  it("handles the empty org cleanly (all zeros, no NaN)", () => {
    const a = summarizeAttribution([], () => NO_PROGRESS);
    expect(a.overallConversion).toBe(0);
    expect(a.counts.accepted).toBe(0);
    expect(a.conversions.every((c) => c.rate === 0)).toBe(true);
  });

  it("is deterministic — same input, same output", () => {
    const moves: AcceptedMove[] = [{ entityId: "1", entityName: "A", moveKind: "pipeline" }];
    expect(summarizeAttribution(moves, () => allReached)).toEqual(
      summarizeAttribution(moves, () => allReached),
    );
  });
});

describe("EMPTY_ATTRIBUTION", () => {
  it("is a fully-zeroed read with every move kind present", () => {
    expect(EMPTY_ATTRIBUTION.overallConversion).toBe(0);
    expect(EMPTY_ATTRIBUTION.counts.accepted).toBe(0);
    expect(EMPTY_ATTRIBUTION.byMoveKind).toHaveLength(MOVE_KINDS.length);
    expect(EMPTY_ATTRIBUTION.conversions.every((c) => c.rate === 0)).toBe(true);
  });
});
