// lib/inference/anthropic.ts
// The Anthropic inference provider — the first adapter behind the gateway. It
// reuses the existing lib/anthropic-client.ts construction (explicit timeouts,
// one retry) and mirrors the behavior of lib/brains/llm.ts exactly (default fast
// model, effort only where supported, error → null so callers fall back), so
// routing through the gateway is behaviorally identical to the direct path.
//
// Adding OpenAI/Google/local is implementing this same InferenceProvider
// interface + registering it — no caller changes.
import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient } from "@/lib/anthropic-client";
import type { InferenceProvider, InferenceRequest, InferenceUsage, ModelSpec } from "./types";

// Tier → model id, each env-overridable. Defaults match the codebase (Haiku is
// the existing brains default; CLAUDE_MODEL is the existing balanced override).
const FAST_MODEL = process.env.CLAUDE_FAST_MODEL || "claude-haiku-4-5-20251001";
const BALANCED_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
const HIGH_MODEL = process.env.CLAUDE_HIGH_MODEL || "claude-opus-4-8";

// `output_config.effort` is only valid on Opus 4.5+, Sonnet 4.6, Fable/Mythos 5.
// Attaching it to Haiku 4.5 / Sonnet 4.5 400s the call (mirrors lib/brains/llm.ts).
function supportsEffort(model: string): boolean {
  return /claude-(opus-4-(5|6|7|8)|sonnet-4-6|fable-5|mythos-5)/.test(model);
}

const MODELS: ModelSpec[] = [
  {
    id: FAST_MODEL,
    provider: "anthropic",
    tier: "fast",
    capabilities: ["low_latency_classification", "structured_extraction", "tool_use"],
    contextTokens: 200_000,
    costPer1kInput: 0.8,
    costPer1kOutput: 4,
  },
  {
    id: BALANCED_MODEL,
    provider: "anthropic",
    tier: "balanced",
    capabilities: ["structured_extraction", "financial_reasoning", "long_context", "tool_use"],
    contextTokens: 200_000,
    costPer1kInput: 3,
    costPer1kOutput: 15,
  },
  {
    id: HIGH_MODEL,
    provider: "anthropic",
    tier: "high_assurance",
    capabilities: ["financial_reasoning", "high_assurance_review", "long_context", "tool_use"],
    contextTokens: 200_000,
    costPer1kInput: 5,
    costPer1kOutput: 25,
  },
];

export const anthropicProvider: InferenceProvider = {
  key: "anthropic",
  label: "Anthropic",

  available(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  },

  models(): ModelSpec[] {
    return MODELS;
  },

  async complete(modelId: string, req: InferenceRequest): Promise<{ text: string | null; usage: InferenceUsage }> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const empty = { text: null, usage: { inputTokens: 0, outputTokens: 0 } };
    if (!apiKey) return empty;

    const client = anthropicClient(apiKey);
    try {
      const message = await client.messages.create({
        model: modelId,
        max_tokens: req.maxTokens ?? 1200,
        ...(req.system ? { system: req.system } : {}),
        ...(req.temperature != null ? { temperature: req.temperature } : {}),
        ...(supportsEffort(modelId) ? { output_config: { effort: "medium" } } : {}),
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      });
      const text =
        message.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim() || null;
      return {
        text,
        usage: { inputTokens: message.usage?.input_tokens ?? 0, outputTokens: message.usage?.output_tokens ?? 0 },
      };
    } catch (err) {
      console.error(`[inference/anthropic] completion failed for model ${modelId}:`, err);
      return empty;
    }
  },
};
