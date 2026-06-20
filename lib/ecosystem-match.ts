// lib/ecosystem-match.ts
// Instant ecosystem matchmaking — the pure core. When a new organization
// finishes onboarding, Earn scores its firm profile against every other
// discoverable org and classifies each fit into one of the five ecosystem lanes
// the operator already thinks in: Capital/LP, Debt & Capital, Partners,
// Providers, and Deals. The match alert that lands in the counterparty's bell is
// built here too. Everything in this file is pure (no DB, no I/O, no server-only
// imports) so the scoring, lane classification, and alert copy unit-test with
// small in-memory fixtures — the I/O orchestration lives in
// lib/ecosystem-match.server.ts.

// The four onboarding operator roles (organizations.operator_role).
export type OperatorRole = "gp" | "family_office" | "advisory" | "operator";

// The five ecosystem lanes a match can belong to. The lane is what the
// connection IS — capital, debt, a partner, a provider, or shared dealflow — and
// it drives the professional alert's headline.
export type EcosystemLane = "capital" | "debt" | "partners" | "providers" | "deals";

export const LANE_LABEL: Record<EcosystemLane, string> = {
  capital: "Capital / LP",
  debt: "Debt & Capital",
  partners: "Partners",
  providers: "Providers",
  deals: "Deals",
};

// The slice of an organization the matcher reasons over. A thin projection of
// the onboarding-captured firm profile so the pure layer never depends on the
// full DB row shape.
export interface EcoOrgProfile {
  id: string;
  name: string;
  operatorRole: string | null; // organizations.operator_role
  strategy: string | null; // organizations.primary_strategy
  location: string | null; // organizations.hq_location
  jurisdiction: string | null; // organizations.jurisdiction
  aumRange: string | null; // organizations.aum_range
}

export interface EcoMatch {
  org: EcoOrgProfile;
  lane: EcosystemLane;
  // 0..100 — how strong the fit is.
  score: number;
  reasons: string[];
}

// --- Display helpers --------------------------------------------------------

const ROLE_LABEL: Record<OperatorRole, string> = {
  gp: "GP / fund manager",
  family_office: "Family office",
  advisory: "Advisory",
  operator: "Operator",
};

const STRATEGY_LABEL: Record<string, string> = {
  real_estate: "real estate",
  private_equity: "private equity",
  credit: "credit",
  multi: "multi-strategy",
};

export function roleLabel(role: string | null): string {
  return role && role in ROLE_LABEL ? ROLE_LABEL[role as OperatorRole] : "Private-market firm";
}

export function strategyLabel(strategy: string | null): string {
  if (!strategy) return "private markets";
  return STRATEGY_LABEL[strategy] ?? strategy.replace(/_/g, " ");
}

// --- Lane classification ----------------------------------------------------

// Role pair → the lane the relationship naturally lives in. Keyed by the two
// roles sorted alphabetically so the map is symmetric (A↔B and B↔A resolve the
// same). A GP and a family office is capital; two GPs share dealflow; an
// advisory serves; an operator partners.
const ROLE_PAIR_LANE: Record<string, EcosystemLane> = {
  "advisory|advisory": "partners",
  "advisory|family_office": "providers",
  "advisory|gp": "providers",
  "advisory|operator": "partners",
  "family_office|family_office": "deals",
  "family_office|gp": "capital",
  "family_office|operator": "partners",
  "gp|gp": "deals",
  "gp|operator": "partners",
  "operator|operator": "partners",
};

function isRole(value: string | null): value is OperatorRole {
  return value === "gp" || value === "family_office" || value === "advisory" || value === "operator";
}

/**
 * Classify the relationship between two firms into an ecosystem lane, or null
 * when either role is unknown (no defensible complementarity to assert). A
 * capital relationship where either side runs credit is reclassified as Debt &
 * Capital — that is the more precise lane for a lender/borrower fit.
 */
export function classifyLane(a: EcoOrgProfile, b: EcoOrgProfile): EcosystemLane | null {
  if (!isRole(a.operatorRole) || !isRole(b.operatorRole)) return null;
  const key = [a.operatorRole, b.operatorRole].sort().join("|");
  const lane = ROLE_PAIR_LANE[key];
  if (!lane) return null;
  if (lane === "capital" && (a.strategy === "credit" || b.strategy === "credit")) return "debt";
  return lane;
}

// --- Scoring ----------------------------------------------------------------

// Lane floor: how much a bare role-complementarity is worth before strategy,
// geography, and scale refine it. Capital/debt anchor highest — a funding fit is
// the strongest reason to make an introduction.
const LANE_BASE: Record<EcosystemLane, number> = {
  capital: 30,
  debt: 30,
  deals: 24,
  partners: 20,
  providers: 20,
};

// AUM buckets in ascending order, so scale proximity is just index distance.
const AUM_ORDER = ["sub_25m", "25m_100m", "100m_500m", "500m_1b", "over_1b"];

// Split a location/jurisdiction string into comparable tokens, dropping noise
// words too short to be a meaningful place name.
function geoTokens(...parts: (string | null)[]): Set<string> {
  const out = new Set<string>();
  for (const p of parts) {
    if (!p) continue;
    for (const t of p.toLowerCase().split(/[^a-z0-9]+/)) {
      if (t.length > 2) out.add(t);
    }
  }
  return out;
}

/**
 * Score how well two firms fit, 0..100, with explainable reasons. The bands
 * mirror lib/matching's weighting so the two engines feel like one instrument:
 *   lane floor (role fit) → up to 30
 *   strategy overlap      → up to 25
 *   geography overlap     → up to 25
 *   scale proximity       → up to 20
 * Returns null when there is no role complementarity to build on.
 */
export function scoreOrgMatch(viewer: EcoOrgProfile, candidate: EcoOrgProfile): EcoMatch | null {
  const lane = classifyLane(viewer, candidate);
  if (!lane) return null;

  const reasons: string[] = [];
  let score = LANE_BASE[lane];
  reasons.push(`${roleLabel(candidate.operatorRole)} — a natural ${LANE_LABEL[lane].toLowerCase()} fit.`);

  // Strategy overlap (up to 25). Same strategy is the strongest signal;
  // multi-strategy on either side is a softer overlap; unknown is neutral.
  if (viewer.strategy && candidate.strategy) {
    if (viewer.strategy === candidate.strategy) {
      score += 25;
      reasons.push(`Both run a ${strategyLabel(viewer.strategy)} strategy.`);
    } else if (viewer.strategy === "multi" || candidate.strategy === "multi") {
      score += 15;
      reasons.push("Multi-strategy overlap.");
    }
  } else {
    score += 8;
  }

  // Geography overlap (up to 25). Any shared place token across hq_location /
  // jurisdiction counts.
  const vTokens = geoTokens(viewer.location, viewer.jurisdiction);
  const cTokens = geoTokens(candidate.location, candidate.jurisdiction);
  const shared = [...vTokens].find((t) => cTokens.has(t));
  if (shared) {
    score += 25;
    reasons.push(`Both operate in ${shared.replace(/\b\w/, (c) => c.toUpperCase())}.`);
  }

  // Scale proximity (up to 20). Closer AUM bands deploy at compatible sizes.
  const vi = viewer.aumRange ? AUM_ORDER.indexOf(viewer.aumRange) : -1;
  const ci = candidate.aumRange ? AUM_ORDER.indexOf(candidate.aumRange) : -1;
  if (vi >= 0 && ci >= 0) {
    const dist = Math.abs(vi - ci);
    if (dist === 0) {
      score += 20;
      reasons.push("Comparable scale.");
    } else if (dist === 1) {
      score += 12;
      reasons.push("Adjacent scale band.");
    } else if (dist === 2) {
      score += 6;
    }
  } else {
    score += 6;
  }

  return { org: candidate, lane, score: Math.min(100, Math.round(score)), reasons };
}

/**
 * Rank a pool of candidate orgs for the newly-onboarded viewer, strongest fit
 * first. `minScore` drops weak matches; `limit` caps the surfaced set. Self and
 * non-complementary orgs are filtered out.
 */
export function rankEcosystemMatches(
  viewer: EcoOrgProfile,
  candidates: EcoOrgProfile[],
  opts: { minScore?: number; limit?: number } = {},
): EcoMatch[] {
  const { minScore = 60, limit = 5 } = opts;
  return candidates
    .filter((c) => c.id !== viewer.id)
    .map((c) => scoreOrgMatch(viewer, c))
    .filter((m): m is EcoMatch => m !== null && m.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// --- Professional alert copy ------------------------------------------------

// A teaser of the newcomer — "minor details", no contact info. Contact stays
// gated behind a warm-intro request, so the alert invites action without
// leaking the counterparty's inbox.
function teaser(org: EcoOrgProfile): string {
  const parts = [roleLabel(org.operatorRole), strategyLabel(org.strategy)];
  if (org.location) parts.push(org.location);
  return parts.join(" · ");
}

export interface AlertCopy {
  subject: string;
  preview: string;
  aiSummary: string;
  intent: string;
}

/**
 * The professional alert that lands in a matching org's bell about the newcomer.
 * Headlines the lane, teases the newcomer's profile, and explains the fit —
 * with no contact details (those come via a warm intro).
 */
export function buildInboundAlert(viewer: EcoOrgProfile, match: EcoMatch): AlertCopy {
  return {
    subject: `New ${LANE_LABEL[match.lane]} match — ${viewer.name}`,
    preview: teaser(viewer),
    aiSummary: `${viewer.name} just joined the ecosystem. ${match.reasons.join(" ")} Request a warm intro to open the conversation.`,
    intent: "Ecosystem match",
  };
}

/**
 * The reciprocal digest that lands in the newcomer's own bell — the other half
 * of the two-way alert — summarizing who they matched across the ecosystem.
 */
export function buildDigestAlert(viewer: EcoOrgProfile, matches: EcoMatch[]): AlertCopy {
  const n = matches.length;
  const lines = matches.map((m) => `${m.org.name} — ${LANE_LABEL[m.lane]} (${m.score}/100)`);
  return {
    subject: `${n} new ecosystem match${n === 1 ? "" : "es"} for ${viewer.name}`,
    preview: matches.map((m) => m.org.name).slice(0, 3).join(", "),
    aiSummary: `Earn matched you across the ecosystem the moment your profile went live:\n${lines.join("\n")}`,
    intent: "Ecosystem matches",
  };
}
