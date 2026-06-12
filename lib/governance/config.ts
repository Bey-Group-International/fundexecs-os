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
 * Starting rosters hold only what is honestly true on day one: the operator
 * (`you`) and open seats. The prototype's seeded people (Sir Reginald Hale,
 * First Republic, Standish & Cole) live on the candidate BENCHES below —
 * presented as Earn's suggestions, never as members. A person joins a roster
 * only through the approve loop, and only confirmed members persist.
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

/** The persistable governance-body kinds (DB check constraint mirrors this). */
export type GovBodyId =
  | 'fund_mgmt'
  | 'ic'
  | 'advisory'
  | 'lpac'
  | 'capital_partners'
  | 'legal_counsel';

/** Members that are real: placeholders (open seats, pending notes) never persist. */
export function confirmedMembers(members: readonly GovMember[]): GovMember[] {
  return members.filter((m) => !m.open && !m.pending);
}

/**
 * The operator's own seats (`you`) — identity, re-derived from config on every
 * read rather than persisted. A roster's confirmed set is always
 * `[...operatorSeats(initial), ...addedMembers(stored)]`, so the operator can
 * never be lost to an empty or hand-edited row.
 */
export function operatorSeats(members: readonly GovMember[]): GovMember[] {
  return members.filter((m) => m.you);
}

/** The members an operator actually added — what persistence stores (no
 *  placeholders, no operator identity seats). */
export function addedMembers(members: readonly GovMember[]): GovMember[] {
  return members.filter((m) => !m.open && !m.pending && !m.you);
}

/**
 * The render shape of a roster: its confirmed members padded back to the
 * body's seat layout with the starting roster's open-seat templates, so an
 * empty roster reads as open seats and a part-filled one keeps the right
 * "next seat" label.
 */
export function padRoster(
  initial: readonly GovMember[],
  confirmed: readonly GovMember[]
): GovMember[] {
  const opens = initial.filter((m) => m.open);
  const fixedSeats = initial.length - opens.length;
  // Seats genuinely consumed = confirmed members beyond the body's fixed
  // (non-open) seats. Caps how many open templates can remain.
  const consumed = Math.max(0, confirmed.length - fixedSeats);

  // Retire the specific open template each confirmed member fills, matched by
  // seat role — so filling the *second* slot removes the second placeholder,
  // not always the first (the old count-only trim mishandled mixed rosters).
  const remaining = [...opens];
  for (const m of confirmed) {
    const idx = remaining.findIndex((o) => o.role === m.role);
    if (idx !== -1) remaining.splice(idx, 1);
  }

  // Enforce the seat-count cap for any members whose role didn't match a named
  // open seat, dropping extra placeholders from the front (fill earliest-first).
  const overflow = remaining.length - (opens.length - consumed);
  return [...confirmed, ...(overflow > 0 ? remaining.slice(overflow) : remaining)];
}

/* ── the per-body approve-loop copy (the prototype's onRun payloads) ─────── */

export interface GovRunCopy {
  title: string;
  steps: string[];
  draftTitle: string;
  draft: string;
}

/** The ActionRunner copy for adding a bench candidate to a governance body. */
export function rosterRun(kind: Exclude<GovBodyId, 'lpac'>, cand: GovCandidate): GovRunCopy {
  switch (kind) {
    case 'fund_mgmt':
      return {
        title: `Bring ${cand.name} onto the GP`,
        steps: [
          'Confirm role & track record',
          'Model the carry & ownership split',
          'Draft the partnership terms',
          'Prepare for your approval'
        ],
        draftTitle: `GP partner — ${cand.name}`,
        draft: `Earn structured terms for ${cand.name} (${cand.note}) as ${cand.role}${
          cand.carry ? `, with a ${cand.carry} carry allocation` : ''
        }. Approve to add them to the management team.`
      };
    case 'ic':
      return {
        title: `Invite ${cand.name} to your IC`,
        steps: [
          'Confirm independence & fit',
          'Draft the appointment letter',
          'Set IC charter & voting rights',
          'Prepare for your approval'
        ],
        draftTitle: `IC appointment — ${cand.name}`,
        draft: `Earn lined up ${cand.name} (${cand.note}) for your Investment Committee. Approve to extend the seat and set their voting rights.`
      };
    case 'advisory':
      return {
        title: `Invite ${cand.name} as an advisor`,
        steps: [
          'Confirm expertise & network fit',
          'Draft the advisory agreement',
          'Set advisory-share terms',
          'Prepare for your approval'
        ],
        draftTitle: `Advisory Board — ${cand.name}`,
        draft: `Earn lined up ${cand.name} (${cand.note}) for your Advisory Board. Approve to extend the role and set advisory-share terms.`
      };
    case 'capital_partners':
      return {
        title: `Engage ${cand.name}`,
        steps: [
          'Confirm terms & covenants',
          'Draft the facility / co-invest agreement',
          'Run counsel review',
          'Prepare for your approval'
        ],
        draftTitle: `Capital partner — ${cand.name}`,
        draft: `Earn structured terms with ${cand.name} (${cand.role}, ${cand.note}). Approve to engage and add the relationship to your capital stack.`
      };
    case 'legal_counsel':
      return {
        title: `Engage ${cand.name}`,
        steps: [
          'Confirm scope & conflicts',
          'Draft the engagement letter',
          'Set fee arrangement',
          'Prepare for your approval'
        ],
        draftTitle: `Legal counsel — ${cand.name}`,
        draft: `Earn lined up ${cand.name} (${cand.role}, ${cand.note}). Approve to engage and add them to your counsel bench.`
      };
  }
}

/* ── the policy stage progression (To do → Drafting → Active) ────────────── */

export type PolicyStage = 'todo' | 'drafting' | 'active';

export const POL_STAGES: Record<PolicyStage, string> = {
  todo: 'Not adopted',
  drafting: 'Drafted — adopt to activate',
  active: 'Active'
};

/** Badge/accent tone per stage. */
export const POL_TONE: Record<PolicyStage, 'neutral' | 'gold' | 'success'> = {
  todo: 'neutral',
  drafting: 'gold',
  active: 'success'
};

/** The per-stage call to action: Draft → Adopt → View. */
export const POL_CTA: Record<PolicyStage, string> = {
  todo: 'Draft',
  drafting: 'Adopt',
  active: 'View'
};

/** Where a policy sits given the org's adopted + drafted decision maps. */
export function policyStage(
  id: string,
  adopted: Record<string, unknown>,
  drafts: Record<string, unknown>
): PolicyStage {
  if (id in adopted) return 'active';
  if (id in drafts) return 'drafting';
  return 'todo';
}

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
