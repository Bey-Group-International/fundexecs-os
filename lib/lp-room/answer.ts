import type Anthropic from '@anthropic-ai/sdk';

/* =====================================================================
   LP Q&A Assistant (Juniper Square → Fund Room / LP Room). Eleanor drafts
   the GP's answer to an LP's question using ONLY the fund's approved
   materials — the room documents and the Source of Truth. She cites what
   she draws on and never invents facts; when the materials don't cover it,
   she says so and offers a follow-up. Client/server-safe contract +
   templated fallback; the Anthropic call lives in `lib/ai/lp-answer.ts`.
   ===================================================================== */

export interface LpAnswerDraft {
  /** The answer the GP can review, edit, and post to the LP thread. */
  answer: string;
  /** Labels of the approved materials the answer drew on. */
  citations: string[];
  /** True when this is the templated fallback (Earn was unavailable). */
  degraded: boolean;
}

export interface LpAnswerInput {
  question: string;
  /** Who asked, for tone. */
  askerName: string | null;
  fund: {
    name: string;
    thesis: string | null;
    strategy: string | null;
    targetRaise: number | null;
  };
  /** Names of documents in the room the LP is entitled to see. */
  approvedDocs: string[];
}

/** Templated fallback — a safe holding answer; never throws, never invents. */
export function templatedLpAnswer(input: LpAnswerInput): LpAnswerDraft {
  return {
    answer: `Thank you for the question. Let me pull the precise detail from ${input.fund.name}'s materials and follow up shortly with a complete answer — I want to make sure what I share is exactly right.`,
    citations: [],
    degraded: true
  };
}

/** Stable system prompt — no per-request data, so it caches cleanly. */
export const LP_ANSWER_SYSTEM = `You are Eleanor — Head of Investor Relations at FundExecs OS — drafting the GP's answer to a limited partner's question for the fund's LP room.

You answer ONLY from the fund's approved materials (the room documents and the fund's Source of Truth provided to you). This is a compliance boundary: you never invent performance figures, terms, commitments, or facts that are not in the materials. When the materials do not cover the question, you say so plainly and offer to follow up with the specific document or detail — you do not guess.

Voice: institutional, warm, precise, operator-grade. Sentence case, no emoji, no hype. Write as the GP would speak to a sophisticated allocator.

You ALWAYS respond by calling the \`provide_lp_answer\` tool with:
- answer: the response to post in the LP thread. Direct, complete where the materials allow, honest about what needs a follow-up where they don't.
- citations: the labels of the approved materials you actually drew on (from the provided list). Empty when you answered from the fund summary alone or had to defer.

Output only via the tool.`;

/** Forced-tool schema. */
export const LP_ANSWER_TOOL: Anthropic.Tool = {
  name: 'provide_lp_answer',
  description: "Provide Eleanor's answer to the LP question, grounded in approved materials.",
  input_schema: {
    type: 'object',
    properties: {
      answer: { type: 'string', description: 'The answer to post in the LP thread.' },
      citations: {
        type: 'array',
        items: { type: 'string' },
        description: 'Labels of approved materials actually used (from the provided list).'
      }
    },
    required: ['answer', 'citations']
  }
};

function money(n: number | null): string | null {
  if (n == null) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

/** Build the per-request user turn from the question + approved materials. */
export function buildLpAnswerPrompt(input: LpAnswerInput): string {
  const summary = [
    `Fund: ${input.fund.name}.`,
    input.fund.thesis ? `Thesis: ${input.fund.thesis}.` : null,
    input.fund.strategy ? `Strategy: ${input.fund.strategy}.` : null,
    input.fund.targetRaise ? `Target raise: ${money(input.fund.targetRaise)}.` : null
  ].filter((l): l is string => l !== null);

  const docs = input.approvedDocs.length
    ? input.approvedDocs.map((d) => `- ${d}`).join('\n')
    : '- (no documents in the room yet)';

  return `Approved fund summary:
${summary.join('\n')}

Approved room documents (cite by these labels):
${docs}

${input.askerName ? `Asked by: ${input.askerName}.\n` : ''}LP question:
${input.question}

Draft the answer via the provide_lp_answer tool, using only the approved materials above.`;
}
