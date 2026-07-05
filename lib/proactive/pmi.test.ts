// Tests for the PMI layer — provenance, staleness, and the modeled-fallback
// honesty. These are the cross-cutting guarantees the task mandates for
// intelligence-grounded drafts.
import { assessStaleness } from "./pmi/registry";
import { benchmarkToClaim, type PmiBenchmark } from "./pmi/types";
import { modeledPercentile } from "./pmi/carta.server";
import { PMI_TTL_SECONDS } from "./config";
import type { VerifiedResult } from "@/lib/source-hub-types";

function result(over: Partial<VerifiedResult<PmiBenchmark>> = {}): VerifiedResult<PmiBenchmark> {
  return {
    status: "success",
    verified: true,
    confidence: 0.9,
    timestamp: "2026-07-05T00:00:00Z",
    sources: [{ provider: "carta", endpoint: "carta:dwh", latency_ms: 12, verified: true, retrieved_at: "2026-07-05T00:00:00Z" }],
    data: { metric: "dpi", value: 1.8, unit: "x", percentile: 85, cohort: "2021 vintage", asOf: "2026-07-01T00:00:00Z" },
    ...over,
  };
}

describe("assessStaleness", () => {
  const now = Date.parse("2026-07-05T00:00:00Z");

  it("fresh data within TTL is not stale", () => {
    const s = assessStaleness("2026-07-05T00:00:00Z", "carta", now);
    expect(s.stale).toBe(false);
    expect(s.ttlSeconds).toBe(PMI_TTL_SECONDS.carta);
  });

  it("data older than the per-source TTL is stale", () => {
    // 2 days old vs carta's 12h TTL.
    const s = assessStaleness("2026-07-03T00:00:00Z", "carta", now);
    expect(s.stale).toBe(true);
  });

  it("an unparseable as-of date is treated as stale (fail safe)", () => {
    expect(assessStaleness("not-a-date", "carta", now).stale).toBe(true);
  });
});

describe("benchmarkToClaim — provenance is mandatory", () => {
  it("carries source, as-of, and confidence", () => {
    const c = benchmarkToClaim(result());
    expect(c).not.toBeNull();
    expect(c!.source).toBe("carta");
    expect(c!.asOf).toBe("2026-07-01T00:00:00Z");
    expect(c!.confidence).toBe(0.9);
    expect(c!.verified).toBe(true);
    expect(c!.claim).toMatch(/DPI/);
    expect(c!.claim).toMatch(/top-quartile/i); // P85 → top quartile
  });

  it("returns null for a failed lookup (never a fabricated claim)", () => {
    expect(benchmarkToClaim(result({ status: "failed", data: null as unknown as PmiBenchmark }))).toBeNull();
  });

  it("marks a modeled (unverified) benchmark as not-verified", () => {
    const c = benchmarkToClaim(
      result({
        verified: false,
        confidence: 0.5,
        sources: [{ provider: "carta·modeled", endpoint: "x", latency_ms: 1, verified: false, retrieved_at: "2026-07-01T00:00:00Z" }],
      }),
    );
    expect(c!.verified).toBe(false);
    expect(c!.source).toBe("carta·modeled");
  });
});

describe("modeledPercentile", () => {
  it("maps DPI multiples to a monotonic cohort percentile", () => {
    expect(modeledPercentile("dpi", 1.8)).toBe(85);
    expect(modeledPercentile("dpi", 0.7)).toBe(55);
    expect(modeledPercentile("dpi", 0.05)).toBe(25);
  });

  it("uses a distinct curve for TVPI/MOIC-style multiples", () => {
    expect(modeledPercentile("tvpi", 2.3)).toBe(85);
    expect(modeledPercentile("tvpi", 1.1)).toBe(40);
  });
});
