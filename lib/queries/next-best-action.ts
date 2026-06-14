import 'server-only';
import { getPendingRuns } from '@/lib/queries/action-queue';
import { getReconnectList } from '@/lib/queries/reconnect';
import { getPipelineConviction } from '@/lib/queries/conviction';
import { getPipelineVelocity } from '@/lib/queries/velocity';
import {
  approvalPriority,
  convictionPriority,
  rankNextActions,
  reconnectPriority,
  velocityPriority,
  type NextAction
} from '@/lib/intelligence/next-best-action';

/* ============================================================================
 * lib/queries/next-best-action.ts — the operator's single ranked worklist.
 *
 * Fuses four key-free OS systems (Action Queue approvals, pipeline velocity,
 * relationship reconnect, deal conviction) into one ranked "do this next" list.
 * Reuses each system's RLS-scoped query — no new schema. Fail-soft to empty.
 * ========================================================================= */

const MAX = 8;

export async function getNextBestActions(orgId: string): Promise<NextAction[]> {
  try {
    const [pending, reconnect, conviction, velocity] = await Promise.all([
      getPendingRuns(orgId).catch(() => []),
      getReconnectList(orgId).catch(() => ({ items: [], overdueCount: 0, dueSoonCount: 0 })),
      getPipelineConviction(orgId).catch(() => ({
        results: [],
        distribution: { High: 0, Building: 0, Early: 0, Cold: 0 },
        average: 0
      })),
      getPipelineVelocity(orgId).catch(() => ({ items: [], stuckCount: 0, slowingCount: 0 }))
    ]);

    const candidates: NextAction[] = [];

    for (const run of pending) {
      candidates.push({
        id: `approval-${run.runId}`,
        kind: 'approval',
        title: `Approve: ${run.taskTitle}`,
        detail: `${run.agentName} — ${run.action}`,
        priority: approvalPriority(),
        href: '/action-queue'
      });
    }

    for (const v of velocity.items) {
      if (v.band === 'Moving') continue;
      candidates.push({
        id: `velocity-${v.dealId}`,
        kind: 'velocity',
        title: `Unstick: ${v.dealName}`,
        detail: v.reason,
        priority: velocityPriority(v.band),
        href: '/source/pipeline'
      });
    }

    for (const r of reconnect.items) {
      candidates.push({
        id: `reconnect-${r.id}`,
        kind: 'reconnect',
        title: `Reconnect: ${r.fullName}`,
        detail: r.reason,
        priority: reconnectPriority(r.priority),
        href: '/run/ir'
      });
    }

    // Only deals that actually need lifting (Early / Cold) become candidates.
    for (const c of conviction.results) {
      if (c.band !== 'Early' && c.band !== 'Cold') continue;
      candidates.push({
        id: `conviction-${c.dealId}`,
        kind: 'conviction',
        title: `Advance: ${c.dealName}`,
        detail: c.topLever,
        priority: convictionPriority(c.score),
        href: '/source/pipeline'
      });
    }

    return rankNextActions(candidates, MAX);
  } catch {
    return [];
  }
}
