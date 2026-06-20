// lib/portfolio-monitor.test.ts — pure portfolio math, no I/O.
import {
  isExited,
  assetMoic,
  markAgeDays,
  isStaleMark,
  concentrationPct,
  rollupPortfolio,
  portfolioAlerts,
  STALE_MARK_DAYS,
  type PortfolioAsset,
  type RollupAsset,
} from "@/lib/portfolio-monitor";

const NOW = new Date("2026-06-20T00:00:00.000Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);
}

describe("isExited", () => {
  it("matches exited statuses case-insensitively", () => {
    expect(isExited("exited")).toBe(true);
    expect(isExited("SOLD")).toBe(true);
    expect(isExited("  Realized ")).toBe(true);
    expect(isExited("written_off")).toBe(true);
    expect(isExited("divested")).toBe(true);
  });
  it("treats held / unknown / empty as not exited", () => {
    expect(isExited("owned")).toBe(false);
    expect(isExited("")).toBe(false);
    expect(isExited(null)).toBe(false);
    expect(isExited(undefined)).toBe(false);
  });
});

describe("assetMoic", () => {
  it("computes value over cost", () => {
    expect(assetMoic(1_500_000, 1_000_000)).toBe(1.5);
  });
  it("guards zero and negative cost with null", () => {
    expect(assetMoic(1_000_000, 0)).toBeNull();
    expect(assetMoic(1_000_000, -5)).toBeNull();
  });
  it("returns null when value or cost is missing", () => {
    expect(assetMoic(null, 1_000)).toBeNull();
    expect(assetMoic(1_000, null)).toBeNull();
  });
});

describe("markAgeDays", () => {
  it("returns whole days since the mark", () => {
    expect(markAgeDays(daysAgo(30), NOW)).toBe(30);
  });
  it("clamps future dates to 0 and returns null on garbage", () => {
    expect(markAgeDays(daysAgo(-10), NOW)).toBe(0);
    expect(markAgeDays("not-a-date", NOW)).toBeNull();
    expect(markAgeDays(null, NOW)).toBeNull();
  });
});

describe("isStaleMark", () => {
  it("is strict at the boundary", () => {
    expect(isStaleMark(daysAgo(STALE_MARK_DAYS), NOW)).toBe(false);
    expect(isStaleMark(daysAgo(STALE_MARK_DAYS + 1), NOW)).toBe(true);
  });
  it("is not stale for a fresh mark", () => {
    expect(isStaleMark(daysAgo(10), NOW)).toBe(false);
  });
});

describe("concentrationPct", () => {
  it("computes a percentage of total", () => {
    expect(concentrationPct(25, 100)).toBe(25);
  });
  it("returns 0 when total is zero", () => {
    expect(concentrationPct(10, 0)).toBe(0);
  });
});

describe("rollupPortfolio", () => {
  const assets: RollupAsset[] = [
    { id: "a", status: "owned", acquisition_cost: 1_000_000, current_value: 800_000 },
    { id: "b", status: "owned", acquisition_cost: 2_000_000, current_value: 1_000_000 },
    { id: "c", status: "exited", acquisition_cost: 500_000, current_value: 900_000 },
  ];
  // a has a fresh mark at 1,200,000; b falls back to current_value.
  const marks = new Map<string, number>([["a", 1_200_000]]);

  it("sums NAV and cost over held assets only, ignoring exited", () => {
    const t = rollupPortfolio(assets, marks);
    expect(t.heldCount).toBe(2);
    expect(t.nav).toBe(2_200_000); // 1.2M (mark) + 1.0M (current_value)
    expect(t.cost).toBe(3_000_000);
    expect(t.unrealizedGain).toBe(-800_000);
  });

  it("computes a NAV-weighted MOIC", () => {
    const t = rollupPortfolio(assets, marks);
    // a: 1.2x weighted by 1.2M; b: 0.5x weighted by 1.0M
    // (1.2*1.2M + 0.5*1.0M) / 2.2M = (1.44M + 0.5M)/2.2M
    expect(t.weightedMoic).toBeCloseTo(1.94 / 2.2, 6);
  });

  it("yields null weighted MOIC and zero totals for no held assets", () => {
    const t = rollupPortfolio(
      [{ id: "x", status: "sold", acquisition_cost: 1, current_value: 2 }],
      new Map(),
    );
    expect(t.heldCount).toBe(0);
    expect(t.nav).toBe(0);
    expect(t.weightedMoic).toBeNull();
  });
});

describe("portfolioAlerts", () => {
  function asset(p: Partial<PortfolioAsset>): PortfolioAsset {
    return {
      id: "a",
      name: "Asset A",
      assetType: "real_estate",
      fundId: null,
      fundName: null,
      status: "owned",
      cost: 1_000_000,
      nav: 1_000_000,
      hasMark: true,
      markAsOf: daysAgo(10),
      markAgeDays: 10,
      isStale: false,
      moic: 1.2,
      unrealizedGain: 200_000,
      concentrationPct: 50,
      ...p,
    };
  }

  it("flags stale marks", () => {
    const alerts = portfolioAlerts([
      asset({ isStale: true, markAgeDays: 200 }),
    ]);
    expect(alerts.some((a) => a.kind === "stale_mark")).toBe(true);
  });

  it("flags underperformers below 1x but above the write-down line", () => {
    const alerts = portfolioAlerts([asset({ moic: 0.9 })]);
    expect(alerts.map((a) => a.kind)).toContain("underperformer");
    expect(alerts.map((a) => a.kind)).not.toContain("write_down_risk");
  });

  it("escalates deep markdowns to write-down risk, not underperformer", () => {
    const alerts = portfolioAlerts([asset({ moic: 0.5 })]);
    expect(alerts.map((a) => a.kind)).toContain("write_down_risk");
    expect(alerts.map((a) => a.kind)).not.toContain("underperformer");
  });

  it("emits nothing for a healthy, freshly-marked asset", () => {
    expect(portfolioAlerts([asset({})])).toEqual([]);
  });

  it("skips exited positions entirely", () => {
    const alerts = portfolioAlerts([
      asset({ status: "exited", moic: 0.2, isStale: true, markAgeDays: 400 }),
    ]);
    expect(alerts).toEqual([]);
  });
});
