import 'server-only';
import { cache } from 'react';
import { loadLifecycleContext } from '@/lib/queries/dashboard/lifecycle';
import { computeLifecycleStageResult, computeReadinessScore } from '@/lib/lifecycle';
import { centerHub, hubReadiness, type HubId } from './lifecycle';

/**
 * lib/hubs/index.ts — IO for the lifecycle rail.
 *
 * One request-cached load feeds the shell rail, the Command Center cockpit,
 * and whichever hub landing is rendering, so a single navigation derives the
 * four readiness percentages and the "NOW" hub exactly once — and they can
 * never disagree across surfaces. Built on `loadLifecycleContext` (the lean
 * dashboard-input loader), not the full `getDashboardData`, to keep the shell
 * cheap on every page.
 */

export interface LifecycleRail {
  /** 0–100 readiness per hub, from the real readiness breakdown. */
  pct: Record<HubId, number>;
  /** The operator's center-of-gravity hub right now (the rail's NOW marker). */
  center: HubId;
}

export const getLifecycleRail = cache(async (orgId: string): Promise<LifecycleRail> => {
  const { inputs } = await loadLifecycleContext(orgId);
  const readiness = computeReadinessScore(inputs);
  const stage = computeLifecycleStageResult(inputs);
  return {
    pct: hubReadiness(readiness.breakdown),
    center: centerHub(stage.stage)
  };
});
