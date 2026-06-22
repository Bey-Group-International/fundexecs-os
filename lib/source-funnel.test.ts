// lib/source-funnel.test.ts
// Unit tests for the pure funnel math that powers the Source Outcome Funnel —
// the conversion percentages, stage-to-stage rates, and source/signal breakdown
// grouping. No DB: every helper is deterministic and runnable in CI.
import { __test, EMPTY_STAGE_COUNTS, FUNNEL_STAGES, type StageCounts } from "@/lib/source-funnel";

const {
  pct,
  conversionRates,
  overallConversion,
  breakdownBy,
  summarizeFunnel,
  humanizeKey,
  engagementRates,
  feedbackRates,
  summarizeEngagement,
} = __test;

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

describe("conversionRates", () => {
  it("derives each adjacent stage-to-stage rate", () => {
    const counts: StageCounts = { sourced: 100, contacted: 50, replied: 25, met: 10, mandate: 5 };
    const conv = conversionRates(counts);
    expect(conv).toHaveLength(FUNNEL_STAGES.length - 1);
    expect(conv[0]).toMatchObject({ from: "sourced", to: "contacted", rate: 50 });
    expect(conv[1]).toMatchObject({ from: "contacted", to: "replied", rate: 50 });
    expect(conv[2]).toMatchObject({ from: "replied", to: "met", rate: 40 });
    expect(conv[3]).toMatchObject({ from: "met", to: "mandate", rate: 50 });
  });
  it("yields 0% (no divide-by-zero) when a prior stage is empty", () => {
    const counts: StageCounts = { sourced: 0, contacted: 0, replied: 0, met: 0, mandate: 0 };
    const conv = conversionRates(counts);
    expect(conv.every((c) => c.rate === 0)).toBe(true);
  });
  it("is deterministic — same input, same output", () => {
    const counts: StageCounts = { sourced: 80, contacted: 40, replied: 20, met: 8, mandate: 4 };
    expect(conversionRates(counts)).toEqual(conversionRates(counts));
  });
});

describe("overallConversion", () => {
  it("is mandate / sourced as a 0–100 rate", () => {
    expect(overallConversion({ sourced: 200, contacted: 50, replied: 20, met: 10, mandate: 10 })).toBe(5);
  });
  it("is 0 when nothing was sourced", () => {
    expect(overallConversion(EMPTY_STAGE_COUNTS)).toBe(0);
  });
});

describe("breakdownBy (grouping)", () => {
  it("sums contributions per key and derives mandate/sourced conversion", () => {
    const rows = breakdownBy([
      { key: "referral", label: "Referral", sourced: 1 },
      { key: "referral", sourced: 1 },
      { key: "referral", contacted: 1 },
      { key: "referral", mandate: 1 },
      { key: "broker", label: "Broker", sourced: 4 },
      { key: "broker", mandate: 1 },
    ]);
    const referral = rows.find((r) => r.key === "referral")!;
    expect(referral).toMatchObject({ sourced: 2, contacted: 1, mandate: 1, conversion: 50, label: "Referral" });
    const broker = rows.find((r) => r.key === "broker")!;
    expect(broker).toMatchObject({ sourced: 4, mandate: 1, conversion: 25 });
  });
  it("sorts by sourced volume desc, then key, for stable order", () => {
    const rows = breakdownBy([
      { key: "b", sourced: 1 },
      { key: "a", sourced: 5 },
      { key: "c", sourced: 5 },
    ]);
    expect(rows.map((r) => r.key)).toEqual(["a", "c", "b"]);
  });
  it("falls back to 'unknown' for an empty key and labels it", () => {
    const rows = breakdownBy([{ key: "", sourced: 1 }]);
    expect(rows[0].key).toBe("unknown");
  });
  it("returns [] for empty input", () => {
    expect(breakdownBy([])).toEqual([]);
  });
  it("is deterministic", () => {
    const input = [
      { key: "x", sourced: 2, mandate: 1 },
      { key: "y", sourced: 3 },
    ];
    expect(breakdownBy(input)).toEqual(breakdownBy(input));
  });
});

describe("summarizeFunnel", () => {
  it("assembles counts, conversions, and the overall rate", () => {
    const counts: StageCounts = { sourced: 10, contacted: 5, replied: 2, met: 1, mandate: 1 };
    const f = summarizeFunnel(counts);
    expect(f.counts).toEqual(counts);
    expect(f.overallConversion).toBe(10);
    expect(f.conversions).toHaveLength(4);
    expect(f.bySource).toEqual([]);
    expect(f.bySignal).toEqual([]);
  });
  it("handles the empty org cleanly (all zeros, no NaN)", () => {
    const f = summarizeFunnel(EMPTY_STAGE_COUNTS);
    expect(f.overallConversion).toBe(0);
    expect(f.conversions.every((c) => c.rate === 0)).toBe(true);
  });
});

describe("humanizeKey", () => {
  it("title-cases and de-underscores a slug", () => {
    expect(humanizeKey("off_market")).toBe("Off Market");
  });
  it("handles the empty string", () => {
    expect(humanizeKey("")).toBe("Unknown");
  });
});

describe("engagementRates (digest telemetry)", () => {
  it("derives open / click / click-through as 0–100 integers", () => {
    expect(engagementRates({ digestsSent: 100, opens: 40, clicks: 10 })).toEqual({
      openRate: 40,
      clickRate: 10,
      clickThroughRate: 25, // clicks / opens
    });
  });
  it("returns 0 on divide-by-zero (no digests sent / nothing opened)", () => {
    expect(engagementRates({ digestsSent: 0, opens: 5, clicks: 2 })).toEqual({
      openRate: 0,
      clickRate: 0,
      clickThroughRate: 40,
    });
    expect(engagementRates({ digestsSent: 10, opens: 0, clicks: 0 })).toEqual({
      openRate: 0,
      clickRate: 0,
      clickThroughRate: 0,
    });
  });
  it("clamps rates above 100", () => {
    expect(engagementRates({ digestsSent: 10, opens: 30, clicks: 30 })).toEqual({
      openRate: 100,
      clickRate: 100,
      clickThroughRate: 100,
    });
  });
  it("is deterministic — same input, same output", () => {
    const input = { digestsSent: 73, opens: 31, clicks: 9 };
    expect(engagementRates(input)).toEqual(engagementRates(input));
  });
});

describe("feedbackRates (Radar acceptance)", () => {
  it("is accepted / (accepted + dismissed + snoozed) as a 0–100 rate", () => {
    expect(feedbackRates({ accepted: 3, dismissed: 1, snoozed: 0 })).toEqual({ acceptanceRate: 75 });
  });
  it("returns 0 when there is no feedback at all (no divide-by-zero)", () => {
    expect(feedbackRates({ accepted: 0, dismissed: 0, snoozed: 0 })).toEqual({ acceptanceRate: 0 });
  });
  it("is deterministic", () => {
    const input = { accepted: 5, dismissed: 3, snoozed: 2 };
    expect(feedbackRates(input)).toEqual(feedbackRates(input));
  });
});

describe("summarizeEngagement", () => {
  it("assembles raw tallies and every derived rate", () => {
    const e = summarizeEngagement({
      digestsSent: 50,
      itemsSent: 200,
      opens: 25,
      clicks: 5,
      accepted: 6,
      dismissed: 2,
      snoozed: 2,
    });
    expect(e).toEqual({
      digestsSent: 50,
      itemsSent: 200,
      opens: 25,
      clicks: 5,
      accepted: 6,
      dismissed: 2,
      snoozed: 2,
      openRate: 50,
      clickRate: 10,
      clickThroughRate: 20,
      acceptanceRate: 60,
    });
  });
  it("handles the empty loop cleanly (all zeros, no NaN)", () => {
    const e = summarizeEngagement({
      digestsSent: 0,
      itemsSent: 0,
      opens: 0,
      clicks: 0,
      accepted: 0,
      dismissed: 0,
      snoozed: 0,
    });
    expect(e.openRate).toBe(0);
    expect(e.clickRate).toBe(0);
    expect(e.clickThroughRate).toBe(0);
    expect(e.acceptanceRate).toBe(0);
  });
  it("is deterministic", () => {
    const input = {
      digestsSent: 12,
      itemsSent: 48,
      opens: 7,
      clicks: 3,
      accepted: 4,
      dismissed: 1,
      snoozed: 1,
    };
    expect(summarizeEngagement(input)).toEqual(summarizeEngagement(input));
  });
});
