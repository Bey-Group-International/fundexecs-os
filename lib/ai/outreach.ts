import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import {
  buildOutreachPrompt,
  OUTREACH_SYSTEM,
  OUTREACH_TOOL,
  templatedOutreach,
  type OutreachInput,
  type OutreachResult
} from '@/lib/capital-formation/outreach';
import { AI_MODELS } from './models';

// Interactive chat tier (Sonnet by default) — strong, natural prose.
const MODEL = AI_MODELS.chat;

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Coerce/clamp the tool input into a safe draft; throw if unusable. */
function normalize(input: unknown): Omit<OutreachResult, 'degraded'> {
  const o = (input ?? {}) as Record<string, unknown>;
  const subject = str(o.subject, 200);
  const body = str(o.body, 4000);
  if (!subject || !body) throw new Error('Earn returned an unusable outreach draft');
  return { subject, body };
}

/**
 * Ask Earn to draft personalized LP outreach. Forced tool call so the result
 * always matches the { subject, body } contract. Degrades to the templated
 * fallback (never throws).
 */
export async function generateOutreachWithEarn(input: OutreachInput): Promise<OutreachResult> {
  if (!process.env.ANTHROPIC_API_KEY) return templatedOutreach(input);

  try {
    const anthropic = new Anthropic({ timeout: 14_000, maxRetries: 1 });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 700,
      system: [{ type: 'text', text: OUTREACH_SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: [OUTREACH_TOOL],
      tool_choice: { type: 'tool', name: OUTREACH_TOOL.name },
      messages: [{ role: 'user', content: buildOutreachPrompt(input) }]
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );
    if (!toolUse) throw new Error('Earn returned no outreach draft');
    return { ...normalize(toolUse.input), degraded: false };
  } catch {
    return templatedOutreach(input);
  }
}
