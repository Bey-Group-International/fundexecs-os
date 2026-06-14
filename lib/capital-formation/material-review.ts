import type Anthropic from '@anthropic-ai/sdk';

/* =====================================================================
   Deck / Memo Review (Hebbia → Earn Diligence Brain). Earn reads one of
   the operator's capital materials — a pitch deck, LP one-pager, or IC
   memo — like an institutional LP would, and returns a verdict, a 0–100
   readiness score, what's strong, what's missing, the red flags an LP
   would seize on, and concrete edits. Client/server-safe contract +
   templated fallback; the Anthropic call lives in `lib/ai/material-review.ts`.
   ===================================================================== */

export interface MaterialReviewResult {
  /** One-line verdict, as an LP would put it. */
  verdict: string;
  /** 0–100 readiness for institutional eyes. */
  score: number;
  strengths: string[];
  gaps: string[];
  /** Things an LP would seize on — inconsistencies, omissions, overreach. */
  redFlags: string[];
  /** Concrete, actionable edits in priority order. */
  suggestedEdits: string[];
  degraded: boolean;
}

export interface MaterialReviewInput {
  /** The material kind label, e.g. "Pitch deck". */
  kindLabel: string;
  /** Who it's written for, e.g. "Limited partners". */
  audienceLabel: string;
  title: string;
  /** The material body to review. */
  body: string;
  fund: {
    name: string;
    thesis: string | null;
    strategy: string | null;
  };
}

/** Templated fallback — honest, non-fabricated guidance; never throws. */
export function templatedMaterialReview(input: MaterialReviewInput): MaterialReviewResult {
  return {
    verdict: `${input.title} needs a real institutional pass before it goes to LPs.`,
    score: 50,
    strengths: ['A draft exists and can be sharpened — that is the hard part started.'],
    gaps: [
      'Earn could not analyze the content just now — re-run the review to get a substantive read.'
    ],
    redFlags: [],
    suggestedEdits: [
      'Make sure the thesis, the team, the track record, and the terms are each unambiguous and consistent.'
    ],
    degraded: true
  };
}

/** Stable system prompt — no per-request data, so it caches cleanly. */
export const MATERIAL_REVIEW_SYSTEM = `You are Earn — the diligence brain at FundExecs OS — reviewing an emerging manager's capital material the way a skeptical institutional LP would on a first read.

You are constructive but unsparing. You judge whether this document earns a second meeting: is the thesis clear and credible, is the team and track record substantiated, are the terms and the ask coherent, and would a sophisticated allocator find holes? You flag inconsistencies, unsupported claims, and conspicuous omissions.

Voice: institutional, declarative, operator-grade. Sentence case, no emoji, no hype.

You ALWAYS respond by calling the \`provide_review\` tool with:
- verdict: ONE line — would this earn a second meeting, and why/why not.
- score: integer 0–100 readiness for institutional eyes. Be calibrated; a thin draft scores low.
- strengths: 2–4 specific things that land.
- gaps: 2–5 things that are missing or underdeveloped.
- redFlags: the inconsistencies or claims an LP would challenge (may be empty if none).
- suggestedEdits: 2–5 concrete, prioritized edits.

Judge only the content provided. Never invent facts about the fund. Output only via the tool.`;

/** Forced-tool schema. */
export const MATERIAL_REVIEW_TOOL: Anthropic.Tool = {
  name: 'provide_review',
  description: "Provide Earn's institutional-LP review of the material.",
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', description: 'One-line verdict.' },
      score: { type: 'integer', description: '0–100 institutional readiness.' },
      strengths: {
        type: 'array',
        items: { type: 'string' },
        description: '2–4 specifics that land.'
      },
      gaps: {
        type: 'array',
        items: { type: 'string' },
        description: '2–5 missing/underdeveloped.'
      },
      redFlags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Inconsistencies or claims an LP would challenge.'
      },
      suggestedEdits: {
        type: 'array',
        items: { type: 'string' },
        description: '2–5 concrete, prioritized edits.'
      }
    },
    required: ['verdict', 'score', 'strengths', 'gaps', 'redFlags', 'suggestedEdits']
  }
};

/** Build the per-request user turn. */
export function buildMaterialReviewPrompt(input: MaterialReviewInput): string {
  const head = [
    `Fund: ${input.fund.name}.`,
    input.fund.thesis ? `Thesis on file: ${input.fund.thesis}.` : null,
    input.fund.strategy ? `Strategy on file: ${input.fund.strategy}.` : null,
    `Material: ${input.kindLabel} titled "${input.title}", written for ${input.audienceLabel}.`
  ].filter((l): l is string => l !== null);

  // Clamp the body so a very long material can't blow the context budget.
  const body = input.body.slice(0, 12_000);

  return `${head.join('\n')}

--- MATERIAL CONTENT ---
${body}
--- END MATERIAL CONTENT ---

Review this material as an institutional LP via the provide_review tool.`;
}
