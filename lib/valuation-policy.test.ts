// lib/valuation-policy.test.ts — pure valuation freshness, no I/O.
import { assessValuationPolicy } from "@/lib/valuation-policy";

const NOW = Date.parse("2026-06-01T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString().slice(0, 10);

const assets = [
  { id: "a", name: "Maple" },
  { id: "b", name: "Birch" },
  { id: "c", name: "Cedar" },
];

describe("assessValuationPolicy", () => {
  it("flags stale and never-marked holdings against the cadence", () => {
    const p = assessValuationPolicy(
      assets,
      [
        { asset_id: "a", as_of: daysAgo(30), method: "409A" }, // fresh
        { asset_id: "b", as_of: daysAgo(200), method: "DCF" }, // stale (>90)
        // c never marked → stale
      ],
      90,
      NOW,
    );
    const by = Object.fromEntries(p.assets.map((f) => [f.assetId, f]));
    expect(by.a.stale).toBe(false);
    expect(by.b.stale).toBe(true);
    expect(by.c.stale).toBe(true);
    expect(by.c.lastMark).toBeNull();
    expect(p.staleCount).toBe(2);
    expect(p.markedCount).toBe(2);
    expect(p.coveragePct).toBe(67); // 2/3
  });

  it("uses the newest mark per asset and its method", () => {
    const p = assessValuationPolicy(
      [{ id: "a", name: "Maple" }],
      [
        { asset_id: "a", as_of: daysAgo(120), method: "cost" },
        { asset_id: "a", as_of: daysAgo(10), method: "409A" },
      ],
      90,
      NOW,
    );
    expect(p.assets[0].method).toBe("409A");
    expect(p.assets[0].daysSince).toBe(10);
    expect(p.assets[0].stale).toBe(false);
  });

  it("tallies method usage across all marks, most-used first", () => {
    const p = assessValuationPolicy(
      assets,
      [
        { asset_id: "a", as_of: daysAgo(10), method: "409A" },
        { asset_id: "b", as_of: daysAgo(20), method: "409A" },
        { asset_id: "c", as_of: daysAgo(30), method: "comps" },
      ],
      90,
      NOW,
    );
    expect(p.methods[0]).toEqual({ method: "409A", count: 2 });
  });

  it("sorts the stalest holding first", () => {
    const p = assessValuationPolicy(
      assets,
      [
        { asset_id: "a", as_of: daysAgo(5), method: null },
        { asset_id: "b", as_of: daysAgo(300), method: null },
      ],
      90,
      NOW,
    );
    // c (never marked) sorts to top, then b (300d), then a (5d)
    expect(p.assets[0].assetId).toBe("c");
    expect(p.assets[1].assetId).toBe("b");
  });
});
