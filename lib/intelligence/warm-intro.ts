/* ============================================================================
 * lib/intelligence/warm-intro.ts — the FundExecs Warm-Intro Pathfinder.
 *
 * A proprietary, key-free routing signal: for each live deal, who in the desk's
 * own relationship graph is the warmest path in. It derives intro paths from
 * data the OS already holds — relationships (strength, depth, recency) matched to
 * a deal's company — rather than depending on a curated table or any external
 * graph API. Adoption over integration.
 *
 * "Warmth" tempers relationship strength with how deep the relationship is and
 * how recently it was touched: a strong, active, well-worn contact at the target
 * company is the person to ask. Pure + total — trivially unit-testable.
 * ========================================================================= */

/** A target the desk wants to reach — a structural subset of PipelineDeal. */
export interface PathfinderTarget {
  dealId: string;
  dealName: string;
  stage: string;
}

/** A relationship that could broker an intro — a subset of ConnectionRow. */
export interface PathfinderConnection {
  id: string;
  fullName: string;
  company: string | null;
  title: string | null;
  /** relationships.strength (0–100). */
  strength: number;
  /** Durable depth — total interactions to date. */
  interactionCount: number;
  /** ISO timestamp of last interaction, or null. */
  lastInteractionAt: string | null;
  status: string;
}

export interface IntroPath {
  dealId: string;
  dealName: string;
  connectorId: string;
  connectorName: string;
  connectorTitle: string | null;
  /** 0–100 path warmth (strength × recency × depth blend). */
  warmth: number;
  /** Other relationships at the same company beyond the top connector. */
  altPaths: number;
  reason: string;
}

/** Legal/generic suffixes stripped before matching a company to a deal name. */
const COMPANY_NOISE =
  /\b(inc|inc\.|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|gmbh|s\.?a|the)\b/g;

const DEPTH_SATURATION = 20;

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

/** Normalise a company / deal name for matching: lowercase, de-punctuate, de-suffix. */
export function normalizeCompany(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(COMPANY_NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Does a connection's company plausibly belong to this deal's target company? */
export function companyMatches(dealName: string, company: string | null): boolean {
  if (!company) return false;
  const a = normalizeCompany(dealName);
  const b = normalizeCompany(company);
  if (!a || !b) return false;
  if (a === b) return true;
  // Containment either direction (deal "Acme Robotics Series A" ⊇ "Acme Robotics").
  if (a.includes(b) || b.includes(a)) return true;
  // Token Jaccard on meaningful tokens.
  const ta = new Set(a.split(' ').filter((t) => t.length >= 3));
  const tb = new Set(b.split(' ').filter((t) => t.length >= 3));
  if (ta.size === 0 || tb.size === 0) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = new Set([...ta, ...tb]).size;
  return union > 0 && inter / union >= 0.5;
}

function recencyFactor(lastInteractionAt: string | null, now: number): number {
  const t = lastInteractionAt ? Date.parse(lastInteractionAt) : NaN;
  if (!Number.isFinite(t)) return 20;
  const days = Math.max(0, Math.floor((now - t) / 86_400_000));
  if (days <= 30) return 100;
  if (days <= 90) return 70;
  if (days <= 180) return 40;
  return 15;
}

/** Blend strength, depth, and recency into a 0–100 path warmth. */
export function introWarmth(c: PathfinderConnection, now: number = Date.now()): number {
  const strength = clamp(c.strength, 0, 100);
  const depth =
    (clamp(Math.floor(c.interactionCount || 0), 0, DEPTH_SATURATION) / DEPTH_SATURATION) * 100;
  const recency = recencyFactor(c.lastInteractionAt, now);
  return Math.round(0.5 * strength + 0.2 * depth + 0.3 * recency);
}

/**
 * For each target, find the warmest connector at its company. Returns one path
 * per reachable target, warmest first. `now` is injectable for tests. Pure.
 */
export function findIntroPaths(
  targets: PathfinderTarget[],
  connections: PathfinderConnection[],
  now: number = Date.now()
): IntroPath[] {
  const paths: IntroPath[] = [];

  for (const target of targets) {
    const matches = connections
      .filter((c) => companyMatches(target.dealName, c.company))
      .map((c) => ({ c, warmth: introWarmth(c, now) }))
      .sort((a, b) => b.warmth - a.warmth || a.c.fullName.localeCompare(b.c.fullName));

    if (matches.length === 0) continue;
    const top = matches[0];

    paths.push({
      dealId: target.dealId,
      dealName: target.dealName,
      connectorId: top.c.id,
      connectorName: top.c.fullName,
      connectorTitle: top.c.title,
      warmth: top.warmth,
      altPaths: matches.length - 1,
      reason:
        top.c.title && top.c.company
          ? `${top.c.fullName} — ${top.c.title}, ${top.c.company}`
          : top.c.company
            ? `${top.c.fullName} at ${top.c.company}`
            : top.c.fullName
    });
  }

  return paths.sort((a, b) => b.warmth - a.warmth || a.dealName.localeCompare(b.dealName));
}
