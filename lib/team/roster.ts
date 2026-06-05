import {
  Workflow,
  Sparkles,
  ScanSearch,
  Briefcase,
  CloudRain,
  Radar,
  Link2,
  Scale,
  Megaphone,
  Search,
  Filter,
  Ticket,
  Users,
  Landmark,
  GraduationCap,
  type LucideIcon
} from 'lucide-react';

/**
 * The Team — a single source of truth for the 15-strong FundExecs OS executive
 * desk. Keys are the canonical `ai_brains.slug` values from
 * `lib/ai/brains.ts`, which is what backs the live Voyage embeddings. The
 * slugs MUST NOT change.
 *
 * `position` is the named seat at the desk; `oneLiner` is ≤ 90 chars and reads
 * as a one-sentence answer to "what do they do?".
 *
 * Earn (`earnest-fundmaker`) is the only Chief Operating Officer and the only
 * member with the gold gradient — see `lib/team/avatar.ts`.
 */

/** Position group, mostly for sectioning the team page later. */
export type TeamGroup = 'leadership' | 'capital' | 'sourcing' | 'narrative' | 'enablement';

export interface TeamMember {
  /** Canonical brain slug, identical to `ai_brains.slug` in the DB. */
  slug: string;
  /** Display name as shown to operators. */
  name: string;
  /** Position at the desk (e.g. "Chief Operating Officer"). */
  position: string;
  /** One-line role summary, ≤ 90 chars. */
  oneLiner: string;
  /** Coarse grouping for any future "Team" page sectioning. */
  group: TeamGroup;
  /** Lucide icon used as a secondary glyph (e.g. in the BrainSwitcher). */
  icon: LucideIcon;
  /** Whether this member is the chief / COO. Exactly one entry must be true. */
  chief?: boolean;
}

const COO_SLUG = 'earnest-fundmaker' as const;

export const TEAM_ROSTER: readonly TeamMember[] = [
  {
    slug: 'earnest-fundmaker',
    name: 'Earnest Fundmaker',
    position: 'Chief Operating Officer',
    oneLiner: 'Your private-market COO — orchestrates the team and your next best move.',
    group: 'leadership',
    icon: Sparkles,
    chief: true
  },
  {
    slug: 'master-workflow',
    name: 'Master Workflow',
    position: 'Chief of Staff',
    oneLiner: 'Routes every request to the right specialist and keeps work moving end to end.',
    group: 'leadership',
    icon: Workflow
  },
  {
    slug: 'executive-advisor',
    name: 'Executive Advisor',
    position: 'Chief Strategy Officer',
    oneLiner: 'Investor intelligence and executive guidance for scaling like an institution.',
    group: 'leadership',
    icon: Briefcase
  },
  {
    slug: 'automater',
    name: 'Automater',
    position: 'Head of Operations',
    oneLiner: 'Scrubs inbound documents and forms into clean, deduplicated records.',
    group: 'enablement',
    icon: ScanSearch
  },
  {
    slug: 'rainmaker',
    name: 'Rainmaker',
    position: 'Head of Closings',
    oneLiner: 'The closer — drives capital commitments and removes the last blockers.',
    group: 'capital',
    icon: CloudRain
  },
  {
    slug: 'capital-raiser',
    name: 'Elite Capital Raiser',
    position: 'Head of Institutional Capital',
    oneLiner: 'Leads institutional raises end-to-end — targeting, narrative, first-close.',
    group: 'capital',
    icon: Landmark
  },
  {
    slug: 'capital-connector',
    name: 'Capital Connector',
    position: 'Head of Capital Formation',
    oneLiner: 'Matches deals to the right capital providers and assembles the stack.',
    group: 'capital',
    icon: Link2
  },
  {
    slug: 'investor-relations',
    name: 'Investor Relations',
    position: 'Head of Investor Relations',
    oneLiner: 'Manages LP communications, quarterly updates, and re-up cadence.',
    group: 'capital',
    icon: Users
  },
  {
    slug: 'deal-sourcer',
    name: 'Deal Sourcer',
    position: 'Head of Acquisitions',
    oneLiner: 'Sources proprietary deal flow scored against your thesis.',
    group: 'sourcing',
    icon: Radar
  },
  {
    slug: 'lead-generator',
    name: 'Lead Generator',
    position: 'Head of Lead Generation',
    oneLiner: 'Builds and runs targeted outreach funnels to qualified prospects.',
    group: 'sourcing',
    icon: Filter
  },
  {
    slug: 'event-curator',
    name: 'Private Event Curator',
    position: 'Head of Network',
    oneLiner: 'Curates private events and roundtables that create warm connections.',
    group: 'sourcing',
    icon: Ticket
  },
  {
    slug: 'legal-admin',
    name: 'Legal & Admin',
    position: 'General Counsel',
    oneLiner: 'Manages fund formation, the LPA pack, KYC/AML, and the evidence trail.',
    group: 'enablement',
    icon: Scale
  },
  {
    slug: 'pr-director',
    name: 'PR Director',
    position: 'Chief Marketing Officer',
    oneLiner: 'Crafts investor-facing collateral and keeps the fund narrative consistent.',
    group: 'narrative',
    icon: Megaphone
  },
  {
    slug: 'seo-disruptor',
    name: 'SEO Disruptor',
    position: 'Head of Discovery',
    oneLiner: 'Improves how the fund is found and perceived by the right LPs online.',
    group: 'narrative',
    icon: Search
  },
  {
    slug: 'workflow-instructor',
    name: 'Workflow Instructor',
    position: 'Head of Enablement',
    oneLiner: 'Teaches operators the FundExecs OS workflows and compounds execution.',
    group: 'enablement',
    icon: GraduationCap
  }
] as const;

/** Map from slug → member for O(1) lookups. */
const BY_SLUG: ReadonlyMap<string, TeamMember> = new Map(
  TEAM_ROSTER.map((m) => [m.slug, m] as const)
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
