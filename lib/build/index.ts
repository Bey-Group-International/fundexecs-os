import 'server-only';
import type { DashboardData, DashboardAction } from '@/lib/queries/dashboard';
import type { LoopChain } from '@/lib/loop-chain';
import { scoreMetric, type HubHeadline, type HubPanel } from '@/lib/loop-hub';
import type { VerbPulse } from '@/lib/loop-pulse';
import { loadVerbHubCommon } from '@/lib/loop-hub.server';
import { buildRecordStrength, deriveBuildPanels, rankBuildFocus } from './workspace';

/* ============================================================================
 * lib/build/index.ts — the BUILD verb's domain module (IO composition).
 *
 * One aggregate loader for the `/build` hub, on the same base every verb hub
 * uses (`loadVerbHubCommon`). The pure derivations live in `./workspace`;
 * this maps them onto the shared hub vocabulary (`lib/loop-hub`) so all four
 * hubs render through one view.
 * ========================================================================= */

export interface BuildWorkspace {
  /** The four subsection summaries, in rail order (shared hub shape). */
  panels: HubPanel[];
  /** Headline 0–100 record strength (mean of panel scores). */
  headline: HubHeadline;
  /** The weakest panel — where work moves the record fastest. */
  focusKey: string | null;
  /** Capital locked behind the readiness gap (dollars). */
  lockedByReadiness: number;
  /** The loop chain — Build's place in Build → Source → Run → Drive. */
  /** The verb's recent outcomes from loop_events (null = calm zero-state). */
  pulse: VerbPulse | null;
  chain: LoopChain;
  /** Earn's single highest-leverage move right now. */
  nextBestAction: DashboardAction | null;
  /** The full dashboard payload, for rail signals on the hub page. */
  dashboard: DashboardData;
}

/** Load everything the `/build` hub renders, in one composed call. */
export async function loadBuildWorkspace(orgId: string): Promise<BuildWorkspace> {
  const { dashboard, chain, pulse } = await loadVerbHubCommon(orgId, 'build');

  const buildPanels = deriveBuildPanels({
    profileCompleteness: dashboard.fundProfile.completenessScore,
    profileGaps: dashboard.fundProfile.topGapLabels,
    loopProgress: dashboard.loopProgress,
    readinessScore: dashboard.readinessScore,
    lockedByReadiness: dashboard.valueAtStake.lockedByReadiness,
    executionScore: dashboard.executionScore.score
  });

  // Map the verb-specific panels onto the shared hub vocabulary.
  const panels: HubPanel[] = buildPanels.map((p) => ({
    key: p.key,
    label: p.label,
    href: p.href,
    metric: scoreMetric(p.metricLabel, p.score),
    tone: p.tone,
    hint: p.hint,
    gaps: p.gaps.length > 0 ? p.gaps : undefined
  }));

  return {
    panels,
    headline: {
      label: 'Record strength',
      metric: scoreMetric('Mean of the four panels', buildRecordStrength(buildPanels))
    },
    focusKey: rankBuildFocus(buildPanels)?.key ?? null,
    lockedByReadiness: dashboard.valueAtStake.lockedByReadiness,
    pulse,
    chain,
    nextBestAction: dashboard.nextBestAction,
    dashboard
  };
}
