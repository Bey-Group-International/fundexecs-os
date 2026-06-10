import 'server-only';
import { getMemberOrCOO } from '@/lib/team/roster';
import { AI_MODELS } from '@/lib/ai/models';
// Pure scoring utilities live in utils.ts (no server deps) so tests can import
// them without pulling in Lucide icons or the team roster.
export {
  ANALYST_AGENTS,
  SYNTHESIS_AGENT,
  commitmentTone,
  clampCommitment,
  type AnalystAgent
} from './utils';
import type { AnalystAgent } from './utils';

/**
 * Meeting Copilot Intelligence Layer — orchestration config.
 *
 * Three analytical agents work in parallel over the meeting transcript;
 * the fourth (Synthesis, Earn herself) weighs their findings into the final
 * judgment — a commitment-probability score plus an operator-ready brief.
 *
 * Each analytical agent maps to an existing executive persona from
 * `lib/team/roster.ts` (slugs MUST stay stable — they back the Voyage
 * embeddings) so the Meeting Copilot voice matches the rest of the desk.
 */

export type MeetingAgent = AnalystAgent | 'synthesis';

/**
 * Model tiering — a single config object so models are trivially swappable.
 * The three analysts run on the `fast` tier (Haiku — cheap, parallel);
 * Synthesis runs on the `chat` tier (Sonnet — judgment + follow-up drafts).
 * Defaults flow from the central `AI_MODELS` registry so the whole desk
 * re-tiers from one place; the `MEETING_COPILOT_*` env vars still win when set.
 */
export const MEETING_COPILOT_MODELS = {
  analyst: process.env.MEETING_COPILOT_ANALYST_MODEL || AI_MODELS.fast,
  synthesis: process.env.MEETING_COPILOT_SYNTHESIS_MODEL || AI_MODELS.chat
} as const;

interface AnalystSpec {
  /** Roster slug whose persona/voice this agent borrows. */
  slug: string;
  /** Human label for the lane (used in prompts + logs). */
  label: string;
  /** What this agent is responsible for assessing. */
  mandate: string;
}

/**
 * Per-agent specification. The persona name/position is resolved from the
 * roster at prompt-build time so display fields stay in one place.
 */
export const ANALYST_SPECS: Record<AnalystAgent, AnalystSpec> = {
  objection_analyst: {
    slug: 'legal-admin', // Adrian — General Counsel & Compliance
    label: 'Objection Analysis',
    mandate:
      'Surface every objection, concern, or hesitation raised in the meeting — stated or implied. Classify each by type (price, timing, authority, need, trust). Rate severity 0–100 and propose a sharp counter for each. Judge whether the objections are navigable or deal-breaking.'
  },
  sentiment_scorer: {
    slug: 'rainmaker', // Vivian — MD, Demand Generation
    label: 'Sentiment & Commitment Scoring',
    mandate:
      "Assess the counterparty's emotional tone and buying signals throughout the transcript. Identify momentum shifts, enthusiasm peaks, and cold moments. Produce a 0–100 commitment-probability score: 0 means disengaged or hostile, 50 is genuinely interested but uncommitted, 100 is ready to proceed. Ground every claim in transcript evidence."
  },
  action_mapper: {
    slug: 'master-workflow', // Sterling — Chief of Staff
    label: 'Action & Follow-Up Mapping',
    mandate:
      'Extract every explicit and implicit next action from the meeting — commitments made, items promised, questions to answer, materials to send. Produce a prioritised list with owner and urgency. Draft two ready-to-send follow-up email paragraphs the operator can use immediately.'
  }
};

/** Synthesis (Earn) borrows the COO persona. */
export const SYNTHESIS_SLUG = 'earnest-fundmaker' as const;

/** Resolve the display persona (name + position) for an agent's slug. */
export function personaFor(slug: string): { name: string; position: string } {
  const member = getMemberOrCOO(slug);
  return { name: member.name, position: member.position };
}
