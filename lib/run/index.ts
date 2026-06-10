import 'server-only';
import type { DashboardData, DashboardAction } from '@/lib/queries/dashboard';
import type { LoopChain } from '@/lib/loop-chain';
import type { HubHeadline, HubPanel } from '@/lib/loop-hub';
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
  chain: LoopChain;
  nextBestAction: DashboardAction | null;
  dashboard: DashboardData;
}

/** Load everything the `/run` hub renders, in one composed call. */
export async function loadRunWorkspace(orgId: string): Promise<RunWorkspace> {
  const { dashboard, chain } = await loadVerbHubCommon(orgId);

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
    chain,
    nextBestAction: dashboard.nextBestAction,
    dashboard
  };
}
