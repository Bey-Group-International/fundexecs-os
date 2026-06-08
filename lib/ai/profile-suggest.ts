import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import {
  EARN_PROFILE_SYSTEM,
  RECOMMENDATIONS_TOOL,
  buildSuggestionPrompt,
  type ProfileRecommendation,
  type ProfileRecommendations,
  type SuggestInput
} from '@/lib/proof-of-truth/earn-profile';
import { AI_MODELS } from './models';

// Interactive chat tier (Sonnet by default) — fast, strong for inline suggestions.
const MODEL = AI_MODELS.chat;

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Coerce/clamp the tool input into safe recommendations (≤ 3 non-empty). */
function normalize(input: unknown): ProfileRecommendations {
  const o = (input ?? {}) as Record<string, unknown>;
  const rawOptions = Array.isArray(o.options) ? o.options : [];

  const options: ProfileRecommendation[] = [];
  for (const raw of rawOptions) {
    const item = (raw ?? {}) as Record<string, unknown>;
    const value = str(item.value, 1000);
    if (!value) continue;
    options.push({ value, note: str(item.note, 200) });
    if (options.length >= 3) break;
  }

  return { insight: str(o.insight, 400), options };
}

/**
 * Ask Earn for three structured recommendations for one profile field. Uses a
 * forced tool call so the result is always the { insight, options } contract.
 * A short client timeout + single retry keeps the endpoint responsive; the
 * caller is expected to fall back to manual entry if this throws.
 */
export async function recommendProfileAnswers(
  input: SuggestInput
): Promise<ProfileRecommendations> {
  const anthropic = new Anthropic({ timeout: 12_000, maxRetries: 1 });

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 900,
    system: [{ type: 'text', text: EARN_PROFILE_SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools: [RECOMMENDATIONS_TOOL],
    tool_choice: { type: 'tool', name: RECOMMENDATIONS_TOOL.name },
    messages: [{ role: 'user', content: buildSuggestionPrompt(input) }]
  });

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  if (!toolUse) throw new Error('Earn returned no recommendations');

  const recommendations = normalize(toolUse.input);
  if (recommendations.options.length === 0) {
    throw new Error('Earn returned no usable options');
  }
  return recommendations;
}
