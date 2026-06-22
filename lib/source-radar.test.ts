// lib/source-radar.test.ts
// Unit tests for the pure scoring + routing that powers the Source Radar — the
// composite priority and the cross-cluster move recommendation. No DB.
import { __test, buildRadar } from "@/lib/source-radar";
import { computeLearnedWeights, MAX_ADJUSTMENT, type RadarAggregate } from "@/lib/radar-learning";

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

// ---------------------------------------------------------------------------
// buildRadar with the learned layer. A tiny fake Supabase client: each builder
// method returns `this`, and the builder is thenable so `await q` and chained
// queries (sourcing_entities + entity_signals) both resolve to { data }.
// ---------------------------------------------------------------------------
function fakeClient(entities: unknown[]) {
  const tableData: Record<string, unknown[]> = {
    sourcing_entities: entities,
    entity_signals: [],
  };
  const builder = (rows: unknown[]) => {
    const b: Record<string, unknown> = {};
    const chain = () => b;
    b.select = chain;
    b.eq = chain;
    b.not = chain;
    b.order = chain;
    b.limit = chain;
    b.then = (resolve: (v: { data: unknown[] }) => unknown) => resolve({ data: rows });
    return b;
  };
  return {
    from: (table: string) => builder(tableData[table] ?? []),
  } as unknown as Parameters<typeof buildRadar>[0];
}

const entityRow = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  kind: "company",
  name: "Acme Co",
  categories: ["saas"],
  geography: "US",
  description: null,
  source_url: null,
  provenance: "discovery",
  metadata: { fitScore: 70 },
  ...over,
});

describe("buildRadar (learned layer)", () => {
  it("with no weights is byte-identical to the pure base score", async () => {
    const entities = [
      entityRow({ id: "a", name: "Alpha", metadata: { fitScore: 70 } }),
      entityRow({ id: "b", name: "Beta", kind: "investor", metadata: { fitScore: 40 } }),
    ];
    const items = await buildRadar(fakeClient(entities), "org-1");
    for (const it of items) {
      // No signals in the fake → propensity/recency are 0; score is fit-only.
      const expected = radarScore({ fit: it.fit, propensity: it.propensity, recency: it.recency, signalCount: it.signalCount });
      expect(it.score).toBe(expected);
    }
    // Default ordering preserved (highest base score first).
    expect(items[0].name).toBe("Alpha");
  });

  it("passing weights nudges the score and re-sorts", async () => {
    const entities = [
      entityRow({ id: "a", name: "Alpha", metadata: { fitScore: 60 } }), // base 15
      entityRow({ id: "b", name: "Beta", metadata: { fitScore: 64 } }), // base 16
    ];
    // Both route to "pipeline" (strong-ish fit, untracked). Reward that combo so
    // the adjustment lifts both and the relative order by base score is kept.
    const aggs: RadarAggregate[] = [
      { entityKind: "company", moveKind: "pipeline", accepted: 10, dismissed: 0, snoozed: 0 },
    ];
    const weights = computeLearnedWeights(aggs);
    const base = await buildRadar(fakeClient(entities), "org-1");
    const tuned = await buildRadar(fakeClient(entities), "org-1", { weights });
    const byName = (arr: typeof tuned, n: string) => arr.find((x) => x.name === n)!;
    expect(byName(tuned, "Alpha").score).toBe(byName(base, "Alpha").score + MAX_ADJUSTMENT);
    expect(byName(tuned, "Beta").score).toBe(byName(base, "Beta").score + MAX_ADJUSTMENT);
  });
});
