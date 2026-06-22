// lib/source-radar.test.ts
// Unit tests for the pure scoring + routing that powers the Source Radar — the
// composite priority and the cross-cluster move recommendation. No DB.
import { __test } from "@/lib/source-radar";

const { recencyScore, radarScore, recommendMove } = __test;

const NOW = new Date("2026-06-22T00:00:00Z").getTime();
const daysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString();

describe("recencyScore", () => {
  it("is 0 with no date", () => {
    expect(recencyScore(null, NOW)).toBe(0);
    expect(recencyScore(undefined, NOW)).toBe(0);
  });
  it("is full credit within a week and decays to 0 by 90 days", () => {
    expect(recencyScore(daysAgo(2), NOW)).toBe(100);
    expect(recencyScore(daysAgo(7), NOW)).toBe(100);
    expect(recencyScore(daysAgo(120), NOW)).toBe(0);
    const mid = recencyScore(daysAgo(48), NOW);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(100);
  });
});

describe("radarScore", () => {
  it("ranks a fresh high-propensity entity above a quiet one", () => {
    const hot = radarScore({ fit: 60, propensity: { sell: 80, raise: 10 }, recency: 100, signalCount: 3 });
    const quiet = radarScore({ fit: 60, propensity: { sell: 0, raise: 0 }, recency: 0, signalCount: 0 });
    expect(hot).toBeGreaterThan(quiet);
  });
  it("scores a signal-less entity on fit alone", () => {
    expect(radarScore({ fit: 80, propensity: { sell: 0, raise: 0 }, recency: 0, signalCount: 0 })).toBe(20);
  });
  it("stays within 0–100", () => {
    const max = radarScore({ fit: 100, propensity: { sell: 100, raise: 100 }, recency: 100, signalCount: 10 });
    expect(max).toBeLessThanOrEqual(100);
    expect(max).toBeGreaterThan(0);
  });
});

describe("recommendMove (cross-cluster routing)", () => {
  it("routes a sell-leaning company to Buyers", () => {
    const m = recommendMove({ name: "Acme Co", kind: "company", propensity: { sell: 70, raise: 5 }, fit: 60, inPipeline: true });
    expect(m.kind).toBe("buyers");
    expect(m.href).toContain("/source/buyers");
    expect(m.href).toContain("Acme");
  });
  it("routes a raise-leaning allocator to Outreach", () => {
    const m = recommendMove({ name: "Beta FO", kind: "investor", propensity: { sell: 5, raise: 75 }, fit: 50, inPipeline: true });
    expect(m.kind).toBe("outreach");
  });
  it("recommends adding a strong-fit, untracked entity to the pipeline", () => {
    const m = recommendMove({ name: "Gamma", kind: "company", propensity: { sell: 10, raise: 10 }, fit: 70, inPipeline: false });
    expect(m.kind).toBe("pipeline");
    expect(m.href).toBeUndefined();
  });
  it("falls back to watching signals when quiet and tracked", () => {
    const m = recommendMove({ name: "Delta", kind: "provider", propensity: { sell: 0, raise: 0 }, fit: 40, inPipeline: true });
    expect(m.kind).toBe("signals");
  });
});
