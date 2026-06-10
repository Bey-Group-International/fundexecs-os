import type { Metadata } from 'next';
import { VerbHubPage } from '@/components/loop/VerbHubPage';
import { loadBuildWorkspace } from '@/lib/build';
import { compactMoney } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Build',
  description:
    'The Build hub — record strength, the loop handoff, and the four record panels (Profile, Strategy, Readiness, Chain of Trust) on one surface.'
};

export const dynamic = 'force-dynamic';

/**
 * `/build` — the Build verb's hub: the record counterparties read from.
 * Thin page on the shared `VerbHubPage` scaffold; all numbers come from
 * `loadBuildWorkspace` (the shared dashboard loader underneath).
 */
export default function BuildPage() {
  return VerbHubPage({
    verb: 'build',
    title: 'Build',
    subtitle: 'Establish the record',
    path: '/build',
    load: loadBuildWorkspace,
    eyebrow: 'Build — establish the record',
    describe: (w) =>
      w.lockedByReadiness > 0
        ? `The record counterparties read from. Every close in Drive compounds back into this surface — ${compactMoney(w.lockedByReadiness)} is still locked behind the readiness gap.`
        : 'The record counterparties read from. Every close in Drive compounds back into this surface.',
    panelsTitle: 'Profile · Strategy · Readiness · Trust'
  });
}
