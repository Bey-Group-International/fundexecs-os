import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import {
  DILIGENCE_QA_SYSTEM,
  DILIGENCE_QA_TOOL,
  buildDiligenceQaPrompt,
  templatedDiligenceQaAnswer,
  type DiligenceQaAnswer,
  type DiligenceQaInput
} from '@/lib/diligence/qa';
import { AI_MODELS } from './models';

// Interactive chat tier (Sonnet by default) — fast, natural operator-facing Q&A.
const MODEL = AI_MODELS.chat;

function strList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const v = raw.trim().slice(0, 80);
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * Coerce/clamp the tool input into a safe answer; throw if unusable. `drewOn`
 * is filtered against the run's actual lane labels so a hallucinated lane can
 * never appear as provenance (mirrors the allowlist in `lib/ai/lp-answer.ts`).
 */
function normalize(input: unknown, allowedLabels: string[]): Omit<DiligenceQaAnswer, 'degraded'> {
  const o = (input ?? {}) as Record<string, unknown>;
  const answer = typeof o.answer === 'string' ? o.answer.trim().slice(0, 4000) : '';
  if (!answer) throw new Error('Earn returned an unusable answer');
  const allowed = new Set(allowedLabels.map((l) => l.trim().toLowerCase()).filter(Boolean));
  const drewOn = strList(o.drewOn, 8).filter((l) => allowed.has(l.toLowerCase()));
  return { answer, drewOn };
}

/**
 * Ask Earn to answer a question about a diligence run, grounded in the review.
 * Forced tool call so the result always matches the { answer, drewOn } contract.
 * Degrades to the templated holding answer (never throws).
 */
export async function answerDiligenceQuestion(input: DiligenceQaInput): Promise<DiligenceQaAnswer> {
  if (!process.env.ANTHROPIC_API_KEY) return templatedDiligenceQaAnswer(input);

  try {
    const anthropic = new Anthropic({ timeout: 14_000, maxRetries: 1 });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 900,
      system: [{ type: 'text', text: DILIGENCE_QA_SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: [DILIGENCE_QA_TOOL],
      tool_choice: { type: 'tool', name: DILIGENCE_QA_TOOL.name },
      messages: [{ role: 'user', content: buildDiligenceQaPrompt(input) }]
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );
    if (!toolUse) throw new Error('Earn returned no answer');
    const allowedLabels = ['Synthesis', ...input.findings.map((f) => f.label)];
    return { ...normalize(toolUse.input, allowedLabels), degraded: false };
  } catch {
    // Timeout / rate limit / malformed output — never block the composer.
    return templatedDiligenceQaAnswer(input);
  }
}
