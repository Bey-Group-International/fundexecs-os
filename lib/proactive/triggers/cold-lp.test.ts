// Tests for the cold-LP trigger — the canonical initiative surface. Focus on
// the pure pieces: urgency mapping and PROVENANCE ON THE GENERATED DRAFT (the
// objective must cite source + as-of when intelligence claims are present).
import { coldLpTrigger, silenceUrgency } from "./cold-lp";
import type { EnrichedSignal } from "./types";
import type { Signal, ProvenancedClaim } from "@/lib/proactive/types";

function signal(days: number): Signal {
  return {
    triggerKey: "cold_lp",
    hub: "source",
    signalClass: "market",
    subjectType: "investor",
    subjectId: "1",
    subjectName: "Meridian Family Office",
    summary: "went cold",
    occurredAt: "2026-05-01T00:00:00Z",
    baseConfidence: 60,
    baseUrgency: silenceUrgency(days),
    metadata: { daysSilent: days },
  };
}

const claim: ProvenancedClaim = {
  claim: "DPI 1.80x — top-quartile (P85) vs 2021 vintage",
  source: "carta",
  asOf: "2026-07-01",
  confidence: 0.9,
  verified: true,
};

describe("silenceUrgency", () => {
  it("rises with days silent", () => {
    expect(silenceUrgency(10)).toBeLessThan(silenceUrgency(45));
    expect(silenceUrgency(45)).toBeLessThan(silenceUrgency(95));
    expect(silenceUrgency(200)).toBe(90);
  });
});

describe("cold-LP draft composition — provenance on the generated draft", () => {
  it("embeds the intelligence claim AND its source when grounded", () => {
    const enriched: EnrichedSignal = { signal: signal(60), claims: [claim], urgency: 74, confidence: 80 };
    const { objective, title } = coldLpTrigger.compose(enriched);
    expect(objective).toContain("Meridian Family Office");
    expect(objective).toContain("DPI 1.80x");
    expect(objective).toMatch(/cite source carta/i);
    expect(objective).toMatch(/as-of/i);
    expect(title).toMatch(/warm re-approach/i);
  });

  it("draft is explicitly draft-only (does not authorize a send)", () => {
    const enriched: EnrichedSignal = { signal: signal(60), claims: [claim], urgency: 74, confidence: 80 };
    const { objective } = coldLpTrigger.compose(enriched);
    expect(objective).toMatch(/do not send/i);
  });

  it("omits grounding language when there is no intelligence to cite (no fabrication)", () => {
    const enriched: EnrichedSignal = { signal: signal(60), claims: [], urgency: 62, confidence: 60 };
    const { objective } = coldLpTrigger.compose(enriched);
    expect(objective).not.toMatch(/cite source/i);
  });

  it("carries the correct outward action + hub for gating", () => {
    expect(coldLpTrigger.sendAction).toBe("send_outreach"); // Tier 2 — gated
    expect(coldLpTrigger.hub).toBe("source");
    expect(coldLpTrigger.signalClass).toBe("market");
  });
});
