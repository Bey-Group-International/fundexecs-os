import type Anthropic from '@anthropic-ai/sdk';

/* =====================================================================
   Objection Handling Assistant (Zocks → Investor Meeting Copilot). Earn
   drafts an institutional-grade rebuttal to a real LP objection — fees,
   track record, team, strategy, timing — plus the talking points to carry
   into the next conversation. Client/server-safe contract + templated
   fallback; the Anthropic call lives in `lib/ai/objection-rebuttal.ts`.
   ===================================================================== */

export interface ObjectionRebuttalResult {
  /** A written rebuttal the operator can adapt and send. */
  rebuttal: string;
  /** Crisp talking points to carry into the live conversation. */
  talkingPoints: string[];
  degraded: boolean;
}

export interface ObjectionRebuttalInput {
  /** The objection in the LP's words (or the operator's paraphrase). */
  objection: string;
  /** The objection category, e.g. "Fees", "Track record". */
  category: string;
  /** The LP who raised it, when known. */
  lpName: string | null;
  fund: {
    name: string;
    thesis: string | null;
    strategy: string | null;
  };
}

/** Templated fallback — honest, non-fabricated; never throws. */
export function templatedRebuttal(input: ObjectionRebuttalInput): ObjectionRebuttalResult {
  const who = input.lpName ? input.lpName : 'the LP';
  return {
    rebuttal: `Acknowledge ${who}'s concern on ${input.category.toLowerCase()} directly, then reframe it around the strength of ${input.fund.name}'s strategy and the evidence you can point to. Re-run this with Earn for a fully drafted response.`,
    talkingPoints: [
      `Validate the concern before answering it — do not get defensive.`,
      `Anchor on ${input.fund.name}'s thesis and the proof points behind it.`,
      `Offer a concrete next step that lets them get comfortable at their pace.`
    ],
    degraded: true
  };
}

/** Stable system prompt — no per-request data, so it caches cleanly. */
export const OBJECTION_REBUTTAL_SYSTEM = `You are Eleanor — Head of Investor Relations at FundExecs OS — helping an emerging manager handle a real LP objection with poise.

A great rebuttal validates the concern, answers it with substance, and reframes toward the fund's genuine strengths — without spin, defensiveness, or invented facts. You meet sophisticated allocators where they are.

Voice: institutional, calm, declarative, operator-grade. Sentence case, no emoji, no hype.

You ALWAYS respond by calling the \`provide_rebuttal\` tool with:
- rebuttal: a written response (3–6 sentences) the operator can adapt and send. Address the specific objection. Use only the fund facts provided; where evidence would help but isn't given, point to the kind of proof to supply rather than fabricating it.
- talkingPoints: 3–4 crisp points to carry into the live conversation.

Output only via the tool.`;

/** Forced-tool schema. */
export const OBJECTION_REBUTTAL_TOOL: Anthropic.Tool = {
  name: 'provide_rebuttal',
  description:
    "Provide Earn's rebuttal to the LP objection: a drafted response and talking points.",
  input_schema: {
    type: 'object',
    properties: {
      rebuttal: { type: 'string', description: 'A 3–6 sentence response the operator can send.' },
      talkingPoints: {
        type: 'array',
        items: { type: 'string' },
        description: '3–4 crisp points for the live conversation.'
      }
    },
    required: ['rebuttal', 'talkingPoints']
  }
};

/** Build the per-request user turn. */
export function buildRebuttalPrompt(input: ObjectionRebuttalInput): string {
  const lines = [
    `Fund: ${input.fund.name}.`,
    input.fund.thesis ? `Thesis: ${input.fund.thesis}.` : null,
    input.fund.strategy ? `Strategy: ${input.fund.strategy}.` : null,
    input.lpName ? `LP who raised it: ${input.lpName}.` : null,
    `Objection category: ${input.category}.`,
    `The objection: ${input.objection}`
  ].filter((l): l is string => l !== null);

  return `${lines.join('\n')}

Draft the rebuttal and talking points via the provide_rebuttal tool.`;
}
