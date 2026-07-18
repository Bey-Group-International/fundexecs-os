// Golden tests for the kpi-ingest deterministic core.
import { kpiIngest, type KpiIngestInput } from "./kpi-ingest";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "portfolio_ops" };
const run = (input: KpiIngestInput) => kpiIngest.run(input, ctx);

describe("kpi-ingest core", () => {
  it("normalizes KPIs, computes variance, and marks a higher-better metric on track", () => {
    const r = run({
      companyName: "Acme Widgets",
      kpis: [
        { name: "ARR", value: 12, unit: "$M", period: "Q2-2026", target: 10, direction: "higher_better" },
      ],
    });
    expect(r.structured.kpiCount).toBe(1);
    expect(r.structured.onTrackCount).toBe(1);
    expect(r.structured.offTrackCount).toBe(0);
    const k = r.structured.normalized[0];
    expect(k.variance).toBe(2); // 12 - 10
    expect(k.status).toBe("on_track");
    // The provided value is a FACT; the variance is a CALCULATION.
    expect(r.sources.find((s) => s.label === "ARR")?.kind).toBe("fact");
    expect(r.sources.find((s) => s.label === "ARR variance")?.kind).toBe("calculation");
  });

  it("marks a lower-better metric on/off track by polarity", () => {
    const r = run({
      companyName: "Acme",
      kpis: [
        { name: "Churn", value: 3, target: 5, direction: "lower_better" }, // 3 <= 5 → on_track
        { name: "CAC", value: 8, target: 5, direction: "lower_better" }, // 8 > 5 → off_track
      ],
    });
    expect(r.structured.normalized[0].status).toBe("on_track");
    expect(r.structured.normalized[1].status).toBe("off_track");
    expect(r.structured.onTrackCount).toBe(1);
    expect(r.structured.offTrackCount).toBe(1);
  });

  it("defaults to higher_better when direction is omitted", () => {
    const r = run({ companyName: "Acme", kpis: [{ name: "NRR", value: 90, target: 100 }] });
    expect(r.structured.normalized[0].status).toBe("off_track"); // 90 < 100
  });

  it("flags a missing KPI value instead of inventing it", () => {
    const r = run({ companyName: "Mystery Co", kpis: [{ name: "EBITDA margin", target: 20 }] });
    const k = r.structured.normalized[0];
    expect(k.value).toBeNull();
    expect(k.variance).toBeNull();
    expect(k.status).toBe("unknown");
    expect(r.structured.missingKpis).toContain("EBITDA margin");
    // Nothing fabricated: no fact source carries the missing value.
    expect(r.sources.some((s) => s.kind === "fact" && s.label === "EBITDA margin")).toBe(false);
  });

  it("marks no_target when a value has no target to compare against", () => {
    const r = run({ companyName: "Acme", kpis: [{ name: "Headcount", value: 42 }] });
    const k = r.structured.normalized[0];
    expect(k.status).toBe("no_target");
    expect(k.variance).toBeNull();
    expect(r.structured.onTrackCount).toBe(0);
    expect(r.structured.offTrackCount).toBe(0);
  });

  it("flags missing required inputs when no KPIs are supplied", () => {
    const r = run({ companyName: "Acme" });
    expect(r.structured.kpiCount).toBe(0);
    expect(r.structured.missingFields).toContain("kpis");
    expect(r.completeness).toBe(0);
    expect(r.structured.recommendedAction).toMatch(/companyName and at least one KPI/i);
  });

  it("always produces a recommended next action and a narrative", () => {
    const r = run({ companyName: "Acme", kpis: [{ name: "ARR", value: 5, target: 5 }] });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
  });
});
