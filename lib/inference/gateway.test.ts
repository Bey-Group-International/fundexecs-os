// Tests for the gateway + registry (degraded/no-provider path + env gating).
import { inferenceConfigured, runInference } from "./gateway";
import { anthropicProvider } from "./anthropic";
import { availableInferenceProviders, routableProviders } from "./registry";

describe("inference registry + gateway (no credentials)", () => {
  const original = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterAll(() => {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  });

  it("reports the Anthropic provider unavailable without a key", () => {
    expect(anthropicProvider.available()).toBe(false);
    expect(availableInferenceProviders()).toHaveLength(0);
    expect(inferenceConfigured()).toBe(false);
  });

  it("returns a degraded result (never throws) when no provider is available", async () => {
    const r = await runInference({ messages: [{ role: "user", content: "hi" }], capability: "financial_reasoning" });
    expect(r.ok).toBe(false);
    expect(r.degraded).toBe(true);
    expect(r.text).toBeNull();
    expect(r.provider).toBeNull();
  });

  it("degrades on a pinned model no provider can serve", async () => {
    const r = await runInference({ messages: [{ role: "user", content: "hi" }], model: "made-up-model" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("made-up-model");
  });

  it("exposes routable providers with capability-bearing models", () => {
    const routable = routableProviders();
    expect(routable.map((p) => p.key)).toContain("anthropic");
    const anthropic = routable.find((p) => p.key === "anthropic")!;
    expect(anthropic.models.length).toBeGreaterThan(0);
    expect(anthropic.models.some((m) => m.capabilities.includes("financial_reasoning"))).toBe(true);
    // Tiers present so the router has a real spread to choose from.
    expect(new Set(anthropic.models.map((m) => m.tier))).toEqual(new Set(["fast", "balanced", "high_assurance"]));
  });

  it("becomes available when a key is present", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    expect(anthropicProvider.available()).toBe(true);
    expect(inferenceConfigured()).toBe(true);
  });
});
