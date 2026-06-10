import {
  moneyMetric,
  rankStakeFocus,
  scoreMetric,
  scoreTone,
  type HubHeadline,
  type HubPanel,
  type HubTone
} from '@/lib/loop-hub';
// Commitment helpers live in the meeting-copilot utils — a pure, dependency-free
// module safe to import from this client-reachable workspace. Single source of
// truth so the panel tone can't drift from the orchestrator's scoring.
import { clampCommitment, commitmentTone } from '@/lib/meeting-copilot/utils';

/**
 * lib/run/workspace.ts — the RUN verb's hub model (pure).
 *
 * Run is the analysis that decides. Its panels mirror the rail cluster:
 * Diligence (capital awaiting a decision, in dollars), the two AI-first
 * actions (Stress Test, Aggregation Strategy — click-to-Earn, no surface
 * yet), the Action Plan (today's operating loop as a 0–100 completion),
 * and the Meeting Copilot (latest commitment-probability from meeting analysis).
 * The headline is the capital waiting on a decision — Run's whole job.
 *
 * The Earn prompts are canonical here and imported by the rail
 * (components/shell/rail-nav.ts), so both surfaces seed the same action.
 */

/** Canonical prompts for Run's AI-first actions (rail + hub share these). */
export const RUN_EARN_PROMPTS = {
  stressTest:
    'Run a stress test on my current deals and raise — model downside scenarios and tell me where it breaks.',
  aggregation:
    'Propose an aggregation strategy across my deals — where are the synergies, and how do they compound?'
} as const;

export interface RunStake {
  amount: number;
  count: number;
  staleCount: number;
  tone: 'azure' | 'warning' | 'danger';
}

export interface RunWorkspaceInputs {
  /** Capital in deals awaiting a diligence decision. */
  diligence: RunStake;
  /** Completed daily-command check-offs today. */
  dailyDone: number;
  /** Total daily-command items today. */
  dailyTotal: number;
  /**
   * Latest meeting_runs commitment_probability (0–100), or null when no run
   * exists yet. Drives the Meeting Copilot panel tone and metric.
   */
  latestCommitmentProbability?: number | null;
}

/** 0–100 completion of today's action plan (0 when nothing is queued). */
export function dailyCompletion(done: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const safeDone = Number.isFinite(done) && done > 0 ? done : 0;
  return Math.max(0, Math.min(100, Math.round((safeDone / total) * 100)));
}

/**
 * Derive the Meeting Copilot panel tone and metric label from the latest
 * commitment-probability score. Returns a neutral "no runs yet" state when
 * no score is available.
 */
function meetingCopilotPanel(latestCommitmentProbability: number | null | undefined): {
  metric: HubPanel['metric'];
  tone: HubTone;
  hint: string;
} {
  const raw = latestCommitmentProbability ?? null;
  const clamped = clampCommitment(raw);
  if (clamped === null) {
    return {
      metric: null,
      tone: 'neutral',
      hint: 'Meeting analysis — run the copilot on your next transcript.'
    };
  }
  const tone: HubTone = commitmentTone(clamped);
  const label =
    tone === 'danger'
      ? 'Cold — low commitment signal'
      : tone === 'success'
        ? 'Hot — strong commitment signal'
        : 'Warm — commitment building';
  return {
    metric: scoreMetric(label, clamped),
    tone,
    hint:
      tone === 'danger'
        ? 'Meeting Copilot — latest meeting ran cold. Revisit objections and follow up.'
        : tone === 'success'
          ? 'Meeting Copilot — strong commitment signal. Move to close.'
          : 'Meeting Copilot — momentum building. Address open items to advance.'
  };
}

/** Derive the five Run panels, in rail order. */
export function deriveRunPanels(inputs: RunWorkspaceInputs): HubPanel[] {
  const completion = dailyCompletion(inputs.dailyDone, inputs.dailyTotal);
  const copilot = meetingCopilotPanel(inputs.latestCommitmentProbability);
  return [
    {
      key: 'diligence',
      label: 'Diligence',
      href: '/ic-memos',
      metric: moneyMetric('Awaiting a decision', inputs.diligence.amount, inputs.diligence.count),
      tone: inputs.diligence.tone,
      hint:
        inputs.diligence.staleCount > 0
          ? `Memos & decisions — ${inputs.diligence.staleCount} gone quiet in diligence.`
          : 'Memos & decisions — clear the queue, arm Drive.'
    },
    {
      key: 'stress-test',
      label: 'Stress Test',
      earnPrompt: RUN_EARN_PROMPTS.stressTest,
      metric: null,
      tone: 'neutral',
      hint: 'Scenario & downside analysis — one tap, Earn runs it.'
    },
    {
      key: 'action-plan',
      label: 'Action Plan',
      href: '/governance',
      metric: scoreMetric("Today's actions", completion),
      tone: scoreTone(completion),
      hint: 'Governance logic & next moves — the daily operating loop.'
    },
    {
      key: 'aggregation',
      label: 'Aggregation Strategy',
      earnPrompt: RUN_EARN_PROMPTS.aggregation,
      metric: null,
      tone: 'neutral',
      hint: 'Synergistic roll-up logic — where the deals compound.'
    },
    {
      key: 'meeting-copilot',
      label: 'Meeting Copilot',
      href: '/meetings',
      metric: copilot.metric,
      tone: copilot.tone,
      hint: copilot.hint
    }
  ];
}

/** The hub headline: the capital sitting on Run's desk. */
export function runHeadline(inputs: RunWorkspaceInputs): HubHeadline {
  return {
    label: 'Awaiting a decision',
    metric: moneyMetric('In diligence', inputs.diligence.amount, inputs.diligence.count)
  };
}

/**
 * Focus: staleness first, else the action plan while today's loop is
 * unfinished — steady check-offs are what charge the chain's handoff.
 */
export function rankRunFocus(
  panels: readonly HubPanel[],
  inputs: RunWorkspaceInputs
): string | null {
  const stale = rankStakeFocus(panels);
  if (stale) return stale;
  if (inputs.dailyTotal > 0 && inputs.dailyDone < inputs.dailyTotal) return 'action-plan';
  return null;
}
