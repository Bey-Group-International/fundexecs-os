import 'server-only';
import type { DashboardData, DashboardAction } from '@/lib/queries/dashboard';
import type { LoopChain } from '@/lib/loop-chain';
import type { HubHeadline, HubPanel } from '@/lib/loop-hub';
import type { VerbPulse } from '@/lib/loop-pulse';
import { loadVerbHubCommon } from '@/lib/loop-hub.server';
import { deriveDrivePanels, driveHeadline, rankDriveFocus } from './workspace';

/**
 * lib/drive/index.ts — the DRIVE verb's domain module (IO composition).
 *
 * One aggregate loader for the `/drive` hub, on the same base every verb hub
 * uses (`loadVerbHubCommon`). The pure derivations live in `./workspace`.
 */

export interface DriveWorkspace {
  panels: HubPanel[];
  headline: HubHeadline;
  /** The panel needing the operator first (slipping close, else materials). */
  focusKey: string | null;
  /** The verb's recent outcomes from loop_events (null = calm zero-state). */
  pulse: VerbPulse | null;
  chain: LoopChain;
  nextBestAction: DashboardAction | null;
  dashboard: DashboardData;
}

/** Load everything the `/drive` hub renders, in one composed call. */
export async function loadDriveWorkspace(orgId: string): Promise<DriveWorkspace> {
  const { dashboard, chain, pulse } = await loadVerbHubCommon(orgId, 'drive');

  const inputs = {
    nearClose: dashboard.valueAtStake.nearClose,
    committed: dashboard.valueAtStake.committed,
    materialsScore:
      dashboard.readinessBreakdown.find((d) => d.dimension === 'materials')?.score ?? 0,
    committedPct: dashboard.raiseProgress.committedPct
  };
  const panels = deriveDrivePanels(inputs);

  return {
    panels,
    headline: driveHeadline(inputs),
    focusKey: rankDriveFocus(panels, inputs),
    pulse,
    chain,
    nextBestAction: dashboard.nextBestAction,
    dashboard
  };
}
