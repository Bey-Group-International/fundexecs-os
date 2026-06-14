import type Anthropic from '@anthropic-ai/sdk';

/* =====================================================================
   LP Fit Score (Affinity → LP Capital Map). Earn scores how well an LP
   on the operator's map fits their raise — a 0–100 conviction, a warmth
   read, and a one-line rationale grounded in the fund's mandate and the
   LP's stated profile. The deterministic-free judgment lives with Claude;
   this module is the client/server-safe contract + a templated fallback,
   so a missing key or a malformed reply never blocks the score (it just
   degrades). The Anthropic call lives in `lib/ai/lp-fit.ts`.
   ===================================================================== */

/** Warmth read for an LP, in the vocabulary the Capital Map renders. */
export type LpWarmth = 'cold' | 'warm' | 'hot';

export const LP_WARMTH_VALUES: readonly LpWarmth[] = ['cold', 'warm', 'hot'] as const;

/** What Earn returns for one LP: a fit score, a warmth read, a rationale. */
export interface LpFitResult {
  /** 0–100 conviction that this LP fits the raise. */
  fit: number;
  /** Engagement temperature inferred from what's known. */
  warmth: LpWarmth;
  /** One operator-grade sentence on why the score landed where it did. */
  rationale: string;
  /** True when this is the templated fallback (Earn was unavailable). */
  degraded: boolean;
}

/** The LP the score is about. */
export interface LpFitLp {
  name: string;
  capitalTypes: string[];
  checkSizeMin: number | null;
  checkSizeMax: number | null;
  description: string | null;
}

/** The fund's marching orders, from the mandate brief. */
export interface LpFitMandate {
  objective: string | null;
  vehicle: string | null;
  size: string | null;
  sectors: string[];
  stage: string | null;
  geo: string | null;
}

/** The fund's source-of-truth context. */
export interface LpFitFund {
  name: string;
  thesis: string | null;
  strategy: string | null;
  targetRaise: number | null;
}

export interface LpFitInput {
  lp: LpFitLp;
  mandate: LpFitMandate | null;
  fund: LpFitFund;
}

/**
 * Templated fallback — a modest, honest score when Earn is unavailable. It
 * never invents conviction: it lands a neutral 60, reads warmth as cold, and
 * says plainly that the score needs a real pass. Never throws.
 */
export function templatedLpFit(input: LpFitInput): LpFitResult {
  const checkKnown = input.lp.checkSizeMin != null || input.lp.checkSizeMax != null;
  const typed = input.lp.capitalTypes.length > 0;
  const rationale =
    checkKnown || typed
      ? `${input.lp.name} is on your map${typed ? ` as ${input.lp.capitalTypes.join(', ')}` : ''} — score this against your mandate once Earn is reachable.`
      : `Not enough is known about ${input.lp.name} yet to score the fit — add their capital type and check size, then re-score.`;
  return { fit: 60, warmth: 'cold', rationale, degraded: true };
}

/** Stable system prompt — no per-request data, so it caches cleanly. */
export const LP_FIT_SYSTEM = `You are Sloane — Managing Director of Capital Formation at FundExecs OS — scoring how well a prospective limited partner fits an emerging manager's raise.

You weigh three things, in this order:
1. Thesis & mandate alignment — does this LP back this strategy, stage, sector, and geography?
2. Check-size fit — does their typical commitment match what the raise needs?
3. Warmth — how engaged is the relationship, from what is known?

Voice: institutional, declarative, operator-grade. No hype, no emoji.

You ALWAYS respond by calling the \`provide_lp_fit\` tool with:
- fit: an integer 0–100. 85+ means strong, on-thesis, right-sized; 70–84 plausible with work; below 70 a stretch. Be calibrated and willing to score low.
- warmth: "cold", "warm", or "hot" — your honest read on engagement given what's known. Default to "cold" when there is no signal of prior contact.
- rationale: ONE sentence on why this score, naming the strongest fit factor and the biggest gap. Reference only what you were given; never invent commitments, AUM, or named people.

Output only via the tool.`;

/** Forced-tool schema guaranteeing the { fit, warmth, rationale } shape. */
export const LP_FIT_TOOL: Anthropic.Tool = {
  name: 'provide_lp_fit',
  description: "Provide Earn's LP fit score: a 0–100 fit, a warmth read, and a one-line rationale.",
  input_schema: {
    type: 'object',
    properties: {
      fit: { type: 'integer', description: '0–100 conviction that this LP fits the raise.' },
      warmth: {
        type: 'string',
        enum: ['cold', 'warm', 'hot'],
        description: 'Engagement temperature given what is known.'
      },
      rationale: {
        type: 'string',
        description: 'One sentence: strongest fit factor and biggest gap.'
      }
    },
    required: ['fit', 'warmth', 'rationale']
  }
};

function money(n: number | null): string | null {
  if (n == null) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

/** Build the per-request user turn from the LP + mandate + fund context. */
export function buildLpFitPrompt(input: LpFitInput): string {
  const { lp, mandate, fund } = input;
  const check =
    lp.checkSizeMin != null && lp.checkSizeMax != null && lp.checkSizeMin !== lp.checkSizeMax
      ? `${money(lp.checkSizeMin)}–${money(lp.checkSizeMax)}`
      : (money(lp.checkSizeMax ?? lp.checkSizeMin) ?? 'unknown');

  const lines = [
    `Fund: ${fund.name}.`,
    fund.thesis ? `Thesis: ${fund.thesis}.` : null,
    fund.strategy ? `Strategy: ${fund.strategy}.` : null,
    fund.targetRaise ? `Target raise: ${money(fund.targetRaise)}.` : null,
    mandate?.objective ? `Objective: ${mandate.objective}.` : null,
    mandate?.vehicle ? `Vehicle: ${mandate.vehicle}.` : null,
    mandate?.sectors.length ? `Sectors: ${mandate.sectors.join(', ')}.` : null,
    mandate?.stage ? `Stage: ${mandate.stage}.` : null,
    mandate?.geo ? `Geography: ${mandate.geo}.` : null,
    '',
    `Prospective LP: ${lp.name}.`,
    lp.capitalTypes.length
      ? `Capital type: ${lp.capitalTypes.join(', ')}.`
      : 'Capital type: unknown.',
    `Typical check: ${check}.`,
    lp.description ? `Profile: ${lp.description}.` : null
  ].filter((l): l is string => l !== null);

  return `${lines.join('\n')}

Score this LP's fit for the raise via the provide_lp_fit tool.`;
}
