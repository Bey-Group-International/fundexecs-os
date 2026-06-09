import { TEAM_ROSTER } from './roster';

/* ============================================================================
 * lib/team/capabilities.ts — what each specialist proposes to do when an
 * operator "runs" a task. Phase 2 is a gated scaffold: a run is a *proposal*
 * the operator approves or rejects on a confirm card. The plan is derived
 * deterministically from this catalog (no model call, no external side
 * effects). LLM-drafted, tool-backed proposals are a later phase; this is the
 * stable surface they will replace.
 * ========================================================================= */

export interface AgentCapability {
  /** Short imperative summary of the run, e.g. "Draft qualified outreach". */
  action: string;
  /**
   * The ordered steps the specialist proposes to take. `{task}` is replaced
   * with the task title so the plan reads as scoped to the work at hand.
   */
  steps: readonly string[];
}

/**
 * Slug → capability. Every roster slug has an entry; the generic fallback is
 * only a defensive net. Steps are written in the team voice and intentionally
 * describe *preparatory, reviewable* work — nothing here sends or commits
 * anything on its own.
 */
export const AGENT_CAPABILITIES: Record<string, AgentCapability> = {
  'earnest-fundmaker': {
    action: 'Coordinate the desk',
    steps: [
      'Frame "{task}" and pick the right specialist',
      'Draft the brief and sequence the work',
      'Surface the plan for your sign-off'
    ]
  },
  'master-workflow': {
    action: 'Sequence the work',
    steps: [
      'Break "{task}" into ordered steps',
      'Assign owners and dependencies across the desk',
      'Stage the runbook for your review'
    ]
  },
  automater: {
    action: 'Structure the inputs',
    steps: [
      'Pull and reconcile the data behind "{task}"',
      'Normalize it into a decision-ready record',
      'Flag gaps and anomalies for review'
    ]
  },
  'executive-advisor': {
    action: 'Pressure-test the call',
    steps: [
      'Frame the trade-offs in "{task}"',
      'Ground the options in the institutional playbook',
      'Draft a recommendation for your decision'
    ]
  },
  rainmaker: {
    action: 'Draft qualified outreach',
    steps: [
      'Pull on-thesis prospects for "{task}"',
      'Draft tailored outreach for the top targets',
      'Queue the sequence for your approval'
    ]
  },
  'deal-sourcer': {
    action: 'Surface on-thesis deals',
    steps: [
      'Scan the market against "{task}"',
      'Score candidates to your mandate',
      'Stage a shortlist for your review'
    ]
  },
  'capital-connector': {
    action: 'Map capital to the deal',
    steps: [
      'Match LPs and co-investors to "{task}"',
      'Rank fits by suitability and history',
      'Draft the intro plan for your sign-off'
    ]
  },
  'legal-admin': {
    action: 'Review structure and risk',
    steps: [
      'Review terms and structure in "{task}"',
      'Flag compliance and downside risk',
      'Draft a redline for your review'
    ]
  },
  'pr-director': {
    action: 'Shape the narrative',
    steps: [
      'Frame the message and positioning for "{task}"',
      'Draft on-brand copy and talking points',
      'Stage the narrative for your approval'
    ]
  },
  'seo-disruptor': {
    action: 'Build organic visibility',
    steps: [
      'Map target keywords for "{task}"',
      'Draft the content and on-page plan',
      'Queue the brief for your review'
    ]
  },
  'lead-generator': {
    action: 'Fill the top of funnel',
    steps: [
      'Identify and warm prospects for "{task}"',
      'Qualify against your ICP',
      'Stage the list for your approval'
    ]
  },
  'event-curator': {
    action: 'Curate the room',
    steps: [
      'Frame the guest list for "{task}"',
      'Draft the format and outreach',
      'Stage the plan for your review'
    ]
  },
  'investor-relations': {
    action: 'Prepare the LP update',
    steps: [
      'Assemble the reporting behind "{task}"',
      'Draft a clear, on-message update',
      'Stage it for your approval'
    ]
  },
  'capital-raiser': {
    action: 'Run the raise step',
    steps: [
      'Build the target list for "{task}"',
      'Draft outreach and the data-room plan',
      'Stage the next move for your sign-off'
    ]
  },
  'workflow-instructor': {
    action: 'Build the playbook',
    steps: [
      'Map the workflow for "{task}"',
      'Draft the enablement and onboarding steps',
      'Stage the playbook for your review'
    ]
  }
};

const GENERIC: AgentCapability = {
  action: 'Prepare the work',
  steps: ['Plan "{task}"', 'Draft the deliverable', 'Stage it for your review']
};

const VALID_SLUGS = new Set(TEAM_ROSTER.map((m) => m.slug));

export interface TaskProposal {
  action: string;
  steps: string[];
}

/** Build a confirm-card proposal for a specialist + task title. Deterministic. */
export function proposalForTask(slug: string, taskTitle: string): TaskProposal {
  const cap = (VALID_SLUGS.has(slug) && AGENT_CAPABILITIES[slug]) || GENERIC;
  const title = taskTitle.trim() || 'this task';
  return {
    action: cap.action,
    steps: cap.steps.map((s) => s.replace('{task}', title))
  };
}
