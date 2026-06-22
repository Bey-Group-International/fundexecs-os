// lib/vesting.test.ts — pure vesting math, no I/O.
import {
  vestedUnits,
  vestingSummary,
  forfeitOnTermination,
  rollupVesting,
  monthsBetween,
  addMonths,
  Grant,
} from "@/lib/vesting";

// Standard 4yr grant, 1yr cliff, monthly: 48,000 units → 1,000/mo.
const grant: Grant = {
  totalUnits: 48_000,
  grantDate: "2024-01-15",
  cliffMonths: 12,
  vestingMonths: 48,
  frequency: "monthly",
};

describe("monthsBetween / addMonths", () => {
  it("counts whole calendar months, day-of-month aware", () => {
    expect(monthsBetween("2024-01-15", "2024-07-15")).toBe(6);
    expect(monthsBetween("2024-01-15", "2024-07-14")).toBe(5); // day not yet reached
    expect(monthsBetween("2024-07-15", "2024-01-15")).toBe(0); // backwards → 0
    expect(monthsBetween("bad", "2024-07-15")).toBe(0);
  });

  it("adds months and clamps to month-end", () => {
    expect(addMonths("2024-01-15", 12)).toBe("2025-01-15");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29"); // leap-year clamp
  });
});

describe("vestedUnits", () => {
  it("vests nothing before the cliff", () => {
    expect(vestedUnits(grant, "2024-07-15")).toBe(0); // month 6
    expect(vestedUnits(grant, "2024-12-15")).toBe(0); // month 11
  });

  it("releases the cliff tranche at the cliff", () => {
    // month 12 → 12/48 * 48,000 = 12,000
    expect(vestedUnits(grant, "2025-01-15")).toBe(12_000);
  });

  it("accrues linearly after the cliff", () => {
    // month 18 → 18,000; month 24 → 24,000
    expect(vestedUnits(grant, "2025-07-15")).toBe(18_000);
    expect(vestedUnits(grant, "2026-01-15")).toBe(24_000);
  });

  it("caps at the total at/after full vest", () => {
    expect(vestedUnits(grant, "2028-01-15")).toBe(48_000); // month 48
    expect(vestedUnits(grant, "2030-01-15")).toBe(48_000); // beyond term
  });

  it("respects a quarterly cadence between boundaries", () => {
    const q: Grant = { ...grant, frequency: "quarterly" };
    // month 14 sits between quarter boundaries → last boundary is month 12 → 12,000
    expect(vestedUnits(q, "2025-03-15")).toBe(12_000);
    // month 15 → quarter boundary → 15,000
    expect(vestedUnits(q, "2025-04-15")).toBe(15_000);
  });

  it("guards bad inputs with zeros", () => {
    expect(vestedUnits({ ...grant, totalUnits: 0 }, "2026-01-15")).toBe(0);
    expect(vestedUnits({ ...grant, vestingMonths: 0 }, "2026-01-15")).toBe(0);
    expect(
      vestedUnits({ ...grant, totalUnits: NaN as unknown as number }, "2026-01-15"),
    ).toBe(0);
  });
});

describe("vestingSummary", () => {
  it("summarizes mid-schedule with the next monthly tranche", () => {
    const s = vestingSummary(grant, "2025-07-15"); // month 18
    expect(s.vested).toBe(18_000);
    expect(s.unvested).toBe(30_000);
    expect(s.vestedPct).toBe(37.5);
    expect(s.fullyVestedOn).toBe("2028-01-15");
    expect(s.nextVestDate).toBe("2025-08-15"); // month 19
    expect(s.nextVestUnits).toBe(1_000);
  });

  it("points to the cliff as the next event before it", () => {
    const s = vestingSummary(grant, "2024-07-15"); // month 6
    expect(s.vested).toBe(0);
    expect(s.nextVestDate).toBe("2025-01-15");
    expect(s.nextVestUnits).toBe(12_000);
  });

  it("has no next event once fully vested", () => {
    const s = vestingSummary(grant, "2028-01-15");
    expect(s.vested).toBe(48_000);
    expect(s.unvested).toBe(0);
    expect(s.vestedPct).toBe(100);
    expect(s.nextVestDate).toBeNull();
    expect(s.nextVestUnits).toBe(0);
  });
});

describe("forfeitOnTermination", () => {
  it("keeps vested, forfeits unvested", () => {
    const f = forfeitOnTermination(grant, "2026-01-15"); // month 24 → 24,000
    expect(f.vestedKept).toBe(24_000);
    expect(f.unvestedForfeited).toBe(24_000);
    expect(f.forfeitedPct).toBe(50);
  });

  it("forfeits everything before the cliff", () => {
    const f = forfeitOnTermination(grant, "2024-07-15"); // month 6
    expect(f.vestedKept).toBe(0);
    expect(f.unvestedForfeited).toBe(48_000);
    expect(f.forfeitedPct).toBe(100);
  });
});

describe("rollupVesting", () => {
  it("totals across a small option pool", () => {
    const founder: Grant = {
      totalUnits: 100_000,
      grantDate: "2023-01-15",
      cliffMonths: 12,
      vestingMonths: 48,
      frequency: "monthly",
    };
    // asOf 2026-01-15: grant (month 24 → 24,000) + founder (month 36 → 75,000)
    const r = rollupVesting([grant, founder], "2026-01-15");
    expect(r.granted).toBe(148_000);
    expect(r.vested).toBe(99_000);
    expect(r.unvested).toBe(49_000);
    expect(r.vestedPct).toBeCloseTo(66.89, 1);
  });

  it("handles an empty pool", () => {
    const r = rollupVesting([], "2026-01-15");
    expect(r.granted).toBe(0);
    expect(r.vested).toBe(0);
    expect(r.vestedPct).toBe(0);
  });
});
