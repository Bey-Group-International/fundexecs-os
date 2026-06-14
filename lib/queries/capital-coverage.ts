import 'server-only';
import { getPipelineData } from '@/lib/queries/pipeline';
import { computeCapitalCoverage, type CapitalCoverage } from '@/lib/intelligence/capital-coverage';

/* ============================================================================
 * lib/queries/capital-coverage.ts — portfolio coverage & concentration read.
 *
 * Reuses the RLS-scoped `getPipelineData` (no new schema): the pipeline's own
 * value/committed totals feed coverage, and the live deals' sizes feed the
 * concentration math. Fail-soft to a safe zero state.
 * ========================================================================= */

const EMPTY: CapitalCoverage = {
  committed: 0,
  pipelineValue: 0,
  coveragePct: 0,
  uncommitted: 0,
  totalExposure: 0,
  sizedDeals: 0,
  byStage: [],
  topDeal: null,
  top3Share: 0,
  hhi: 0,
  band: 'Diversified',
  headline: 'No sized deals in the live pipeline yet'
};

export async function getCapitalCoverage(orgId: string): Promise<CapitalCoverage> {
  try {
    const data = await getPipelineData(orgId);
    const deals = data.stages.flatMap((s) =>
      s.deals.map((d) => ({
        id: d.id,
        name: d.name,
        stage: d.stage,
        status: d.status,
        amount: d.amount
      }))
    );
    return computeCapitalCoverage(deals, data.pipelineValue, data.committed);
  } catch {
    return EMPTY;
  }
}
