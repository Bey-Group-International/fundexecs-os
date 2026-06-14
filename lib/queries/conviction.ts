import 'server-only';
import { getPipelineData } from '@/lib/queries/pipeline';
import {
  computeConviction,
  convictionDistribution,
  type ConvictionBand,
  type ConvictionResult
} from '@/lib/intelligence/conviction';

/* ============================================================================
 * lib/queries/conviction.ts — score the live pipeline with the Deal Conviction
 * Index. Reuses `getPipelineData` (RLS-scoped) so there is no extra schema
 * surface; every open deal is run through the pure scorer and ranked. Fail-soft
 * to an empty result.
 * ========================================================================= */

export interface PipelineConviction {
  results: ConvictionResult[];
  distribution: Record<ConvictionBand, number>;
  /** Mean score across scored deals (0 when none). */
  average: number;
}

const EMPTY: PipelineConviction = {
  results: [],
  distribution: { High: 0, Building: 0, Early: 0, Cold: 0 },
  average: 0
};

export async function getPipelineConviction(orgId: string): Promise<PipelineConviction> {
  try {
    const data = await getPipelineData(orgId);
    const now = Date.now();

    const results = data.stages
      .flatMap((s) => s.deals)
      // 'closed' deals are done — the index is about live conviction.
      .filter((d) => d.status !== 'closed' && d.stage.toLowerCase() !== 'closed')
      .map((d) =>
        computeConviction(
          {
            id: d.id,
            name: d.name,
            stage: d.stage,
            amount: d.amount,
            allocations: d.allocations.map((a) => ({ amount: a.amount, status: a.status })),
            diligenceRuns: d.diligenceRuns.map((r) => ({
              status: r.status,
              conviction: r.conviction
            })),
            updatedAt: d.updatedAt
          },
          now
        )
      )
      .sort((a, b) => b.score - a.score);

    const average = results.length
      ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length)
      : 0;

    return { results, distribution: convictionDistribution(results), average };
  } catch {
    return EMPTY;
  }
}
