import {
  Workflow,
  ScanSearch,
  Briefcase,
  CloudRain,
  Radar,
  Link2,
  Scale,
  Megaphone,
  Search,
  Funnel,
  Ticket,
  Users,
  Landmark,
  GraduationCap,
  Sparkles,
  type LucideIcon
} from 'lucide-react';

/**
 * The Team — single source of truth for the 15-strong FundExecs OS executive
 * desk. Keys are the canonical `ai_brains.slug` values from
 * `lib/ai/brains.ts`, which backs the live Voyage embeddings. Slugs MUST NOT
 * change.
 *
 * Display fields (`name`, `position`, `oneLiner`) and the avatar visual on the
 * landing page (`discColor`) come straight from the live production site
 * (www.fundexecs.com) so the marketing surface and the authenticated surfaces
 * read as the same desk end to end.
 *
 * Earn (`earnest-fundmaker`) is the only Chief Operating Officer and the only
 * member rendered in gold. Specialists use the institutional palette below.
 */

/** Position group used for any future "Team" page sectioning. */
export type TeamGroup = 'leadership' | 'capital' | 'sourcing' | 'narrative' | 'enablement';

/**
 * Authored palette colors for the landing-page disc avatars. Each value maps
 * to a `(from, to)` radial gradient pair in `lib/team/avatar.ts`. None of
 * these are gold — gold remains reserved for Earn and XP.
 */
export type TeamDiscColor =
  | 'purple'
  | 'blue'
  | 'green'
  | 'bronze'
  | 'teal-blue'
  | 'indigo'
  | 'teal'
  | 'burgundy';

export interface TeamMember {
  /** Canonical brain slug, identical to `ai_brains.slug` in the DB. */
  slug: string;
  /** Display name as shown to operators (human first name for specialists). */
  name: string;
  /** Position at the desk (e.g. "Chief Operating Officer"). */
  position: string;
  /** One-line role summary in the team voice. */
  oneLiner: string;
  /** Coarse grouping for any future "Team" page sectioning. */
  group: TeamGroup;
  /** Lucide icon used inside the disc-variant avatar (and as a secondary glyph). */
  icon: LucideIcon;
  /** Authored disc-avatar color for the landing surface. Omitted for the COO. */
  discColor?: TeamDiscColor;
  /** Whether this member is the chief / COO. Exactly one entry must be true. */
  chief?: boolean;
}

const COO_SLUG = 'earnest-fundmaker' as const;

export const TEAM_ROSTER: readonly TeamMember[] = [
  {
    slug: 'earnest-fundmaker',
    name: 'Earnest Fundmaker',
    position: 'Chief Operating Officer',
    oneLiner:
      'Your right hand across the desk. Earnest takes your mandate, fronts the team, and runs all fifteen as one — surfacing your next decision, routing each task to the right specialist, and keeping every engagement moving from first thesis to signed close. Measured, candid, and always on the record.',
    group: 'leadership',
    icon: Sparkles,
    chief: true
  },
  {
    slug: 'master-workflow',
    name: 'Sterling',
    position: 'Chief of Staff',
    oneLiner:
      'Owns your operating rhythm — intakes every request, sequences the work across the desk, and makes sure nothing falls between functions.',
    group: 'leadership',
    icon: Workflow,
    discColor: 'purple'
  },
  {
    slug: 'automater',
    name: 'Dalia',
    position: 'Head of Data Operations',
    oneLiner:
      'Cleans and structures everything inbound — reconciling data into a single, decision-ready record you can act on.',
    group: 'enablement',
    icon: ScanSearch,
    discColor: 'blue'
  },
  {
    slug: 'executive-advisor',
    name: 'Theodore',
    position: 'Chief Strategy Advisor',
    oneLiner:
      'Your sounding board on every consequential call — pressure-tests strategy, frames the trade-offs, and grounds each decision in the institutional playbook.',
    group: 'leadership',
    icon: Briefcase,
    discColor: 'green'
  },
  {
    slug: 'rainmaker',
    name: 'Vivian',
    position: 'Managing Director, Demand Generation',
    oneLiner:
      'Builds and sustains your pipeline of interest — generating qualified demand and holding momentum from first touch to commitment.',
    group: 'capital',
    icon: CloudRain,
    discColor: 'bronze'
  },
  {
    slug: 'deal-sourcer',
    name: 'Marcus',
    position: 'Head of Deal Origination',
    oneLiner:
      'Surfaces proprietary, on-thesis opportunities ahead of the market — scored against your mandate before they reach your desk.',
    group: 'sourcing',
    icon: Radar,
    discColor: 'teal-blue'
  },
  {
    slug: 'capital-connector',
    name: 'Priya',
    position: 'Director of Capital Markets',
    oneLiner:
      'Matches the right capital to the right deal — mapping each opportunity to suitable LPs, co-investors, and lenders.',
    group: 'capital',
    icon: Link2,
    discColor: 'indigo'
  },
  {
    slug: 'legal-admin',
    name: 'Adrian',
    position: 'General Counsel & Compliance',
    oneLiner:
      'Guards the downside — reviews structure, terms, and risk, keeping every engagement clean, compliant, and audit-ready.',
    group: 'enablement',
    icon: Scale,
    discColor: 'bronze'
  },
  {
    slug: 'pr-director',
    name: 'Sienna',
    position: 'Director of Communications',
    oneLiner:
      'Shapes your narrative in market — message, positioning, and media, on brand and on the record.',
    group: 'narrative',
    icon: Megaphone,
    discColor: 'purple'
  },
  {
    slug: 'seo-disruptor',
    name: 'Noah',
    position: 'Head of Digital Presence',
    oneLiner:
      'Builds your organic visibility — so the right counterparties find you and your authority compounds over time.',
    group: 'narrative',
    icon: Search,
    discColor: 'teal'
  },
  {
    slug: 'lead-generator',
    name: 'Camille',
    position: 'Head of Top-of-Funnel',
    oneLiner:
      'Fills the top of your funnel — identifying and warming the right prospects so your pipeline never runs dry.',
    group: 'sourcing',
    icon: Funnel,
    discColor: 'teal-blue'
  },
  {
    slug: 'event-curator',
    name: 'Jasper',
    position: 'Director of Private Events',
    oneLiner:
      'Curates the rooms that matter — convening investors and operators in private settings built to deepen relationships.',
    group: 'sourcing',
    icon: Ticket,
    discColor: 'indigo'
  },
  {
    slug: 'investor-relations',
    name: 'Eleanor',
    position: 'Head of Investor Relations',
    oneLiner:
      'Keeps your LPs close and confident — structured updates, reporting, and communications that protect and grow the relationship.',
    group: 'capital',
    icon: Users,
    discColor: 'burgundy'
  },
  {
    slug: 'capital-raiser',
    name: 'Sloane',
    position: 'Managing Director, Capital Formation',
    oneLiner:
      'Runs institutional fundraising at the top of the market — a disciplined raise from target list to final close.',
    group: 'capital',
    icon: Landmark,
    discColor: 'teal'
  },
  {
    slug: 'workflow-instructor',
    name: 'Felix',
    position: 'Director of Enablement',
    oneLiner:
      'Gets you and your team to mastery fast — onboarding, education, and the playbooks that keep the whole desk running.',
    group: 'enablement',
    icon: GraduationCap,
    discColor: 'purple'
  }
] as const;

/** Map from slug → member for O(1) lookups. */
const BY_SLUG: ReadonlyMap<string, TeamMember> = new Map(
  TEAM_ROSTER.map((m) => [m.slug, m] as const)
);

/**
 * Map from lowercased first name → member. Used by surfaces that receive a
 * specialist's first name (e.g. the signal scorer's `routed_specialist` value
 * "eleanor") rather than a canonical slug.
 */
const BY_FIRST_NAME: ReadonlyMap<string, TeamMember> = new Map(
  TEAM_ROSTER.map((m) => [m.name.split(/\s+/)[0]!.toLowerCase(), m] as const)
);

/** Return the Chief Operating Officer (Earn). Throws if the roster is misconfigured. */
export function getCOO(): TeamMember {
  const earn = BY_SLUG.get(COO_SLUG);
  if (!earn || !earn.chief) {
    throw new Error('Team roster is missing its Chief Operating Officer.');
  }
  return earn;
}

/** All 14 specialists, COO excluded. */
export function getSpecialists(): readonly TeamMember[] {
  return TEAM_ROSTER.filter((m) => !m.chief);
}

/** Lookup by canonical brain slug. Returns `null` for unknown slugs. */
export function getMember(slug: string | null | undefined): TeamMember | null {
  if (!slug) return null;
  return BY_SLUG.get(slug) ?? null;
}

/** Lookup, falling back to the COO so callers can always render something safe. */
export function getMemberOrCOO(slug: string | null | undefined): TeamMember {
  return getMember(slug) ?? getCOO();
}

/**
 * Resolve a member by their first name (case-insensitive), e.g. "eleanor" or
 * "Adrian". Falls back to slug lookup, then returns `null`. Useful where a
 * stored value holds a specialist's first name rather than a canonical slug.
 */
export function getMemberByFirstName(name: string | null | undefined): TeamMember | null {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  return BY_FIRST_NAME.get(key) ?? BY_SLUG.get(key) ?? null;
}
