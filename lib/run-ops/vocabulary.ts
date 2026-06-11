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

export interface BaselineIrItem {
  cat: string;
  /** Days from seeding until due. */
  dueInDays: number;
}

/** Eleanor's reporting cadence — the deliverables LPs expect on a clock. */
export const IR_BASELINE: readonly BaselineIrItem[] = [
  { cat: 'Quarterly LP letter', dueInDays: 30 },
  { cat: 'Capital account statements', dueInDays: 45 },
  { cat: 'Pipeline & portfolio update', dueInDays: 14 },
  { cat: 'Annual meeting planning', dueInDays: 90 }
] as const;
