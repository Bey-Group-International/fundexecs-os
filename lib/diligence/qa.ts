import type Anthropic from '@anthropic-ai/sdk';

/* =====================================================================
   Diligence Q&A — "ask Earn about this review". The operator asks a
   question about a completed diligence run; Earn answers grounded ONLY
   in the run's synthesis memo, the six analyst findings, and any
   retrieved document context. She names the agents/lanes she drew on and
   never invents facts — when the review doesn't cover it, she says so.
   Client/server-safe contract + templated fallback; the Anthropic call
   lives in `lib/ai/diligence-qa.ts`. Ephemeral — nothing is persisted.
   ===================================================================== */

export interface DiligenceQaAnswer {
  /** The grounded answer to render inline under the composer. */
  answer: string;
  /** Lane labels (e.g. "Market Size", "Synthesis") the answer drew on. */
  drewOn: string[];
  /** True when this is the templated fallback (Earn was unavailable). */
  degraded: boolean;
}

/** One analyst finding, flattened for the prompt. */
export interface QaFinding {
  /** The analytical lane label (e.g. "Market Size") — what Earn cites by. */
  label: string;
  score: number | null;
  summary: string;
  detail: string | null;
}

export interface DiligenceQaInput {
  question: string;
  /** What the run reviewed, for framing (deal name when linked). */
  subject: string | null;
  synthesis: {
    conviction: number | null;
    recommendation: string;
    memo: string;
  } | null;
  /** The six analyst findings, in committee order. */
  findings: QaFinding[];
  /** Optional retrieved document passages (file name + snippet). */
  context: { fileName: string; content: string }[];
}

/** Templated fallback — a safe holding answer; never throws, never invents. */
export function templatedDiligenceQaAnswer(input: DiligenceQaInput): DiligenceQaAnswer {
  const subject = input.subject ?? 'this opportunity';
  return {
    answer: `Let me re-read the committee's findings on ${subject} and come back with the precise detail — I want what I share to track the review exactly rather than guess at it.`,
    drewOn: [],
    degraded: true
  };
}

/** Stable system prompt — no per-request data, so it caches cleanly. */
export const DILIGENCE_QA_SYSTEM = `You are Earn — COO of FundExecs OS — answering an operator's question about a diligence review your committee already ran.

You answer ONLY from the review provided to you: the synthesis memo and recommendation, the six analytical findings (each with a score and reasoning), and any retrieved document passages. This is a compliance boundary — you never invent figures, terms, or facts that are not in the review. When the review does not cover the question, you say so plainly and point to the follow-up diligence that would resolve it. You do not guess.

Voice: institutional, declarative, operator-grade. Sentence case, no emoji, no hype. Speak as the COO would to a partner reading the memo.

You ALWAYS respond by calling the \`answer_diligence_question\` tool with:
- answer: the response, grounded in the review. Direct where the findings support it, honest about gaps where they don't.
- drewOn: the lane labels you actually relied on (from the labels provided — e.g. "Market Size", "Synthesis"). Empty when you answered from the memo alone or had to defer.

Output only via the tool.`;

/** Forced-tool schema. */
export const DILIGENCE_QA_TOOL: Anthropic.Tool = {
  name: 'answer_diligence_question',
  description: "Provide Earn's answer to the operator's question, grounded in the review.",
  input_schema: {
    type: 'object',
    properties: {
      answer: { type: 'string', description: 'The grounded answer to the operator.' },
      drewOn: {
        type: 'array',
        items: { type: 'string' },
        description: 'Lane labels actually relied on (from the provided findings/synthesis).'
      }
    },
    required: ['answer', 'drewOn']
  }
};

/** Build the per-request user turn from the question + review materials. */
export function buildDiligenceQaPrompt(input: DiligenceQaInput): string {
  const header = input.subject
    ? `Review subject: ${input.subject}.`
    : 'Review subject: an unnamed opportunity.';

  const synthesis = input.synthesis
    ? [
        `### Synthesis (Earn) — conviction ${input.synthesis.conviction ?? 'n/a'}/100`,
        input.synthesis.recommendation ? `Recommendation: ${input.synthesis.recommendation}` : null,
        input.synthesis.memo || null
      ]
        .filter((l): l is string => l !== null)
        .join('\n')
    : '### Synthesis — not yet produced for this run.';

  const findings = input.findings.length
    ? input.findings
        .map((f) =>
          `### ${f.label} — score ${f.score ?? 'n/a'}/100\n${f.summary}\n\n${f.detail ?? ''}`.trim()
        )
        .join('\n\n')
    : 'No analytical findings are on this run yet.';

  const context = input.context.length
    ? input.context.map((c) => `[${c.fileName}]\n${c.content}`).join('\n\n')
    : '(no additional document passages retrieved)';

  return `${header}

${synthesis}

The six analytical findings (cite by these lane labels):

${findings}

Retrieved document passages (supporting evidence, may be empty):

${context}

Operator's question:
${input.question}

Answer via the answer_diligence_question tool, using only the review materials above.`;
}
