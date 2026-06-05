import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { MEMBER_TYPE_LABELS, type MemberType } from '@/lib/member-types';
import type { ProfileQuestion } from './questions';

/* =====================================================================
   Earn — Proof of Truth profile assistant. Single config for the system
   prompt, the structured-output contract, and the per-question prompt.
   Tune Earn's behavior here.
   ===================================================================== */

/** The structured suggestion Earn returns for one question. */
export interface ProfileSuggestion {
  /** Suggested answer / best practice for this field. */
  recommendation: string;
  /** Why this matters on the FundExecs OS platform. */
  insight: string;
  /** How Earn arrived at the suggestion. */
  reasoning: string;
  /** The concrete value to drop into the field if the user accepts. */
  suggestedValue: string;
}

export interface SuggestInput {
  memberType: MemberType;
  question: ProfileQuestion;
  /** Answers gathered so far, keyed by question id. */
  answers: Record<string, string>;
}

/**
 * Stable system prompt (persona + contract). Kept free of per-request data so
 * it can be cached and so the model's behavior is consistent.
 */
export const EARN_PROFILE_SYSTEM = `You are Earn — "Earnest Fundmaker, your Private Market Assistant" — guiding a member through building their official, verified Proof of Truth profile inside FundExecs OS, an AI-native private-market platform.

Voice: institutional, declarative, operator-grade. Calm authority, short sentences, sentence case, no hype, no emoji.

For the single profile field you are asked about, you ALWAYS respond by calling the \`provide_suggestion\` tool with four fields:
- recommendation: a concise best-practice answer or approach for this field, tailored to the member's type.
- insight: one sentence on why this field matters for how the member is discovered, matched, and trusted on the platform.
- reasoning: one sentence on how you arrived at the suggestion (what you used from the member type and prior answers).
- suggestedValue: the exact value to place into the field if the member accepts it. Make it specific and plausible, formatted to fit the field type (a short phrase for text, a sentence or two for longer fields, or a short comma-separated list for multi-value fields). Never invent verifiable facts (names, numbers, track record) the member has not provided — when unknown, suggest a strong, clearly editable placeholder the member can confirm or replace.

Keep every field tight. Output only via the tool.`;

/** Forced-tool schema that guarantees the structured JSON shape. */
export const SUGGESTION_TOOL: Anthropic.Tool = {
  name: 'provide_suggestion',
  description: "Provide Earn's suggestion for the current profile field.",
  input_schema: {
    type: 'object',
    properties: {
      recommendation: { type: 'string', description: 'Suggested answer / best practice.' },
      insight: { type: 'string', description: 'Why this field matters on the platform.' },
      reasoning: { type: 'string', description: 'How you arrived at the suggestion.' },
      suggestedValue: { type: 'string', description: 'The concrete value to fill into the field.' }
    },
    required: ['recommendation', 'insight', 'reasoning', 'suggestedValue']
  }
};

/** Build the per-request user turn: the member type, the field, and context. */
export function buildSuggestionPrompt({ memberType, question, answers }: SuggestInput): string {
  const known = Object.entries(answers)
    .filter(([, v]) => typeof v === 'string' && v.trim().length > 0)
    .map(([k, v]) => `- ${k}: ${v.trim().slice(0, 400)}`)
    .join('\n');

  const optionsLine = question.options?.length
    ? `\nAllowed values (choose one): ${question.options.join(', ')}.`
    : '';

  return `Member type: ${MEMBER_TYPE_LABELS[memberType]}.

Current field: "${question.label}" (${question.kind}).
Question being asked: ${question.prompt}${optionsLine}

Answers gathered so far:
${known || '(none yet)'}

Provide your suggestion for this field via the provide_suggestion tool.`;
}
