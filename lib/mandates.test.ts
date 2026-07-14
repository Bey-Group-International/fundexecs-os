// lib/mandates.test.ts
// Unit tests for the pure mandate helpers — parsing the persisted jsonb shapes
// into the gate-layer types, serializing back, and composing Earn's context
// block. The DB-touching functions (getActiveMandate*) are not exercised here;
// only the pure translation layer, which is where the guardrail/blast-radius
// wiring lives.
import {
  parseGuardrails,
  parseBlastRadius,
  blastRadiusToRules,
  mandateContextBlock,
} from "@/lib/mandates";
import { sanitizeGuardrails, parseBlastRadiusForm } from "@/lib/mandate-options";

describe("parseGuardrails", () => {
  it("flattens {rule} objects and trims, dropping blanks", () => {
    expect(
      parseGuardrails([{ rule: "Never contact first" }, { rule: "  " }, { rule: " Disclose LP " }]),
    ).toEqual(["Never contact first", "Disclose LP"]);
  });

  it("tolerates plain strings and ignores garbage", () => {
    expect(parseGuardrails(["bare string", 42, null, {}, { rule: 7 }])).toEqual(["bare string"]);
  });

  it("returns [] for non-array input", () => {
    expect(parseGuardrails(undefined)).toEqual([]);
    expect(parseGuardrails("nope")).toEqual([]);
  });
});

describe("parseBlastRadius", () => {
  it("normalizes the {type,value}[] shape into a structured BlastRadius", () => {
    const br = parseBlastRadius([
      { type: "max_outreach_per_day", value: "25" },
      { type: "max_dollar_per_action", value: 50000 },
      { type: "forbidden_domain", value: "competitor.com" },
      { type: "forbidden_domain", value: "blacklist.com" },
    ]);
    expect(br).toEqual({
      maxOutreachPerDay: 25,
      maxDollarPerAction: 50000,
      forbiddenDomains: ["competitor.com", "blacklist.com"],
    });
  });

  it("ignores unknown types and invalid values", () => {
    const br = parseBlastRadius([
      { type: "bogus", value: 1 },
      { type: "max_outreach_per_day", value: "not-a-number" },
      { type: "forbidden_domain", value: "" },
    ]);
    expect(br).toEqual({});
  });

  it("returns {} for non-array input", () => {
    expect(parseBlastRadius(null)).toEqual({});
  });
});

describe("blastRadiusToRules ↔ parseBlastRadius round-trip", () => {
  it("preserves a full blast radius", () => {
    const br = {
      maxOutreachPerDay: 10,
      maxDollarPerAction: 25000,
      forbiddenDomains: ["a.com", "b.com"],
    };
    expect(parseBlastRadius(blastRadiusToRules(br))).toEqual(br);
  });

  it("omits absent limits", () => {
    expect(blastRadiusToRules({})).toEqual([]);
    expect(blastRadiusToRules({ maxOutreachPerDay: 5 })).toEqual([
      { type: "max_outreach_per_day", value: 5 },
    ]);
  });
});

describe("mandateContextBlock", () => {
  it("returns '' when the row is empty of constraints", () => {
    expect(mandateContextBlock(undefined)).toBe("");
    expect(mandateContextBlock({ scope: "", guardrails: [], blast_radius_rules: [] })).toBe("");
  });

  it("renders scope, guardrails, and blast-radius limits", () => {
    const block = mandateContextBlock({
      scope: "US multifamily",
      guardrails: [{ rule: "Never contact first" }],
      blast_radius_rules: [
        { type: "max_outreach_per_day", value: 25 },
        { type: "forbidden_domain", value: "competitor.com" },
      ],
    });
    expect(block).toContain("## Active mandate");
    expect(block).toContain("Scope: US multifamily");
    expect(block).toContain("Never contact first");
    expect(block).toContain("max 25 automated sends/day");
    expect(block).toContain("competitor.com");
  });
});

describe("sanitizeGuardrails (form → jsonb)", () => {
  it("splits lines, trims, dedupes, and drops blanks", () => {
    expect(sanitizeGuardrails("  Rule A \n\nRule B\nRule A\n")).toEqual([
      { rule: "Rule A" },
      { rule: "Rule B" },
    ]);
  });
});

describe("parseBlastRadiusForm (form → BlastRadius)", () => {
  it("coerces numbers and normalizes domains", () => {
    expect(
      parseBlastRadiusForm({
        maxOutreachPerDay: "25",
        maxDollarPerAction: "50000",
        forbiddenDomains: "https://www.Competitor.com/x\nblacklist.com, competitor.com",
      }),
    ).toEqual({
      maxOutreachPerDay: 25,
      maxDollarPerAction: 50000,
      forbiddenDomains: ["competitor.com", "blacklist.com"],
    });
  });

  it("omits blank/invalid fields rather than storing zeros", () => {
    expect(parseBlastRadiusForm({ maxOutreachPerDay: "", forbiddenDomains: "" })).toEqual({});
  });
});
