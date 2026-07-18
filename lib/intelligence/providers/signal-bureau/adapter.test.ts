// Tests for the Signal Bureau anti-corruption adapter — normalization, evidence
// discipline, additive-schema tolerance, and malformed-payload handling.
import { adaptSignal, adaptSignals, detectDrift } from "./adapter";
import type { SbSignal } from "./schema";

const NOW = Date.parse("2026-07-10T00:00:00.000Z");

function sig(over: Partial<SbSignal> = {}): SbSignal {
  return {
    id: "sig_1",
    entity: "Acme Corp",
    headline: "Acme accelerating in robotics",
    summary: "Attention surging",
    trajectory: "accelerating",
    receipts: [{ url: "https://src.example/a", title: "Report" }],
    confidence: 0.82,
    as_of: "2026-07-09T00:00:00.000Z",
    observed_at: "2026-07-08T00:00:00.000Z",
    schema_version: "sb.signals.v1",
    ...over,
  };
}

describe("adaptSignal", () => {
  it("normalizes a well-formed signal and preserves provenance", () => {
    const { observation } = adaptSignal(sig(), NOW);
    expect(observation).not.toBeNull();
    expect(observation!.provider).toBe("signal_bureau");
    expect(observation!.providerRecordId).toBe("sig_1");
    expect(observation!.providerSchemaVersion).toBe("sb.signals.v1");
    expect(observation!.evidenceStatus).toBe("receipted");
    expect(observation!.confidence).toBeCloseTo(0.82);
    expect(observation!.providerAsOf).toBe("2026-07-09T00:00:00.000Z");
    expect(observation!.sourceUrls).toContain("https://src.example/a");
    // Provider as-of and ingest time are never conflated: raw payload is verbatim.
    expect(observation!.rawPayload).toMatchObject({ id: "sig_1", trajectory: "accelerating" });
  });

  it("normalizes a 0–100 confidence scale to 0–1", () => {
    const { observation } = adaptSignal(sig({ confidence: undefined, score: 74 }), NOW);
    expect(observation!.confidence).toBeCloseTo(0.74);
  });

  it("distinguishes an unreceipted lead from receipted evidence", () => {
    const lead = adaptSignal(sig({ receipts: [], sources: [], corroborated: false }), NOW);
    expect(lead.observation!.evidenceStatus).toBe("unreceipted");

    const corr = adaptSignal(sig({ receipts: [], corroborated: true }), NOW);
    expect(corr.observation!.evidenceStatus).toBe("corroborated");
  });

  it("normalizes trajectory to a neutral band and derives an urgency hint", () => {
    expect(adaptSignal(sig({ trajectory: "surging" }), NOW).observation!.trajectory).toBe("accelerating");
    expect(adaptSignal(sig({ trajectory: "cooling" }), NOW).observation!.trajectory).toBe("decelerating");
    expect(adaptSignal(sig({ trajectory: undefined, velocity: 0.4 }), NOW).observation!.trajectory).toBe("accelerating");
    const accel = adaptSignal(sig({ trajectory: "accelerating" }), NOW).observation!;
    const decel = adaptSignal(sig({ trajectory: "declining" }), NOW).observation!;
    expect(accel.urgencyHint!).toBeGreaterThan(decel.urgencyHint!);
  });

  it("tolerates additive schema drift — keeps unknown fields, never throws", () => {
    const drifted = sig({ brand_new_field: { nested: true }, another_new: 5 } as Partial<SbSignal>);
    const { observation, drift } = adaptSignal(drifted, NOW);
    expect(observation).not.toBeNull();
    expect(drift).toEqual(expect.arrayContaining(["brand_new_field", "another_new"]));
    // Unknown fields survive in the raw payload.
    expect(observation!.rawPayload).toMatchObject({ brand_new_field: { nested: true } });
  });

  it("skips a malformed record (no title, no entity) rather than emitting an empty observation", () => {
    const { observation } = adaptSignal({ id: "x", confidence: 0.5 }, NOW);
    expect(observation).toBeNull();
  });

  it("handles missing evidence + missing timestamps without throwing", () => {
    const { observation } = adaptSignal({ entity: "Acme", headline: "Bare signal" }, NOW);
    expect(observation!.evidenceStatus).toBe("unreceipted");
    expect(observation!.observedAt).toBeNull();
    expect(observation!.providerAsOf).toBeNull();
    expect(observation!.confidence).toBe(0);
  });

  it("extracts primary + co-mentioned entity hints, de-duplicated", () => {
    const { observation } = adaptSignal(
      sig({ entity: "Acme Corp", entities: ["Acme Corp", { name: "Beta Capital", relationship: "investor" }] }),
      NOW,
    );
    const names = observation!.entityHints.map((h) => h.name);
    expect(names).toContain("Acme Corp");
    expect(names).toContain("Beta Capital");
    expect(names.filter((n) => n === "Acme Corp")).toHaveLength(1);
    expect(observation!.entityHints.find((h) => h.name === "Beta Capital")?.providerRelationship).toBe("investor");
  });
});

describe("adaptSignals", () => {
  it("aggregates drift across a batch and drops malformed records", () => {
    const { observations, driftKeys } = adaptSignals(
      [sig(), { id: "bad" }, sig({ id: "sig_2", weird_field: 1 } as Partial<SbSignal>)],
      NOW,
    );
    expect(observations).toHaveLength(2);
    expect(driftKeys).toContain("weird_field");
  });
});

describe("detectDrift", () => {
  it("returns only unknown top-level keys", () => {
    expect(detectDrift(sig())).toEqual([]);
    expect(detectDrift(sig({ mystery: 1 } as Partial<SbSignal>))).toEqual(["mystery"]);
  });
});
