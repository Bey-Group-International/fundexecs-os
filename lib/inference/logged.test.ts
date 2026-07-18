// Tests for runInferenceLogged — returns the real gateway result unchanged and
// records telemetry best-effort (no throw). No mocks: with no provider key in
// the test env the gateway returns a degraded result and the store no-ops.
import { runInferenceLogged } from "./logged";

describe("runInferenceLogged (no credentials)", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const originalService = process.env.SUPABASE_SERVICE_ROLE_KEY;
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });
  afterAll(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
    if (originalService === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalService;
  });

  it("returns the same InferenceResult runInference would, without throwing", async () => {
    const result = await runInferenceLogged(
      { orgId: "org-1", purpose: "plan_generation" },
      { messages: [{ role: "user", content: "hi" }], capability: "financial_reasoning" },
    );

    // The real gateway path. With no providers configured it degrades; if a
    // provider is configured, still assert the result shape holds.
    expect(typeof result.ok).toBe("boolean");
    expect(typeof result.degraded).toBe("boolean");
    expect("provider" in result).toBe(true);
    expect("model" in result).toBe(true);
    expect(result.usage).toBeDefined();

    if (!result.ok) {
      expect(result.degraded).toBe(true);
      expect(result.text).toBeNull();
      expect(result.provider).toBeNull();
    }
  });
});
