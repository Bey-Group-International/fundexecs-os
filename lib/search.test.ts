// Unit tests for the pure shaping helpers in lib/search. No DB and no
// server-only imports — fixtures are plain in-memory objects.
import {
  normalizeQuery,
  dealToHit,
  investorToHit,
  assetToHit,
  MIN_QUERY_LENGTH,
} from "./search";

describe("normalizeQuery", () => {
  it("trims and lowercases", () => {
    expect(normalizeQuery("  AcmE  ")).toBe("acme");
  });

  it("returns '' for empty, null, or undefined", () => {
    expect(normalizeQuery("")).toBe("");
    expect(normalizeQuery(null)).toBe("");
    expect(normalizeQuery(undefined)).toBe("");
  });

  it("guards length: queries shorter than MIN_QUERY_LENGTH become ''", () => {
    expect(MIN_QUERY_LENGTH).toBe(2);
    expect(normalizeQuery("a")).toBe("");
    expect(normalizeQuery("  x ")).toBe("");
    expect(normalizeQuery("ab")).toBe("ab");
  });
});

describe("dealToHit", () => {
  it("maps a deal into a hit with href and humanized subtitle", () => {
    const hit = dealToHit({
      id: "d1",
      name: "Project Atlas",
      stage: "ic_review",
      asset_class: "real_estate",
    });
    expect(hit).toEqual({
      id: "d1",
      kind: "deal",
      title: "Project Atlas",
      subtitle: "Ic review · Real estate",
      href: "/deal/d1",
    });
  });

  it("omits missing subtitle parts", () => {
    const hit = dealToHit({
      id: "d2",
      name: "Lone Deal",
      stage: "sourced",
      asset_class: null,
    });
    expect(hit.subtitle).toBe("Sourced");
    expect(hit.href).toBe("/deal/d2");
  });
});

describe("investorToHit", () => {
  it("maps an investor (LP) into a hit", () => {
    const hit = investorToHit({
      id: "i1",
      name: "Evergreen Capital",
      investor_type: "family_office",
      pipeline_stage: "committed",
    });
    expect(hit).toEqual({
      id: "i1",
      kind: "investor",
      title: "Evergreen Capital",
      subtitle: "Family office · Committed",
      href: "/investor/i1",
    });
  });
});

describe("assetToHit", () => {
  it("maps an asset into a hit", () => {
    const hit = assetToHit({
      id: "a1",
      name: "Tower One",
      asset_type: "real_estate",
      status: "owned",
    });
    expect(hit).toEqual({
      id: "a1",
      kind: "asset",
      title: "Tower One",
      subtitle: "Real estate · Owned",
      href: "/asset/a1",
    });
  });

  it("falls back to empty subtitle when fields are blank", () => {
    const hit = assetToHit({
      id: "a2",
      name: "Mystery Asset",
      asset_type: "" as never,
      status: "",
    });
    expect(hit.subtitle).toBe("");
  });
});
