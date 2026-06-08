import type Anthropic from '@anthropic-ai/sdk';
import { MEMBER_TYPE_LABELS, type MemberType } from '@/lib/member-types';
import { FIRST_MOVES } from './first-moves';

/* =====================================================================
   Earn — instant launch brief. Shown once on a new member's first use of
   the command center, right after onboarding. A one-line read on who they
   are + their objective, then three concrete first moves tailored to their
   member type AND their stated objective / active work.

   Client- and server-safe (no `server-only`): the templated fallback and
   the types are shared with the API route and the card. The actual Anthropic
   call lives in `lib/ai/launch-brief.ts`.
   ===================================================================== */

/** One first move in the brief — a label, a one-line reason, and a destination. */
export interface BriefMove {
  label: string;
  detail: string;
  href: string;
}

/** Earn's full launch brief: a personalized read + three first moves. */
export interface LaunchBrief {
  /** One-line read on who they are and the outcome they want. */
  headline: string;
  /** Three concrete first moves, in priority order. */
  moves: BriefMove[];
  /** True when this is the templated fallback (Earn was unavailable). */
  degraded: boolean;
}

/** The member context the brief is built from. */
export interface LaunchBriefInput {
  memberType: MemberType;
  /** Display name (first name is used in the read). */
  displayName: string | null;
  /** Free-text 90-day objective, if answered. */
  objective: string | null;
  /** Free-text "actively working on", if answered. */
  activeWork: string | null;
  /** Timeline select, if answered. */
  urgency: string | null;
  /** One-line headline from the profile, for extra context. */
  headline: string | null;
}

/**
 * Templated fallback brief — used whenever Earn is unavailable (no API key, a
 * timeout, or malformed output). Built from `FIRST_MOVES[memberType]` plus the
 * member's own objective so it still feels personal. Never throws.
 */
export function templatedBrief(input: LaunchBriefInput): LaunchBrief {
  const firstName = (input.displayName ?? '').trim().split(/\s+/)[0] || 'there';
  const role = MEMBER_TYPE_LABELS[input.memberType].toLowerCase();
  const objective = (input.objective ?? '').trim();

  const headline = objective
    ? `Welcome, ${firstName}. You're here as ${aOrAn(role)} ${role}, and your next 90 days are about: ${trimEnd(objective)}.`
    : `Welcome, ${firstName}. You're set up as ${aOrAn(role)} ${role} — here's where to start.`;

  const moves: BriefMove[] = FIRST_MOVES[input.memberType].moves.map((m) => ({
    label: m.label,
    detail: m.detail,
    href: m.href
  }));

  return { headline, moves, degraded: true };
}

function aOrAn(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

/** Drop a single trailing period so the templated sentence reads cleanly. */
function trimEnd(s: string): string {
  return s.replace(/\.+$/, '');
}

/**
 * Stable system prompt for the launch brief. Free of per-request data so it
 * caches and stays consistent.
 */
export const LAUNCH_BRIEF_SYSTEM = `You are Earn — "Earnest Fundmaker, your Private Market Assistant" — welcoming a member to FundExecs OS, an AI-native private-market platform, the moment they finish onboarding.

You write their launch brief: a sharp, personal read on who they are and what they want, then exactly three concrete first moves that get them there.

Voice: institutional, declarative, operator-grade. Calm authority, short sentences, sentence case, no hype, no emoji. Speak as Earn, in the first person where natural — this is your read on their situation.

You ALWAYS respond by calling the \`provide_launch_brief\` tool with:
- headline: ONE line. Name who they are (their member type) and reflect their stated 90-day objective back to them precisely. If they gave an objective, anchor the line on it. Address them by first name. Make it feel like you read what they wrote, not a template.
- moves: EXACTLY three first moves, in priority order, each { label, detail, href }.
  - label: a short imperative, e.g. "Add your first LP".
  - detail: one line on why this move, now — tie it to their objective or active work when you can.
  - href: choose the most relevant destination for the move from the allowed hrefs you are given. Use only those hrefs.

Tailor the moves to BOTH their member type and their objective / active work. Order them by leverage toward their stated outcome. Never invent verifiable facts they did not provide. Output only via the tool.`;

/** Forced-tool schema guaranteeing the { headline, moves } shape. */
export const LAUNCH_BRIEF_TOOL: Anthropic.Tool = {
  name: 'provide_launch_brief',
  description: "Provide Earn's launch brief: a one-line read plus three first moves.",
  input_schema: {
    type: 'object',
    properties: {
      headline: {
        type: 'string',
        description: 'One-line read on who they are and the outcome they want.'
      },
      moves: {
        type: 'array',
        description: 'Exactly three first moves, in priority order.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Short imperative label for the move.' },
            detail: { type: 'string', description: 'One line on why this move, now.' },
            href: { type: 'string', description: 'Destination for the move (allowed hrefs only).' }
          },
          required: ['label', 'detail', 'href']
        }
      }
    },
    required: ['headline', 'moves']
  }
};

/** Build the per-request user turn from the member's context + allowed hrefs. */
export function buildBriefPrompt(input: LaunchBriefInput): string {
  const allowed = Array.from(new Set(FIRST_MOVES[input.memberType].moves.map((m) => m.href)));
  const lines = [
    `Member type: ${MEMBER_TYPE_LABELS[input.memberType]}.`,
    input.displayName ? `Name: ${input.displayName}.` : null,
    input.headline ? `Their headline: ${input.headline}.` : null,
    input.objective ? `Their 90-day objective: ${input.objective}.` : 'No 90-day objective given.',
    input.activeWork ? `Actively working on: ${input.activeWork}.` : null,
    input.urgency ? `Timeline: ${input.urgency}.` : null
  ].filter((l): l is string => Boolean(l));

  return `${lines.join('\n')}

Allowed hrefs (use only these for each move's href): ${allowed.join(', ')}.

Write their launch brief via the provide_launch_brief tool: a one-line read, then exactly three first moves tailored to their member type and objective.`;
}
