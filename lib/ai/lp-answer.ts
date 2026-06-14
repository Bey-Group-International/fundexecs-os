import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import {
  buildLpAnswerPrompt,
  LP_ANSWER_SYSTEM,
  LP_ANSWER_TOOL,
  templatedLpAnswer,
  type LpAnswerDraft,
  type LpAnswerInput
} from '@/lib/lp-room/answer';
import { AI_MODELS } from './models';

// Interactive chat tier (Sonnet by default) — strong, natural IR prose.
const MODEL = AI_MODELS.chat;

function strList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const v = raw.trim().slice(0, 200);
    if (v) out.push(v);
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * Coerce/clamp the tool input into a safe draft; throw if unusable. Citations
 * are filtered against the approved-materials list so a hallucinated or
 * unapproved label can never be persisted downstream as a citation.
 */
function normalize(input: unknown, approvedDocs: string[]): Omit<LpAnswerDraft, 'degraded'> {
  const o = (input ?? {}) as Record<string, unknown>;
  const answer = typeof o.answer === 'string' ? o.answer.trim().slice(0, 4000) : '';
  if (!answer) throw new Error('Earn returned an unusable answer');
  const allowed = new Set(approvedDocs.map((d) => d.trim().toLowerCase()).filter(Boolean));
  const citations = strList(o.citations, 8).filter((c) => allowed.has(c.toLowerCase()));
  return { answer, citations };
}

/**
 * Ask Eleanor to draft an LP answer from approved materials. Forced tool call
 * so the result always matches the { answer, citations } contract. Degrades to
 * the templated holding answer (never throws).
 */
export async function draftLpAnswerWithEarn(input: LpAnswerInput): Promise<LpAnswerDraft> {
  if (!process.env.ANTHROPIC_API_KEY) return templatedLpAnswer(input);

  try {
    const anthropic = new Anthropic({ timeout: 14_000, maxRetries: 1 });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 900,
      system: [{ type: 'text', text: LP_ANSWER_SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: [LP_ANSWER_TOOL],
      tool_choice: { type: 'tool', name: LP_ANSWER_TOOL.name },
      messages: [{ role: 'user', content: buildLpAnswerPrompt(input) }]
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );
    if (!toolUse) throw new Error('Earn returned no answer');
    return { ...normalize(toolUse.input, input.approvedDocs), degraded: false };
  } catch {
    return templatedLpAnswer(input);
  }
}
