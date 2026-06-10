import 'server-only';
import type { DashboardData, DashboardAction } from '@/lib/queries/dashboard';
import type { LoopChain } from '@/lib/loop-chain';
import type { HubHeadline, HubPanel } from '@/lib/loop-hub';
import { loadVerbHubCommon } from '@/lib/loop-hub.server';
import { deriveSourcePanels, rankSourceFocus, sourceHeadline } from './workspace';

/**
 * lib/source/index.ts — the SOURCE verb's domain module (IO composition).
 *
 * One aggregate loader for the `/source` hub, on the same base every verb
 * hub uses (`loadVerbHubCommon`). The pure derivations live in `./workspace`.
 */

export interface SourceWorkspace {
  panels: HubPanel[];
  headline: HubHeadline;
  /** The panel needing the operator first (stale stake, else the LP gap). */
  focusKey: string | null;
  chain: LoopChain;
  nextBestAction: DashboardAction | null;
  dashboard: DashboardData;
}

/** Load everything the `/source` hub renders, in one composed call. */
export async function loadSourceWorkspace(orgId: string): Promise<SourceWorkspace> {
  const { dashboard, chain } = await loadVerbHubCommon(orgId);

  const inputs = {
    deals: dashboard.valueAtStake.deals,
    raiseGap: dashboard.valueAtStake.raiseGap,
    raise: {
      target: dashboard.raiseProgress.target,
      committed: dashboard.raiseProgress.committed,
      softCircled: dashboard.raiseProgress.softCircled,
      coveragePct: dashboard.raiseProgress.coveragePct
    }
  };
  const panels = deriveSourcePanels(inputs);

  return {
    panels,
    headline: sourceHeadline(inputs),
    focusKey: rankSourceFocus(panels, inputs),
    chain,
    nextBestAction: dashboard.nextBestAction,
    dashboard
  };
}
