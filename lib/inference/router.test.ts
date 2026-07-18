// Tests for the pure capability-based model router.
import { selectRoute } from "./router";
import type { ModelSpec, RoutableProvider } from "./types";

function model(over: Partial<ModelSpec> & Pick<ModelSpec, "id" | "tier">): ModelSpec {
  return {
    provider: "anthropic",
    capabilities: [],
    contextTokens: 200_000,
    ...over,
  };
}

const providers = (models: ModelSpec[], available = true): RoutableProvider[] => [
  { key: "anthropic", available, models },
];

describe("selectRoute", () => {
  it("returns null when no provider is available", () => {
    const r = selectRoute({}, providers([model({ id: "m", tier: "fast" })], false));
    expect(r).toBeNull();
  });

  it("filters by capability", () => {
    const models = [
      model({ id: "fast", tier: "fast", capabilities: ["low_latency_classification"] }),
      model({ id: "reasoner", tier: "balanced", capabilities: ["financial_reasoning"] }),
    ];
    const r = selectRoute({ capability: "financial_reasoning" }, providers(models));
    expect(r?.model.id).toBe("reasoner");
  });

  it("returns null when no model has the capability", () => {
    const r = selectRoute({ capability: "image_understanding" }, providers([model({ id: "m", tier: "fast", capabilities: ["tool_use"] })]));
    expect(r).toBeNull();
  });

  it("prefers the requested tier", () => {
    const models = [
      model({ id: "fast", tier: "fast", capabilities: ["financial_reasoning"] }),
      model({ id: "high", tier: "high_assurance", capabilities: ["financial_reasoning"] }),
    ];
    expect(selectRoute({ capability: "financial_reasoning", preferTier: "high_assurance" }, providers(models))?.model.id).toBe("high");
    expect(selectRoute({ capability: "financial_reasoning", preferTier: "fast" }, providers(models))?.model.id).toBe("fast");
  });

  it("routes restricted data only to a private deployment or an allowed region", () => {
    const cloud = model({ id: "cloud", tier: "high_assurance", capabilities: ["financial_reasoning"] });
    const priv = model({ id: "onprem", tier: "balanced", capabilities: ["financial_reasoning"], privateDeployment: true });
    // Cloud-only set + restricted → no route.
    expect(selectRoute({ sensitivity: "restricted", capability: "financial_reasoning" }, providers([cloud]))).toBeNull();
    // Private deployment available → routes there.
    expect(selectRoute({ sensitivity: "restricted", capability: "financial_reasoning" }, providers([cloud, priv]))?.model.id).toBe("onprem");
  });

  it("respects a region constraint", () => {
    const us = model({ id: "us", tier: "balanced", capabilities: ["tool_use"], regions: ["us"] });
    const eu = model({ id: "eu", tier: "balanced", capabilities: ["tool_use"], regions: ["eu"] });
    expect(selectRoute({ region: "eu", capability: "tool_use" }, providers([us, eu]))?.model.id).toBe("eu");
    expect(selectRoute({ region: "apac", capability: "tool_use" }, providers([us, eu]))).toBeNull();
  });

  it("excludes models whose context window is too small", () => {
    const small = model({ id: "small", tier: "fast", capabilities: ["long_context"], contextTokens: 8_000 });
    const big = model({ id: "big", tier: "balanced", capabilities: ["long_context"], contextTokens: 200_000 });
    expect(selectRoute({ capability: "long_context", contextTokens: 100_000 }, providers([small, big]))?.model.id).toBe("big");
  });

  it("enforces a cost ceiling", () => {
    const cheap = model({ id: "cheap", tier: "fast", capabilities: ["tool_use"], costPer1kOutput: 4 });
    const pricey = model({ id: "pricey", tier: "high_assurance", capabilities: ["tool_use"], costPer1kOutput: 25 });
    const r = selectRoute({ capability: "tool_use", costCeilingPer1kOutput: 10 }, providers([cheap, pricey]));
    expect(r?.model.id).toBe("cheap");
  });

  it("biases restricted / high-assurance work toward stronger tiers", () => {
    const models = [
      model({ id: "fast", tier: "fast", capabilities: ["high_assurance_review"] }),
      model({ id: "high", tier: "high_assurance", capabilities: ["high_assurance_review"] }),
    ];
    expect(selectRoute({ capability: "high_assurance_review" }, providers(models))?.model.id).toBe("high");
  });

  it("is deterministic (stable tie-break)", () => {
    const models = [
      model({ id: "b", tier: "balanced", capabilities: ["tool_use"], costPer1kOutput: 15 }),
      model({ id: "a", tier: "balanced", capabilities: ["tool_use"], costPer1kOutput: 15 }),
    ];
    const r1 = selectRoute({ capability: "tool_use" }, providers(models));
    const r2 = selectRoute({ capability: "tool_use" }, providers(models));
    expect(r1?.model.id).toBe(r2?.model.id);
  });
});
