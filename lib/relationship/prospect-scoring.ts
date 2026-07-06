// lib/relationship/prospect-scoring.ts
// Unified prospect scoring for the native Relationship Intelligence Engine.
//
// Three pure, testable scores drive prioritization across the CRM:
//   - fitScore       how well a contact/org matches the firm's mandate/goal
//   - priorityScore  fit + confidence + engagement + strength + urgency, blended
//   - needsReview    the "don't bulk-message low-confidence data" guardrail
//
// These generalize the LP-specific scoreThesisFit (capital-map.ts) to any
// prospect. Native — no external service. Every input is optional so partial
// records still score.

export type ScoreBand = "high" | "medium" | "low";

export function scoreBand(score: number): ScoreBand {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

// Case-insensitive "does haystack mention needle" (word-ish contains).
function mentions(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.trim().toLowerCase());
}

// Seniority → up to 30 points. Decision-makers are worth more as prospects.
const SENIORITY_WEIGHT: Record<string, number> = {
  c_suite: 30,
  owner: 30,
  founder: 30,
  partner: 28,
  vp: 22,
  director: 18,
  manager: 12,
  individual: 6,
};
function seniorityWeight(seniority?: string | null): number {
  if (!seniority) return 8;
  return SENIORITY_WEIGHT[seniority.toLowerCase().replace(/[\s-]+/g, "_")] ?? 8;
}

export interface FitTarget {
  seniority?: string | null;
  title?: string | null;
  company?: string | null;
  location?: string | null;
}

export interface Mandate {
  geographies?: string[];
  assetClasses?: string[];
  // Titles/roles the firm is trying to reach (e.g. "Managing Partner", "CIO").
  targetRoles?: string[];
}

export interface FitResult {
  score: number;
  band: ScoreBand;
  reasons: string[];
}

// How well a contact matches the mandate. 0–100, with human-readable reasons.
export function fitScore(target: FitTarget, mandate: Mandate): FitResult {
  const reasons: string[] = [];
  let score = 0;

  // Geography — up to 30. Contact location intersects mandate geographies.
  if (mandate.geographies?.length) {
    if (target.location && mandate.geographies.some((g) => mentions(target.location!, g) || mentions(g, target.location!))) {
      score += 30;
      reasons.push("Located in a target geography.");
    }
  } else {
    score += 10; // No geographic constraint — mildly positive by default.
  }

  // Seniority — up to 30.
  const sw = seniorityWeight(target.seniority);
  score += sw;
  if (sw >= 22) reasons.push("Senior decision-maker.");

  // Role/title relevance — up to 25 (targetRoles), else up to 15 (asset class).
  if (mandate.targetRoles?.length && target.title && mandate.targetRoles.some((r) => mentions(target.title!, r))) {
    score += 25;
    reasons.push("Title matches a target role.");
  } else if (mandate.assetClasses?.length && target.title && mandate.assetClasses.some((a) => mentions(target.title!, a))) {
    score += 15;
    reasons.push("Title aligns with a target asset class.");
  }

  // Identifiable organization — up to 15.
  if (target.company) {
    score += 15;
    reasons.push("Affiliated with a named organization.");
  }

  const final = clamp(score);
  return { score: final, band: scoreBand(final), reasons };
}

export interface PriorityInputs {
  fit: number; // 0–100
  confidence?: number; // 0–100 data reliability
  engagement?: number; // 0–100 active interest
  strength?: number; // 0–100 relationship strength
  urgency?: number; // 0–100
}

export interface PriorityResult {
  score: number;
  band: ScoreBand;
}

// Combine the signals into one prioritization score. Fit and confidence carry
// the most weight (a strong-fit, trustworthy record is worth pursuing);
// engagement, relationship strength, and urgency modulate. Missing signals
// contribute 0 rather than penalizing.
export function priorityScore(p: PriorityInputs): PriorityResult {
  const fit = clamp(p.fit);
  const confidence = clamp(p.confidence ?? 0);
  const engagement = clamp(p.engagement ?? 0);
  const strength = clamp(p.strength ?? 0);
  const urgency = clamp(p.urgency ?? 0);

  const score = clamp(
    fit * 0.35 + confidence * 0.2 + engagement * 0.2 + strength * 0.15 + urgency * 0.1,
  );
  return { score, band: scoreBand(score) };
}

// Below this confidence, a contact must be reviewed before bulk outbound.
export const REVIEW_CONFIDENCE_THRESHOLD = 50;

export interface ReviewInputs {
  confidence?: number | null;
  verified?: boolean | null;
  email?: string | null;
}

// The "don't bulk-message unreliable data" gate. A verified contact is fine; an
// unverified one needs review if its confidence is low or it has no email.
export function needsReview(c: ReviewInputs): boolean {
  if (c.verified) return false;
  if ((c.confidence ?? 0) < REVIEW_CONFIDENCE_THRESHOLD) return true;
  if (!c.email) return true;
  return false;
}

export interface BulkEligibility {
  eligible: boolean;
  reason?: string;
}

// Combine the compliance gate with the review gate for bulk outbound: a contact
// must be contactable AND not need review (unless review is explicitly allowed).
export function bulkOutboundEligibility(args: {
  contactable: boolean;
  contactableReason?: string;
  needsReview: boolean;
  allowUnreviewed?: boolean;
}): BulkEligibility {
  if (!args.contactable) {
    return { eligible: false, reason: args.contactableReason ?? "Not contactable" };
  }
  if (args.needsReview && !args.allowUnreviewed) {
    return { eligible: false, reason: "Low-confidence contact needs review before bulk outbound" };
  }
  return { eligible: true };
}
