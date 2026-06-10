import 'server-only';
import type { DashboardData, DashboardAction } from '@/lib/queries/dashboard';
import type { LoopChain } from '@/lib/loop-chain';
import type { HubHeadline, HubPanel } from '@/lib/loop-hub';
import type { VerbPulse } from '@/lib/loop-pulse';
import { loadVerbHubCommon } from '@/lib/loop-hub.server';
import { deriveRunPanels, rankRunFocus, runHeadline } from './workspace';

/**
 * lib/run/index.ts — the RUN verb's domain module (IO composition).
 *
 * One aggregate loader for the `/run` hub, on the same base every verb hub
 * uses (`loadVerbHubCommon`). The pure derivations live in `./workspace`.
 */

export interface RunWorkspace {
  panels: HubPanel[];
  headline: HubHeadline;
  /** The panel needing the operator first (stale stake, else today's plan). */
  focusKey: string | null;
  /** The verb's recent outcomes from loop_events (null = calm zero-state). */
  pulse: VerbPulse | null;
  chain: LoopChain;
  nextBestAction: DashboardAction | null;
  dashboard: DashboardData;
}

/** Load everything the `/run` hub renders, in one composed call. */
export async function loadRunWorkspace(orgId: string): Promise<RunWorkspace> {
  const { dashboard, chain, pulse } = await loadVerbHubCommon(orgId, 'run');

  const inputs = {
    diligence: dashboard.valueAtStake.diligence,
    dailyDone: dashboard.executionScore.dailyDone,
    dailyTotal: dashboard.executionScore.dailyTotal
  };
  const panels = deriveRunPanels(inputs);

  return {
    panels,
    headline: runHeadline(inputs),
    focusKey: rankRunFocus(panels, inputs),
    pulse,
    chain,
    nextBestAction: dashboard.nextBestAction,
    dashboard
  };
}
