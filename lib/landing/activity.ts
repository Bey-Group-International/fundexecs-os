/**
 * lib/landing/activity.ts
 * -----------------------
 * Data layer for the public landing page's "Live Activity" ticker.
 *
 * Public API:
 *   getChainOfTrustActivity(): Promise<ActivityEntry[]>
 *
 * The homepage at `/` is UNAUTHENTICATED. This module must therefore NEVER
 * query org-scoped or RLS-protected tables — doing so from an anonymous
 * request would either fail or leak nothing useful. Instead it attempts an
 * anonymized, public, read-only source (a clearly-commented stub below) and
 * always falls back to the bundled, illustrative `ACTIVITY_SEED`.
 *
 * Entries are anonymized for confidentiality and shown only to illustrate
 * platform momentum — not an offer or solicitation.
 */

/** Allowed activity types — keep in sync with `ACTIVITY_TYPES`. */
export type ActivityType =
  | 'Deal Closed'
  | 'Capital Allocated'
  | 'Check Signed'
  | 'Capital Raised'
  | 'Connector Intro'
  | 'Acquisition Review';

export const ACTIVITY_TYPES: readonly ActivityType[] = [
  'Deal Closed',
  'Capital Allocated',
  'Check Signed',
  'Capital Raised',
  'Connector Intro',
  'Acquisition Review'
];

/** A single anonymized activity entry rendered in the ticker / grid. */
export interface ActivityEntry {
  /** Anonymized initials, e.g. "J.R." */
  initials: string;
  /** Counterparty role, e.g. "Family Office". */
  role: string;
  /** Region / city, e.g. "Chicago". */
  region: string;
  /** Activity type — one of `ACTIVITY_TYPES`. */
  type: ActivityType;
  /** Human-readable value, e.g. "$250K" or "Tier-1 LP". */
  value: string;
  /** Coarse date label, e.g. "Feb 2026". */
  date: string;
}

/**
 * Seed activity for the Live Activity ticker. Anonymized and illustrative
 * only — not an offer or solicitation. Ported from the standalone landing
 * draft (`landing/data/activity.json`).
 */
export const ACTIVITY_SEED: ActivityEntry[] = [
  {
    initials: 'J.R.',
    role: 'Family Office',
    region: 'Chicago',
    type: 'Capital Allocated',
    value: '$250K',
    date: 'Feb 2026'
  },
  {
    initials: 'M.T.',
    role: 'Fund Manager',
    region: 'New York',
    type: 'Capital Raised',
    value: '$4.2M',
    date: 'Feb 2026'
  },
  {
    initials: 'A.K.',
    role: 'General Partner',
    region: 'Austin',
    type: 'Deal Closed',
    value: '$1.8M',
    date: 'Jan 2026'
  },
  {
    initials: 'S.L.',
    role: 'Angel Investor',
    region: 'San Francisco',
    type: 'Check Signed',
    value: '$100K',
    date: 'Jan 2026'
  },
  {
    initials: 'D.P.',
    role: 'Connector',
    region: 'London',
    type: 'Connector Intro',
    value: 'Tier-1 LP',
    date: 'Feb 2026'
  },
  {
    initials: 'R.N.',
    role: 'Sponsor',
    region: 'Miami',
    type: 'Acquisition Review',
    value: '$12M Target',
    date: 'Jan 2026'
  },
  {
    initials: 'C.B.',
    role: 'Family Office',
    region: 'Dallas',
    type: 'Capital Allocated',
    value: '$500K',
    date: 'Dec 2025'
  },
  {
    initials: 'E.V.',
    role: 'Fund Manager',
    region: 'Boston',
    type: 'Capital Raised',
    value: '$7.5M',
    date: 'Feb 2026'
  },
  {
    initials: 'T.H.',
    role: 'General Partner',
    region: 'Toronto',
    type: 'Deal Closed',
    value: '$3.1M',
    date: 'Jan 2026'
  },
  {
    initials: 'P.W.',
    role: 'Institutional LP',
    region: 'Singapore',
    type: 'Check Signed',
    value: '$2.0M',
    date: 'Feb 2026'
  },
  {
    initials: 'G.M.',
    role: 'Connector',
    region: 'Dubai',
    type: 'Connector Intro',
    value: 'Sovereign Fund',
    date: 'Dec 2025'
  },
  {
    initials: 'L.F.',
    role: 'Sponsor',
    region: 'Los Angeles',
    type: 'Acquisition Review',
    value: '$28M Target',
    date: 'Feb 2026'
  }
];

/** Type guard: does `e` look like a valid `ActivityEntry`? */
function isValidEntry(e: unknown): e is ActivityEntry {
  if (!e || typeof e !== 'object') return false;
  const r = e as Record<string, unknown>;
  return (
    typeof r.initials === 'string' &&
    typeof r.role === 'string' &&
    typeof r.region === 'string' &&
    typeof r.value === 'string' &&
    typeof r.date === 'string' &&
    typeof r.type === 'string' &&
    (ACTIVITY_TYPES as readonly string[]).includes(r.type)
  );
}

/** Normalize a raw payload (array OR `{ entries: [] }`) into clean entries. */
function normalize(payload: unknown): ActivityEntry[] {
  const list = Array.isArray(payload)
    ? payload
    : payload &&
        typeof payload === 'object' &&
        Array.isArray((payload as { entries?: unknown }).entries)
      ? (payload as { entries: unknown[] }).entries
      : [];
  return list.filter(isValidEntry);
}

/**
 * Attempt an anonymized, PUBLIC, read-only activity feed.
 *
 * STUB — intentionally returns no data today. When a public Chain-of-Trust
 * feed ships, point `CHAIN_OF_TRUST_ENDPOINT` at it. It must be a public,
 * unauthenticated endpoint returning already-anonymized JSON in the shape
 * `{ entries: ActivityEntry[] }`. Do NOT wire this to org-scoped / RLS tables
 * via a server client — the homepage is unauthenticated and must not read
 * confidential, tenant-scoped data.
 */
const CHAIN_OF_TRUST_ENDPOINT: string | null = null;
const LIVE_TIMEOUT_MS = 3500;

async function fetchPublicActivity(): Promise<ActivityEntry[]> {
  if (!CHAIN_OF_TRUST_ENDPOINT) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
  try {
    const res = await fetch(CHAIN_OF_TRUST_ENDPOINT, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    if (!res.ok) return [];
    return normalize(await res.json());
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Get the activity feed for the public ticker. Tries the anonymized public
 * source first, then falls back to `ACTIVITY_SEED`. Always resolves to a
 * non-empty array — it never rejects, so callers don't need try/catch.
 */
export async function getChainOfTrustActivity(): Promise<ActivityEntry[]> {
  const live = await fetchPublicActivity();
  if (live.length) return live;
  return ACTIVITY_SEED;
}
