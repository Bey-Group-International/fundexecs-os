/**
 * The www.fundexecs.com homepage's four-step lifecycle — used wherever the
 * dashboard needs to plot progress against the brand's canonical operating
 * model. **Orthogonal** to the four Chain-of-Trust proof layers (Truth /
 * Concept / Execution / Work): the lifecycle is *what* gets done; the proof
 * layers are *how* each artifact is verified.
 *
 *   1. Set the mandate
 *   2. Source & raise
 *   3. Analyze & package
 *   4. Communicate & close
 *
 * Kept as a tiny fixture file (instead of a sprawling type) so layouts can
 * compose readiness paths without importing dashboard logic.
 */
import type { FundReadinessStage } from '@/components/dashboard/FundReadinessPath';

export const LIFECYCLE_STAGES = [
  {
    id: 'mandate',
    name: 'Set the mandate',
    hint: 'Thesis, targets, constraints — aligned with Earn.'
  },
  {
    id: 'source-raise',
    name: 'Source & raise',
    hint: 'On-thesis deals + suitable capital, qualified through your relationships.'
  },
  {
    id: 'analyze-package',
    name: 'Analyze & package',
    hint: 'Committee-grade rigor — model, narrative, terms in lockstep.'
  },
  {
    id: 'communicate-close',
    name: 'Communicate & close',
    hint: 'Advance every counterparty and drive to signature.'
  }
] as const;

/**
 * Build a ready-to-render lifecycle path. Pass `activeIndex` (0–3) to mark
 * the currently in-flight stage; everything before is `complete`, after is
 * `upcoming`. Pass `activePct` to render the active progress bar.
 */
export function buildLifecyclePath(activeIndex: number, activePct = 60): FundReadinessStage[] {
  return LIFECYCLE_STAGES.map((stage, idx) => ({
    id: stage.id,
    name: stage.name,
    hint: stage.hint,
    status: idx < activeIndex ? 'complete' : idx === activeIndex ? 'active' : 'upcoming',
    pct: idx === activeIndex ? activePct : undefined
  }));
}
