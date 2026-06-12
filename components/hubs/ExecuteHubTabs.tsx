'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Banknote, FileSignature, GitBranch, Receipt } from 'lucide-react';
import { SegTabs } from '@/components/ui/Tabs';

/**
 * The Execute hub's module tabs — the prototype's SegTabs row, synced to
 * the URL so every module keeps its deep link (/execute/closings etc.)
 * while the hub reads as one tabbed surface.
 */
const TABS = [
  { id: '/execute/closings', label: 'Closings', icon: FileSignature },
  { id: '/execute/wires', label: 'Signatures & wires', icon: Banknote },
  { id: '/execute/capital', label: 'Capital calls', icon: Receipt },
  { id: '/execute/chain-of-trust', label: 'Chain of Trust', icon: GitBranch }
];

export function ExecuteHubTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const active = TABS.find((t) => pathname.startsWith(t.id))?.id ?? TABS[0].id;

  return (
    <div className="overflow-x-auto pb-0.5">
      <SegTabs tabs={TABS} active={active} onChange={(id) => router.push(id)} />
    </div>
  );
}
