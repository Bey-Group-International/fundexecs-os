// lib/source-stats.test.ts
// Unit tests for the pure per-module summaries behind the Source dashboards.
// No database is hit — all inputs are small in-memory row fixtures.
import { summarizeModule, __test } from "@/lib/source-stats";

const { checkEstimate, distribution } = __test;

describe("checkEstimate", () => {
  it("returns the midpoint when a band is present", () => {
    expect(checkEstimate({ typical_check_min: 1_000_000, typical_check_max: 3_000_000 })).toBe(2_000_000);
  });
  it("falls back to whichever bound exists", () => {
    expect(checkEstimate({ typical_check_max: 5_000_000 })).toBe(5_000_000);
    expect(checkEstimate({ typical_check_min: 250_000 })).toBe(250_000);
  });
  it("is zero with no check data", () => {
    expect(checkEstimate({})).toBe(0);
  });
});

describe("distribution", () => {
  const order = [
    { key: "a", label: "A", tone: "muted" as const },
    { key: "b", label: "B", tone: "gold" as const },
  ];
  it("counts rows into ordered buckets and keeps empty buckets", () => {
    const out = distribution([{ s: "a" }, { s: "a" }, { s: "b" }], "s", order);
    expect(out.map((o) => o.count)).toEqual([2, 1]);
  });
  it("normalizes share against the busiest bucket", () => {
    const out = distribution([{ s: "a" }, { s: "a" }, { s: "b" }], "s", order);
    expect(out[0].share).toBe(1);
    expect(out[1].share).toBe(0.5);
  });
});

describe("summarizeModule", () => {
  it("returns null for non-Source modules", () => {
    expect(summarizeModule("run/diligence", [{}])).toBeNull();
  });

  it("scores the LP pipeline by temperature and capital in play", () => {
    const summary = summarizeModule("source/lp_pipeline", [
      { pipeline_stage: "committed", typical_check_min: 1_000_000, typical_check_max: 3_000_000 },
      { pipeline_stage: "soft circle", typical_check_max: 2_000_000 },
      { pipeline_stage: "prospect" },
    ]);
    expect(summary).not.toBeNull();
    const stats = Object.fromEntries(summary!.stats.map((s) => [s.label, s.value]));
    expect(stats["Investors"]).toBe("3");
    expect(stats["Active + circling"]).toBe("2"); // committed + soft circle
    expect(stats["Committed"]).toBe("1");
    // 2M (midpoint) + 2M = 4M in play, compacted.
    expect(stats["Capital in play"]).toBe("$4.0M");
    expect(summary!.funnel?.title).toBe("Pipeline temperature");
  });

  it("counts live deals and capital at work, excluding dead deals", () => {
    const summary = summarizeModule("source/deal_pipeline", [
      { stage: "diligence", target_amount: 10_000_000, thesis_fit: 80 },
      { stage: "closing", target_amount: 5_000_000, thesis_fit: 40 },
      { stage: "dead", target_amount: 99_000_000 },
    ]);
    const stats = Object.fromEntries(summary!.stats.map((s) => [s.label, s.value]));
    expect(stats["Live deals"]).toBe("2");
    expect(stats["Closing / owned"]).toBe("1");
    expect(stats["Capital at work"]).toBe("$15.0M"); // dead deal excluded
    expect(stats["Avg thesis fit"]).toBe("60%");
  });

  it("reports the core provider bench coverage", () => {
    const summary = summarizeModule("source/providers", [
      { provider_type: "legal", status: "active" },
      { provider_type: "audit", status: "active" },
    ]);
    const stats = Object.fromEntries(summary!.stats.map((s) => [s.label, s.value]));
    expect(stats["Core bench"]).toBe("2/4");
    expect(stats["Active"]).toBe("2");
  });
});
