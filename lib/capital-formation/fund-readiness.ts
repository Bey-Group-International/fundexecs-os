import type Anthropic from '@anthropic-ai/sdk';

/* =====================================================================
   Fund Readiness Score (Carta → Fund Readiness Path). Earn reads the
   operator's live workspace — profile completeness, formation progress,
   materials, and the LP pipeline — and returns an institutional-grade
   readiness read: a 0–100 score, a one-line verdict, a dimension
   breakdown, and the three highest-leverage next moves. Client/server-safe
   contract + templated fallback; Anthropic call in `lib/ai/fund-readiness.ts`.
   ===================================================================== */

export interface ReadinessDimension {
  label: string;
  /** 0–100 for this dimension. */
  score: number;
  /** One line: what's strong or what's missing. */
  note: string;
}

export interface ReadinessMove {
  label: string;
  detail: string;
}

export interface FundReadinessResult {
  /** 0–100 overall institutional readiness. */
  score: number;
  /** One-line verdict an LP would recognize. */
  verdict: string;
  dimensions: ReadinessDimension[];
  /** Up to three highest-leverage next moves, in priority order. */
  moves: ReadinessMove[];
  degraded: boolean;
}

/** The live signals the read is built from. */
export interface FundReadinessInput {
  fundName: string;
  /** 0–100 profile completeness from the Source of Truth. */
  profileCompleteness: number;
  /** Required profile gaps still open (label + severity). */
  gaps: Array<{ label: string; severity: 'missing' | 'weak' }>;
  thesisPresent: boolean;
  targetRaise: number | null;
  /** Formation steps filed / total. */
  formationCompleted: number;
  formationTotal: number;
  /** Capital materials that are publish-ready / total drafted. */
  materialsReady: number;
  materialsTotal: number;
  /** LP pipeline shape. */
  lpTotal: number;
  lpCommitted: number;
  lpSoftCircled: number;
}

/** Templated fallback — a defensible score from the raw signals; never throws. */
export function templatedReadiness(input: FundReadinessInput): FundReadinessResult {
  const formationPct = input.formationTotal
    ? Math.round((input.formationCompleted / input.formationTotal) * 100)
    : 0;
  const materialsPct = input.materialsTotal
    ? Math.round((input.materialsReady / input.materialsTotal) * 100)
    : 0;
  const pipelinePct = input.lpTotal ? Math.min(100, input.lpTotal * 8 + input.lpCommitted * 15) : 0;

  const dimensions: ReadinessDimension[] = [
    {
      label: 'Profile & narrative',
      score: input.profileCompleteness,
      note: input.thesisPresent ? 'Thesis on file.' : 'No clear thesis yet.'
    },
    {
      label: 'Formation readiness',
      score: formationPct,
      note: `${input.formationCompleted}/${input.formationTotal} formation steps filed.`
    },
    {
      label: 'Materials',
      score: materialsPct,
      note: `${input.materialsReady} of ${input.materialsTotal} materials ready.`
    },
    {
      label: 'Capital pipeline',
      score: pipelinePct,
      note: `${input.lpTotal} LPs · ${input.lpCommitted} committed.`
    }
  ];
  const score = Math.round(dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length);

  const moves: ReadinessMove[] = [];
  for (const g of input.gaps.slice(0, 2)) {
    moves.push({
      label: `Close: ${g.label}`,
      detail: `A counterparty will probe this — it reads ${g.severity}.`
    });
  }
  if (input.lpTotal === 0) {
    moves.push({
      label: 'Build your LP list',
      detail: 'Stand up the capital map so the pipeline can compound.'
    });
  }
  if (moves.length === 0) {
    moves.push({
      label: 'Tighten your materials',
      detail: 'Get your core materials publish-ready for diligence.'
    });
  }

  return {
    score,
    verdict:
      score >= 75
        ? `${input.fundName} reads close to institutional — tighten the gaps and you're there.`
        : `${input.fundName} has a foundation; a few moves get it institutional.`,
    dimensions,
    moves: moves.slice(0, 3),
    degraded: true
  };
}

/** Stable system prompt — no per-request data, so it caches cleanly. */
export const FUND_READINESS_SYSTEM = `You are Earn — the capital-formation copilot at FundExecs OS — giving an emerging manager an honest, institutional-grade read on how ready their fund is to raise.

You think like an LP's investment committee: identity and narrative, mandate clarity, evidence and track record, operational/formation readiness, and the strength of the capital pipeline. You reward substance and penalize gaps — you do not inflate scores to be encouraging.

Voice: institutional, declarative, operator-grade. Sentence case, no emoji, no hype.

You ALWAYS respond by calling the \`provide_readiness\` tool with:
- score: an integer 0–100 overall readiness. Be calibrated; most emerging managers are not yet at 80.
- verdict: ONE line an LP would recognize — where this fund really stands.
- dimensions: 3–5 { label, score (0–100), note } covering the areas above, grounded in the signals given.
- moves: the THREE highest-leverage next moves, in priority order, each { label, detail }. Tie each to the gap it closes.

Reference only the signals provided. Never invent track record, commitments, or facts. Output only via the tool.`;

/** Forced-tool schema. */
export const FUND_READINESS_TOOL: Anthropic.Tool = {
  name: 'provide_readiness',
  description: "Provide Earn's fund readiness read: score, verdict, dimensions, and next moves.",
  input_schema: {
    type: 'object',
    properties: {
      score: { type: 'integer', description: '0–100 overall institutional readiness.' },
      verdict: { type: 'string', description: 'One-line verdict on where the fund stands.' },
      dimensions: {
        type: 'array',
        description: '3–5 readiness dimensions with their own scores.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            score: { type: 'integer', description: '0–100 for this dimension.' },
            note: { type: 'string', description: 'One line: strength or gap.' }
          },
          required: ['label', 'score', 'note']
        }
      },
      moves: {
        type: 'array',
        description: 'Exactly three highest-leverage next moves, in priority order.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            detail: { type: 'string' }
          },
          required: ['label', 'detail']
        }
      }
    },
    required: ['score', 'verdict', 'dimensions', 'moves']
  }
};

function money(n: number | null): string | null {
  if (n == null) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

/** Build the per-request user turn from the live workspace signals. */
export function buildReadinessPrompt(input: FundReadinessInput): string {
  const gapLines = input.gaps.length
    ? input.gaps.map((g) => `- ${g.label} (${g.severity})`).join('\n')
    : '- none reported';
  const lines = [
    `Fund: ${input.fundName}.`,
    `Profile completeness: ${input.profileCompleteness}/100.`,
    `Thesis on file: ${input.thesisPresent ? 'yes' : 'no'}.`,
    input.targetRaise ? `Target raise: ${money(input.targetRaise)}.` : 'Target raise: not set.',
    `Formation steps filed: ${input.formationCompleted}/${input.formationTotal}.`,
    `Materials publish-ready: ${input.materialsReady}/${input.materialsTotal}.`,
    `LP pipeline: ${input.lpTotal} total, ${input.lpSoftCircled} soft-circled, ${input.lpCommitted} committed.`,
    '',
    'Open required profile gaps:',
    gapLines
  ];
  return `${lines.join('\n')}

Assess this fund's readiness to raise via the provide_readiness tool.`;
}
