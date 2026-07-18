// Brain LLM adapter.
//
// A thin seam over the model so Brains never import the SDK directly. Defaults
// to Haiku 4.5 (fast + inexpensive — keeps the live loop within a tight budget),
// overridable via CLAUDE_MODEL. With no ANTHROPIC_API_KEY the adapter returns
// null and the caller falls back to a deterministic stub, so CI/preview builds
// and demos keep working with zero spend.
//
// Plug a different provider in here later (or route per-Brain) without touching
// any Brain logic.
import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient } from "@/lib/anthropic-client";
import { runInference } from "@/lib/inference/gateway";

const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";

// `output_config.effort` is GA but only on Opus 4.5+, Sonnet 4.6, and Fable/Mythos 5.
// It returns a 400 on Haiku 4.5 and Sonnet 4.5 — and since our default model IS
// Haiku 4.5, sending it unconditionally 400s every live call, which the catch below
// swallows into a stub fallback (the loop silently drops to preview mode). Only attach
// it when the configured model is known to support it; omitting it just uses default effort.
function supportsEffort(model: string): boolean {
  return /claude-(opus-4-(5|6|7|8)|sonnet-4-6|fable-5|mythos-5)/.test(model);
}

export function brainsLive(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function client(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey ? anthropicClient(apiKey) : null;
}

export interface CompleteArgs {
  system: string;
  prompt: string;
  maxTokens?: number;
}

// Returns the model's text, or null when no key is configured / on error so the
// caller can fall back to a deterministic stub.
export async function complete({ system, prompt, maxTokens = 1200 }: CompleteArgs): Promise<string | null> {
  // Provider-agnostic path (opt-in): route through the inference gateway so the
  // model is chosen by capability, not hard-coded. Off by default → the direct
  // Anthropic path below is unchanged. `preferTier: "fast"` preserves the Brain
  // default (Haiku). The gateway degrades to null on no provider, same as here.
  if (process.env.INFERENCE_GATEWAY_ENABLED === "true") {
    const result = await runInference({
      system,
      messages: [{ role: "user", content: prompt }],
      maxTokens,
      preferTier: "fast",
    });
    return result.text;
  }

  const anthropic = client();
  if (!anthropic) return null;
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      ...(supportsEffort(MODEL) ? { output_config: { effort: "medium" } } : {}),
      messages: [{ role: "user", content: prompt }],
    });
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return text || null;
  } catch (err) {
    // Fall back to the deterministic stub, but don't fail silently — a swallowed
    // error here is exactly what made a degraded loop look like a healthy preview.
    console.error(`[brains/llm] completion failed for model ${MODEL}:`, err);
    return null;
  }
}
