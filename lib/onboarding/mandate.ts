/**
 * lib/onboarding/mandate.ts — the Mandate Brief config + mappings (pure).
 *
 * Ports the onboarding prototype's data layer into typed, dependency-free
 * config the wizard renders and the server action persists. The prototype's
 * three role families map onto the app's canonical `member_type` / `org_type`
 * here so the flow stays a thin, restyled port that wires to the real backend.
 *
 * Kept pure (no React, no IO) so it unit-tests without a DOM and is safe to
 * import from both client components and server actions.
 */
import type { MemberType } from '@/lib/member-types';
import type { Database } from '@/lib/supabase/database.types';

type OrgType = Database['public']['Enums']['org_type'];

/* ── Role families (prototype "Describe yourself") ───────────────────────── */

export type InvestorGroup = 'fund' | 'capital' | 'service';

export interface RoleGroup {
  id: InvestorGroup;
  label: string;
  sub: string;
  /** lucide-react icon name (resolved by the wizard). */
  icon: string;
  roles: string[];
}

export const ROLE_GROUPS: readonly RoleGroup[] = [
  {
    id: 'fund',
    label: 'Fund / Dealmaker',
    sub: 'You run capital or deals',
    icon: 'briefcase',
    roles: [
      'General Partner',
      'Fund Manager',
      'Independent Sponsor',
      'Dealmaker',
      'Search Fund',
      'Student-led fund'
    ]
  },
  {
    id: 'capital',
    label: 'Capital / Investor',
    sub: 'You allocate capital',
    icon: 'landmark',
    roles: [
      'Limited Partner',
      'Family Office',
      'UHNWI',
      'Corporate VC (CVC)',
      'Endowment / Foundation',
      'Fund-of-Funds'
    ]
  },
  {
    id: 'service',
    label: 'Service Provider',
    sub: 'You support the ecosystem',
    icon: 'handshake',
    roles: [
      'Legal Counsel',
      'CPA / Accountant',
      'Broker / Placement',
      'Investment Bank',
      'Capital Provider',
      'Advisor / Consultant'
    ]
  }
] as const;

export const EXPERIENCE = ['New to this', 'A few deals done', 'Seasoned'] as const;
export const STANDING = ['Accredited individual', 'Institutional', 'Building toward it'] as const;

/* ── Mandate options, role-family-aware ──────────────────────────────────── */

export interface Choice {
  id: string;
  label: string;
  sub?: string;
  icon: string;
  note?: string;
  recommended?: boolean;
}
export interface SizeChoice {
  id: string;
  label: string;
  sub: string;
  recommended?: boolean;
}

export interface MandateGroupConfig {
  heading: string;
  sub: string;
  objLabel: string;
  objectives: Choice[];
  vehLabel: string;
  vehicles: Choice[];
  sizeLabel: string;
  sizes: SizeChoice[];
  /** Specialist ids (from TEAM) shown in the "Who acts on this" row. */
  acts: string[];
  actsText: string;
}

const FUND_OBJECTIVES: Choice[] = [
  { id: 'launch', label: 'Launch a fund', sub: 'Stand up a new vehicle from zero', icon: 'rocket' },
  { id: 'raise', label: 'Raise capital', sub: 'Fill an existing fund or SPV', icon: 'handshake' },
  { id: 'source', label: 'Source & invest', sub: 'Find deals and deploy', icon: 'radar' },
  {
    id: 'run',
    label: 'Run the full lifecycle',
    sub: 'Launch, raise, source, close',
    icon: 'infinity',
    recommended: true
  }
];

export const MANDATE_BY_GROUP: Record<InvestorGroup, MandateGroupConfig> = {
  fund: {
    heading: 'What are you here to do?',
    sub: "This is your mandate — the team's marching orders. Pick the shape of the work, the vehicle, and the size you're aiming for.",
    objLabel: 'Objective',
    objectives: FUND_OBJECTIVES,
    vehLabel: 'Vehicle',
    vehicles: [
      { id: 'venture', label: 'Venture fund', icon: 'sprout' },
      { id: 'buyout', label: 'PE / Buyout fund', icon: 'building-2' },
      { id: 'spv', label: 'SPV / Syndicate', icon: 'layers' },
      { id: 'search', label: 'Search fund / Roll-up', icon: 'search' },
      {
        id: 'student',
        label: 'Student-managed fund',
        icon: 'graduation-cap',
        note: 'No prior experience needed'
      }
    ],
    sizeLabel: 'Target raise',
    sizes: [
      { id: '25', label: '$25M', sub: 'First fund' },
      { id: '100', label: '$100M', sub: 'Emerging' },
      { id: '500', label: '$500M', sub: 'Institutional', recommended: true },
      { id: '1000', label: '$1B+', sub: 'Top-tier' }
    ],
    acts: ['sterling', 'sloane', 'adrian'],
    actsText:
      'Sterling sequences the plan, Sloane sizes the LP target list, and Adrian sets the right structure for this vehicle.'
  },
  capital: {
    heading: "What's your allocation mandate?",
    sub: 'You allocate capital — so the team finds, diligences and tracks what you back. Set the shape of your portfolio.',
    objLabel: 'Objective',
    objectives: [
      {
        id: 'portfolio',
        label: 'Build a portfolio',
        sub: 'Commit across funds & deals',
        icon: 'layers',
        recommended: true
      },
      { id: 'backfunds', label: 'Back funds', sub: 'Find & diligence GPs', icon: 'landmark' },
      {
        id: 'coinvest',
        label: 'Source co-invests',
        sub: 'Direct & co-invest deals',
        icon: 'radar'
      },
      { id: 'manage', label: 'Manage allocations', sub: 'Monitor & report', icon: 'pie-chart' }
    ],
    vehLabel: 'How you deploy',
    vehicles: [
      { id: 'fundcommit', label: 'Fund commitments', icon: 'landmark' },
      { id: 'direct', label: 'Direct deals', icon: 'building-2' },
      { id: 'coinv', label: 'Co-investments', icon: 'layers' },
      { id: 'spvsynd', label: 'SPVs / Syndicates', icon: 'users' }
    ],
    sizeLabel: 'Capital to deploy',
    sizes: [
      { id: '5', label: '$5M', sub: 'Individual' },
      { id: '50', label: '$50M', sub: 'Family office' },
      { id: '250', label: '$250M', sub: 'Institutional', recommended: true },
      { id: '1000', label: '$1B+', sub: 'Major LP' }
    ],
    acts: ['theodore', 'marcus', 'eleanor'],
    actsText:
      'Theodore screens fit, Marcus surfaces deals and funds that match, and Eleanor tracks every position and report.'
  },
  service: {
    heading: "What's your growth mandate?",
    sub: 'You support the ecosystem — so the team fills your pipeline and wins you mandates. Set what you want to grow.',
    objLabel: 'Objective',
    objectives: [
      {
        id: 'clients',
        label: 'Win clients & mandates',
        sub: 'Grow your book',
        icon: 'handshake',
        recommended: true
      },
      { id: 'dealflow', label: 'Source deal flow', sub: 'Tap the network', icon: 'radar' },
      {
        id: 'partner',
        label: 'Build partnerships',
        sub: 'Referrals & alliances',
        icon: 'briefcase'
      },
      {
        id: 'practice',
        label: 'Grow my practice',
        sub: 'Visibility & pipeline',
        icon: 'trending-up'
      }
    ],
    vehLabel: 'Your practice',
    vehicles: [
      { id: 'legal', label: 'Legal / Counsel', icon: 'scale' },
      { id: 'accounting', label: 'Accounting / Tax', icon: 'calculator' },
      { id: 'banking', label: 'Investment bank', icon: 'landmark' },
      { id: 'capitalp', label: 'Capital provider', icon: 'banknote' },
      { id: 'advisory', label: 'Advisory', icon: 'compass' }
    ],
    sizeLabel: 'Client focus',
    sizes: [
      { id: 'emerging', label: 'Emerging', sub: 'New managers' },
      { id: 'midmarket', label: 'Mid-market', sub: 'Funds I–III', recommended: true },
      { id: 'institutional', label: 'Institutional', sub: 'Established' },
      { id: 'all', label: 'All', sub: 'Full market' }
    ],
    acts: ['vivian', 'camille', 'sienna'],
    actsText:
      'Vivian and Camille fill your funnel with the right prospects, and Sienna sharpens how you show up in market.'
  }
};

export function mandateCfg(group: InvestorGroup): MandateGroupConfig {
  return MANDATE_BY_GROUP[group] ?? MANDATE_BY_GROUP.fund;
}

export const SECTORS = [
  'AI & Software',
  'Industrials',
  'Healthcare',
  'Climate & Energy',
  'Consumer',
  'Fintech',
  'Real Assets'
] as const;
export const STAGES = ['Pre-seed / Seed', 'Series A / B', 'Growth', 'Buyout / Control'] as const;
export const GEOS = ['North America', 'Europe', 'LATAM', 'APAC', 'Global'] as const;

/* ── The mandate the wizard assembles ────────────────────────────────────── */

export interface Mandate {
  principal: string;
  firm: string;
  /** Earn-suggested working name when the user has no firm yet. */
  noFirm: boolean;
  firmSeed: number;
  investorGroup: InvestorGroup;
  investorRole: string;
  experience: string;
  standing: string;
  objective: string;
  vehicle: string;
  size: string;
  sectors: string[];
  stage: string;
  geo: string;
}

export const DEFAULT_MANDATE: Mandate = {
  principal: '',
  firm: '',
  noFirm: false,
  firmSeed: 0,
  investorGroup: 'fund',
  investorRole: 'General Partner',
  experience: 'New to this',
  standing: 'Building toward it',
  objective: 'run',
  vehicle: 'venture',
  size: '500',
  sectors: ['AI & Software', 'Industrials'],
  stage: 'Series A / B',
  geo: 'North America'
};

/** Working-title suggestions for managers without a firm name yet. */
const NAME_SEEDS = [
  'Northgate Capital',
  'Vantage Partners',
  'Cedar Lane Capital',
  'Meridian Ventures',
  'Atlas Holdings',
  'Granite Capital',
  'Beacon Partners',
  'Summit Lane Capital',
  'Keystone Ventures',
  'Harbor Point Capital'
];
export function suggestFirmName(seed: number): string {
  return NAME_SEEDS[((seed % NAME_SEEDS.length) + NAME_SEEDS.length) % NAME_SEEDS.length];
}

/** The recommended defaults for a freshly-picked role family. */
export function groupDefaults(
  group: InvestorGroup
): Pick<Mandate, 'objective' | 'vehicle' | 'size'> {
  const c = mandateCfg(group);
  return {
    objective: (c.objectives.find((x) => x.recommended) ?? c.objectives[0]).id,
    vehicle: c.vehicles[0].id,
    size: (c.sizes.find((x) => x.recommended) ?? c.sizes[0]).id
  };
}

/* ── Mapping prototype → app canonical types ─────────────────────────────── */

/**
 * Map the prototype's role family (+ specific role) to the app's canonical
 * `member_type`. The student-led fund role is the one fund-family case that
 * routes to the `student` member type.
 */
export function memberTypeFor(group: InvestorGroup, role: string): MemberType {
  if (group === 'capital') return 'individual_investor';
  if (group === 'service') return 'service_provider';
  // fund family
  if (role === 'Student-led fund') return 'student';
  return 'investment_firm';
}

/** Map the role family to the org-level `org_type`. */
export function orgTypeFor(group: InvestorGroup): OrgType {
  if (group === 'capital') return 'lp';
  if (group === 'service') return 'service_provider';
  return 'fund';
}

/** Map the role family to a `save_onboarding_identity` role (its whitelist). */
export function identityRoleFor(group: InvestorGroup): string {
  if (group === 'capital') return 'limited_partner';
  if (group === 'service') return 'advisor';
  return 'managing_partner';
}

/* ── The team that "activates" once briefed ──────────────────────────────── */

export interface Specialist {
  id: string;
  name: string;
  title: string;
  /** lucide-react icon name. */
  icon: string;
  /** What they do the moment the mandate is briefed (the activation payoff). */
  build: string;
}

export const TEAM: readonly Specialist[] = [
  {
    id: 'sterling',
    name: 'Sterling',
    title: 'Chief of Staff',
    icon: 'list-checks',
    build: 'Sequenced your launch into a 19-step operating plan.'
  },
  {
    id: 'dalia',
    name: 'Dalia',
    title: 'Head of Data Operations',
    icon: 'database',
    build: 'Structured your firm into one decision-ready record.'
  },
  {
    id: 'theodore',
    name: 'Theodore',
    title: 'Chief Strategy Advisor',
    icon: 'compass',
    build: 'Pressure-tested your thesis against the institutional playbook.'
  },
  {
    id: 'marcus',
    name: 'Marcus',
    title: 'Head of Deal Origination',
    icon: 'radar',
    build: 'Surfaced 12 on-thesis opportunities, scored to your mandate.'
  },
  {
    id: 'sloane',
    name: 'Sloane',
    title: 'MD, Capital Formation',
    icon: 'landmark',
    build: 'Drafted a 40-name institutional LP target list for the raise.'
  },
  {
    id: 'priya',
    name: 'Priya',
    title: 'Director of Capital Markets',
    icon: 'arrow-left-right',
    build: 'Matched each deal to suitable LPs, co-investors and lenders.'
  },
  {
    id: 'adrian',
    name: 'Adrian',
    title: 'General Counsel & Compliance',
    icon: 'scale',
    build: 'Set your fund-formation checklist and compliance baseline.'
  },
  {
    id: 'eleanor',
    name: 'Eleanor',
    title: 'Head of Investor Relations',
    icon: 'users',
    build: 'Stood up your data room and LP reporting cadence.'
  },
  {
    id: 'vivian',
    name: 'Vivian',
    title: 'MD, Demand Generation',
    icon: 'megaphone',
    build: 'Primed a demand engine to keep the pipeline full.'
  },
  {
    id: 'camille',
    name: 'Camille',
    title: 'Head of Top-of-Funnel',
    icon: 'filter',
    build: 'Identified the right prospects to warm first.'
  },
  {
    id: 'sienna',
    name: 'Sienna',
    title: 'Director of Communications',
    icon: 'pen-line',
    build: 'Framed your market narrative and positioning.'
  }
];

/** The specialists shown actively building during activation, in order. */
export const ACTIVATION_ORDER = [
  'sterling',
  'dalia',
  'theodore',
  'marcus',
  'sloane',
  'priya',
  'adrian',
  'eleanor'
] as const;

export function specialistById(id: string): Specialist | undefined {
  return TEAM.find((t) => t.id === id);
}

export interface WorkspaceStat {
  label: string;
  value: string;
  sub: string;
  icon: string;
  tone: 'gold' | 'azure' | 'success' | 'info';
}

/** The "what got built" tiles shown when activation completes. */
export function workspaceStats(m: Mandate): WorkspaceStat[] {
  const cfg = mandateCfg(m.investorGroup);
  const size = (cfg.sizes.find((s) => s.id === m.size) ?? cfg.sizes[0]).label;
  const veh = cfg.vehicles.find((v) => v.id === m.vehicle)?.label ?? 'Fund';
  const isCapital = m.investorGroup === 'capital';
  return [
    {
      label: isCapital ? 'Capital to deploy' : 'Raise target',
      value: size,
      sub: veh,
      icon: 'handshake',
      tone: 'gold'
    },
    {
      label: isCapital ? 'Funds & deals matched' : 'LP targets built',
      value: '40',
      sub: 'fit-scored & ranked',
      icon: 'landmark',
      tone: 'azure'
    },
    {
      label: 'Deals sourced',
      value: '12',
      sub: 'on-thesis, scored',
      icon: 'radar',
      tone: 'success'
    },
    {
      label: 'Launch readiness',
      value: '64%',
      sub: 'checklist pre-filled',
      icon: 'shield-check',
      tone: 'info'
    }
  ];
}

/** First-action label used on the activation CTA, by role family. */
export function activationHeadline(m: Mandate): string {
  const first = (m.principal || 'there').trim().split(/\s+/)[0] || 'there';
  return `Your desk is ready, ${first}.`;
}
