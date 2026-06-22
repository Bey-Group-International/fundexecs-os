import { computeBuildReadiness, type BuildReadinessInput } from "@/lib/build-readiness";
import type {
  Organization,
  InvestmentThesis,
  Entity,
  TrackRecord,
  OrganizationMember,
  Principal,
} from "@/lib/supabase/database.types";

// Minimal fixtures — only the fields the readiness checks read.
function fullFoundation(): BuildReadinessInput {
  const org = {
    legal_name: "Acme Capital LP",
    entity_type: "lp",
    jurisdiction: "Delaware",
    website: "https://acme.vc",
    description: "A lower-middle-market buyout firm.",
    tagline: "Operators backing operators.",
    brand_color: "#D4AF6A",
    logo_url: "https://acme.vc/logo.png",
    brand_palette: ["#D4AF6A", "#111111"],
    brand_voice: "Plain-spoken, precise.",
  } as unknown as Organization;
  const theses = [
    {
      id: "t1",
      is_active: true,
      summary: "Buy and build niche industrials.",
      asset_classes: ["private_equity"],
      geographies: ["north_america"],
      target_irr: 25,
      target_moic: 3,
      check_size_min: 5_000_000,
      check_size_max: 25_000_000,
    } as unknown as InvestmentThesis,
  ];
  const entities = [
    { id: "e1", entity_type: "gp" } as unknown as Entity,
    { id: "e2", entity_type: "fund" } as unknown as Entity,
  ];
  const records = [
    { id: "r1", gross_irr: 30, gross_moic: 2.5, is_realized: true } as unknown as TrackRecord,
  ];
  const members = [
    { principal_id: "p1" } as unknown as OrganizationMember,
    { principal_id: "p2" } as unknown as OrganizationMember,
  ];
  const principals = [
    { id: "p1", title: "Managing Partner" } as unknown as Principal,
    { id: "p2", title: "Partner" } as unknown as Principal,
  ];
  return { org, theses, entities, records, members, principals };
}

describe("computeBuildReadiness — data room dimension", () => {
  it("includes the data room as a scored module", () => {
    const r = computeBuildReadiness(fullFoundation());
    const keys = r.modules.map((m) => m.key);
    expect(keys).toContain("data_room");
    expect(r.modules).toHaveLength(7);
    expect(r.statuses.data_room).toBeDefined();
  });

  it("an empty firm scores zero everywhere, including the data room", () => {
    const r = computeBuildReadiness({
      org: null,
      theses: [],
      entities: [],
      records: [],
      members: [],
      principals: [],
    });
    expect(r.overall).toBe(0);
    const dr = r.modules.find((m) => m.key === "data_room")!;
    expect(dr.score).toBe(0);
    expect(dr.status).toBe("empty");
  });

  it("a full foundation partially fills the data room via build-backed sections", () => {
    const r = computeBuildReadiness(fullFoundation());
    const dr = r.modules.find((m) => m.key === "data_room")!;
    // Build-backed sections (overview, thesis, track record, team, legal) are
    // satisfied, but doc-only sections (fund terms, financials…) are not.
    expect(dr.status).toBe("started");
    expect(dr.score).toBeGreaterThan(0);
    expect(dr.score).toBeLessThan(100);
  });

  it("adding documents raises the data-room score", () => {
    const base = fullFoundation();
    const before = computeBuildReadiness(base).modules.find((m) => m.key === "data_room")!.score;
    const after = computeBuildReadiness({
      ...base,
      docCounts: { marketing: 3, fund_terms: 1, financials: 1, compliance: 1 },
    }).modules.find((m) => m.key === "data_room")!.score;
    expect(after).toBeGreaterThan(before);
  });

  it("once the foundation is complete, the next-best action points at a missing material", () => {
    const r = computeBuildReadiness(fullFoundation());
    expect(r.nextAction).not.toBeNull();
    expect(r.nextAction!.moduleKey).toBe("data_room");
  });

  it("a fully-documented, fully-built firm reaches the fundraising-ready stage", () => {
    const r = computeBuildReadiness({
      ...fullFoundation(),
      docCounts: {
        overview: 1, marketing: 3, thesis: 1, track_record: 1, portfolio: 1,
        team: 1, fund_terms: 1, legal: 1, financials: 1, compliance: 1,
        operations: 1, esg: 1, risk: 1, diligence: 1, references: 1,
      },
    });
    expect(r.modules.find((m) => m.key === "data_room")!.score).toBe(100);
    expect(r.overall).toBe(100);
    expect(r.stage.key).toBe("fundraising_ready");
    expect(r.nextAction).toBeNull();
  });
});
