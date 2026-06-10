import 'server-only';
import { getDashboardData, type DashboardData, type DashboardAction } from '@/lib/queries/dashboard';
import { buildLoopChain, type LoopChain } from '@/lib/loop-chain';
import {
  buildRecordStrength,
  deriveBuildPanels,
  rankBuildFocus,
  type BuildPanel
} from './workspace';

/* ============================================================================
 * lib/build/index.ts — the BUILD verb's domain module (IO composition).
 *
 * One aggregate loader for the `/build` hub: it composes the shared dashboard
 * loader (already the single source for stage, readiness, trust, and profile
 * signals) into the verb-level payload the hub renders — panels, record
 * strength, focus, the loop chain, and the next best action. The pure
 * derivations live in `./workspace` so they stay testable without IO.
 *
 * No new queries: `getDashboardData` is request-cached by Next, so pages that
 * also build rail signals from it pay for the load once.
 * ========================================================================= */

export interface BuildWorkspace {
  /** The four subsection summaries, in rail order. */
  panels: BuildPanel[];
  /** Headline 0–100 record strength (mean of panel scores). */
  recordStrength: number;
  /** The weakest panel — where work moves the record fastest. */
  focus: BuildPanel | null;
  /** The loop chain — Build's place in Build → Source → Run → Drive. */
  chain: LoopChain;
  /** Earn's single highest-leverage move right now. */
  nextBestAction: DashboardAction | null;
  /** Capital locked behind the readiness gap (dollars). */
  lockedByReadiness: number;
  /** The full dashboard payload, for rail signals on the hub page. */
  dashboard: DashboardData;
}

/** Load everything the `/build` hub renders, in one composed call. */
export async function loadBuildWorkspace(orgId: string): Promise<BuildWorkspace> {
  const dashboard = await getDashboardData(orgId);

  const panels = deriveBuildPanels({
    profileCompleteness: dashboard.fundProfile.completenessScore,
    profileGaps: dashboard.fundProfile.topGapLabels,
    loopProgress: dashboard.loopProgress,
    readinessScore: dashboard.readinessScore,
    lockedByReadiness: dashboard.valueAtStake.lockedByReadiness,
    executionScore: dashboard.executionScore.score
  });

  const chain = buildLoopChain({
    stage: dashboard.stage,
    dailyDone: dashboard.executionScore.dailyDone,
    dailyTotal: dashboard.executionScore.dailyTotal,
    committed: dashboard.raiseProgress.committed,
    readinessScore: dashboard.readinessScore
  });

  return {
    panels,
    recordStrength: buildRecordStrength(panels),
    focus: rankBuildFocus(panels),
    chain,
    nextBestAction: dashboard.nextBestAction,
    lockedByReadiness: dashboard.valueAtStake.lockedByReadiness,
    dashboard
  };
}
