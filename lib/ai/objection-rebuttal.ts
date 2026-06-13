import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import {
  buildRebuttalPrompt,
  OBJECTION_REBUTTAL_SYSTEM,
  OBJECTION_REBUTTAL_TOOL,
  templatedRebuttal,
  type ObjectionRebuttalInput,
  type ObjectionRebuttalResult
} from '@/lib/capital-formation/objection-rebuttal';
import { AI_MODELS } from './models';

// Interactive chat tier (Sonnet by default) — strong, natural prose.
const MODEL = AI_MODELS.chat;

function strList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const v = raw.trim().slice(0, 280);
    if (v) out.push(v);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** Coerce/clamp the tool input into a safe result; throw if unusable. */
function normalize(input: unknown): Omit<ObjectionRebuttalResult, 'degraded'> {
  const o = (input ?? {}) as Record<string, unknown>;
  const rebuttal = typeof o.rebuttal === 'string' ? o.rebuttal.trim().slice(0, 2000) : '';
  const talkingPoints = strList(o.talkingPoints, 4);
  if (!rebuttal) throw new Error('Earn returned an unusable rebuttal');
  return { rebuttal, talkingPoints };
}

/**
 * Ask Earn to draft a rebuttal to an LP objection. Forced tool call so the
 * result always matches the { rebuttal, talkingPoints } contract. Degrades to
 * the templated fallback (never throws).
 */
export async function draftRebuttalWithEarn(
  input: ObjectionRebuttalInput
): Promise<ObjectionRebuttalResult> {
  if (!process.env.ANTHROPIC_API_KEY) return templatedRebuttal(input);

  try {
    const anthropic = new Anthropic({ timeout: 14_000, maxRetries: 1 });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: [
        { type: 'text', text: OBJECTION_REBUTTAL_SYSTEM, cache_control: { type: 'ephemeral' } }
      ],
      tools: [OBJECTION_REBUTTAL_TOOL],
      tool_choice: { type: 'tool', name: OBJECTION_REBUTTAL_TOOL.name },
      messages: [{ role: 'user', content: buildRebuttalPrompt(input) }]
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );
    if (!toolUse) throw new Error('Earn returned no rebuttal');
    return { ...normalize(toolUse.input), degraded: false };
  } catch {
    return templatedRebuttal(input);
  }
}
