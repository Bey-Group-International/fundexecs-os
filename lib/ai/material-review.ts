import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import {
  buildMaterialReviewPrompt,
  MATERIAL_REVIEW_SYSTEM,
  MATERIAL_REVIEW_TOOL,
  templatedMaterialReview,
  type MaterialReviewInput,
  type MaterialReviewResult
} from '@/lib/capital-formation/material-review';
import { AI_MODELS } from './models';

// Reasoning tier (Opus by default) — this is judgment work where depth beats latency.
const MODEL = AI_MODELS.reasoning;

function clampScore(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 0;
}

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
function normalize(input: unknown): Omit<MaterialReviewResult, 'degraded'> {
  const o = (input ?? {}) as Record<string, unknown>;
  const verdict = typeof o.verdict === 'string' ? o.verdict.trim().slice(0, 280) : '';
  const strengths = strList(o.strengths, 4);
  const gaps = strList(o.gaps, 5);
  if (!verdict || (strengths.length === 0 && gaps.length === 0)) {
    throw new Error('Earn returned an unusable review');
  }
  return {
    verdict,
    score: clampScore(o.score),
    strengths,
    gaps,
    redFlags: strList(o.redFlags, 5),
    suggestedEdits: strList(o.suggestedEdits, 5)
  };
}

/**
 * Ask Earn to review a capital material like an institutional LP. Forced tool
 * call so the result always matches the contract. Degrades to the templated
 * fallback (never throws).
 */
export async function reviewMaterialWithEarn(
  input: MaterialReviewInput
): Promise<MaterialReviewResult> {
  if (!process.env.ANTHROPIC_API_KEY) return templatedMaterialReview(input);

  try {
    const anthropic = new Anthropic({ timeout: 30_000, maxRetries: 1 });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: [
        { type: 'text', text: MATERIAL_REVIEW_SYSTEM, cache_control: { type: 'ephemeral' } }
      ],
      tools: [MATERIAL_REVIEW_TOOL],
      tool_choice: { type: 'tool', name: MATERIAL_REVIEW_TOOL.name },
      messages: [{ role: 'user', content: buildMaterialReviewPrompt(input) }]
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );
    if (!toolUse) throw new Error('Earn returned no review');
    return { ...normalize(toolUse.input), degraded: false };
  } catch {
    return templatedMaterialReview(input);
  }
}
