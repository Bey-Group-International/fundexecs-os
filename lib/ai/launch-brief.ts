import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { FIRST_MOVES } from '@/lib/proof-of-truth/first-moves';
import {
  LAUNCH_BRIEF_SYSTEM,
  LAUNCH_BRIEF_TOOL,
  buildBriefPrompt,
  templatedBrief,
  type BriefMove,
  type LaunchBrief,
  type LaunchBriefInput
} from '@/lib/proof-of-truth/launch-brief';
import { AI_MODELS } from './models';

// Interactive chat tier (Sonnet by default) — fast, strong for a welcome brief.
const MODEL = AI_MODELS.chat;

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Coerce/clamp the tool input into a safe brief. Hrefs are pinned to the
 * member type's allow-list so a hallucinated path can never ship; an unknown
 * href falls back to that move's canonical destination by position.
 */
function normalize(input: unknown, ctx: LaunchBriefInput): LaunchBrief {
  const o = (input ?? {}) as Record<string, unknown>;
  const fallbackMoves = FIRST_MOVES[ctx.memberType].moves;
  const allowed = new Set(fallbackMoves.map((m) => m.href));

  const rawMoves = Array.isArray(o.moves) ? o.moves : [];
  const moves: BriefMove[] = [];
  for (let i = 0; i < rawMoves.length && moves.length < 3; i++) {
    const item = (rawMoves[i] ?? {}) as Record<string, unknown>;
    const label = str(item.label, 80);
    const detail = str(item.detail, 200);
    if (!label) continue;
    const proposed = str(item.href, 200);
    const href = allowed.has(proposed)
      ? proposed
      : (fallbackMoves[moves.length]?.href ?? fallbackMoves[0].href);
    moves.push({ label, detail, href });
  }

  const headline = str(o.headline, 280);
  if (!headline || moves.length === 0) {
    throw new Error('Earn returned an unusable brief');
  }
  return { headline, moves, degraded: false };
}

/**
 * Ask Earn for the member's launch brief. Uses a forced tool call so the result
 * always matches the { headline, moves } contract. On any failure the caller is
 * expected to fall back to `templatedBrief` — but this also degrades internally
 * so a thrown error never escapes to the route.
 */
export async function generateLaunchBrief(input: LaunchBriefInput): Promise<LaunchBrief> {
  if (!process.env.ANTHROPIC_API_KEY) return templatedBrief(input);

  try {
    const anthropic = new Anthropic({ timeout: 12_000, maxRetries: 1 });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 700,
      system: [{ type: 'text', text: LAUNCH_BRIEF_SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: [LAUNCH_BRIEF_TOOL],
      tool_choice: { type: 'tool', name: LAUNCH_BRIEF_TOOL.name },
      messages: [{ role: 'user', content: buildBriefPrompt(input) }]
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );
    if (!toolUse) throw new Error('Earn returned no brief');
    return normalize(toolUse.input, input);
  } catch {
    // Timeout / rate limit / malformed output — never block the welcome.
    return templatedBrief(input);
  }
}
