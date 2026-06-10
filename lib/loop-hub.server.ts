import 'server-only';
import { getDashboardData, type DashboardData } from '@/lib/queries/dashboard';
import { buildLoopChain, type LoopChain, type LoopVerb } from '@/lib/loop-chain';
import { deriveVerbPulse, type VerbPulse } from '@/lib/loop-pulse';
import { getLoopEventRows } from '@/lib/queries/loop-pulse';

/**
 * lib/loop-hub.server.ts — the verb hubs' shared IO composition.
 *
 * Every hub loader needs the same three things: the lifecycle-aware dashboard
 * payload (the single source for stage, readiness, stakes, and actions), the
 * loop chain derived from it, and the verb's recent-outcome pulse from the
 * loop_events stream. Composing them once here means the four hubs, the rail
 * badges, and the Command Center can never disagree — and a page that loads a
 * hub plus rail signals still pays for `getDashboardData` only once (it's
 * request-cached by Next). The pulse read is best-effort: an empty stream
 * derives a calm null, never a broken hub.
 */

export interface VerbHubCommon {
  dashboard: DashboardData;
  chain: LoopChain;
  /** The verb's recent outcomes from loop_events (null = calm zero-state). */
  pulse: VerbPulse | null;
}

/** Load the dashboard + chain + the verb's pulse — the base of every hub loader. */
export async function loadVerbHubCommon(orgId: string, verb: LoopVerb): Promise<VerbHubCommon> {
  const [dashboard, eventRows] = await Promise.all([
    getDashboardData(orgId),
    getLoopEventRows(orgId)
  ]);
  const chain = buildLoopChain({
    stage: dashboard.stage,
    dailyDone: dashboard.executionScore.dailyDone,
    dailyTotal: dashboard.executionScore.dailyTotal,
    committed: dashboard.raiseProgress.committed,
    readinessScore: dashboard.readinessScore
  });
  return { dashboard, chain, pulse: deriveVerbPulse(verb, eventRows) };
}
