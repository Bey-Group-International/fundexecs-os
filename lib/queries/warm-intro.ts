import 'server-only';
import { getPipelineData } from '@/lib/queries/pipeline';
import { getConnectionsData } from '@/lib/queries/connections';
import { findIntroPaths, type IntroPath } from '@/lib/intelligence/warm-intro';

/* ============================================================================
 * lib/queries/warm-intro.ts — the warmest path into each live deal.
 *
 * Fuses two RLS-scoped reads (the live pipeline + the relationship graph) with
 * no new schema: live deals become targets, relationships become candidate
 * connectors, and the Pathfinder routes each. Fail-soft to empty.
 * ========================================================================= */

const MAX = 8;

export async function getWarmIntroPaths(orgId: string): Promise<IntroPath[]> {
  try {
    const [pipeline, connections] = await Promise.all([
      getPipelineData(orgId),
      getConnectionsData(orgId)
    ]);

    const targets = pipeline.stages
      .flatMap((s) => s.deals)
      .filter((d) => d.status !== 'closed' && d.stage.toLowerCase() !== 'closed')
      .map((d) => ({ dealId: d.id, dealName: d.name, stage: d.stage }));

    const candidates = connections.rows.map((c) => ({
      id: c.id,
      fullName: c.full_name,
      company: c.company,
      title: c.title,
      strength: c.strength,
      interactionCount: c.interaction_count,
      lastInteractionAt: c.last_interaction_at,
      status: c.status
    }));

    return findIntroPaths(targets, candidates).slice(0, MAX);
  } catch {
    return [];
  }
}
