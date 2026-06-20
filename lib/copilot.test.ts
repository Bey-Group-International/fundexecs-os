// lib/copilot.test.ts
// Unit tests for the pure Earn-copilot routing: path → context, context →
// on-point specialist, and context → suggestions. No DB, no React.
import {
  copilotContextFromPath,
  onPointAgent,
  suggestionsFor,
  suggestionTier,
  contextPreamble,
} from "@/lib/copilot";

describe("copilotContextFromPath", () => {
  it("parses a hub/module route", () => {
    const ctx = copilotContextFromPath("/run/diligence");
    expect(ctx).toMatchObject({ hub: "run", module: "diligence", scope: "run/diligence", dealId: null });
  });

  it("parses a bare hub route", () => {
    expect(copilotContextFromPath("/source")).toMatchObject({ hub: "source", module: null, scope: "source" });
  });

  it("parses the deal war room", () => {
    expect(copilotContextFromPath("/deal/abc-123")).toMatchObject({
      hub: "run",
      module: "deal",
      dealId: "abc-123",
      scope: "deal",
    });
  });

  it("parses a hub/module inside a session frame", () => {
    expect(copilotContextFromPath("/session/s1/execute/reporting")).toMatchObject({
      hub: "execute",
      module: "reporting",
      scope: "execute/reporting",
    });
  });

  it("falls back to a generic scope for unknown routes", () => {
    expect(copilotContextFromPath("/dashboard")).toMatchObject({ hub: null, scope: "dashboard" });
  });

  it("strips query strings", () => {
    expect(copilotContextFromPath("/run/risk?x=1").scope).toBe("run/risk");
  });
});

describe("onPointAgent", () => {
  it("routes a module to its specialist", () => {
    expect(onPointAgent(copilotContextFromPath("/run/diligence"))).toBe("diligence");
    expect(onPointAgent(copilotContextFromPath("/run/underwriting"))).toBe("analyst");
    expect(onPointAgent(copilotContextFromPath("/source/lp_pipeline"))).toBe("capital_raiser");
    expect(onPointAgent(copilotContextFromPath("/execute/capital_events"))).toBe("fund_admin");
    expect(onPointAgent(copilotContextFromPath("/deal/x"))).toBe("diligence");
  });

  it("falls back to a hub default for a bare hub", () => {
    expect(onPointAgent(copilotContextFromPath("/execute"))).toBe("portfolio_ops");
  });

  it("falls back to Earn off-hub", () => {
    expect(onPointAgent(copilotContextFromPath("/dashboard"))).toBe("associate");
  });
});

describe("suggestionsFor", () => {
  it("returns module-specific suggestions when present", () => {
    const s = suggestionsFor(copilotContextFromPath("/run/diligence"));
    expect(s.length).toBeGreaterThan(0);
    expect(s.every((x) => x.prompt.length > 0)).toBe(true);
    expect(s.map((x) => x.id)).toContain("dd-checklist");
  });

  it("falls back to hub suggestions for a bare hub", () => {
    const s = suggestionsFor(copilotContextFromPath("/run"));
    expect(s.map((x) => x.id)).toContain("run-next");
  });

  it("falls back to the generic set off-hub", () => {
    const s = suggestionsFor(copilotContextFromPath("/dashboard"));
    expect(s.map((x) => x.id)).toContain("whats-next");
  });
});

describe("suggestionTier", () => {
  it("returns a tier for action suggestions and null otherwise", () => {
    const lp = suggestionsFor(copilotContextFromPath("/source/lp_pipeline"));
    const outreach = lp.find((s) => s.id === "lp-outreach")!;
    expect(suggestionTier(outreach)).toBe(1); // drafting only → Tier 1 (free)
    const capCall = suggestionsFor(copilotContextFromPath("/execute/capital_events"))[0];
    expect(suggestionTier(capCall)).toBe(2); // distribute_report → Tier 2
    const dd = suggestionsFor(copilotContextFromPath("/run/diligence"))[0];
    expect(suggestionTier(dd)).toBeNull(); // no outward action
  });
});

describe("contextPreamble", () => {
  it("names the deal war room", () => {
    expect(contextPreamble(copilotContextFromPath("/deal/xyz"))).toMatch(/deal war room/i);
  });
  it("names the hub and module", () => {
    expect(contextPreamble(copilotContextFromPath("/run/diligence"))).toMatch(/run › diligence/i);
  });
});
