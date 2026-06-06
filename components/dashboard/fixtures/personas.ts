/**
 * Persona presets — anonymized counterparty archetypes that mirror the
 * www.fundexecs.com homepage activity ticker. Used as defaults across the
 * new dashboard sub-components (Synergy alerts, Fund Room commitment tracker,
 * LP Room update feed). The set is intentionally narrow — these are the
 * personas the live brand addresses.
 *
 * Per the locked Feb-2026 product call, `student-led-fund` is included
 * alongside the seven live-ticker personas. It represents a *participant in
 * a student-led investment vehicle*, not a generic student. This file is
 * fixture-only — no DB schema or `member_type` rename.
 */
export const PERSONA_KEYS = [
  'family-office',
  'fund-manager',
  'general-partner',
  'angel-investor',
  'connector',
  'sponsor',
  'institutional-lp',
  'student-led-fund'
] as const;

export type PersonaKey = (typeof PERSONA_KEYS)[number];

export interface PersonaPreset {
  key: PersonaKey;
  /** Human label as it would appear in the activity feed ("Family Office"). */
  label: string;
  /** Short hint used in some hover labels / accessibility text. */
  hint: string;
}

export const PERSONAS: Record<PersonaKey, PersonaPreset> = {
  'family-office': {
    key: 'family-office',
    label: 'Family Office',
    hint: 'multi-generational capital'
  },
  'fund-manager': { key: 'fund-manager', label: 'Fund Manager', hint: 'institutional allocator' },
  'general-partner': {
    key: 'general-partner',
    label: 'General Partner',
    hint: 'fund GP / managing partner'
  },
  'angel-investor': {
    key: 'angel-investor',
    label: 'Angel Investor',
    hint: 'individual check writer'
  },
  connector: { key: 'connector', label: 'Connector', hint: 'warm-intro relationship hub' },
  sponsor: { key: 'sponsor', label: 'Sponsor', hint: 'independent sponsor / acquirer' },
  'institutional-lp': {
    key: 'institutional-lp',
    label: 'Institutional LP',
    hint: 'pension / endowment / sovereign'
  },
  'student-led-fund': {
    key: 'student-led-fund',
    label: 'Student-Led Fund',
    hint: 'participant in a student-led investment vehicle'
  }
};

/** Anonymized initials used to seed activity-style fixtures. */
export interface PersonaActivityRow {
  id: string;
  initials: string;
  persona: PersonaKey;
  city: string;
  action: string;
  amount?: string;
  /** ISO month label, e.g. "Feb 2026" — kept as a string so fixtures stay
   *  serializable and stable in snapshots / SSR. */
  when: string;
}

/**
 * Default activity ticker rows — mirrors the live www.fundexecs.com homepage
 * exactly (7 live personas) and appends one Student-Led Fund row per the
 * locked product framing. Stable, deterministic — safe to use as fixtures
 * in SSR-rendered fallbacks.
 */
export const DEFAULT_PERSONA_ACTIVITY: PersonaActivityRow[] = [
  {
    id: 'jr-chicago',
    initials: 'J.R.',
    persona: 'family-office',
    city: 'Chicago',
    action: 'Capital Allocated',
    amount: '$250K',
    when: 'Feb 2026'
  },
  {
    id: 'mt-newyork',
    initials: 'M.T.',
    persona: 'fund-manager',
    city: 'New York',
    action: 'Capital Raised',
    amount: '$4.2M',
    when: 'Feb 2026'
  },
  {
    id: 'ak-austin',
    initials: 'A.K.',
    persona: 'general-partner',
    city: 'Austin',
    action: 'Deal Closed',
    amount: '$1.8M',
    when: 'Jan 2026'
  },
  {
    id: 'sl-sf',
    initials: 'S.L.',
    persona: 'angel-investor',
    city: 'San Francisco',
    action: 'Check Signed',
    amount: '$100K',
    when: 'Jan 2026'
  },
  {
    id: 'dp-london',
    initials: 'D.P.',
    persona: 'connector',
    city: 'London',
    action: 'Connector Intro',
    amount: 'Tier-1 LP',
    when: 'Feb 2026'
  },
  {
    id: 'rn-miami',
    initials: 'R.N.',
    persona: 'sponsor',
    city: 'Miami',
    action: 'Acquisition Review',
    amount: '$12M Target',
    when: 'Jan 2026'
  },
  {
    id: 'pw-singapore',
    initials: 'P.W.',
    persona: 'institutional-lp',
    city: 'Singapore',
    action: 'Check Signed',
    amount: '$2.0M',
    when: 'Feb 2026'
  },
  {
    id: 'eb-cambridge',
    initials: 'E.B.',
    persona: 'student-led-fund',
    city: 'Cambridge',
    action: 'Fund Participant Onboarded',
    amount: '$25K Pilot',
    when: 'Feb 2026'
  }
];
