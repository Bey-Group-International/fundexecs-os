import {
  ROUTING_GOLDENS,
  evaluateRoutingCase,
  evaluateRoutingGoldens,
} from "./intelligence-eval";

describe("intelligence routing evaluation harness", () => {
  it("passes every golden routing case", () => {
    const summary = evaluateRoutingGoldens();
    expect(summary).toMatchObject({
      total: ROUTING_GOLDENS.length,
      passed: ROUTING_GOLDENS.length,
      failed: 0,
      score: 1,
      failures: [],
    });
  });

  it("returns per-case actual and expected values for audit evidence", () => {
    const result = evaluateRoutingCase(ROUTING_GOLDENS[0]);
    expect(result.ok).toBe(true);
    expect(result.actual).toEqual({
      stage: ROUTING_GOLDENS[0].expected.stage,
      engine: ROUTING_GOLDENS[0].expected.engine,
      executive: ROUTING_GOLDENS[0].expected.executive,
      confidence: ROUTING_GOLDENS[0].expected.confidence,
    });
  });

  it("reports failures with a normalized score", () => {
    const bad = {
      ...ROUTING_GOLDENS[0],
      expected: {
        ...ROUTING_GOLDENS[0].expected,
        engine: "Reporting Engine" as const,
      },
    };
    const summary = evaluateRoutingGoldens([ROUTING_GOLDENS[0], bad]);
    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.score).toBe(0.5);
    expect(summary.failures[0].id).toBe(bad.id);
  });
});
