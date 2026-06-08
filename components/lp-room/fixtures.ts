/**
 * LP Room — inline placeholder fixtures.
 *
 * Used by `app/lp-room/page.tsx` as the default `LpRoomData`. Eleanor is the
 * voice anchor; lifecycle tags map to the live www.fundexecs.com four-step
 * model; persona keys mirror `components/dashboard/fixtures/personas.ts`.
 *
 * Backend wiring deletes this file: Claude maps real Supabase data onto the
 * typed contracts in `./types.ts` and removes the default.
 */
import type {
  CapitalAccountSummaryData,
  CommitmentSnapshot,
  DistributionItem,
  FundOverview,
  LpDocument,
  LpQuestion,
  LpRoomData,
  LpUpdate
} from './types';

export const FIXTURE_FUND: FundOverview = {
  name: 'FundExecs Capital I',
  vintage: 2026,
  strategy: 'Lower-middle-market growth · capital formation',
  sizeTarget: '$120M',
  committed: '$72M',
  called: '$38M',
  dpi: '0.42x',
  tvpi: '1.18x',
  irr: '21.4%',
  nextClose: 'Mar 21, 2026',
  status: 'in-market',
  oneLiner:
    'A disciplined raise from target list to final close — every commitment documented as it forms.'
};

export const FIXTURE_DOCUMENTS: LpDocument[] = [
  {
    id: 'doc-lpa',
    name: 'Limited Partnership Agreement (executed)',
    kind: 'lpa',
    sizeMb: '2.4 MB',
    uploadedAt: 'Jan 24, 2026',
    signed: true,
    accessLevel: 'committed'
  },
  {
    id: 'doc-subdoc',
    name: 'Subscription Documents — Series A',
    kind: 'subscription',
    sizeMb: '1.1 MB',
    uploadedAt: 'Jan 30, 2026',
    signed: true,
    accessLevel: 'committed'
  },
  {
    id: 'doc-side-letter',
    name: 'Side Letter — Tier-1 LP',
    kind: 'side-letter',
    sizeMb: '0.8 MB',
    uploadedAt: 'Feb 02, 2026',
    signed: true,
    accessLevel: 'committed'
  },
  {
    id: 'doc-q4-report',
    name: 'Q4 2025 LP Report',
    kind: 'report',
    sizeMb: '4.2 MB',
    uploadedAt: 'Feb 06, 2026',
    accessLevel: 'committed'
  },
  {
    id: 'doc-capital-call-3',
    name: 'Capital Call Notice · #3',
    kind: 'capital-call',
    sizeMb: '0.3 MB',
    uploadedAt: 'Feb 12, 2026',
    accessLevel: 'committed'
  },
  {
    id: 'doc-teaser-deck',
    name: 'Prospect Teaser Deck (one-pager)',
    kind: 'memo',
    sizeMb: '1.7 MB',
    uploadedAt: 'Feb 14, 2026',
    accessLevel: 'prospect'
  },
  {
    id: 'doc-k1-2025',
    name: 'K-1 Schedules · 2025',
    kind: 'k1',
    sizeMb: '5.5 MB',
    uploadedAt: 'Feb 18, 2026',
    accessLevel: 'committed'
  }
];

export const FIXTURE_UPDATES: LpUpdate[] = [
  {
    id: 'update-mar-close',
    postedAt: 'Feb 14, 2026',
    title: 'Mar 21 close — $14M added in commitments this week',
    body: 'Sloane closed two new tickets ($8M and $6M). The final-close cap remains at $120M; we are tracking 88% subscribed. Sterling will sequence the final round of intro calls on a rolling basis.',
    author: 'Eleanor',
    authorRole: 'Head of Investor Relations',
    lifecycle: 'source-raise',
    attachments: [
      { id: 'doc-side-letter', name: 'Side Letter · Tier-1 LP', documentId: 'doc-side-letter' }
    ]
  },
  {
    id: 'update-q4-report',
    postedAt: 'Feb 06, 2026',
    title: 'Q4 2025 LP Report — posted to the Vault',
    body: 'Reporting package is live. Two portfolio updates lifted TVPI to 1.18x; one downside risk is flagged on the climate sleeve with mitigation in flight. K-1 schedules will be posted Feb 18.',
    author: 'Eleanor',
    authorRole: 'Head of Investor Relations',
    lifecycle: 'reporting',
    attachments: [{ id: 'doc-q4-report', name: 'Q4 2025 LP Report', documentId: 'doc-q4-report' }]
  },
  {
    id: 'update-thesis-refresh',
    postedAt: 'Jan 28, 2026',
    title: 'Thesis refresh — added one sector, removed two',
    body: 'Theodore pressure-tested the 2026 mandate. We are adding industrial automation, sunsetting two early-stage consumer tilts. Marcus is repricing the on-thesis funnel against the refreshed targets.',
    author: 'Eleanor',
    authorRole: 'Head of Investor Relations',
    lifecycle: 'mandate'
  },
  {
    id: 'update-ic-package',
    postedAt: 'Jan 18, 2026',
    title: 'IC package · Northwind Logistics — circulated',
    body: 'Adrian cleared structure and risk. Priya matched two co-investors. Theodore signed off on the narrative. Decision deck attached — vote target Feb 02.',
    author: 'Eleanor',
    authorRole: 'Head of Investor Relations',
    lifecycle: 'analyze-package'
  }
];

export const FIXTURE_COMMITMENTS: CommitmentSnapshot = {
  committed: '$72M',
  called: '$38M',
  distributed: '$12M',
  remaining: '$34M',
  schedule: [
    {
      id: 'commit-pw',
      persona: 'institutional-lp',
      initials: 'P.W.',
      city: 'Singapore',
      committed: '$15M',
      called: '$8.0M',
      status: 'called',
      when: 'Feb 2026'
    },
    {
      id: 'commit-jr',
      persona: 'family-office',
      initials: 'J.R.',
      city: 'Chicago',
      committed: '$10M',
      called: '$5.4M',
      status: 'called',
      when: 'Feb 2026'
    },
    {
      id: 'commit-cb',
      persona: 'family-office',
      initials: 'C.B.',
      city: 'Dallas',
      committed: '$8M',
      called: '$4.2M',
      status: 'committed',
      when: 'Jan 2026'
    },
    {
      id: 'commit-mt',
      persona: 'fund-manager',
      initials: 'M.T.',
      city: 'New York',
      committed: '$12M',
      called: '$6.3M',
      status: 'called',
      when: 'Feb 2026'
    },
    {
      id: 'commit-ev',
      persona: 'fund-manager',
      initials: 'E.V.',
      city: 'Boston',
      committed: '$9M',
      called: '$5.0M',
      status: 'committed',
      when: 'Feb 2026'
    },
    {
      id: 'commit-sl',
      persona: 'angel-investor',
      initials: 'S.L.',
      city: 'San Francisco',
      committed: '$2M',
      called: '$1.2M',
      status: 'committed',
      when: 'Jan 2026'
    },
    {
      id: 'commit-th',
      persona: 'general-partner',
      initials: 'T.H.',
      city: 'Toronto',
      committed: '$4M',
      called: '$2.1M',
      status: 'called',
      when: 'Jan 2026'
    },
    {
      id: 'commit-rn',
      persona: 'sponsor',
      initials: 'R.N.',
      city: 'Miami',
      committed: '$6M',
      called: '$2.4M',
      status: 'in-progress',
      when: 'Feb 2026'
    },
    {
      id: 'commit-dp',
      persona: 'connector',
      initials: 'D.P.',
      city: 'London',
      committed: '$3M',
      called: '$2.0M',
      status: 'called',
      when: 'Feb 2026'
    },
    {
      id: 'commit-eb',
      persona: 'student-led-fund',
      initials: 'E.B.',
      city: 'Cambridge',
      committed: '$3M',
      called: '$1.4M',
      status: 'committed',
      when: 'Feb 2026'
    }
  ]
};

export const FIXTURE_QUESTIONS: LpQuestion[] = [
  {
    id: 'q-fee-waiver',
    askedBy: 'J.R. · Family Office',
    askedAt: 'Feb 12, 2026',
    body: 'Can you walk me through the management-fee waiver mechanics for the Tier-1 cohort? I want the worked example before the Mar 21 close.',
    status: 'answered',
    thread: [
      {
        id: 'a-fee-waiver-1',
        author: 'Eleanor',
        authorRole: 'Head of Investor Relations',
        postedAt: 'Feb 12, 2026 · 4:18 pm',
        body: 'Tier-1 commitments above $10M waive 50 bps of the management fee for the first three years, recaptured pro rata against carry. I have a worked example in the side-letter packet — pinging Adrian for the audited tear-sheet.',
        citations: [{ id: 'doc-side-letter', label: 'Side Letter · Tier-1 LP' }]
      }
    ]
  },
  {
    id: 'q-climate-mitigation',
    askedBy: 'P.W. · Institutional LP',
    askedAt: 'Feb 09, 2026',
    body: 'Re: the climate sleeve risk flagged in the Q4 report — what is the specific mitigation timeline? Considering an upsize but want to see the plan first.',
    status: 'answered',
    thread: [
      {
        id: 'a-climate-1',
        author: 'Eleanor',
        authorRole: 'Head of Investor Relations',
        postedAt: 'Feb 10, 2026 · 9:02 am',
        body: 'Theodore and Priya are re-pricing the sleeve. Mitigation plan posts to the Vault by Feb 20 — fully audit-ready. Happy to walk you through ahead of the upsize call.',
        citations: [{ id: 'doc-q4-report', label: 'Q4 2025 LP Report' }]
      }
    ]
  },
  {
    id: 'q-coinvest',
    askedBy: 'C.B. · Family Office',
    askedAt: 'Feb 05, 2026',
    body: 'Are co-investment rights extended pro rata, or first-come on a per-deal basis?',
    status: 'open',
    thread: []
  }
];

export const FIXTURE_DISTRIBUTIONS: DistributionItem[] = [
  {
    id: 'dist-1',
    distributionDate: 'Jan 15, 2026',
    kind: 'return_of_capital',
    amount: 6_000_000,
    status: 'paid',
    memo: 'Q4 2025 return of capital — Northwind Logistics partial exit'
  },
  {
    id: 'dist-2',
    distributionDate: 'Dec 01, 2025',
    kind: 'profit',
    amount: 3_200_000,
    status: 'paid',
    memo: 'Carry distribution — closing event'
  },
  {
    id: 'dist-3',
    distributionDate: 'Mar 01, 2026',
    kind: 'return_of_capital',
    amount: 2_800_000,
    status: 'pending',
    memo: 'Q1 2026 return of capital — processing'
  }
];

export const FIXTURE_CAPITAL_ACCOUNT: CapitalAccountSummaryData = {
  committed: 72_000_000,
  called: 38_000_000,
  distributed: 12_000_000,
  navBalance: 44_800_000,
  balanceSeries: [
    38_000_000, 39_200_000, 40_100_000, 41_500_000, 43_000_000, 42_600_000, 44_800_000
  ]
};

export const FIXTURE_LP_ROOM: LpRoomData = {
  fund: FIXTURE_FUND,
  documents: FIXTURE_DOCUMENTS,
  updates: FIXTURE_UPDATES,
  commitments: FIXTURE_COMMITMENTS,
  questions: FIXTURE_QUESTIONS,
  distributions: FIXTURE_DISTRIBUTIONS,
  capitalAccount: FIXTURE_CAPITAL_ACCOUNT,
  isCapitalDataSample: true
};
