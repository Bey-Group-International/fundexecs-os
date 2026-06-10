import type { Metadata } from 'next';
import { VerbHubPage } from '@/components/loop/VerbHubPage';
import { loadRunWorkspace } from '@/lib/run';

export const metadata: Metadata = {
  title: 'Run',
  description:
    'The Run hub — capital awaiting a decision, the loop handoff, and the analysis panels (Diligence, Stress Test, Action Plan, Aggregation) on one surface.'
};

export const dynamic = 'force-dynamic';

/**
 * `/run` — the Run verb's hub: the analysis that decides.
 * Thin page on the shared `VerbHubPage` scaffold; all numbers come from
 * `loadRunWorkspace` (the shared dashboard loader underneath).
 */
export default function RunPage() {
  return VerbHubPage({
    verb: 'run',
    title: 'Run',
    subtitle: 'The analysis that decides',
    path: '/run',
    load: loadRunWorkspace,
    eyebrow: 'Run — the analysis that decides',
    describe: () =>
      'Pressure-test the thesis, surface the risks, and decide. Cleared diligence is what arms Drive — and every completed run feeds proof back into your record.',
    panelsTitle: 'Diligence · Stress Test · Action Plan · Aggregation'
  });
}
