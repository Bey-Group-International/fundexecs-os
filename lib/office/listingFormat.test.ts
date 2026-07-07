import { prettyListingType, formatListingAmount, LISTING_TYPE_LABELS } from "./listingFormat";

describe("prettyListingType", () => {
  it("maps known listing types to their labels", () => {
    expect(prettyListingType("deal")).toBe("Deal");
    expect(prettyListingType("co_invest")).toBe("Co-invest");
    expect(prettyListingType("lp_seeking")).toBe("LP Seeking");
  });

  it("title-cases unknown types, splitting on _, space, and hyphen", () => {
    expect(prettyListingType("growth_equity")).toBe("Growth Equity");
    expect(prettyListingType("real-estate")).toBe("Real Estate");
    expect(prettyListingType("private credit")).toBe("Private Credit");
  });

  it("covers every declared label key", () => {
    for (const key of Object.keys(LISTING_TYPE_LABELS)) {
      expect(prettyListingType(key)).toBe(LISTING_TYPE_LABELS[key]);
    }
  });
});

describe("formatListingAmount", () => {
  it("formats an amount as compact USD", () => {
    expect(formatListingAmount(4_000_000)).toBe("$4M");
    expect(formatListingAmount(250_000)).toBe("$250K");
  });

  it("returns null for a missing amount", () => {
    expect(formatListingAmount(null)).toBeNull();
    expect(formatListingAmount(undefined)).toBeNull();
  });
});
