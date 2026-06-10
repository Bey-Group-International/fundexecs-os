import 'server-only';
import type { DashboardData, DashboardAction } from '@/lib/queries/dashboard';
import type { LoopChain } from '@/lib/loop-chain';
import type { HubHeadline, HubPanel } from '@/lib/loop-hub';
import type { VerbPulse } from '@/lib/loop-pulse';
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
  /** The verb's recent outcomes from loop_events (null = calm zero-state). */
  pulse: VerbPulse | null;
  chain: LoopChain;
  nextBestAction: DashboardAction | null;
  dashboard: DashboardData;
}

/** Load everything the `/source` hub renders, in one composed call. */
export async function loadSourceWorkspace(orgId: string): Promise<SourceWorkspace> {
  const { dashboard, chain, pulse } = await loadVerbHubCommon(orgId, 'source');

  const inputs = {
    deals: dashboard.valueAtStake.deals,
    raiseGap: dashboard.valueAtStake.raiseGap,
    raise: {
      target: dashboard.raiseProgress.target,
      committed: dashboard.raiseProgress.committed,
      softCircled: dashboard.raiseProgress.softCircled,
      coveragePct: dashboard.raiseProgress.coveragePct
    },
    // Target Scout panel: no pipeline table this increment — calm null state
    // until a scout session runs (count is carried client-side for now).
    targets: null
  };
  const panels = deriveSourcePanels(inputs);

  return {
    panels,
    headline: sourceHeadline(inputs),
    focusKey: rankSourceFocus(panels, inputs),
    pulse,
    chain,
    nextBestAction: dashboard.nextBestAction,
    dashboard
  };
}
