// Tests for the Carta benchmark mapper + question builder — the pure glue
// between a live Carta response and PmiBenchmark. Ensures a live value is only
// emitted when there is a usable number (else the caller falls back to modeled).
import { mapCartaBenchmark, questionForMetric, modeledPercentile } from "./carta.server";

describe("mapCartaBenchmark", () => {
  it("maps a clean structured payload", () => {
    const b = mapCartaBenchmark(
      { value: 1.8, unit: "x", percentile: 85, cohort: "2021 vintage", as_of: "2026-07-01" },
      "dpi",
    );
    expect(b).toEqual({
      metric: "dpi",
      value: 1.8,
      unit: "x",
      percentile: 85,
      cohort: "2021 vintage",
      asOf: "2026-07-01",
    });
  });

  it("tolerates nested data + string numbers + camelCase as-of", () => {
    const b = mapCartaBenchmark({ data: { value: "1.80x", percentile: "82", asOf: "2026-06-30" } }, "dpi");
    expect(b!.value).toBe(1.8);
    expect(b!.percentile).toBe(82);
    expect(b!.asOf).toBe("2026-06-30");
  });

  it("infers pct unit for net_irr", () => {
    const b = mapCartaBenchmark({ value: 18.5 }, "net_irr");
    expect(b!.unit).toBe("pct");
  });

  it("returns null when there is no usable numeric value (→ caller falls back)", () => {
    expect(mapCartaBenchmark({ note: "no data" }, "dpi")).toBeNull();
    expect(mapCartaBenchmark("garbage", "dpi")).toBeNull();
    expect(mapCartaBenchmark(null, "dpi")).toBeNull();
  });

  it("defaults the cohort label when Carta omits one", () => {
    expect(mapCartaBenchmark({ value: 1.2 }, "tvpi")!.cohort).toBe("Carta peer cohort");
  });
});

describe("questionForMetric", () => {
  it("names the metric and folds in the cohort scope", () => {
    const q = questionForMetric("dpi", { vintage: 2021, strategy: "buyout" });
    expect(q).toMatch(/DPI/);
    expect(q).toMatch(/percentile/i);
    expect(q).toMatch(/2021/);
  });
});

describe("modeledPercentile (unchanged fallback curve)", () => {
  it("still maps multiples to a monotonic percentile", () => {
    expect(modeledPercentile("dpi", 1.8)).toBe(85);
    expect(modeledPercentile("tvpi", 1.1)).toBe(40);
  });
});
