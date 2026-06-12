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

export const COMPLIANCE_STATUSES = ['open', 'resolved'] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

export interface BaselineComplianceItem {
  category: string;
  severity: ComplianceSeverity;
  /** What "resolved" means for this item — shown in the runner draft. */
  note: string;
}

/** Adrian's compliance baseline — the posture every emerging manager owes. */
export const COMPLIANCE_BASELINE: readonly BaselineComplianceItem[] = [
  {
    category: 'Reg D / Form D',
    severity: 'high',
    note: 'File within 15 days of first sale; keep the exemption posture current.'
  },
  {
    category: 'Accreditation records',
    severity: 'high',
    note: 'Evidence on file for every LP, matched to the exemption.'
  },
  {
    category: 'Advertising & solicitation',
    severity: 'medium',
    note: 'Marketing reviewed against the 506(b)/(c) line before anything ships.'
  },
  {
    category: 'Books & records',
    severity: 'medium',
    note: 'Ledgers, minutes and side letters retained and retrievable.'
  },
  {
    category: 'Privacy & data handling',
    severity: 'low',
    note: 'LP PII scoped, access-controlled, and disclosed in the subscription docs.'
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
