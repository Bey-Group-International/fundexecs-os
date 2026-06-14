import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import {
  buildLpFitPrompt,
  LP_FIT_SYSTEM,
  LP_FIT_TOOL,
  LP_WARMTH_VALUES,
  templatedLpFit,
  type LpFitInput,
  type LpFitResult,
  type LpWarmth
} from '@/lib/capital-formation/lp-fit';
import { AI_MODELS } from './models';

// Interactive chat tier (Sonnet by default) — fast, strong for a calibrated score.
const MODEL = AI_MODELS.chat;

function clampWarmth(value: unknown): LpWarmth {
  return typeof value === 'string' && (LP_WARMTH_VALUES as readonly string[]).includes(value)
    ? (value as LpWarmth)
    : 'cold';
}

/** Coerce/clamp the tool input into a safe result; throw if unusable. */
function normalize(input: unknown): Omit<LpFitResult, 'degraded'> {
  const o = (input ?? {}) as Record<string, unknown>;
  const rawFit = typeof o.fit === 'number' ? o.fit : Number(o.fit);
  const fit = Number.isFinite(rawFit) ? Math.min(100, Math.max(0, Math.round(rawFit))) : NaN;
  const rationale = typeof o.rationale === 'string' ? o.rationale.trim().slice(0, 400) : '';
  if (!Number.isFinite(fit) || !rationale) throw new Error('Earn returned an unusable fit score');
  return { fit, warmth: clampWarmth(o.warmth), rationale };
}

/**
 * Ask Earn to score an LP's fit for the raise. Forced tool call so the result
 * always matches the { fit, warmth, rationale } contract. Degrades to the
 * templated fallback (never throws) so the score path always returns something.
 */
export async function scoreLpFitWithEarn(input: LpFitInput): Promise<LpFitResult> {
  if (!process.env.ANTHROPIC_API_KEY) return templatedLpFit(input);

  try {
    const anthropic = new Anthropic({ timeout: 12_000, maxRetries: 1 });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: [{ type: 'text', text: LP_FIT_SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: [LP_FIT_TOOL],
      tool_choice: { type: 'tool', name: LP_FIT_TOOL.name },
      messages: [{ role: 'user', content: buildLpFitPrompt(input) }]
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );
    if (!toolUse) throw new Error('Earn returned no fit score');
    return { ...normalize(toolUse.input), degraded: false };
  } catch {
    return templatedLpFit(input);
  }
}
