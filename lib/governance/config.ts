/**
 * lib/governance/config.ts — Structure & Governance config (pure).
 *
 * Ported from the onboarding prototype's `governance.jsx` data layer: the
 * copiloted policy set (you set the posture, Earn drafts to the institutional
 * standard) plus the governance-body rosters (management team, IC, advisory
 * board, capital partners, legal bench) and their candidate benches.
 *
 * Illustrative until governance tables land + counsel signs off. Pure (no React,
 * no IO) so it unit-tests cleanly and is safe to import anywhere.
 */

export interface PolicyDecision {
  key: string;
  kind: 'radio' | 'multi';
  label: string;
  opts: string[];
}

export type PolicyValue = string | string[];

export interface GovPolicy {
  id: string;
  name: string;
  /** lucide-ish icon name (resolved by the view). */
  icon: string;
  intro: string;
  decisions: PolicyDecision[];
  rec: Record<string, PolicyValue>;
  recText: string;
}

export const GOV_POLICIES: readonly GovPolicy[] = [
  {
    id: 'valuation',
    name: 'Valuation policy',
    icon: 'scale',
    intro: 'How you mark positions — the methodology LPs and auditors hold you to.',
    decisions: [
      {
        key: 'method',
        kind: 'radio',
        label: 'Basis',
        opts: ['Fair value (ASC 820)', 'Cost less impairment']
      },
      { key: 'cadence', kind: 'radio', label: 'Cadence', opts: ['Quarterly', 'Semi-annual'] }
    ],
    rec: { method: 'Fair value (ASC 820)', cadence: 'Quarterly' },
    recText:
      'Fair value under ASC 820, marked quarterly, is the institutional standard your auditor and LPs expect. I’ll draft the full methodology and a quarterly review workflow.'
  },
  {
    id: 'conflicts',
    name: 'Conflicts of interest',
    icon: 'git-fork',
    intro: 'How conflicts are identified, disclosed and cleared — reviewed by your LPAC.',
    decisions: [
      {
        key: 'review',
        kind: 'radio',
        label: 'Clearance',
        opts: ['LPAC approval', 'GP discretion + disclosure']
      },
      {
        key: 'coinvest',
        kind: 'radio',
        label: 'Co-investment',
        opts: ['Pro-rata to LPs', 'Case-by-case']
      }
    ],
    rec: { review: 'LPAC approval', coinvest: 'Pro-rata to LPs' },
    recText:
      'Route material conflicts to your LPAC and allocate co-investment pro-rata. It’s the cleanest posture for diligence and avoids the questions that stall a raise.'
  },
  {
    id: 'allocation',
    name: 'Allocation policy',
    icon: 'pie-chart',
    intro:
      'How deals and capacity are split across vehicles and co-investors — fairly and on the record.',
    decisions: [
      {
        key: 'rule',
        kind: 'radio',
        label: 'Rule',
        opts: ['Pro-rata by commitment', 'Capacity-weighted']
      }
    ],
    rec: { rule: 'Pro-rata by commitment' },
    recText:
      'Pro-rata by commitment is the defensible default — predictable for LPs and simple to audit. I’ll document exceptions and the approval path.'
  },
  {
    id: 'compliance',
    name: 'Compliance manual',
    icon: 'shield-check',
    intro:
      'Your firm’s rulebook — personal trading, marketing, recordkeeping, and the annual review.',
    decisions: [
      {
        key: 'scope',
        kind: 'multi',
        label: 'Include',
        opts: [
          'Personal trading',
          'Marketing rules',
          'Recordkeeping',
          'Insider info / MNPI',
          'Annual review'
        ]
      }
    ],
    rec: {
      scope: [
        'Personal trading',
        'Marketing rules',
        'Recordkeeping',
        'Insider info / MNPI',
        'Annual review'
      ]
    },
    recText:
      'Cover all five — this is the document an LP’s ODD team reads first. I’ll draft each section to the SEC baseline for a private fund adviser.'
  },
  {
    id: 'ethics',
    name: 'Code of ethics',
    icon: 'book-open',
    intro: 'The standards of conduct everyone at the firm signs — the foundation of LP trust.',
    decisions: [
      { key: 'attest', kind: 'radio', label: 'Attestation', opts: ['Annual', 'On hire only'] }
    ],
    rec: { attest: 'Annual' },
    recText:
      'Annual attestation is expected by institutional LPs. I’ll draft the code and a one-click attestation workflow for the team.'
  },
  {
    id: 'cyber',
    name: 'Cybersecurity & BCP',
    icon: 'lock',
    intro:
      'Data protection and business-continuity — increasingly a hard requirement in diligence.',
    decisions: [
      { key: 'level', kind: 'radio', label: 'Standard', opts: ['SOC 2-aligned', 'Baseline'] }
    ],
    rec: { level: 'SOC 2-aligned' },
    recText:
      'Aligning to SOC 2 signals seriousness to institutional LPs and most ODD checklists now ask for it. I’ll draft the policy and a continuity plan.'
  }
] as const;

/** Per-policy stage in the hub grid: To do → Drafting → Active. */
export type PolStage = 'todo' | 'drafting' | 'active';

export const POL_STAGES: Record<PolStage, string> = {
  todo: 'To do',
  drafting: 'Drafting',
  active: 'Active'
};

/** Badge tone per stage (matches the prototype's grid tones). */
export const POL_TONE: Record<PolStage, 'neutral' | 'gold' | 'success'> = {
  todo: 'neutral',
  drafting: 'gold',
  active: 'success'
};

/** Adopted wins; a draft-in-progress reads Drafting; otherwise To do. */
export function policyStage(adopted: boolean, drafting: boolean): PolStage {
  return adopted ? 'active' : drafting ? 'drafting' : 'todo';
}

export interface GovMember {
  id: string;
  name?: string;
  role: string;
  you?: boolean;
  open?: boolean;
  pending?: boolean;
  note?: string;
  carry?: string;
}

export interface GovCandidate {
  name: string;
  role: string;
  note: string;
  carry?: string;
}

/*
 * Starting rosters hold only the operator's own seat, open seats, or pending
 * placeholders — never the prototype's seeded people. Those live on the
 * candidate benches below, presented as suggestions; a member becomes real
 * data only when the operator confirms them into a seat.
 */
export const FM_0: readonly GovMember[] = [
  {
    id: 'fm1',
    you: true,
    role: 'Managing Partner',
    carry: '60%',
    note: 'Key person · final IC vote'
  },
  { id: 'fm2', name: 'Open seat', role: 'Partner', open: true }
];
export const FM_CANDIDATES: readonly GovCandidate[] = [
  { name: 'Priya Anand', role: 'Partner', carry: '25%', note: 'Deal lead · ex-PE principal' },
  {
    name: 'Tom Becker',
    role: 'Partner, Operations',
    carry: '15%',
    note: 'Portfolio ops & value creation'
  }
];

export const IC_MEMBERS_0: readonly GovMember[] = [
  { id: 'p1', name: '', role: 'Chair · Managing Partner', you: true },
  { id: 'p2', name: 'Open seat', role: 'Investment Partner', open: true }
];
export const IC_CANDIDATES: readonly GovCandidate[] = [
  { name: 'Dr. Helen Ashford', role: 'Investment Partner', note: 'Ex-operator, 20y sector' },
  { name: 'Marcus Reyes', role: 'Investment Partner', note: 'Former MD, growth equity' }
];

export const ADV_0: readonly GovMember[] = [
  { id: 'a1', name: 'Open seat', role: 'Industry Advisor', open: true },
  { id: 'a2', name: 'Open seat', role: 'Advisor', open: true }
];
export const ADV_CANDIDATES: readonly GovCandidate[] = [
  { name: 'Sir Reginald Hale', role: 'Industry Advisor', note: 'Former CEO, sector incumbent' },
  { name: 'Dr. Amara Diallo', role: 'Technical Advisor', note: 'Research lead · diligence depth' },
  { name: 'Gloria Tan', role: 'Capital Markets Advisor', note: 'Ex-placement · LP introductions' },
  { name: 'Hiroshi Sato', role: 'Operating Advisor', note: '3 exits · operator network' }
];

export const CAP_0: readonly GovMember[] = [
  { id: 'c1', name: 'Open relationship', role: 'Capital partner', open: true },
  { id: 'c2', name: 'Open relationship', role: 'Capital partner', open: true }
];
export const CAP_CANDIDATES: readonly GovCandidate[] = [
  { name: 'First Republic', role: 'Subscription credit line', note: '$25M facility' },
  { name: 'Apollo Credit', role: 'NAV facility', note: 'Portfolio-level leverage' },
  { name: 'Coastal Co-invest', role: 'Co-investment partner', note: 'Deal-by-deal capital' },
  { name: 'Silicon Valley Bank', role: 'Capital-call facility', note: 'Bridge financing' }
];

export const LEGAL_0: readonly GovMember[] = [
  { id: 'g1', name: 'Open relationship', role: 'Fund counsel', open: true },
  { id: 'g2', name: 'Open relationship', role: 'Legal counsel', open: true }
];
export const LEGAL_CANDIDATES: readonly GovCandidate[] = [
  {
    name: 'Standish & Cole',
    role: 'Fund counsel',
    note: 'Formation & LPA · from Partner Network'
  },
  { name: 'Whitman Regulatory', role: 'Regulatory & SEC counsel', note: 'Compliance & exemptions' },
  { name: 'Harbor Tax LLP', role: 'Fund tax counsel', note: 'Structuring & K-1s' },
  { name: 'Meridian IP', role: 'Portfolio counsel', note: 'Deal & IP support' }
];

export const LPAC_0: readonly GovMember[] = [
  { id: 'l1', name: 'Forms at first close', role: 'LP representatives', pending: true }
];

/** A fresh, editable copy of a policy's recommended decisions. */
export function policyDefaults(pol: GovPolicy): Record<string, PolicyValue> {
  const out: Record<string, PolicyValue> = {};
  for (const [k, v] of Object.entries(pol.rec)) out[k] = Array.isArray(v) ? [...v] : v;
  return out;
}

/** The review rows shown for an adopted policy. */
export function policyRows(pol: GovPolicy, d: Record<string, PolicyValue>): [string, string][] {
  return pol.decisions.map((dec) => {
    const v = d[dec.key];
    return [dec.label, Array.isArray(v) ? (v.length ? v.join(', ') : 'None') : (v ?? '—')];
  });
}
