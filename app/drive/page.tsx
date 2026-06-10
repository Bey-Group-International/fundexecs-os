import type { Metadata } from 'next';
import { VerbHubPage } from '@/components/loop/VerbHubPage';
import { loadDriveWorkspace } from '@/lib/drive';

export const metadata: Metadata = {
  title: 'Drive',
  description:
    'The Drive hub — close progress, the loop handoff, and the execution panels (Materials, Deal Desk, Cap Table, Execute) on one surface.'
};

export const dynamic = 'force-dynamic';

/**
 * `/drive` — the Drive verb's hub: take the deal to close.
 * Thin page on the shared `VerbHubPage` scaffold; all numbers come from
 * `loadDriveWorkspace` (the shared dashboard loader underneath).
 */
export default function DrivePage() {
  return VerbHubPage({
    verb: 'drive',
    title: 'Drive',
    subtitle: 'Drive the deal to close',
    path: '/drive',
    load: loadDriveWorkspace,
    eyebrow: 'Drive — to close',
    describe: () =>
      'Materials, signatures, and the last mile to a closed deal. Every close here compounds back into Build — proof of work on your record, readiness up, next raise easier.',
    panelsTitle: 'Materials · Deal Desk · Cap Table · Execute'
  });
}
