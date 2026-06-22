// lib/exit-scenarios.test.ts — pure exit & scenario math, no I/O.
import { annualizedReturn, modelExit, scenarioGrid } from "@/lib/exit-scenarios";
import { DEFAULT_TERMS } from "@/lib/waterfall";

describe("annualizedReturn", () => {
  it("annualizes a double over 3 years", () => {
    // 2^(1/3) − 1 ≈ 25.99%
    expect(annualizedReturn(1_000_000, 2_000_000, 3)).toBeCloseTo(26.0, 1);
  });

  it("is null for non-positive or zero-year inputs", () => {
    expect(annualizedReturn(0, 100, 2)).toBeNull();
    expect(annualizedReturn(100, 100, 0)).toBeNull();
  });
});

describe("modelExit", () => {
  it("runs the exit value through the waterfall and derives multiples", () => {
    // cost 1M, paid-in 1M, exit 2M over 4 years.
    const s = modelExit(1_000_000, 2_000_000, 4, 1_000_000, DEFAULT_TERMS);
    expect(s.grossMultiple).toBe(2);
    // LP + GP must reconstruct the exit value.
    expect(s.toLps + s.toGp).toBeCloseTo(2_000_000, 0);
    // GP takes carry, so LPs receive less than the full proceeds.
    expect(s.toLps).toBeLessThan(2_000_000);
    expect(s.lpIrr).not.toBeNull();
  });

  it("returns all capital to LPs and nothing to GP below paid-in", () => {
    const s = modelExit(1_000_000, 600_000, 2, 1_000_000, DEFAULT_TERMS);
    expect(s.toGp).toBe(0);
    expect(s.toLps).toBe(600_000);
  });
});

describe("scenarioGrid", () => {
  it("sweeps the multiple grid plus the current mark, sorted by exit value", () => {
    const grid = scenarioGrid(1_000_000, 1_800_000, 5, 1_000_000, DEFAULT_TERMS, [1, 2, 3]);
    expect(grid).toHaveLength(4); // 3 multiples + current mark
    for (let i = 1; i < grid.length; i++) {
      expect(grid[i].exitValue).toBeGreaterThanOrEqual(grid[i - 1].exitValue);
    }
    expect(grid.some((s) => s.label === "Current mark")).toBe(true);
  });
});
