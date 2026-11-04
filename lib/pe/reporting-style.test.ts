import { formatMetricLine, parseReportingStyle } from "./reporting-style";

describe("parseReportingStyle", () => {
  it("keeps only valid values and reports each dropped one", () => {
    const p = parseReportingStyle({ currency: " USD ", units: "m", decimals: 1, labels: { netIrr: " Net IRR (net of fees) ", nav: "", bogus: "x", dpi: "d".repeat(50) } });
    expect(p.style).toEqual({ currency: "USD", units: "m", decimals: 1, labels: { netIrr: "Net IRR (net of fees)" } });
    expect(p.dropped.join(" ")).toMatch(/labels\.bogus: unknown metric/);
    expect(p.dropped.join(" ")).toMatch(/labels\.dpi: over 40 characters/);
  });

  it("rejects bad decimals and over-long or non-text words", () => {
    const p = parseReportingStyle({ currency: "x".repeat(20), units: 5, decimals: 2.5 });
    expect(p.style).toBeNull();
    expect(p.dropped).toHaveLength(3);
    expect(parseReportingStyle({ decimals: 9 }).style).toBeNull();
    expect(parseReportingStyle({ decimals: 0 }).style).toEqual({ decimals: 0 }); // zero decimals is a real choice
  });

  it("is null for nothing usable, and never throws on junk", () => {
    for (const junk of [null, undefined, "x", 3, [], {}, { currency: "", units: "  ", decimals: null, labels: { nav: "" } }]) expect(parseReportingStyle(junk).style).toBeNull();
  });
});

describe("formatMetricLine", () => {
  it("is identical to the standing format with no style", () => {
    expect(formatMetricLine("nav", 12.3)).toBe("NAV: 12.3");
    expect(formatMetricLine("dpi", 0.8)).toBe("DPI: 0.8x");
    expect(formatMetricLine("tvpi", 1.4)).toBe("TVPI: 1.4x");
    expect(formatMetricLine("netIrr", 14)).toBe("Net IRR: 14%");
  });

  it("applies currency, unit attachment, decimals and labels, and nothing else", () => {
    const style = { currency: "USD", units: "m", decimals: 2, labels: { netIrr: "Net IRR (net of fees)" } };
    expect(formatMetricLine("nav", 12.3, style)).toBe("NAV: USD 12.30m");
    expect(formatMetricLine("dpi", 0.8, style)).toBe("DPI: 0.80x");
    expect(formatMetricLine("netIrr", 14, style)).toBe("Net IRR (net of fees): 14.00%");
    expect(formatMetricLine("nav", 1.5, { units: "million" })).toBe("NAV: 1.5 million"); // a word is spaced
    expect(formatMetricLine("nav", 12.345, { decimals: 0 })).toBe("NAV: 12");
  });
});
