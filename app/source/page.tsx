import type { Metadata } from 'next';
import { VerbHubPage } from '@/components/loop/VerbHubPage';
import { loadSourceWorkspace } from '@/lib/source';

export const metadata: Metadata = {
  title: 'Source',
  description:
    'The Source hub — capital in motion, the loop handoff, and the sourcing panels (Deals, LPs, Capital) on one surface.'
};

export const dynamic = 'force-dynamic';

/**
 * `/source` — the Source verb's hub: find the deals and capital that fit.
 * Thin page on the shared `VerbHubPage` scaffold; all numbers come from
 * `loadSourceWorkspace` (the shared dashboard loader underneath).
 */
export default function SourcePage() {
  return VerbHubPage({
    verb: 'source',
    title: 'Source',
    subtitle: 'Find what fits',
    path: '/source',
    load: loadSourceWorkspace,
    eyebrow: 'Source — find what fits',
    describe: () =>
      'The deals and capital that fit your thesis, matched against your record. A strong Build record is what makes these matches credible.',
    panelsTitle: 'Deals · LPs · Capital'
  });
}
