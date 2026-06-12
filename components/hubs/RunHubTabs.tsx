'use client';

import { usePathname, useRouter } from 'next/navigation';
import { FileSearch, ListChecks, ShieldCheck, Users } from 'lucide-react';
import { SegTabs } from '@/components/ui/Tabs';

/**
 * The Run hub's module tabs — the prototype's SegTabs row, synced to the URL
 * so every module keeps its deep link (/run/diligence etc.) while the hub
 * reads as one tabbed surface.
 */
const TABS = [
  { id: '/run/diligence', label: 'Diligence', icon: FileSearch },
  { id: '/run/workflows', label: 'Workflows', icon: ListChecks },
  { id: '/run/compliance', label: 'Compliance', icon: ShieldCheck },
  { id: '/run/ir', label: 'IR & reporting', icon: Users }
];

export function RunHubTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const active = TABS.find((t) => pathname.startsWith(t.id))?.id ?? TABS[0].id;

  return (
    <div className="overflow-x-auto pb-0.5">
      <SegTabs tabs={TABS} active={active} onChange={(id) => router.push(id)} />
    </div>
  );
}
