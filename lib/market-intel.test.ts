// lib/market-intel.test.ts
import {
  buildIntel,
  computeRelevance,
  momentumFor,
  searchIntel,
  rankIntel,
  distinctSectors,
  distinctKinds,
  type IntelRecord,
} from "@/lib/market-intel";

// A fixed clock so recency-dependent relevance is deterministic.
const NOW = Date.parse("2026-07-06T00:00:00.000Z");
const recent = new Date(NOW - 5 * 86_400_000).toISOString(); // 5 days old
const old = new Date(NOW - 800 * 86_400_000).toISOString(); // ~2.2 years old

describe("buildIntel — per-kind mapping", () => {
  it("maps an investor row onto the normalized shape", () => {
    const [rec] = buildIntel(
      {
        investors: [
          {
            id: "i1",
            name: "Redwood Capital",
            investor_type: "family_office",
            jurisdiction: "US",
            aum: 5_000_000_000,
            pipeline_stage: "committed",
            created_at: recent,
          },
        ],
      },
      { now: NOW },
    );
    expect(rec.kind).toBe("investor");
    expect(rec.name).toBe("Redwood Capital");
    expect(rec.sector).toBe("family_office");
    expect(rec.geography).toBe("US");
    expect(rec.size_usd).toBe(5_000_000_000);
    expect(rec.stage).toBe("committed");
  });

  it("maps a deal row (sector=asset_class, size=target_amount)", () => {
    const [rec] = buildIntel(
      {
        deals: [
          {
            id: "d1",
            name: "Project Atlas",
            asset_class: "real_estate",
            geography: "EU",
            target_amount: 120_000_000,
            stage: "diligence",
            created_at: recent,
          },
        ],
      },
      { now: NOW },
    );
    expect(rec.kind).toBe("deal");
    expect(rec.sector).toBe("real_estate");
    expect(rec.geography).toBe("EU");
    expect(rec.size_usd).toBe(120_000_000);
    expect(rec.stage).toBe("diligence");
  });

  it("maps a fund row with a vintage-derived stage label", () => {
    const [rec] = buildIntel(
      {
        funds: [
          {
            id: "f1",
            name: "Growth Fund III",
            fund_type: "fund",
            target_size: 250_000_000,
            vintage_year: 2024,
          },
        ],
      },
      { now: NOW },
    );
    expect(rec.kind).toBe("fund");
    expect(rec.sector).toBe("fund");
    expect(rec.size_usd).toBe(250_000_000);
    expect(rec.stage).toBe("Vintage 2024");
    expect(rec.geography).toBeNull();
  });

  it("maps a partner row (size null, sector=partner_type)", () => {
    const [rec] = buildIntel(
      {
        partners: [
          {
            id: "p1",
            name: "Baker McKenzie",
            partner_type: "legal",
            status: "active",
          },
        ],
      },
      { now: NOW },
    );
    expect(rec.kind).toBe("partner");
    expect(rec.sector).toBe("legal");
    expect(rec.size_usd).toBeNull();
    expect(rec.stage).toBe("active");
  });

  it("is null-safe for missing / malformed columns", () => {
    const [rec] = buildIntel(
      { deals: [{ id: "d2" }] },
      { now: NOW },
    );
    expect(rec.name).toBe("Untitled deal");
    expect(rec.sector).toBeNull();
    expect(rec.geography).toBeNull();
    expect(rec.size_usd).toBeNull();
    expect(rec.stage).toBeNull();
    expect(rec.relevance).toBeGreaterThanOrEqual(0);
    expect(rec.relevance).toBeLessThanOrEqual(100);
  });

  it("skips absent source groups and concatenates in canonical order", () => {
    const recs = buildIntel(
      {
        partners: [{ id: "p1", name: "P", partner_type: "legal", status: "active" }],
        investors: [{ id: "i1", name: "I", investor_type: "lp" }],
      },
      { now: NOW },
    );
    expect(recs.map((r) => r.kind)).toEqual(["investor", "partner"]);
  });
});

describe("computeRelevance + momentum bucketing", () => {
  it("scores a large, late-stage, fresh record higher than a small stale one", () => {
    const big = computeRelevance({
      size_usd: 5_000_000_000,
      stage: "closing",
      createdAt: recent,
      now: NOW,
    });
    const small = computeRelevance({
      size_usd: 50_000,
      stage: "sourced",
      createdAt: old,
      now: NOW,
    });
    expect(big).toBeGreaterThan(small);
    expect(big).toBeLessThanOrEqual(100);
    expect(small).toBeGreaterThanOrEqual(0);
  });

  it("gives no size credit below $100k and full credit at $10B", () => {
    const floor = computeRelevance({ size_usd: 100_000, stage: null, now: NOW });
    const ceil = computeRelevance({ size_usd: 10_000_000_000, stage: null, now: NOW });
    // Both share the same neutral stage+recency baseline; only size differs.
    expect(ceil - floor).toBe(40);
  });

  it("buckets momentum by relevance thresholds", () => {
    expect(momentumFor(80)).toBe("hot");
    expect(momentumFor(66)).toBe("hot");
    expect(momentumFor(50)).toBe("warm");
    expect(momentumFor(33)).toBe("warm");
    expect(momentumFor(20)).toBe("cool");
  });

  it("derives the record momentum consistently with its relevance", () => {
    const [rec] = buildIntel(
      {
        deals: [
          {
            id: "d1",
            name: "Big",
            target_amount: 8_000_000_000,
            stage: "closing",
            created_at: recent,
          },
        ],
      },
      { now: NOW },
    );
    expect(rec.momentum).toBe(momentumFor(rec.relevance));
    expect(rec.momentum).toBe("hot");
  });
});

describe("searchIntel", () => {
  const records: IntelRecord[] = buildIntel(
    {
      investors: [
        { id: "i1", name: "Alpha LP", investor_type: "lp", jurisdiction: "US", aum: 1e9, pipeline_stage: "committed", created_at: recent },
      ],
      deals: [
        { id: "d1", name: "Beta Tower", asset_class: "real_estate", geography: "EU", target_amount: 5e7, stage: "sourced", created_at: old },
      ],
      partners: [
        { id: "p1", name: "Gamma Legal", partner_type: "legal", status: "inactive" },
      ],
    },
    { now: NOW },
  );

  it("matches name substrings case-insensitively", () => {
    expect(searchIntel(records, "alpha").map((r) => r.id)).toEqual(["i1"]);
    expect(searchIntel(records, "TOWER").map((r) => r.id)).toEqual(["d1"]);
  });

  it("matches over sector and geography too", () => {
    expect(searchIntel(records, "real_estate").map((r) => r.id)).toEqual(["d1"]);
    expect(searchIntel(records, "eu").map((r) => r.id)).toEqual(["d1"]);
  });

  it("returns all records for an empty query", () => {
    expect(searchIntel(records, "  ")).toHaveLength(3);
  });

  it("applies kind, sector, and momentum filters (ANDed)", () => {
    expect(searchIntel(records, "", { kinds: ["deal", "partner"] }).map((r) => r.id).sort()).toEqual(["d1", "p1"]);
    expect(searchIntel(records, "", { sector: "lp" }).map((r) => r.id)).toEqual(["i1"]);
    const hotOnly = searchIntel(records, "", { momentum: "hot" });
    expect(hotOnly.every((r) => r.momentum === "hot")).toBe(true);
    // Conflicting filters yield nothing.
    expect(searchIntel(records, "alpha", { kinds: ["partner"] })).toHaveLength(0);
  });
});

describe("rankIntel", () => {
  it("sorts by relevance descending", () => {
    const recs: IntelRecord[] = [
      { id: "a", kind: "deal", name: "A", sector: null, geography: null, size_usd: null, stage: null, relevance: 30, momentum: "cool" },
      { id: "b", kind: "deal", name: "B", sector: null, geography: null, size_usd: null, stage: null, relevance: 90, momentum: "hot" },
      { id: "c", kind: "deal", name: "C", sector: null, geography: null, size_usd: null, stage: null, relevance: 60, momentum: "warm" },
    ];
    expect(rankIntel(recs).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("is stable for equal relevance and does not mutate the input", () => {
    const recs: IntelRecord[] = [
      { id: "x", kind: "fund", name: "X", sector: null, geography: null, size_usd: null, stage: null, relevance: 50, momentum: "warm" },
      { id: "y", kind: "fund", name: "Y", sector: null, geography: null, size_usd: null, stage: null, relevance: 50, momentum: "warm" },
      { id: "z", kind: "fund", name: "Z", sector: null, geography: null, size_usd: null, stage: null, relevance: 50, momentum: "warm" },
    ];
    const snapshot = recs.map((r) => r.id);
    expect(rankIntel(recs).map((r) => r.id)).toEqual(["x", "y", "z"]);
    expect(recs.map((r) => r.id)).toEqual(snapshot); // input untouched
  });
});

describe("distinct helpers", () => {
  const records = buildIntel(
    {
      investors: [{ id: "i1", name: "I", investor_type: "lp" }],
      deals: [
        { id: "d1", name: "D1", asset_class: "real_estate" },
        { id: "d2", name: "D2", asset_class: "credit" },
      ],
    },
    { now: NOW },
  );

  it("returns sorted distinct sectors", () => {
    expect(distinctSectors(records)).toEqual(["credit", "lp", "real_estate"]);
  });

  it("returns present kinds in canonical order", () => {
    expect(distinctKinds(records)).toEqual(["investor", "deal"]);
  });
});
