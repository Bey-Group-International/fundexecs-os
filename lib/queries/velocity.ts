import 'server-only';
import { getPipelineData } from '@/lib/queries/pipeline';
import { rankVelocity, type VelocityResult } from '@/lib/intelligence/velocity';

/* ============================================================================
 * lib/queries/velocity.ts — surface the deals that have stalled in stage.
 *
 * Reuses the RLS-scoped `getPipelineData` (no new schema), runs every live deal
 * through the velocity detector, and returns the stalled set with stuck /
 * slowing counts. Fail-soft to empty.
 * ========================================================================= */

export interface PipelineVelocity {
  items: VelocityResult[];
  stuckCount: number;
  slowingCount: number;
}

const EMPTY: PipelineVelocity = { items: [], stuckCount: 0, slowingCount: 0 };

const MAX_ITEMS = 8;

export async function getPipelineVelocity(orgId: string): Promise<PipelineVelocity> {
  try {
    const data = await getPipelineData(orgId);
    const deals = data.stages.flatMap((s) => s.deals);

    const ranked = rankVelocity(
      deals.map((deal) => ({
        id: deal.id,
        name: deal.name,
        stage: deal.stage,
        status: deal.status,
        events: deal.events.map((e) => ({ type: e.type, createdAt: e.createdAt })),
        updatedAt: deal.updatedAt
      }))
    );

    return {
      items: ranked.slice(0, MAX_ITEMS),
      stuckCount: ranked.filter((r) => r.band === 'Stuck').length,
      slowingCount: ranked.filter((r) => r.band === 'Slowing').length
    };
  } catch {
    return EMPTY;
  }
}
