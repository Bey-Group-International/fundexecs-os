// Coverage for the pure intent-signal summarizers. Contracts:
//   - scoreIntent rewards frequency + recency
//   - summarizeSignals totals by source and ranks identifiable parties by intent

import { scoreIntent, summarizeSignals, type RawSignal } from "./interest-signals";

const NOW = Date.parse("2026-07-06T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

describe("scoreIntent", () => {
  it("rewards frequent, recent engagement over sparse, stale", () => {
    const hot = scoreIntent(4, NOW - 1 * 86_400_000, NOW);
    const cold = scoreIntent(1, NOW - 60 * 86_400_000, NOW);
    expect(hot).toBeGreaterThan(cold);
    expect(hot).toBeLessThanOrEqual(100);
  });
});

describe("summarizeSignals", () => {
  const raw: RawSignal[] = [
    { source: "deal_share", party: "Blackstone", createdAt: daysAgo(1) },
    { source: "deal_share", party: "Blackstone", createdAt: daysAgo(2) },
    { source: "deal_share", party: "Small LP", createdAt: daysAgo(40) },
    { source: "data_room", createdAt: daysAgo(1) },
    { source: "marketplace", createdAt: daysAgo(3) },
    { source: "portal", createdAt: daysAgo(5) },
  ];

  it("totals by source", () => {
    const s = summarizeSignals(raw, NOW);
    expect(s.totals.total).toBe(6);
    expect(s.totals.deal_share).toBe(3);
    expect(s.totals.data_room).toBe(1);
    expect(s.totals.marketplace).toBe(1);
    expect(s.totals.portal).toBe(1);
  });

  it("ranks the most-engaged party first and ignores party-less events", () => {
    const s = summarizeSignals(raw, NOW);
    expect(s.parties[0].party).toBe("Blackstone");
    expect(s.parties[0].events).toBe(2);
    expect(s.parties.map((p) => p.party)).toEqual(["Blackstone", "Small LP"]); // only labeled parties
    expect(s.parties[0].intent).toBeGreaterThan(s.parties[1].intent);
  });
});
