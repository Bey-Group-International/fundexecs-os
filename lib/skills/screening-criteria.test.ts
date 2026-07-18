// Tests for the defensive screening-criteria parser.
import { parseScreeningCriteria, hasUsableCriteria } from "./screening-criteria";

describe("parseScreeningCriteria", () => {
  it("keeps well-typed string lists and numeric bands", () => {
    const c = parseScreeningCriteria({
      sectors: ["Software", "Healthcare"],
      geographies: ["North America"],
      minRevenue: 10,
      maxRevenue: 100,
      minEbitda: 2,
      maxEbitda: 30,
      maxEnterpriseValue: 250,
      transactionTypes: ["majority"],
      exclusions: ["tobacco"],
    });
    expect(c).toEqual({
      sectors: ["Software", "Healthcare"],
      geographies: ["North America"],
      minRevenue: 10,
      maxRevenue: 100,
      minEbitda: 2,
      maxEbitda: 30,
      maxEnterpriseValue: 250,
      transactionTypes: ["majority"],
      exclusions: ["tobacco"],
    });
  });

  it("drops malformed values rather than coercing or inventing them", () => {
    const c = parseScreeningCriteria({
      sectors: ["Software", 42, "", "   ", null],
      minRevenue: "10", // wrong type → dropped
      maxRevenue: -5, // negative → dropped
      minEbitda: Number.NaN, // not finite → dropped
      exclusions: "tobacco", // not an array → dropped
    });
    expect(c).toEqual({ sectors: ["Software"] });
  });

  it("dedupes string lists case-insensitively, trimming whitespace", () => {
    const c = parseScreeningCriteria({ sectors: ["Software", " software ", "SOFTWARE", "SaaS"] });
    expect(c).toEqual({ sectors: ["Software", "SaaS"] });
  });

  it("returns null for non-objects", () => {
    expect(parseScreeningCriteria(null)).toBeNull();
    expect(parseScreeningCriteria(undefined)).toBeNull();
    expect(parseScreeningCriteria("criteria")).toBeNull();
    expect(parseScreeningCriteria(["software"])).toBeNull();
    expect(parseScreeningCriteria(42)).toBeNull();
  });

  it("returns null when nothing valid survives", () => {
    expect(parseScreeningCriteria({})).toBeNull();
    expect(parseScreeningCriteria({ sectors: [], minRevenue: "x", junk: true })).toBeNull();
  });

  it("keeps a zero band (0 is a valid, non-negative bound)", () => {
    expect(parseScreeningCriteria({ minEbitda: 0 })).toEqual({ minEbitda: 0 });
  });
});

describe("hasUsableCriteria", () => {
  it("is true when any dimension is constrained", () => {
    expect(hasUsableCriteria({ sectors: ["software"] })).toBe(true);
    expect(hasUsableCriteria({ minRevenue: 10 })).toBe(true);
    expect(hasUsableCriteria({ exclusions: ["tobacco"] })).toBe(true);
    expect(hasUsableCriteria({ minEbitda: 0 })).toBe(true);
  });

  it("is false for null/undefined/empty", () => {
    expect(hasUsableCriteria(null)).toBe(false);
    expect(hasUsableCriteria(undefined)).toBe(false);
    expect(hasUsableCriteria({})).toBe(false);
    expect(hasUsableCriteria({ sectors: [] })).toBe(false);
  });
});
