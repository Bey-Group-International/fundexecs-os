import {
  aggregateRisk,
  fallbackDiligence,
  isValidFinding,
  DILIGENCE_LENSES,
  type Finding,
} from "@/lib/diligence-agent";

function finding(lens: Finding["lens"], severity: Finding["severity"]): Finding {
  return {
    lens,
    severity,
    title: `${lens} ${severity}`,
    detail: "detail",
    recommendation: "recommendation",
  };
}

describe("aggregateRisk — scoring & levels", () => {
  it("no findings → score 0, level low, all lenses empty", () => {
    const r = aggregateRisk([]);
    expect(r.score).toBe(0);
    expect(r.level).toBe("low");
    for (const { key } of DILIGENCE_LENSES) {
      expect(r.byLens[key]).toEqual({ count: 0, top: null });
    }
  });

  it("a single low finding stays 'low'", () => {
    const r = aggregateRisk([finding("legal", "low")]);
    expect(r.score).toBe(5); // 1 - (1 - 0.05)
    expect(r.level).toBe("low");
  });

  it("a single high finding is 'elevated'", () => {
    const r = aggregateRisk([finding("financial", "high")]);
    expect(r.score).toBe(35); // 1 - (1 - 0.35)
    expect(r.level).toBe("elevated");
  });

  it("a single critical finding lands in 'high'", () => {
    const r = aggregateRisk([finding("legal", "critical")]);
    expect(r.score).toBe(60); // 1 - (1 - 0.6)
    expect(r.level).toBe("high");
  });

  it("two critical findings compound into 'severe'", () => {
    const r = aggregateRisk([finding("legal", "critical"), finding("financial", "critical")]);
    expect(r.score).toBe(84); // 1 - 0.4 * 0.4
    expect(r.level).toBe("severe");
  });

  it("score saturates toward but never exceeds 100", () => {
    const many = Array.from({ length: 30 }, () => finding("commercial", "critical"));
    const r = aggregateRisk(many);
    expect(r.score).toBeGreaterThan(99);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it("ignores findings with an invalid lens or severity", () => {
    const bad = { lens: "bogus", severity: "high" } as unknown as Finding;
    const r = aggregateRisk([bad, finding("legal", "high")]);
    expect(r.score).toBe(35); // only the valid high counts
    expect(r.byLens.legal.count).toBe(1);
  });
});

describe("aggregateRisk — byLens grouping", () => {
  it("counts per lens and tracks the top (worst) severity", () => {
    const r = aggregateRisk([
      finding("legal", "low"),
      finding("legal", "critical"),
      finding("legal", "medium"),
      finding("compliance", "high"),
    ]);
    expect(r.byLens.legal.count).toBe(3);
    expect(r.byLens.legal.top).toBe("critical");
    expect(r.byLens.compliance.count).toBe(1);
    expect(r.byLens.compliance.top).toBe("high");
    expect(r.byLens.financial).toEqual({ count: 0, top: null });
  });
});

describe("fallbackDiligence — keyword detection", () => {
  it("empty text → single low 'insufficient data' finding", () => {
    const r = fallbackDiligence("   ");
    expect(r).toHaveLength(1);
    expect(r[0].severity).toBe("low");
    expect(r[0].title).toMatch(/insufficient data/i);
  });

  it("detects litigation as a legal high", () => {
    const r = fallbackDiligence("The company is subject to ongoing litigation with a former partner.");
    const legal = r.find((f) => f.lens === "legal");
    expect(legal).toBeDefined();
    expect(legal!.severity).toBe("high");
  });

  it("maps lens keywords to the right lens", () => {
    const text =
      "There is a going concern note, heavy customer concentration, a key person dependency, and GDPR exposure.";
    const lenses = new Set(fallbackDiligence(text).map((f) => f.lens));
    expect(lenses.has("financial")).toBe(true);
    expect(lenses.has("commercial")).toBe(true);
    expect(lenses.has("operational")).toBe(true);
    expect(lenses.has("compliance")).toBe(true);
  });

  it("detects sanctions/AML as a compliance finding", () => {
    const r = fallbackDiligence("Screening flagged potential OFAC sanctions and AML gaps.");
    expect(r.some((f) => f.lens === "compliance")).toBe(true);
  });

  it("non-empty text with no signals → single low 'no material signals' finding", () => {
    const r = fallbackDiligence("The weather was pleasant and the office had good coffee.");
    expect(r).toHaveLength(1);
    expect(r[0].severity).toBe("low");
    expect(r[0].title).toMatch(/no material risk signals/i);
  });

  it("never throws on odd input and always returns findings", () => {
    expect(() => fallbackDiligence("")).not.toThrow();
    expect(fallbackDiligence("").length).toBeGreaterThan(0);
  });
});

describe("isValidFinding", () => {
  it("accepts a well-formed finding and rejects malformed ones", () => {
    expect(isValidFinding(finding("legal", "high"))).toBe(true);
    expect(isValidFinding({ lens: "legal", severity: "nope", title: "x", detail: "y", recommendation: "z" })).toBe(false);
    expect(isValidFinding({ lens: "bogus", severity: "high", title: "x", detail: "y", recommendation: "z" })).toBe(false);
    expect(isValidFinding(null)).toBe(false);
  });
});
