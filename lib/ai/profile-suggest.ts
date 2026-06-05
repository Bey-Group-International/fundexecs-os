import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import {
  EARN_PROFILE_SYSTEM,
  SUGGESTION_TOOL,
  buildSuggestionPrompt,
  type ProfileSuggestion,
  type SuggestInput
} from '@/lib/proof-of-truth/earn-profile';

// Sonnet 4.6 — fast, strong for an interactive assistant; env-overridable.
const MODEL = process.env.EARN_MODEL || 'claude-sonnet-4-6';

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Coerce/clamp the tool input into a safe ProfileSuggestion. */
function normalize(input: unknown): ProfileSuggestion {
  const o = (input ?? {}) as Record<string, unknown>;
  return {
    recommendation: str(o.recommendation, 600),
    insight: str(o.insight, 400),
    reasoning: str(o.reasoning, 400),
    suggestedValue: str(o.suggestedValue, 1000)
  };
}

/**
 * Ask Earn for a structured suggestion for one profile field. Uses a forced
 * tool call so the result is always the four-field JSON contract. A short
 * client timeout + single retry keeps the endpoint responsive; the caller is
 * expected to fall back to manual entry if this throws.
 */
export async function suggestProfileAnswer(input: SuggestInput): Promise<ProfileSuggestion> {
  const anthropic = new Anthropic({ timeout: 12_000, maxRetries: 1 });

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 700,
    system: [{ type: 'text', text: EARN_PROFILE_SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools: [SUGGESTION_TOOL],
    tool_choice: { type: 'tool', name: SUGGESTION_TOOL.name },
    messages: [{ role: 'user', content: buildSuggestionPrompt(input) }]
  });

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  if (!toolUse) throw new Error('Earn returned no suggestion');

  const suggestion = normalize(toolUse.input);
  if (!suggestion.suggestedValue && !suggestion.recommendation) {
    throw new Error('Earn returned an empty suggestion');
  }
  return suggestion;
}
