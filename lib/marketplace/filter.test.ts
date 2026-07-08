import { resolveCountry, countryFlag } from "./flags";
import { formatMoney, priceDisplay, subMetricFor, isNew, prettyType } from "./format";
import {
  DEFAULT_FILTERS,
  matchesFilters,
  sortListings,
  runExplorer,
  countryFacets,
  filtersActive,
  countryKey,
  type ListingLike,
  type ListingFilters,
} from "./filter";

function listing(over: Partial<ListingLike>): ListingLike {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: "Untitled",
    summary: null,
    listing_type: "deal",
    status: "listed",
    amount: null,
    target_irr: null,
    country: null,
    asset_class: null,
    reference_code: null,
    currency: "USD",
    featured: false,
    teaser_url: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("flags.resolveCountry", () => {
  it("resolves ISO-2, slug, and full name to the same country", () => {
    expect(resolveCountry("US")?.code).toBe("US");
    expect(resolveCountry("united-states")?.code).toBe("US");
    expect(resolveCountry("United States")?.code).toBe("US");
    expect(resolveCountry("usa")?.code).toBe("US");
  });
  it("resolves common aliases", () => {
    expect(resolveCountry("uk")?.code).toBe("GB");
    expect(resolveCountry("dubai")?.code).toBe("AE");
  });
  it("falls back to a title-cased label + globe for unknowns", () => {
    const r = resolveCountry("atlantis-north");
    expect(r?.code).toBeNull();
    expect(r?.label).toBe("Atlantis North");
    expect(r?.flag).toBe("🌐");
  });
  it("returns null for empty input", () => {
    expect(resolveCountry("")).toBeNull();
    expect(resolveCountry(null)).toBeNull();
    expect(countryFlag(null)).toBe("🌐");
  });
});

describe("format", () => {
  it("formats money by currency and TBD placeholder", () => {
    expect(formatMoney(25_000_000, "USD")).toBe("$25,000,000");
    expect(formatMoney(18_500_000, "EUR")).toBe("€18,500,000");
    expect(formatMoney(null)).toBeNull();
    expect(priceDisplay(null)).toBe("TBD");
  });
  it("picks the first disclosed sub-metric", () => {
    expect(subMetricFor({ ebitda: 3_200_000, currency: "USD" })).toEqual({
      label: "EBITDA",
      value: "$3,200,000",
    });
    expect(subMetricFor({ gross_revenue: 8_100_000, currency: "USD" }).label).toBe("Gross");
    expect(subMetricFor({ target_irr: 22.5 })).toEqual({ label: "Target IRR", value: "22.5%" });
    expect(subMetricFor({})).toEqual({ label: "EBITDA", value: "TBD" });
  });
  it("labels listing types", () => {
    expect(prettyType("co_invest")).toBe("Co-invest");
    expect(prettyType("lp_seeking")).toBe("LP seeking");
  });
  it("flags recent listings as new", () => {
    const now = Date.parse("2026-01-10T00:00:00Z");
    expect(isNew("2026-01-05T00:00:00Z", now)).toBe(true);
    expect(isNew("2025-11-01T00:00:00Z", now)).toBe(false);
  });
});

describe("filter.matchesFilters", () => {
  const base: ListingFilters = { ...DEFAULT_FILTERS };

  it("keyword searches across title/summary/country/reference", () => {
    const l = listing({ title: "Gold Mine", country: "Ghana", reference_code: "L#20261100" });
    expect(matchesFilters(l, { ...base, keyword: "ghana" })).toBe(true);
    expect(matchesFilters(l, { ...base, keyword: "20261100" })).toBe(true);
    expect(matchesFilters(l, { ...base, keyword: "nope" })).toBe(false);
  });
  it("filters by country key regardless of input spelling", () => {
    const l = listing({ country: "united-states" });
    expect(matchesFilters(l, { ...base, country: "US" })).toBe(true);
    expect(matchesFilters(l, { ...base, country: "GB" })).toBe(false);
  });
  it("applies amount and irr ranges, treating null amount as excluded by min", () => {
    expect(matchesFilters(listing({ amount: 5_000_000 }), { ...base, amountMin: 1_000_000 })).toBe(
      true,
    );
    expect(matchesFilters(listing({ amount: 500_000 }), { ...base, amountMin: 1_000_000 })).toBe(
      false,
    );
    expect(matchesFilters(listing({ amount: null }), { ...base, amountMin: 1 })).toBe(false);
    expect(matchesFilters(listing({ target_irr: 25 }), { ...base, irrMin: 20 })).toBe(true);
  });
  it("honors featuredOnly and hasTeaser", () => {
    expect(matchesFilters(listing({ featured: true }), { ...base, featuredOnly: true })).toBe(true);
    expect(matchesFilters(listing({ featured: false }), { ...base, featuredOnly: true })).toBe(
      false,
    );
    expect(matchesFilters(listing({ teaser_url: "x" }), { ...base, hasTeaser: true })).toBe(true);
  });
});

describe("filter.sortListings", () => {
  const a = listing({ id: "a", amount: 100, created_at: "2026-01-01T00:00:00Z", featured: false });
  const b = listing({ id: "b", amount: 300, created_at: "2026-02-01T00:00:00Z", featured: true });
  const c = listing({ id: "c", amount: 200, created_at: "2026-03-01T00:00:00Z", featured: false });

  it("sorts featured first then newest", () => {
    expect(sortListings([a, b, c], "featured").map((l) => l.id)).toEqual(["b", "c", "a"]);
  });
  it("sorts by amount both directions", () => {
    expect(sortListings([a, b, c], "amount_desc").map((l) => l.id)).toEqual(["b", "c", "a"]);
    expect(sortListings([a, b, c], "amount_asc").map((l) => l.id)).toEqual(["a", "c", "b"]);
  });
  it("sorts by standing via tierRank", () => {
    const p = listing({ id: "p", tierRank: 0 });
    const q = listing({ id: "q", tierRank: 3 });
    expect(sortListings([q, p], "standing").map((l) => l.id)).toEqual(["p", "q"]);
  });
});

describe("filter.runExplorer + facets", () => {
  const items = [
    listing({ id: "1", country: "united-states", asset_class: "saas", featured: true }),
    listing({ id: "2", country: "US", asset_class: "manufacturing" }),
    listing({ id: "3", country: "germany", asset_class: "saas" }),
  ];

  it("groups country facets by canonical key", () => {
    const f = countryFacets(items);
    const us = f.find((x) => x.key === "US");
    expect(us?.count).toBe(2);
    expect(us?.label).toBe("United States");
  });

  it("filters, sorts, and paginates in one pass", () => {
    const res = runExplorer(items, { ...DEFAULT_FILTERS, assetClass: "saas" }, "featured", 1, 10);
    expect(res.filteredTotal).toBe(2);
    expect(res.items[0].id).toBe("1"); // featured first
    expect(res.pageCount).toBe(1);
  });

  it("clamps out-of-range pages", () => {
    const res = runExplorer(items, DEFAULT_FILTERS, "newest", 99, 2);
    expect(res.page).toBe(res.pageCount);
    expect(res.items.length).toBeGreaterThan(0);
  });

  it("detects active filters and country keys", () => {
    expect(filtersActive(DEFAULT_FILTERS)).toBe(false);
    expect(filtersActive({ ...DEFAULT_FILTERS, keyword: "x" })).toBe(true);
    expect(countryKey("United States")).toBe("US");
  });
});
