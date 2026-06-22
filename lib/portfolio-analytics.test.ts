// lib/portfolio-analytics.test.ts
import {
  gradeScore,
  computePortfolioHealth,
  formatMOIC,
  formatIRR,
  varianceLabel,
  SEVERITY_STYLES,
  type RiskSeverity,
} from "@/lib/portfolio-analytics";

// --- gradeScore --------------------------------------------------------------
describe("gradeScore", () => {
  it("returns A for score >= 85", () => {
    expect(gradeScore(85)).toBe("A");
    expect(gradeScore(100)).toBe("A");
  });

  it("returns B for score 70-84", () => {
    expect(gradeScore(70)).toBe("B");
    expect(gradeScore(84)).toBe("B");
  });

  it("returns C for score 55-69", () => {
    expect(gradeScore(55)).toBe("C");
    expect(gradeScore(69)).toBe("C");
  });

  it("returns D for score 40-54", () => {
    expect(gradeScore(40)).toBe("D");
    expect(gradeScore(54)).toBe("D");
  });

  it("returns F for score < 40", () => {
    expect(gradeScore(0)).toBe("F");
    expect(gradeScore(39)).toBe("F");
  });
});

// --- computePortfolioHealth --------------------------------------------------
describe("computePortfolioHealth", () => {
  const goodParams = {
    avgMOIC: 2.0,
    targetMOIC: 2.0,
    underperformingCount: 0,
    totalAssets: 10,
    maxConcentrationPct: 15,
    riskAlertCount: 0,
  };

  it("returns all required fields", () => {
    const result = computePortfolioHealth(goodParams);
    expect(result).toHaveProperty("overall");
    expect(result).toHaveProperty("performance");
    expect(result).toHaveProperty("diversification");
    expect(result).toHaveProperty("momentum");
    expect(result).toHaveProperty("grade");
    expect(result).toHaveProperty("summary");
  });

  it("a well-performing portfolio scores high and earns grade A", () => {
    const result = computePortfolioHealth(goodParams);
    expect(result.overall).toBeGreaterThanOrEqual(70);
    expect(["A", "B"]).toContain(result.grade);
  });

  it("high concentration reduces the diversification score", () => {
    const highConc = computePortfolioHealth({ ...goodParams, maxConcentrationPct: 50 });
    const lowConc = computePortfolioHealth({ ...goodParams, maxConcentrationPct: 15 });
    expect(highConc.diversification).toBeLessThan(lowConc.diversification);
  });

  it("all underperforming assets yields momentum of 0", () => {
    const result = computePortfolioHealth({
      ...goodParams,
      underperformingCount: 10,
      totalAssets: 10,
    });
    expect(result.momentum).toBe(0);
  });

  it("no underperforming assets yields maximum momentum (20)", () => {
    const result = computePortfolioHealth({ ...goodParams, underperformingCount: 0, totalAssets: 5 });
    expect(result.momentum).toBe(20);
  });

  it("overall = performance + diversification + momentum", () => {
    const result = computePortfolioHealth(goodParams);
    expect(result.overall).toBe(result.performance + result.diversification + result.momentum);
  });

  it("overall score does not exceed 100", () => {
    const result = computePortfolioHealth({
      avgMOIC: 3.0,
      targetMOIC: 1.0,
      underperformingCount: 0,
      totalAssets: 10,
      maxConcentrationPct: 0,
      riskAlertCount: 0,
    });
    expect(result.overall).toBeLessThanOrEqual(100);
  });
});

// --- formatMOIC & formatIRR --------------------------------------------------
describe("formatMOIC", () => {
  it("returns — for null/undefined/0", () => {
    expect(formatMOIC(null)).toBe("—");
    expect(formatMOIC(undefined)).toBe("—");
    expect(formatMOIC(0)).toBe("—");
  });

  it("formats with 2 decimal places and trailing x", () => {
    expect(formatMOIC(2.5)).toBe("2.50x");
    expect(formatMOIC(1)).toBe("1.00x");
  });
});

describe("formatIRR", () => {
  it("returns — for null/undefined", () => {
    expect(formatIRR(null)).toBe("—");
    expect(formatIRR(undefined)).toBe("—");
  });

  it("formats with 1 decimal place and trailing %", () => {
    expect(formatIRR(18.5)).toBe("18.5%");
    expect(formatIRR(0)).toBe("0.0%");
  });
});

// --- varianceLabel -----------------------------------------------------------
describe("varianceLabel", () => {
  it("returns — when actual or target is missing", () => {
    expect(varianceLabel(null, 2.0)).toBe("—");
    expect(varianceLabel(2.0, null)).toBe("—");
    expect(varianceLabel(null, null)).toBe("—");
  });

  it("returns — when target is 0", () => {
    expect(varianceLabel(2.0, 0)).toBe("—");
  });

  it("shows positive delta with + sign", () => {
    expect(varianceLabel(2.2, 2.0)).toBe("+10.0%");
  });

  it("shows negative delta without + sign", () => {
    expect(varianceLabel(1.8, 2.0)).toBe("-10.0%");
  });
});

// --- SEVERITY_STYLES ---------------------------------------------------------
describe("SEVERITY_STYLES", () => {
  it("has styles for all severity levels", () => {
    const severities: RiskSeverity[] = ["low", "medium", "high", "critical"];
    for (const s of severities) {
      expect(SEVERITY_STYLES[s].border).toBeTruthy();
      expect(SEVERITY_STYLES[s].text).toBeTruthy();
      expect(SEVERITY_STYLES[s].bg).toBeTruthy();
    }
  });

  it("critical uses red coloring", () => {
    expect(SEVERITY_STYLES.critical.text).toContain("red");
  });
});
