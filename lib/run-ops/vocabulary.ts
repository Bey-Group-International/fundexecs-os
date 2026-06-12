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

/** The prototype's RUN_TONE over the canonical task statuses. */
export type TaskTone = 'warning' | 'azure' | 'success';
export const TASK_TONE: Record<TaskStatus, TaskTone> = {
  todo: 'warning',
  doing: 'azure',
  done: 'success'
};

/** The board's three columns, in order, with their eyebrow labels. */
export const WF_COLUMNS: readonly { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'To do' },
  { status: 'doing', label: 'In progress' },
  { status: 'done', label: 'Done' }
] as const;

export interface BaselineTask {
  name: string;
  /** Specialist first name from the team roster. */
  who: string;
  /** Why the step matters — the card's drives line. */
  drives: string;
  /** The next concrete action, phrased for the approve loop. */
  action: string;
  critical: boolean;
  /** Subtask checklist — seeded unchecked; nothing is pretend-done. */
  sub: readonly string[];
}

export interface BaselineWorkflow {
  stream: string;
  name: string;
  tasks: readonly BaselineTask[];
}

/** Sterling's standard launch plan — seeded once, then worked for real. */
export const WORKFLOW_BASELINE: readonly BaselineWorkflow[] = [
  {
    stream: 'Launch',
    name: 'Stand up the fund',
    tasks: [
      {
        name: 'Finalize the fund story',
        who: 'Sienna',
        drives: 'Anchors every LP conversation',
        action: 'Lock the narrative',
        critical: true,
        sub: ['Thesis one-liner', 'Track-record summary', 'Edge & market view']
      },
      {
        name: 'Complete formation filings',
        who: 'Adrian',
        drives: 'Makes the fund legally real',
        action: 'File the documents',
        critical: true,
        sub: ['Entity filings', 'EIN & bank accounts', 'LPA executed']
      },
      {
        name: 'Adopt the governance baseline',
        who: 'Adrian',
        drives: 'Keeps every decision defensible',
        action: 'Adopt the policies',
        critical: false,
        sub: ['Policy set adopted', 'IC charter', 'Signing authority']
      },
      {
        name: 'Publish the data room',
        who: 'Eleanor',
        drives: 'Lets LPs diligence you self-serve',
        action: 'Publish the room',
        critical: false,
        sub: ['Core documents staged', 'Access controls set', 'Share links minted']
      }
    ]
  },
  {
    stream: 'Raise',
    name: 'Open the raise',
    tasks: [
      {
        name: 'Rank the LP target list',
        who: 'Sloane',
        drives: 'Focuses outreach on real fits',
        action: 'Rank the targets',
        critical: true,
        sub: ['Fit-score the capital map', 'Pick the first twenty']
      },
      {
        name: 'Send the first outreach wave',
        who: 'Sloane',
        drives: 'Starts the raise clock',
        action: 'Draft the wave',
        critical: true,
        sub: ['Personalized intros', 'One-pager attached']
      },
      {
        name: 'Run the follow-up cadence',
        who: 'Sloane',
        drives: 'Keeps warm leads moving',
        action: 'Queue the follow-ups',
        critical: false,
        sub: ['Seven-day touches', 'Meeting asks']
      },
      {
        name: 'Lock the first soft-circles',
        who: 'Priya',
        drives: 'Converts interest into commitments',
        action: 'Confirm the circles',
        critical: true,
        sub: ['Verbal confirms', 'Allocation notes']
      }
    ]
  },
  {
    stream: 'Deploy',
    name: 'Build the pipeline',
    tasks: [
      {
        name: 'Define the sourcing thesis',
        who: 'Marcus',
        drives: 'Filters the funnel before it fills',
        action: 'Write the thesis',
        critical: false,
        sub: ['Sectors & stages', 'Disqualifiers']
      },
      {
        name: 'Qualify the first inbound set',
        who: 'Marcus',
        drives: 'Surfaces the deals worth your time',
        action: 'Score the inbound',
        critical: false,
        sub: ['First-pass screens', 'Fit notes']
      },
      {
        name: 'Open diligence on the lead deal',
        who: 'Theodore',
        drives: 'Moves the best deal toward IC',
        action: 'Open the desk',
        critical: true,
        sub: ['Diligence desk opened', 'Document requests out']
      }
    ]
  }
] as const;

/** Stream posture: completion + how many critical steps still block. */
export function workflowPosture(tasks: readonly { status: string; critical?: boolean | null }[]): {
  total: number;
  done: number;
  open: number;
  critOpen: number;
  pct: number;
} {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const critOpen = tasks.filter((t) => Boolean(t.critical) && t.status !== 'done').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return { total, done, open: total - done, critOpen, pct };
}

/** Stream chip icons, keyed off the stream's name (prototype's WF_STREAMS). */
export type StreamIconKey =
  | 'rocket'
  | 'landmark'
  | 'briefcase'
  | 'user-plus'
  | 'calendar-clock'
  | 'list-checks';

export function streamIconKey(stream: string): StreamIconKey {
  const s = stream.toLowerCase();
  if (s.includes('launch') || s.includes('formation')) return 'rocket';
  if (s.includes('raise') || s.includes('fund') || s.includes('capital')) return 'landmark';
  if (s.includes('deploy') || s.includes('pipeline') || s.includes('deal')) return 'briefcase';
  if (s.includes('onboard')) return 'user-plus';
  if (s.includes('report') || s.includes('quarter')) return 'calendar-clock';
  return 'list-checks';
}

/* — Earn's automations strip — */

export interface WorkflowAutomation {
  /** Persisted as automations.on_event, org-scoped. */
  key: string;
  name: string;
  /** The claimed outcome — badged Illustrative until a real engine runs it. */
  desc: string;
  icon: 'mail' | 'shield-check' | 'radar' | 'banknote';
}

/** The prototype's AUTOMATIONS catalog. Off until the operator turns one on. */
export const WF_AUTOMATIONS: readonly WorkflowAutomation[] = [
  {
    key: 'lp_digest',
    name: 'Weekly LP digest',
    desc: 'Auto-drafts your investor update every Friday',
    icon: 'mail'
  },
  {
    key: 'compliance_watch',
    name: 'Compliance monitoring',
    desc: 'Watches filings, deadlines & attestations',
    icon: 'shield-check'
  },
  {
    key: 'pipeline_refresh',
    name: 'Pipeline refresh',
    desc: 'Re-scores deals & LPs nightly',
    icon: 'radar'
  },
  {
    key: 'cash_calls',
    name: 'Cash & capital calls',
    desc: 'Flags when a call or distribution is due',
    icon: 'banknote'
  }
] as const;

export function isAutomationKey(key: string): boolean {
  return WF_AUTOMATIONS.some((a) => a.key === key);
}

/** Honest status line for an automation card — no fake run history. */
export function automationStatusLabel(
  enabled: boolean,
  lastRunAt: string | null,
  now: number = Date.now()
): string {
  if (!enabled) return 'Paused';
  if (!lastRunAt) return 'On';
  const ms = now - new Date(lastRunAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'On';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'Ran just now';
  if (hours < 24) return `Ran ${hours}h ago`;
  return `Ran ${Math.floor(hours / 24)}d ago`;
}

/* — the prototype's runItem choreography, as pure copy builders — */

export function taskRunSteps(who: string | null, act: string): string[] {
  return [
    who ? `Pull context with ${who}` : "Pull the step's context",
    act,
    'Update the record',
    'Prepare for your approval'
  ];
}

export function taskRunDraft(input: {
  name: string;
  who: string | null;
  drives: string | null;
  act: string;
  toLabel: string;
}): string {
  const lead = input.who
    ? `${input.who} prepared "${input.act}" for ${input.name}.`
    : `"${input.act}" is prepared for ${input.name}.`;
  const why = input.drives
    ? ` This ${input.drives.charAt(0).toLowerCase()}${input.drives.slice(1).replace(/\.$/, '')}.`
    : '';
  return `${lead}${why} Approve to move it to ${input.toLabel} — nothing changes until you confirm.`;
}

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
