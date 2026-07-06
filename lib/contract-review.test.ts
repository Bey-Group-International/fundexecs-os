// Coverage for the pure contract-review core: assessContract scoring/levels and
// highs/missing roll-up, plus the deterministic fallbackReview presence
// detection, risk assignment, and empty-text behavior.
import {
  assessContract,
  fallbackReview,
  CLAUSE_TYPES,
  CLAUSE_KEYS,
  type Finding,
} from "./contract-review";

function finding(over: Partial<Finding> & { clause_type: string }): Finding {
  return {
    present: true,
    risk: "none",
    excerpt: null,
    redline: null,
    ...over,
  };
}

describe("assessContract", () => {
  it("scores an all-clear set at 0 / low", () => {
    const findings = CLAUSE_KEYS.map((k) => finding({ clause_type: k, risk: "none" }));
    const { score, level, highs, missing } = assessContract(findings);
    expect(score).toBe(0);
    expect(level).toBe("low");
    expect(highs).toHaveLength(0);
    expect(missing).toHaveLength(0);
  });

  it("scores an all-high set at 100 / high", () => {
    const findings = CLAUSE_KEYS.map((k) => finding({ clause_type: k, risk: "high" }));
    const { score, level, highs } = assessContract(findings);
    expect(score).toBe(100);
    expect(level).toBe("high");
    expect(highs).toHaveLength(CLAUSE_KEYS.length);
  });

  it("collects only high-risk findings into highs", () => {
    const findings = [
      finding({ clause_type: "non_compete", risk: "high" }),
      finding({ clause_type: "governing_law", risk: "medium" }),
      finding({ clause_type: "audit_rights", risk: "low" }),
    ];
    const { highs } = assessContract(findings);
    expect(highs.map((f) => f.clause_type)).toEqual(["non_compete"]);
  });

  it("lists missing protective clauses (absent + riskIfAbsent) by label", () => {
    const findings = [
      // indemnification carries riskIfAbsent → should appear when absent
      finding({ clause_type: "indemnification", present: false, risk: "high" }),
      // change_of_control has no riskIfAbsent → absent but NOT flagged as missing
      finding({ clause_type: "change_of_control", present: false, risk: "none" }),
    ];
    const { missing } = assessContract(findings);
    expect(missing).toContain("Indemnification");
    expect(missing).not.toContain("Change of Control");
  });

  it("bands scores into the four levels", () => {
    // Single medium finding: weight 10 / max 22 → 45 → elevated
    expect(assessContract([finding({ clause_type: "termination", risk: "medium" })]).level).toBe(
      "elevated",
    );
    // Single low finding: 4 / 22 → 18 → moderate
    expect(assessContract([finding({ clause_type: "audit_rights", risk: "low" })]).level).toBe(
      "moderate",
    );
    // Single high finding: 22 / 22 → 100 → high
    expect(assessContract([finding({ clause_type: "non_compete", risk: "high" })]).level).toBe(
      "high",
    );
  });

  it("returns a zero score for an empty findings list without throwing", () => {
    const { score, level, highs, missing } = assessContract([]);
    expect(score).toBe(0);
    expect(level).toBe("low");
    expect(highs).toEqual([]);
    expect(missing).toEqual([]);
  });
});

describe("fallbackReview", () => {
  it("produces exactly one finding per clause type", () => {
    const findings = fallbackReview("This agreement is short.");
    expect(findings).toHaveLength(CLAUSE_TYPES.length);
    expect(new Set(findings.map((f) => f.clause_type))).toEqual(new Set(CLAUSE_KEYS));
  });

  it("detects present clauses from keywords and quotes an excerpt", () => {
    const text =
      "This Agreement shall be governed by the laws of Delaware. The Seller shall indemnify the Buyer. " +
      "Upon a change of control, the Buyer may terminate. The parties agree to exclusivity during the period.";
    const findings = fallbackReview(text);
    const by = (k: string) => findings.find((f) => f.clause_type === k)!;

    expect(by("governing_law").present).toBe(true);
    expect(by("indemnification").present).toBe(true);
    expect(by("change_of_control").present).toBe(true);
    expect(by("exclusivity").present).toBe(true);
    // Excerpt is a non-empty quote for a detected clause.
    expect(by("governing_law").excerpt).toBeTruthy();
  });

  it("assigns high risk to an adverse present clause (change of control)", () => {
    const findings = fallbackReview("There is a change of control provision here.");
    const coc = findings.find((f) => f.clause_type === "change_of_control")!;
    expect(coc.present).toBe(true);
    expect(coc.risk).toBe("high");
    expect(coc.redline).toBeTruthy();
  });

  it("flags an absent protective clause with its riskIfAbsent and a redline", () => {
    // Text mentions nothing about indemnification.
    const findings = fallbackReview("A plain paragraph with no legal clauses of note.");
    const indem = findings.find((f) => f.clause_type === "indemnification")!;
    expect(indem.present).toBe(false);
    expect(indem.risk).toBe("high"); // indemnification.riskIfAbsent
    expect(indem.redline).toBeTruthy();
  });

  it("detects MFN via the abbreviation and via the full phrase", () => {
    expect(
      fallbackReview("Buyer receives MFN pricing.").find((f) => f.clause_type === "most_favored_nation")!
        .present,
    ).toBe(true);
    expect(
      fallbackReview("A most favoured nation clause applies.").find(
        (f) => f.clause_type === "most_favored_nation",
      )!.present,
    ).toBe(true);
  });

  it("treats empty text as all-missing and never throws", () => {
    const findings = fallbackReview("");
    expect(findings).toHaveLength(CLAUSE_TYPES.length);
    expect(findings.every((f) => f.present === false)).toBe(true);
    expect(findings.every((f) => f.excerpt === null)).toBe(true);
    // Protective clauses still get a "missing" redline note.
    const indem = findings.find((f) => f.clause_type === "indemnification")!;
    expect(indem.redline).toBeTruthy();
  });

  it("tolerates non-string input without throwing", () => {
    // @ts-expect-error — exercising the runtime guard
    expect(() => fallbackReview(undefined)).not.toThrow();
  });
});
