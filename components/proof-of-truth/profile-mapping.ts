import type { MemberType } from '@/lib/member-types';
import { getQuestionSet, type ProfileQuestion } from '@/lib/proof-of-truth/questions';
import {
  buildLadder,
  scoreDepth,
  tierForQuestion,
  type LadderItem,
  type ProfileLadderState
} from '@/lib/proof-of-truth/tiers';
import type { MemberProfileInput } from '@/lib/actions/member-profile';
import type { MemberProfile } from '@/lib/queries/member-profile';

/** Answers are stored as strings keyed by question id (tags are comma-joined). */
export type Answers = Record<string, string>;

/** Fields that land in the `links` object rather than `details`. */
const LINK_FIELDS = new Set(['linkedin', 'website']);

/** Split a stored tag string back into a trimmed, de-duplicated array. */
export function splitTags(value: string | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  for (const raw of value.split(',')) {
    const t = raw.trim();
    if (t && !out.some((v) => v.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

/** Count of questions with a non-empty answer / total, as a 0–100 percentage. */
export function completionPct(memberType: MemberType, answers: Answers): number {
  const set = getQuestionSet(memberType);
  if (!set.length) return 0;
  const answered = set.filter((q) => (answers[q.id] ?? '').trim().length > 0).length;
  return Math.round((answered / set.length) * 100);
}

/** Whether a single question's current answer is present, and whether it's thin. */
export function scoreAnswer(
  q: ProfileQuestion,
  answers: Answers
): { present: boolean; weak: boolean } {
  const raw = answers[q.id] ?? '';
  if (q.kind === 'tags') {
    return scoreDepth(q, { text: '', tagCount: splitTags(raw).length });
  }
  return scoreDepth(q, { text: raw, tagCount: 0 });
}

/**
 * Compute the readiness ladder from the in-progress answers, using the SAME
 * tier model and weak-text rule the server Profile surface uses — so the
 * wizard and `/profile` always agree on where the member stands.
 */
export function computeLadder(memberType: MemberType, answers: Answers): ProfileLadderState {
  const items: LadderItem[] = getQuestionSet(memberType).map((q) => {
    const { present, weak } = scoreAnswer(q, answers);
    return { tier: tierForQuestion(q), optional: Boolean(q.optional), present, weak };
  });
  return buildLadder(items);
}

/**
 * The index of the next required question that still needs work (missing or
 * thin), searched forward from `after` and wrapping once. This is the wizard's
 * "next best question" — it always points at the highest rung still open, in
 * climb order, so approving answers drives straight to 100%. Returns -1 when
 * every required field is strong.
 */
export function nextGapIndex(memberType: MemberType, answers: Answers, after: number): number {
  const set = getQuestionSet(memberType);
  const n = set.length;
  const ladder = computeLadder(memberType, answers);
  const targetTier = ladder.currentTierId;
  if (!targetTier) return -1;

  const order = Array.from({ length: n }, (_, step) => (after + step + 1) % n);

  // Prefer the next open gap on the rung the member is currently climbing, so
  // the wizard fills Identity before Mandate before Evidence rather than just
  // walking the raw question order.
  for (const i of order) {
    const q = set[i];
    if (q.optional || tierForQuestion(q) !== targetTier) continue;
    const { present, weak } = scoreAnswer(q, answers);
    if (!present || weak) return i;
  }

  // Fallback: any remaining required gap (covers the capstone tier, where no
  // collecting question matches the target rung).
  for (const i of order) {
    const q = set[i];
    if (q.optional) continue;
    const { present, weak } = scoreAnswer(q, answers);
    if (!present || weak) return i;
  }

  return -1;
}

/**
 * A read-only projection of the answers into the shape the live profile panel
 * renders: the named columns, the links map, and the details map.
 */
export interface AssembledProfile {
  displayName: string;
  headline: string;
  bio: string;
  focusAreas: string[];
  links: Record<string, string>;
  details: Array<{ question: ProfileQuestion; value: string; tags: string[] }>;
}

export function assembleProfile(memberType: MemberType, answers: Answers): AssembledProfile {
  const links: Record<string, string> = {};
  const details: AssembledProfile['details'] = [];
  let displayName = '';
  let headline = '';
  let bio = '';
  let focusAreas: string[] = [];

  for (const q of getQuestionSet(memberType)) {
    const value = (answers[q.id] ?? '').trim();
    if (q.target === 'profile') {
      if (q.field === 'display_name') displayName = value;
      else if (q.field === 'headline') headline = value;
      else if (q.field === 'bio') bio = value;
      else if (q.field === 'focus_areas') focusAreas = splitTags(value);
      continue;
    }
    // target: 'details'
    if (LINK_FIELDS.has(q.field)) {
      if (value) links[q.field] = value;
      continue;
    }
    if (!value) continue;
    details.push({ question: q, value, tags: q.kind === 'tags' ? splitTags(value) : [] });
  }

  return { displayName, headline, bio, focusAreas, links, details };
}

/** Map answers → the `saveMemberProfile` input for the final write. */
export function answersToProfileInput(
  memberType: MemberType,
  answers: Answers
): MemberProfileInput {
  const links: Record<string, string> = {};
  const details: Record<string, unknown> = {};
  const input: MemberProfileInput = {
    displayName: null,
    headline: null,
    bio: null,
    focusAreas: [],
    links: {},
    details: {},
    status: 'complete',
    completionPct: 100
  };

  for (const q of getQuestionSet(memberType)) {
    const value = (answers[q.id] ?? '').trim();
    if (q.target === 'profile') {
      if (q.field === 'display_name') input.displayName = value || null;
      else if (q.field === 'headline') input.headline = value || null;
      else if (q.field === 'bio') input.bio = value || null;
      else if (q.field === 'focus_areas') input.focusAreas = splitTags(value);
      continue;
    }
    if (LINK_FIELDS.has(q.field)) {
      if (value) links[q.field] = value;
      continue;
    }
    if (!value) continue;
    details[q.field] = q.kind === 'tags' ? splitTags(value) : value;
  }

  input.links = links;
  input.details = details;
  return input;
}

/**
 * Seed the answers map from a previously-saved profile so the flow resumes:
 * prefer the in-progress `draft`, then fall back to already-persisted fields.
 */
export function seedAnswers(profile: MemberProfile): Answers {
  const answers: Answers = {};

  // Persisted fields first (so a finished/edited profile re-populates).
  if (profile.displayName) answers.display_name = profile.displayName;
  if (profile.headline) answers.headline = profile.headline;
  if (profile.bio) answers.bio = profile.bio;
  if (profile.focusAreas.length) answers.focus_areas = profile.focusAreas.join(', ');
  for (const [k, v] of Object.entries(profile.links)) {
    if (typeof v === 'string' && v.trim()) answers[k] = v;
  }
  for (const [k, v] of Object.entries(profile.details)) {
    if (Array.isArray(v)) answers[k] = v.map((x) => String(x)).join(', ');
    else if (typeof v === 'string' && v.trim()) answers[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') answers[k] = String(v);
  }

  // Draft overrides (the most recent in-progress state).
  for (const [k, v] of Object.entries(profile.draft)) {
    if (Array.isArray(v)) answers[k] = v.map((x) => String(x)).join(', ');
    else if (typeof v === 'string') answers[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') answers[k] = String(v);
  }

  return answers;
}
