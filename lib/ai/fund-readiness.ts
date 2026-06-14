import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import {
  buildReadinessPrompt,
  FUND_READINESS_SYSTEM,
  FUND_READINESS_TOOL,
  templatedReadiness,
  type FundReadinessInput,
  type FundReadinessResult,
  type ReadinessDimension,
  type ReadinessMove
} from '@/lib/capital-formation/fund-readiness';
import { AI_MODELS } from './models';

// Interactive chat tier (Sonnet by default) — fast, strong for a structured read.
const MODEL = AI_MODELS.chat;

function clampScore(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 0;
}

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Coerce/clamp the tool input into a safe result; throw if unusable. */
function normalize(input: unknown): Omit<FundReadinessResult, 'degraded'> {
  const o = (input ?? {}) as Record<string, unknown>;
  const verdict = str(o.verdict, 280);

  const dimensions: ReadinessDimension[] = [];
  for (const raw of Array.isArray(o.dimensions) ? o.dimensions : []) {
    const d = (raw ?? {}) as Record<string, unknown>;
    const label = str(d.label, 80);
    if (!label) continue;
    dimensions.push({ label, score: clampScore(d.score), note: str(d.note, 200) });
    if (dimensions.length >= 5) break;
  }

  const moves: ReadinessMove[] = [];
  for (const raw of Array.isArray(o.moves) ? o.moves : []) {
    const m = (raw ?? {}) as Record<string, unknown>;
    const label = str(m.label, 100);
    if (!label) continue;
    moves.push({ label, detail: str(m.detail, 240) });
    if (moves.length >= 3) break;
  }

  if (!verdict || dimensions.length === 0 || moves.length === 0) {
    throw new Error('Earn returned an unusable readiness read');
  }
  return { score: clampScore(o.score), verdict, dimensions, moves };
}

/**
 * Ask Earn for an institutional readiness read. Forced tool call so the result
 * always matches the contract. Degrades to the templated fallback (never
 * throws) so the readiness card always has something to show.
 */
export async function assessReadinessWithEarn(
  input: FundReadinessInput
): Promise<FundReadinessResult> {
  if (!process.env.ANTHROPIC_API_KEY) return templatedReadiness(input);

  try {
    const anthropic = new Anthropic({ timeout: 14_000, maxRetries: 1 });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 900,
      system: [{ type: 'text', text: FUND_READINESS_SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: [FUND_READINESS_TOOL],
      tool_choice: { type: 'tool', name: FUND_READINESS_TOOL.name },
      messages: [{ role: 'user', content: buildReadinessPrompt(input) }]
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );
    if (!toolUse) throw new Error('Earn returned no readiness read');
    return { ...normalize(toolUse.input), degraded: false };
  } catch {
    return templatedReadiness(input);
  }
}
