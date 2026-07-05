// Relationship scoring — pure functions shared by the import pipeline, the
// Capital Network views, and the copilot relationship context provider.
//
// Three distinct scores (all 0–100):
//   strength   — how strong the relationship is (interactions, recency)
//   relevance  — how capital-relevant the contact is to private-market work
//   confidence — how reliable the underlying data is (computed at normalize)

import type { CapitalRole, NormalizedProfile } from "./types";

export type StrengthInputs = {
  /** Count of recorded interactions (emails, meetings, notes). */
  interactions: number;
  /** Days since the most recent interaction; null when never. */
  daysSinceLastInteraction: number | null;
  /** Days since first connected (e.g. LinkedIn connected_on); null unknown. */
  daysConnected: number | null;
  /** Optional explicit 0–100 rating set by the user; overrides nothing but adds. */
  userRating?: number | null;
};

/** Relationship strength: recency-weighted interaction history. */
export function scoreStrength(inputs: StrengthInputs): number {
  let score = 0;

  // Interaction volume: saturating curve, 12+ interactions ≈ full 45 points.
  score += Math.min(45, Math.round(45 * (1 - Math.exp(-inputs.interactions / 5))));

  // Recency: full 35 within a week, decaying to 0 past a year.
  if (inputs.daysSinceLastInteraction !== null) {
    const d = inputs.daysSinceLastInteraction;
    score += d <= 7 ? 35 : d <= 30 ? 28 : d <= 90 ? 18 : d <= 365 ? 8 : 0;
  }

  // Tenure: long-standing connections carry residual warmth (up to 10).
  if (inputs.daysConnected !== null) {
    score += inputs.daysConnected >= 730 ? 10 : inputs.daysConnected >= 365 ? 7 : inputs.daysConnected >= 90 ? 4 : 2;
  }

  // Explicit user rating blends in as up to 10 bonus points.
  if (inputs.userRating != null) {
    score += Math.round(Math.max(0, Math.min(100, inputs.userRating)) / 10);
  }

  return Math.max(0, Math.min(100, score));
}

export function strengthLabel(score: number): "cold" | "warm" | "active" | "strong" {
  if (score >= 75) return "strong";
  if (score >= 50) return "active";
  if (score >= 25) return "warm";
  return "cold";
}

/** How much weight each capital role carries for private-market relevance. */
const ROLE_RELEVANCE: Record<CapitalRole, number> = {
  limited_partner: 50,
  family_office: 50,
  capital_provider: 46,
  lender: 44,
  fund_manager: 40,
  independent_sponsor: 38,
  broker: 34,
  operator: 32,
  advisor: 28,
  founder: 26,
  strategic_partner: 26,
  service_provider: 16,
  unknown: 0,
};

const RELEVANT_TAGS = new Set([
  "lp", "investor", "capital", "lender", "credit", "family office", "fund",
  "acquisition", "deal", "sponsor", "co-invest", "coinvest", "operator",
]);

export type RelevanceInputs = {
  capitalRole: CapitalRole;
  title: string | null;
  tags: string[];
  /** Whether the contact is already linked to a deal/fund in the graph. */
  linkedToDealOrFund?: boolean;
  /** Optional keyword scope from the active workflow (fund thesis, deal sector). */
  scopeKeywords?: string[];
};

/** Capital relevance: role-weighted plus workflow-scoped keyword matching. */
export function scoreRelevance(inputs: RelevanceInputs): number {
  let score = ROLE_RELEVANCE[inputs.capitalRole];

  const tagText = inputs.tags.map((t) => t.toLowerCase());
  if (tagText.some((t) => RELEVANT_TAGS.has(t))) score += 15;

  const title = (inputs.title ?? "").toLowerCase();
  if (/invest|capital|partner|principal|director/.test(title)) score += 10;

  if (inputs.linkedToDealOrFund) score += 15;

  // Scoped relevance: does this contact's text match the active workflow?
  if (inputs.scopeKeywords && inputs.scopeKeywords.length > 0) {
    const haystack = `${title} ${tagText.join(" ")}`.toLowerCase();
    const hits = inputs.scopeKeywords.filter(
      (k) => k.trim().length > 2 && haystack.includes(k.trim().toLowerCase()),
    ).length;
    score += Math.min(20, hits * 7);
  }

  return Math.max(0, Math.min(100, score));
}

/** Initial scores for a freshly imported profile (no interaction history yet). */
export function initialScores(profile: NormalizedProfile): {
  strength: number;
  strengthLabel: "cold" | "warm" | "active" | "strong";
  relevance: number;
} {
  const daysConnected = profile.connected_on
    ? Math.max(0, Math.floor((Date.now() - new Date(profile.connected_on).getTime()) / 86_400_000))
    : null;
  const strength = scoreStrength({
    interactions: 0,
    daysSinceLastInteraction: null,
    daysConnected,
  });
  return {
    strength,
    strengthLabel: strengthLabel(strength),
    relevance: scoreRelevance({
      capitalRole: profile.capital_role,
      title: profile.title,
      tags: profile.tags,
    }),
  };
}
