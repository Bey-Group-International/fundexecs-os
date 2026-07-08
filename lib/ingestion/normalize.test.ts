// lib/ingestion/normalize.test.ts
// Unit tests for the pure normalize + de-dupe pass. No I/O.
import { normalizeEntities } from "@/lib/ingestion/normalize";
import { dedupeInputs } from "@/lib/ingestion/pipeline";
import type { ExtractedEntity } from "@/lib/ingestion/extract";

const ent = (over: Partial<ExtractedEntity>): ExtractedEntity => ({
  kind: "company",
  name: "Acme",
  ...over,
});

describe("normalizeEntities", () => {
  it("trims, clamps, and stamps provenance + source url", () => {
    const out = normalizeEntities([ent({ name: "  Acme Capital  ", description: "  a  firm  " })], {
      sourceUrl: "https://acme.com",
    });
    expect(out[0].name).toBe("Acme Capital");
    expect(out[0].description).toBe("a firm");
    expect(out[0].provenance).toBe("web_ingest");
    expect(out[0].sourceUrl).toBe("https://acme.com");
  });

  it("drops nameless rows", () => {
    expect(normalizeEntities([ent({ name: "   " })])).toEqual([]);
  });

  it("coerces an unknown kind to company", () => {
    const out = normalizeEntities([ent({ kind: "banana" as never })]);
    expect(out[0].kind).toBe("company");
  });

  it("de-dupes by (kind, lower name) and unions categories, filling blanks", () => {
    const out = normalizeEntities([
      ent({ name: "Acme", categories: ["saas"], description: null }),
      ent({ name: "acme", categories: ["fintech"], description: "later desc" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].categories).toEqual(["saas", "fintech"]);
    // First record had no description; the merge fills it from the duplicate.
    expect(out[0].description).toBe("later desc");
  });

  it("lower-cases, de-dupes, and caps categories at 12", () => {
    const many = Array.from({ length: 20 }, (_, i) => `Cat${i}`);
    const out = normalizeEntities([ent({ categories: ["SaaS", "saas", ...many] })]);
    expect(out[0].categories).toContain("saas");
    expect(out[0].categories!.length).toBeLessThanOrEqual(12);
    expect(new Set(out[0].categories).size).toBe(out[0].categories!.length);
  });

  it("keeps distinct kinds with the same name separate", () => {
    const out = normalizeEntities([ent({ kind: "company" }), ent({ kind: "investor" })]);
    expect(out).toHaveLength(2);
  });
});

describe("dedupeInputs", () => {
  it("keeps the first of each (kind, lower name) and drops blanks", () => {
    const out = dedupeInputs([
      { kind: "company", name: "Acme" },
      { kind: "company", name: "ACME" },
      { kind: "company", name: "  " },
      { kind: "investor", name: "Acme" },
    ]);
    expect(out.map((e) => `${e.kind}:${e.name}`)).toEqual(["company:Acme", "investor:Acme"]);
  });
});
