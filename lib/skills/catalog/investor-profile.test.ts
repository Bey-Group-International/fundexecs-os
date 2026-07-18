// Golden tests for the investor-profile deterministic core.
import { readFileSync } from "fs";
import { join } from "path";
import { investorProfile, investorProfileManifest, type InvestorProfileInput } from "./investor-profile";
import type { SkillContext } from "@/lib/skills/types";

const loadJson = (rel: string): unknown => JSON.parse(readFileSync(join(process.cwd(), rel), "utf8"));

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "investor_relations" };
const run = (input: InvestorProfileInput) => investorProfile.run(input, ctx);

describe("investor-profile core", () => {
  it("builds a full profile and scores fit across known dimensions", () => {
    const r = run({
      investor: {
        name: "Evergreen Family Office",
        type: "family_office",
        aum: 800,
        typicalTicket: 10,
        sectorsOfInterest: ["software"],
        geographiesOfInterest: ["north america"],
        priorCommitments: 3,
        relationshipOwner: "J. Okafor",
      },
      fundCriteria: { minTicket: 5, targetSectors: ["software"], targetGeographies: ["north america"] },
    });
    expect(r.structured.profile.name).toBe("Evergreen Family Office");
    expect(r.structured.profile.ticketBand).toBe("5-25M");
    expect(r.structured.fitScore).toBe(100);
    expect(r.structured.fitSignals.every((s) => s.status === "fit")).toBe(true);
    expect(r.structured.missingFields).toEqual([]);
    expect(r.structured.suggestedNextStep).toBe("Profile complete — route to Capital Formation for targeting.");
  });

  it("flags missing fields and never fabricates them", () => {
    const r = run({ investor: { name: "Mystery LP" } });
    // Every unsupplied important field is surfaced.
    expect(r.structured.missingFields).toEqual([
      "type",
      "aum",
      "typicalTicket",
      "sectorsOfInterest",
      "geographiesOfInterest",
      "priorCommitments",
      "relationshipOwner",
    ]);
    // Nothing invented: nullable profile fields stay null, no fact source carries a fabricated value.
    expect(r.structured.profile.aum).toBeNull();
    expect(r.structured.profile.type).toBeNull();
    expect(r.sources.some((s) => s.kind === "fact" && s.label === "Mystery LP — AUM")).toBe(false);
    expect(r.structured.suggestedNextStep).toContain("Complete profile");
  });

  it("leaves ticketBand null when no typical ticket is supplied — never invented", () => {
    const r = run({ investor: { name: "NoTicket LP", type: "pension" } });
    expect(r.structured.profile.ticketBand).toBeNull();
    expect(r.structured.missingContext.some((m) => m.includes("ticket band not derived"))).toBe(true);
    // No ticketBand calculation source is emitted when there is no ticket to bucket.
    expect(r.sources.some((s) => s.label === "NoTicket LP — ticket band")).toBe(false);
  });

  it("labels fitScore a calculation and ticketBand a calculation over a supplied fact", () => {
    const r = run({
      investor: { name: "Band LP", typicalTicket: 30 },
      fundCriteria: { minTicket: 5 },
    });
    expect(r.structured.profile.ticketBand).toBe("25M+");
    expect(r.sources.find((s) => s.label === "Band LP — fit score")?.kind).toBe("calculation");
    expect(r.sources.find((s) => s.label === "Band LP — ticket band")?.kind).toBe("calculation");
    // The typical ticket itself is a FACT.
    expect(r.sources.find((s) => s.label === "Band LP — typical ticket")?.kind).toBe("fact");
  });

  it("excludes silent dimensions from scoring rather than penalising them", () => {
    // Only ticket is scoreable (fit); sector/geography criteria absent → unknown, excluded.
    const r = run({
      investor: { name: "Ticket-Only LP", typicalTicket: 8 },
      fundCriteria: { minTicket: 5 },
    });
    const ticket = r.structured.fitSignals.find((s) => s.dimension === "ticket");
    const sector = r.structured.fitSignals.find((s) => s.dimension === "sector");
    expect(ticket?.status).toBe("fit");
    expect(sector?.status).toBe("unknown");
    // fitScore is the average of KNOWN dims only → 100, not dragged down by unknowns.
    expect(r.structured.fitScore).toBe(100);
  });

  it("records supplied investor fields as facts", () => {
    const r = run({
      investor: { name: "Fact LP", type: "fund_of_funds", aum: 1200, relationshipOwner: "A. Rivera" },
    });
    expect(r.sources.find((s) => s.label === "Fact LP — type")?.kind).toBe("fact");
    expect(r.sources.find((s) => s.label === "Fact LP — AUM")?.kind).toBe("fact");
    expect(r.sources.find((s) => s.label === "Fact LP — relationship owner")?.kind).toBe("fact");
  });

  it("scores a partial sector overlap and a ticket miss", () => {
    const r = run({
      investor: {
        name: "Partial LP",
        typicalTicket: 2,
        sectorsOfInterest: ["software", "retail"],
        geographiesOfInterest: ["asia"],
      },
      fundCriteria: { minTicket: 5, targetSectors: ["software"], targetGeographies: ["north america"] },
    });
    expect(r.structured.fitSignals.find((s) => s.dimension === "ticket")?.status).toBe("miss");
    expect(r.structured.fitSignals.find((s) => s.dimension === "sector")?.status).toBe("partial");
    expect(r.structured.fitSignals.find((s) => s.dimension === "geography")?.status).toBe("miss");
    // (0 + 50 + 0) / 3 = 17 (rounded).
    expect(r.structured.fitScore).toBe(17);
  });

  it("always produces a suggested next step and a narrative", () => {
    const r = run({ investor: { name: "X" } });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.suggestedNextStep.length).toBeGreaterThan(0);
    // Never an executed-outreach action — that is a prohibited Tier-2 move here.
    expect(r.structured.suggestedNextStep.toLowerCase()).not.toContain("reach out");
  });
});

describe("investor-profile package consistency", () => {
  it("input schema on disk matches the manifest", () => {
    expect(loadJson("skills/investor-profile/input.schema.json")).toEqual(investorProfileManifest.inputSchema);
  });

  it("output schema on disk matches the manifest", () => {
    expect(loadJson("skills/investor-profile/output.schema.json")).toEqual(investorProfileManifest.outputSchema);
  });

  it("the example input validates against the schema", async () => {
    const { validate } = await import("../validate");
    const example = loadJson("skills/investor-profile/examples/example-1.json") as { input: unknown };
    const r = validate(example.input, investorProfileManifest.inputSchema);
    expect(r.valid).toBe(true);
  });
});
