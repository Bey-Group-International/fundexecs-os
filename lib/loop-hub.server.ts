import 'server-only';
import { getDashboardData, type DashboardData } from '@/lib/queries/dashboard';
import { buildLoopChain, type LoopChain } from '@/lib/loop-chain';

/**
 * lib/loop-hub.server.ts — the verb hubs' shared IO composition.
 *
 * Every hub loader needs the same two things: the lifecycle-aware dashboard
 * payload (the single source for stage, readiness, stakes, and actions) and
 * the loop chain derived from it. Composing them once here means the four
 * hubs, the rail badges, and the Command Center can never disagree — and a
 * page that loads a hub plus rail signals still pays for `getDashboardData`
 * only once (it's request-cached by Next).
 */

export interface VerbHubCommon {
  dashboard: DashboardData;
  chain: LoopChain;
}

/** Load the dashboard + derive the chain — the base of every hub loader. */
export async function loadVerbHubCommon(orgId: string): Promise<VerbHubCommon> {
  const dashboard = await getDashboardData(orgId);
  const chain = buildLoopChain({
    stage: dashboard.stage,
    dailyDone: dashboard.executionScore.dailyDone,
    dailyTotal: dashboard.executionScore.dailyTotal,
    committed: dashboard.raiseProgress.committed,
    readinessScore: dashboard.readinessScore
  });
  return { dashboard, chain };
}
