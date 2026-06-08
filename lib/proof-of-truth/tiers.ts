import type { ProfileQuestion } from './questions';

/* ============================================================================
 * lib/proof-of-truth/tiers.ts — the Profile readiness ladder.
 *
 * The Profile is not a flat form with one percentage. It is a ladder a member
 * climbs, where each rung compounds the value of the last: a sharp thesis only
 * lands once the identity above it holds up, and a counterparty only reads the
 * evidence once the mandate matches. Four rungs:
 *
 *   1. Identity      → "Discoverable"           (who you are)
 *   2. Mandate       → "Matchable"              (what you do and want)
 *   3. Evidence      → "Diligence-ready"        (the substance they press on)
 *   4. Institutional → "Institutionally ready"  (nothing thin left on the record)
 *
 * Each collecting rung (1–3) owns a slice of the SAME per-member-type question
 * set onboarding uses (`questions.ts`), so the ladder, the gaps, and the wizard
 * all stay in lockstep. The 4th rung owns no questions — it is the capstone:
 * earned only when every required field across 1–3 reads strong (not thin).
 *
 * This module is pure (no React, no server-only) so the server Profile surface
 * (`fund-profile.ts`) and the client onboarding wizard (`ProofOfTruthFlow`) can
 * both compute the identical ladder.
 * ========================================================================= */

/** A string answer is "weak" (present but thin) below this length. */
export const WEAK_TEXT_LEN = 40;

/** Only free-text prose can read "weak"; structured fields are present or not. */
export function isWeakText(kind: ProfileQuestion['kind'], text: string): boolean {
  const len = text.trim().length;
  return kind === 'textarea' && len > 0 && len < WEAK_TEXT_LEN;
}

export type ProfileTierId = 'identity' | 'mandate' | 'evidence' | 'institutional';

/** The three rungs that actually collect answers (institutional is the gate). */
export type CollectingTierId = Exclude<ProfileTierId, 'institutional'>;

export interface ProfileTier {
  id: ProfileTierId;
  /** 1-based position in the ladder. */
  order: number;
  /** Short rung label. */
  label: string;
  /** The readiness state this rung unlocks when complete. */
  readiness: string;
  /** One line on what the rung proves to a counterparty. */
  blurb: string;
}

/** The ladder definition, in climb order. */
export const PROFILE_TIERS: readonly ProfileTier[] = [
  {
    id: 'identity',
    order: 1,
    label: 'Identity',
    readiness: 'Discoverable',
    blurb: 'Who you are — the record a counterparty lands on first.'
  },
  {
    id: 'mandate',
    order: 2,
    label: 'Mandate',
    readiness: 'Matchable',
    blurb: 'What you do and what you want — so the right counterparties find you.'
  },
  {
    id: 'evidence',
    order: 3,
    label: 'Evidence',
    readiness: 'Diligence-ready',
    blurb: 'The substance a counterparty presses on — thesis, traction, the proof.'
  },
  {
    id: 'institutional',
    order: 4,
    label: 'Institutional',
    readiness: 'Institutionally ready',
    blurb: 'Nothing thin left — every required field reads like a seasoned operator wrote it.'
  }
] as const;

export function getTier(id: ProfileTierId): ProfileTier {
  // Non-null: every ProfileTierId is present in PROFILE_TIERS.
  return PROFILE_TIERS.find((t) => t.id === id)!;
}

/** Identity fields are common to every member type (who you are). */
const IDENTITY_IDS = new Set([
  'display_name',
  'headline',
  'bio',
  'focus_areas',
  'linkedin',
  'website'
]);

/** Intent fields (what you want, what's live, how soon) — part of the mandate. */
const INTENT_IDS = new Set(['objective', 'active_work', 'urgency']);

/**
 * Which rung a question belongs to. Identity fields are fixed; intent rolls into
 * the mandate; the deep prose detail (thesis, traction, ideal client, value-add,
 * career goal…) is the evidence a counterparty diligences; everything else
 * structured (firm type, sectors, stage, check size…) makes you matchable.
 */
export function tierForQuestion(q: ProfileQuestion): CollectingTierId {
  if (IDENTITY_IDS.has(q.id)) return 'identity';
  if (INTENT_IDS.has(q.id)) return 'mandate';
  if (q.target === 'details' && q.kind === 'textarea') return 'evidence';
  return 'mandate';
}

/** One scored answer, the unit the ladder is built from. */
export interface LadderItem {
  tier: CollectingTierId;
  optional: boolean;
  present: boolean;
  weak: boolean;
}

/** Per-rung progress. */
export interface TierProgress {
  tier: ProfileTier;
  /** Required (non-optional) fields owned by this rung. */
  required: number;
  /** Weighted points earned (strong = 1, thin = 0.5, missing = 0). */
  earned: number;
  /** 0–100 completeness of this rung's required fields. */
  pct: number;
  /** True when every required field is present and strong. */
  complete: boolean;
  /** Required fields still missing or thin. */
  gaps: number;
  /** True until the previous rung is complete (the rung isn't lit yet). */
  locked: boolean;
}

export interface ProfileLadderState {
  /** All four rungs, in climb order (institutional last). */
  tiers: TierProgress[];
  /** The rung the member is on — the first incomplete one (or institutional). */
  currentTierId: ProfileTierId;
  /** The highest readiness state fully achieved, or null before any rung. */
  readinessTierId: ProfileTierId | null;
  /** Display label for the achieved readiness, e.g. "Matchable". */
  readinessLabel: string;
  /** Weighted completeness across all required fields (matches completenessScore). */
  overallPct: number;
  /** Every required field present and strong — the record an institution can't press on. */
  institutionalReady: boolean;
}

const COLLECTING: CollectingTierId[] = ['identity', 'mandate', 'evidence'];

function pointsFor(item: LadderItem): number {
  if (!item.present) return 0;
  return item.weak ? 0.5 : 1;
}

/**
 * Build the readiness ladder from a flat list of scored answers. Pure and
 * deterministic — the same `items` always produce the same ladder, whether
 * computed on the server (from the member row) or the client (from answers).
 */
export function buildLadder(items: LadderItem[]): ProfileLadderState {
  const byTier = new Map<CollectingTierId, { required: number; earned: number; gaps: number }>();
  for (const t of COLLECTING) byTier.set(t, { required: 0, earned: 0, gaps: 0 });

  for (const item of items) {
    if (item.optional) continue; // optional fields lift quality, never gate the rung
    const acc = byTier.get(item.tier)!;
    acc.required += 1;
    acc.earned += pointsFor(item);
    if (!item.present || item.weak) acc.gaps += 1;
  }

  const collecting: TierProgress[] = [];
  let prevComplete = true;
  let totalRequired = 0;
  let totalEarned = 0;

  for (const id of COLLECTING) {
    const acc = byTier.get(id)!;
    // A rung with nothing to collect hasn't been achieved — it reads 0%, not 100%.
    const pct = acc.required === 0 ? 0 : Math.round((acc.earned / acc.required) * 100);
    const complete = acc.required > 0 && acc.gaps === 0;
    totalRequired += acc.required;
    totalEarned += acc.earned;
    collecting.push({
      tier: getTier(id),
      required: acc.required,
      earned: acc.earned,
      pct: Math.max(0, Math.min(100, pct)),
      complete,
      gaps: acc.gaps,
      locked: !prevComplete
    });
    prevComplete = complete;
  }

  const overallPct =
    totalRequired === 0 ? 0 : Math.max(0, Math.min(100, Math.round((totalEarned / totalRequired) * 100)));
  const institutionalReady = collecting.every((t) => t.complete) && totalRequired > 0;
  const remainingGaps = collecting.reduce((sum, t) => sum + t.gaps, 0);

  const institutional: TierProgress = {
    tier: getTier('institutional'),
    required: 0,
    earned: 0,
    pct: institutionalReady ? 100 : 0,
    complete: institutionalReady,
    gaps: institutionalReady ? 0 : remainingGaps,
    // The capstone lights only once the evidence rung is fully strong.
    locked: !collecting[2].complete
  };

  const tiers = [...collecting, institutional];

  // Highest fully-earned rung gives the achieved readiness label.
  let readinessTierId: ProfileTierId | null = null;
  let readinessLabel = 'Getting started';
  for (const t of tiers) {
    if (t.complete) {
      readinessTierId = t.tier.id;
      readinessLabel = t.tier.readiness;
    }
  }

  // The member is "on" the first rung that isn't complete (or the capstone).
  const current = tiers.find((t) => !t.complete);
  const currentTierId: ProfileTierId = current ? current.tier.id : 'institutional';

  return {
    tiers,
    currentTierId,
    readinessTierId,
    readinessLabel,
    overallPct,
    institutionalReady
  };
}
