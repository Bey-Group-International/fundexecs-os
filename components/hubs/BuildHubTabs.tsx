'use client';

import { usePathname, useRouter } from 'next/navigation';
import { CircleUserRound, FolderLock, ListChecks, Scale } from 'lucide-react';
import { SegTabs } from '@/components/ui/Tabs';

/**
 * The Build hub's module tabs — the prototype's SegTabs row, synced to the
 * URL so every module keeps its deep link (/build/formation etc.) while the
 * hub reads as one tabbed surface.
 */
const TABS = [
  { id: '/build/formation', label: 'Formation checklist', icon: ListChecks },
  { id: '/build/data-room', label: 'Materials & data room', icon: FolderLock },
  { id: '/build/governance', label: 'Governance', icon: Scale },
  { id: '/build/brand', label: 'Profile & brand', icon: CircleUserRound }
];

export function BuildHubTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const active = TABS.find((t) => pathname.startsWith(t.id))?.id ?? TABS[0].id;

  return (
    <div className="overflow-x-auto pb-0.5">
      <SegTabs tabs={TABS} active={active} onChange={(id) => router.push(id)} />
    </div>
  );
}
