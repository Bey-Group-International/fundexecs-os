import 'server-only';
import { getPipelineData } from '@/lib/queries/pipeline';
import { computeConversion, type ConversionAnalytics } from '@/lib/intelligence/conversion';

/* ============================================================================
 * lib/queries/conversion.ts — pipeline funnel & conversion read.
 *
 * Reuses the RLS-scoped `getPipelineData` (no new schema): the canonical stages
 * and their current deal counts feed the funnel. Fail-soft to a safe zero state.
 * ========================================================================= */

const EMPTY: ConversionAnalytics = {
  stages: [],
  totalDeals: 0,
  overallConversionPct: 0,
  biggestLeak: null,
  headline: 'No deals in the funnel yet'
};

export async function getPipelineConversion(orgId: string): Promise<ConversionAnalytics> {
  try {
    const data = await getPipelineData(orgId);
    const stages = data.stages.map((s) => ({
      key: s.key,
      label: s.label,
      count: s.deals.length
    }));
    return computeConversion(stages);
  } catch {
    return EMPTY;
  }
}
