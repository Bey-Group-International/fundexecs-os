/**
 * lib/run-ops/vocabulary.ts — the Run interiors' pure vocabulary.
 *
 * Three operating surfaces share it: Workflows & tasks (Sterling's sequenced
 * launch plan), Compliance (Adrian's posture board), and IR & reporting
 * (Eleanor's LP cadence). Each defines its status order (one step at a time,
 * enforced server-side) and the baseline the specialist seeds through the
 * approve loop — real rows the operator then works, never fake counts.
 */

/* ── Workflows & tasks ───────────────────────────────────────────────────── */

export const TASK_STATUSES = ['todo', 'doing', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export function isTaskStatus(s: string): s is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(s);
}

/** The only legal transition is to the next status in order. */
export function nextTaskStatus(s: TaskStatus): TaskStatus | null {
  const i = TASK_STATUSES.indexOf(s);
  return i >= 0 && i < TASK_STATUSES.length - 1 ? TASK_STATUSES[i + 1] : null;
}

export const TASK_MOVE: Record<Exclude<TaskStatus, 'done'>, string> = {
  todo: 'Start',
  doing: 'Complete'
};

export interface BaselineWorkflow {
  stream: string;
  name: string;
  tasks: string[];
}

/** Sterling's standard launch plan — seeded once, then worked for real. */
export const WORKFLOW_BASELINE: readonly BaselineWorkflow[] = [
  {
    stream: 'Launch',
    name: 'Stand up the fund',
    tasks: [
      'Finalize the fund story',
      'Complete formation filings',
      'Adopt the governance baseline',
      'Publish the data room'
    ]
  },
  {
    stream: 'Raise',
    name: 'Open the raise',
    tasks: [
      'Rank the LP target list',
      'Send the first outreach wave',
      'Run the follow-up cadence',
      'Lock the first soft-circles'
    ]
  },
  {
    stream: 'Deploy',
    name: 'Build the pipeline',
    tasks: [
      'Define the sourcing thesis',
      'Qualify the first inbound set',
      'Open diligence on the lead deal'
    ]
  }
] as const;

/* ── Compliance ──────────────────────────────────────────────────────────── */

export const COMPLIANCE_SEVERITIES = ['high', 'medium', 'low'] as const;
export type ComplianceSeverity = (typeof COMPLIANCE_SEVERITIES)[number];

export const COMPLIANCE_STATUSES = ['open', 'upcoming', 'resolved'] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

/** Open and upcoming items can be worked; resolved is terminal. */
export function isComplianceResolvable(s: string): boolean {
  return s === 'open' || s === 'upcoming';
}

/** The prototype's CO_CATS — the posture board's filter chips. */
export const COMPLIANCE_CATEGORIES = [
  'Regulatory',
  'Investor',
  'Internal',
  'Data & Cyber'
] as const;
export type ComplianceCategory = (typeof COMPLIANCE_CATEGORIES)[number];

/**
 * Map a stored category to one of the four board categories. New rows store
 * the canonical value; legacy rows stored the obligation itself ('Reg D /
 * Form D', 'Accreditation records', …) and are bucketed by keyword.
 */
export function normalizeComplianceCategory(raw: string): ComplianceCategory {
  const exact = COMPLIANCE_CATEGORIES.find((c) => c.toLowerCase() === raw.trim().toLowerCase());
  if (exact) return exact;
  const r = raw.toLowerCase();
  if (/(privacy|data|cyber|soc\s?2)/.test(r)) return 'Data & Cyber';
  if (/(reg\s?d|form\s|filing|blue sky|sec\b|regulat)/.test(r)) return 'Regulatory';
  if (/(accredit|kyc|aml|investor|subscription|lp\b)/.test(r)) return 'Investor';
  return 'Internal';
}

export interface CompliancePosture {
  label: 'Action required' | 'Items open' | 'On track' | 'Fully compliant';
  tone: 'danger' | 'warning' | 'info' | 'success';
}

/**
 * The prototype's posture ladder, computed from real items: high-severity
 * open → Action required; open → Items open; upcoming → On track; otherwise
 * Fully compliant.
 */
export function compliancePosture(
  items: ReadonlyArray<{ status: string; severity: string }>
): CompliancePosture {
  const open = items.filter((i) => i.status === 'open');
  if (open.some((i) => i.severity === 'high')) return { label: 'Action required', tone: 'danger' };
  if (open.length > 0) return { label: 'Items open', tone: 'warning' };
  if (items.some((i) => i.status === 'upcoming')) return { label: 'On track', tone: 'info' };
  return { label: 'Fully compliant', tone: 'success' };
}

export interface BaselineComplianceItem {
  /** The obligation itself ('Form D filing', 'LP KYC / AML clearance', …). */
  name: string;
  category: ComplianceCategory;
  severity: ComplianceSeverity;
  /** Honest starting state — the baseline never seeds anything as resolved. */
  status: Extract<ComplianceStatus, 'open' | 'upcoming'>;
  /** Owning specialist (first name from the roster). */
  owner: string;
  /** Rule-derived due framing — never a fabricated countdown. */
  due: string;
  /** Why it matters — the drives-line under the row. */
  drives: string;
  /** Earn's action verb for the resolve loop. */
  action: string;
  detail: string;
  checklist: readonly string[];
}

/**
 * Adrian's compliance baseline — the posture every emerging manager owes,
 * spanning all four categories. Every item seeds open or upcoming; nothing
 * is ever pre-marked resolved (no fake filing is ever marked done).
 */
export const COMPLIANCE_BASELINE: readonly BaselineComplianceItem[] = [
  {
    name: 'LP KYC / AML clearance',
    category: 'Investor',
    severity: 'high',
    status: 'open',
    owner: 'Adrian',
    due: 'Before capital is accepted',
    drives: 'Commitments cannot close until every subscribing LP clears',
    action: 'Stand up the checks',
    detail:
      'Every subscribing LP needs identity and source-of-funds verification before their capital is accepted into the fund.',
    checklist: ['Identity verification', 'Source-of-funds review', 'Sanctions screening']
  },
  {
    name: 'Form D filing',
    category: 'Regulatory',
    severity: 'high',
    status: 'open',
    owner: 'Adrian',
    due: 'Within 15 days of first sale',
    drives: 'Keeps the raise SEC-compliant',
    action: 'Prepare the filing',
    detail:
      'Form D is due within 15 days of the first sale — and an amendment whenever the offering amount or investor count materially changes.',
    checklist: ['Offering size', 'Investor count', 'EDGAR filing']
  },
  {
    name: 'Accreditation records',
    category: 'Investor',
    severity: 'high',
    status: 'open',
    owner: 'Adrian',
    due: 'Evidence on file per LP',
    drives: 'Protects the exemption on every commitment',
    action: 'Collect the evidence',
    detail:
      'Accreditation evidence must be on file for every LP, matched to the exemption you are relying on (506(b) vs 506(c)).',
    checklist: ['Verification method per LP', 'Evidence on file', 'Exemption match']
  },
  {
    name: 'AML program & officer',
    category: 'Investor',
    severity: 'medium',
    status: 'open',
    owner: 'Adrian',
    due: 'Before institutional capital',
    drives: 'Lets you accept institutional capital',
    action: 'Adopt the program',
    detail:
      'A written AML program with a designated officer and ongoing sanctions screening is table stakes for institutional LPs.',
    checklist: ['Written program', 'Designated officer', 'OFAC screening']
  },
  {
    name: 'Marketing & comms review',
    category: 'Internal',
    severity: 'medium',
    status: 'open',
    owner: 'Sienna',
    due: 'Before anything ships',
    drives: 'Keeps the raise within the Marketing Rule',
    action: 'Review the materials',
    detail:
      'Every LP-facing material needs compliance review under the Marketing Rule — and against the 506(b)/(c) solicitation line — before it goes out.',
    checklist: ['Pitch deck', 'One-pager & track record', 'Web & social presence']
  },
  {
    name: 'Form ADV annual update',
    category: 'Regulatory',
    severity: 'medium',
    status: 'upcoming',
    owner: 'Adrian',
    due: 'Within 90 days of fiscal year-end',
    drives: 'Maintains adviser registration',
    action: 'Draft the update',
    detail:
      'The annual Form ADV update is due within 90 days of fiscal year-end — AUM, brochure and disclosures need refreshing.',
    checklist: ['AUM update', 'Brochure (Part 2A)', 'Disclosure review']
  },
  {
    name: 'Annual compliance review',
    category: 'Internal',
    severity: 'medium',
    status: 'upcoming',
    owner: 'Adrian',
    due: 'Annually under Rule 206(4)-7',
    drives: 'ODD-ready for institutions',
    action: 'Schedule the review',
    detail:
      'The annual review of the compliance program under Rule 206(4)-7 must be performed and documented — institutional ODD asks for it.',
    checklist: ['Policy review', 'Testing', 'Findings memo']
  },
  {
    name: 'Personal trading attestations',
    category: 'Internal',
    severity: 'low',
    status: 'upcoming',
    owner: 'Adrian',
    due: 'Quarterly',
    drives: 'Required under the Code of Ethics before each close',
    action: 'Send the attestations',
    detail:
      'Quarterly personal-trading attestations under the Code of Ethics keep the team clean ahead of every close.',
    checklist: ['Code of Ethics adopted', 'Quarterly attestations', 'Exception log']
  },
  {
    name: 'Blue sky (state) filings',
    category: 'Regulatory',
    severity: 'low',
    status: 'upcoming',
    owner: 'Adrian',
    due: 'Per state, after first sale',
    drives: 'State-level offering compliance',
    action: 'Map the states',
    detail:
      'State notice filings are due in the states where your LPs reside, generally within 15 days of the first sale in that state.',
    checklist: ['LP state map', 'Notice filings', 'Fee schedule']
  },
  {
    name: 'SOC 2 / cybersecurity',
    category: 'Data & Cyber',
    severity: 'medium',
    status: 'upcoming',
    owner: 'Noah',
    due: 'Ahead of institutional ODD',
    drives: 'Increasingly required in ODD',
    action: 'Close the gaps',
    detail:
      'Institutional LPs increasingly ask for SOC 2-aligned controls — access management, incident response and vendor risk all get tested.',
    checklist: ['Access controls', 'Incident response plan', 'Vendor risk review']
  },
  {
    name: 'Data privacy (GDPR/CCPA)',
    category: 'Data & Cyber',
    severity: 'low',
    status: 'upcoming',
    owner: 'Noah',
    due: 'Before EU or California capital',
    drives: 'Required for EU & California investors',
    action: 'Refresh the policy',
    detail:
      'Privacy policy and data-processing terms must cover EU and California LP data, and be disclosed in the subscription docs.',
    checklist: ['Privacy policy', 'DPA template', 'Data map']
  }
] as const;

/* ── IR & reporting ──────────────────────────────────────────────────────── */

export const IR_STATUSES = ['todo', 'sent'] as const;
export type IrStatus = (typeof IR_STATUSES)[number];

/** The prototype's IR_CATS — the deliverable filter chips. */
export const IR_CATS = ['Letters', 'Statements', 'Events', 'Portal'] as const;
export type IrCategory = (typeof IR_CATS)[number];

export function isIrCategory(s: string): s is IrCategory {
  return (IR_CATS as readonly string[]).includes(s);
}

/** The per-item action verb, by category — the prototype's `action` field. */
export const IR_ACTION: Record<IrCategory, string> = {
  Letters: 'Review & send',
  Statements: 'Generate & send',
  Events: 'Plan & schedule',
  Portal: 'Publish & send'
};

export function irAction(category: string | null): string {
  return category && isIrCategory(category) ? IR_ACTION[category] : 'Prepare & send';
}

export interface BaselineIrItem {
  name: string;
  category: IrCategory;
  /** The specialist who assembles it. */
  who: string;
  /** Why it matters — the row's drives-line and the drawer's gold strip. */
  drives: string;
  /** The drawer's explanation paragraph. */
  detail: string;
  /** The contents checklist ("Contents · {n}"). */
  contents: string[];
  /** Days from seeding until due. */
  dueInDays: number;
}

/** Eleanor's reporting cadence — the deliverables LPs expect on a clock. */
export const IR_BASELINE: readonly BaselineIrItem[] = [
  {
    name: 'Pipeline & portfolio update',
    category: 'Letters',
    who: 'Eleanor',
    drives: 'Light-touch confidence between quarters',
    detail:
      'A short between-quarters note — what moved in the pipeline and the portfolio. Eleanor drafts it from your workspace; nothing reaches an LP until you approve.',
    contents: ['Pipeline movement', 'One portfolio highlight', 'One ask'],
    dueInDays: 14
  },
  {
    name: 'Quarterly LP letter',
    category: 'Letters',
    who: 'Eleanor',
    drives: 'Keeps momentum into next close',
    detail:
      'Your quarterly letter, assembled from the workspace — performance, portfolio news and market view. Review and send on your approval.',
    contents: ['Performance section', 'Portfolio updates', 'Market commentary', 'Capital activity'],
    dueInDays: 30
  },
  {
    name: 'Capital account statements',
    category: 'Statements',
    who: 'Eleanor',
    drives: 'LPs expect them on cadence',
    detail:
      'Per-LP capital account statements with NAV, contributions, distributions, fees and carry — generated from your capital records.',
    contents: ['NAV struck', 'Per-LP allocations', 'Fee & carry calc', 'Distribution summary'],
    dueInDays: 45
  },
  {
    name: 'Annual meeting planning',
    category: 'Events',
    who: 'Sienna',
    drives: 'The room that drives re-ups',
    detail:
      'The annual LP meeting is your single biggest re-up moment. Build the deck and the run of show well before the room fills.',
    contents: ['Performance review', 'Portfolio deep-dives', 'Strategy & outlook', 'Q&A prep'],
    dueInDays: 90
  }
] as const;

/** LP roster sentiment, derived only from a real recorded warmth signal. */
export interface IrSentiment {
  label: 'Champion' | 'Engaged' | 'Needs attention';
  tone: 'success' | 'azure' | 'warning';
}

/**
 * Map a capital_providers warmth ("Hot"/"Warm"/"Cold", free-form) to the
 * prototype's sentiment vocabulary. A missing or unrecognized warmth returns
 * null — sentiment only renders where a real signal exists.
 */
export function irSentiment(warmth: string | null | undefined): IrSentiment | null {
  const w = (warmth ?? '').trim().toLowerCase();
  if (!w) return null;
  if (/^(hot|champion)/.test(w)) return { label: 'Champion', tone: 'success' };
  if (/^(warm|engaged|active)/.test(w)) return { label: 'Engaged', tone: 'azure' };
  if (/^(cold|cool|quiet|stale)/.test(w)) return { label: 'Needs attention', tone: 'warning' };
  return null;
}
