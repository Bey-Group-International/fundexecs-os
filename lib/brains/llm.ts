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

const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";

export function brainsLive(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function client(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey ? new Anthropic({ apiKey }) : null;
}

export interface CompleteArgs {
  system: string;
  prompt: string;
  maxTokens?: number;
}

// Returns the model's text, or null when no key is configured / on error so the
// caller can fall back to a deterministic stub.
export async function complete({ system, prompt, maxTokens = 1200 }: CompleteArgs): Promise<string | null> {
  const anthropic = client();
  if (!anthropic) return null;
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      output_config: { effort: "medium" },
      messages: [{ role: "user", content: prompt }],
    });
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return text || null;
  } catch {
    return null;
  }
}
