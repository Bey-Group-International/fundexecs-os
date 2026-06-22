// lib/sourcing-intel.test.ts
// Unit tests for the pure helpers behind Sourcing Intelligence — the module→kind
// mapping, the embed-text composition, and the deterministic lexical fallback
// that powers discovery when pgvector cosine search is unavailable. No DB.
import { __test, ENTITY_KINDS } from "@/lib/sourcing-intel";

const { entityKindForModule, composeEmbedText, lexicalScore } = __test;

describe("entityKindForModule", () => {
  it("maps each Source module to its catalog kind", () => {
    expect(entityKindForModule("source/lp_pipeline")).toBe("investor");
    expect(entityKindForModule("source/deal_pipeline")).toBe("company");
    expect(entityKindForModule("source/debt")).toBe("lender");
    expect(entityKindForModule("source/partners")).toBe("advisor");
    expect(entityKindForModule("source/providers")).toBe("provider");
  });
  it("accepts bare module keys (no source/ prefix)", () => {
    expect(entityKindForModule("lp_pipeline")).toBe("investor");
  });
  it("defaults unknown modules to company", () => {
    expect(entityKindForModule("source/unknown")).toBe("company");
  });
  it("only ever returns valid kinds", () => {
    for (const m of ["lp_pipeline", "deal_pipeline", "debt", "partners", "providers", "x"]) {
      expect(ENTITY_KINDS).toContain(entityKindForModule(m));
    }
  });
});

describe("composeEmbedText", () => {
  it("joins name, categories, geography, and description", () => {
    expect(
      composeEmbedText({
        name: "Acme Capital",
        categories: ["family_office", "growth"],
        geography: "Texas",
        description: "Backs first-time managers.",
      }),
    ).toBe("Acme Capital. family_office growth. Texas. Backs first-time managers.");
  });
  it("skips empty fields", () => {
    expect(composeEmbedText({ name: "Solo" })).toBe("Solo");
    expect(composeEmbedText({ name: "Solo", categories: [], geography: "" })).toBe("Solo");
  });
});

describe("lexicalScore", () => {
  it("is 0 for an empty query", () => {
    expect(lexicalScore("", { name: "Acme" })).toBe(0);
  });
  it("scores token overlap above non-overlap", () => {
    const e = { name: "Texas Family Office", categories: ["family_office"], geography: "Texas", description: "Backs emerging managers" };
    const hit = lexicalScore("texas family office managers", e);
    const miss = lexicalScore("private credit lender", e);
    expect(hit).toBeGreaterThan(miss);
    expect(hit).toBeGreaterThan(0);
  });
  it("applies a facet boost when query terms hit a category", () => {
    const withCat = lexicalScore("growth", { name: "X", categories: ["growth"], description: "" });
    const withoutCat = lexicalScore("growth", { name: "X", categories: ["value"], description: "" });
    expect(withCat).toBeGreaterThan(withoutCat);
  });
  it("never exceeds 1", () => {
    const e = { name: "growth growth growth", categories: ["growth"], geography: "growth", description: "growth" };
    expect(lexicalScore("growth", e)).toBeLessThanOrEqual(1);
  });
});
