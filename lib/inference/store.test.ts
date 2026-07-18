// Tests for the inference-run ledger store (no service env → best-effort null).
import { persistInferenceRun } from "./store";
import type { InferenceResult } from "./types";

const okResult: InferenceResult = {
  ok: true,
  text: "hello",
  provider: "anthropic",
  model: "claude-test",
  usage: { inputTokens: 12, outputTokens: 34 },
  latencyMs: 42,
  degraded: false,
};

const degradedResult: InferenceResult = {
  ok: false,
  text: null,
  provider: null,
  model: null,
  usage: { inputTokens: 0, outputTokens: 0 },
  latencyMs: 0,
  degraded: true,
  error: "No available model satisfies the request policy",
};

describe("persistInferenceRun (no service env)", () => {
  const original = process.env.SUPABASE_SERVICE_ROLE_KEY;
  beforeEach(() => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });
  afterAll(() => {
    if (original === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = original;
  });

  it("returns null (never throws) for an ok result when no service env", async () => {
    await expect(
      persistInferenceRun({ orgId: "org-1", result: okResult, capability: "financial_reasoning", purpose: "plan_generation" }),
    ).resolves.toBeNull();
  });

  it("returns null (never throws) for a degraded result when no service env", async () => {
    await expect(
      persistInferenceRun({ orgId: "org-1", result: degradedResult }),
    ).resolves.toBeNull();
  });
});
