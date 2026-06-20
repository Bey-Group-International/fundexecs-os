// lib/mission-control.test.ts
// Unit tests for the pure shaping helpers behind the mission-control strip.
// No database, no server-only imports — only the exported pure functions are
// exercised here. The aggregator (getMissionControl) is the impure wrapper and
// is not tested here.
import {
  scoreTone,
  formatMultiple,
  formatExecuteMetric,
} from "@/lib/mission-control";

describe("scoreTone", () => {
  it("maps a strong score to good", () => {
    expect(scoreTone(70)).toBe("good");
    expect(scoreTone(85)).toBe("good");
    expect(scoreTone(100)).toBe("good");
  });

  it("maps a mid score to warn", () => {
    expect(scoreTone(35)).toBe("warn");
    expect(scoreTone(50)).toBe("warn");
    expect(scoreTone(69)).toBe("warn");
  });

  it("maps a low score to muted", () => {
    expect(scoreTone(0)).toBe("muted");
    expect(scoreTone(34)).toBe("muted");
  });

  it("treats a null score (no 0–100) as muted", () => {
    expect(scoreTone(null)).toBe("muted");
  });
});

describe("formatMultiple", () => {
  it("renders a one-decimal multiple", () => {
    expect(formatMultiple(1.8)).toBe("1.8x");
    expect(formatMultiple(2.45)).toBe("2.5x"); // rounds to one decimal
  });

  it("trims a trailing .0 to a whole number", () => {
    expect(formatMultiple(2)).toBe("2x");
    expect(formatMultiple(1.0)).toBe("1x");
    expect(formatMultiple(3.04)).toBe("3x");
  });

  it("renders a dash for null", () => {
    expect(formatMultiple(null)).toBe("—");
  });
});

describe("formatExecuteMetric", () => {
  it("combines stage, multiple, and hero label", () => {
    expect(formatExecuteMetric("Operating", 1.8, "TVPI")).toBe("Operating · 1.8x TVPI");
    expect(formatExecuteMetric("Harvesting", 2, "Gross MOIC")).toBe(
      "Harvesting · 2x Gross MOIC",
    );
  });

  it("falls back to just the stage when there is no multiple", () => {
    expect(formatExecuteMetric("Pre-deployment", null, "TVPI")).toBe("Pre-deployment");
  });
});
