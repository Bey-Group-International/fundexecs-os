import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { MEMBER_TYPE_LABELS, type MemberType } from '@/lib/member-types';
import type { ProfileQuestion } from './questions';

/* =====================================================================
   Earn — Proof of Truth profile assistant. Single config for the system
   prompt, the structured-output contract, and the per-question prompt.
   Tune Earn's behavior here.

   Earn does not auto-suggest. When the member asks for a recommendation,
   Earn returns THREE genuinely distinct candidate answers it has
   considered, plus a short insight line. On regeneration it is told which
   values the member already passed on, and avoids them.
   ===================================================================== */

/** One candidate answer Earn proposes for a field. */
export interface ProfileRecommendation {
  /** The concrete value to drop into the field if the member approves it. */
  value: string;
  /** One short line on why Earn offers this option. */
  note: string;
}

/** Earn's full response for one question: an insight + three options. */
export interface ProfileRecommendations {
  /** A short Earn "insight" line shown above the options. */
  insight: string;
  /** The candidate answers (up to three, distinct). */
  options: ProfileRecommendation[];
}

export interface SuggestInput {
  memberType: MemberType;
  question: ProfileQuestion;
  /** Answers gathered so far, keyed by question id. */
  answers: Record<string, string>;
  /** Values the member already disapproved for this question (avoid these). */
  disliked?: string[];
}

/**
 * Stable system prompt (persona + contract). Kept free of per-request data so
 * it can be cached and so the model's behavior is consistent.
 */
export const EARN_PROFILE_SYSTEM = `You are Earn — "Earnest Fundmaker, your Private Market Assistant" — guiding a member through building their official, verified Proof of Truth profile inside FundExecs OS, an AI-native private-market platform.

Voice: institutional, declarative, operator-grade. Calm authority, short sentences, sentence case, no hype, no emoji.

For the single profile field you are asked about, you ALWAYS respond by calling the \`provide_recommendations\` tool with:
- insight: one self-aware sentence framing the options as your own considered take — why this field matters for how the member is discovered, matched, and trusted on the platform.
- options: EXACTLY three genuinely distinct, high-quality candidate answers tailored to the member's type and their prior answers. Each option is { value, note }.
  - value: the exact text to place into the field if the member approves it. Make it specific and plausible, formatted to fit the field type (a short phrase for text, a sentence or two for longer fields, a short comma-separated list for multi-value fields). Never invent verifiable facts (names, numbers, track record) the member has not provided — when something is unknown, offer a strong, clearly-editable placeholder the member can confirm or replace.
  - note: one short line on why you offer this particular option (its angle / emphasis).

The three options must take meaningfully different angles — do not return three rewordings of the same idea. Speak as yourself: these are options you considered and are recommending.

If you are told the member already passed on certain values, treat them as rejected: do not repeat them or close variants of them, and lean into a different direction.

Keep every field tight. Output only via the tool.`;

/** Forced-tool schema that guarantees the structured JSON shape. */
export const RECOMMENDATIONS_TOOL: Anthropic.Tool = {
  name: 'provide_recommendations',
  description: "Provide Earn's three recommended answers for the current profile field.",
  input_schema: {
    type: 'object',
    properties: {
      insight: {
        type: 'string',
        description: 'One self-aware sentence framing the options and why this field matters.'
      },
      options: {
        type: 'array',
        description: 'Exactly three distinct candidate answers.',
        items: {
          type: 'object',
          properties: {
            value: { type: 'string', description: 'The concrete value to fill into the field.' },
            note: { type: 'string', description: 'One short line on why you offer this option.' }
          },
          required: ['value', 'note']
        }
      }
    },
    required: ['insight', 'options']
  }
};

/** Build the per-request user turn: the member type, the field, and context. */
export function buildSuggestionPrompt({
  memberType,
  question,
  answers,
  disliked
}: SuggestInput): string {
  const known = Object.entries(answers)
    .filter(([, v]) => typeof v === 'string' && v.trim().length > 0)
    .map(([k, v]) => `- ${k}: ${v.trim().slice(0, 400)}`)
    .join('\n');

  const optionsLine = question.options?.length
    ? `\nAllowed values (choose from): ${question.options.join(', ')}.`
    : '';

  const avoid = (disliked ?? [])
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .map((v) => `- ${v.slice(0, 400)}`)
    .join('\n');

  const avoidBlock = avoid ? `\n\nAvoid these — the member already passed on them:\n${avoid}` : '';

  return `Member type: ${MEMBER_TYPE_LABELS[memberType]}.

Current field: "${question.label}" (${question.kind}).
Question being asked: ${question.prompt}${optionsLine}

Answers gathered so far:
${known || '(none yet)'}${avoidBlock}

Provide exactly three distinct recommended answers for this field via the provide_recommendations tool.`;
}
