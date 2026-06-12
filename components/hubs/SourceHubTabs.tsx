'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Handshake, Landmark, Megaphone, TrendingUp } from 'lucide-react';
import { SegTabs } from '@/components/ui/Tabs';

/**
 * The Source hub's module tabs — the prototype's SegTabs row, synced to the
 * URL so every module keeps its deep link (/source/capital-map etc.). The
 * first tab's label is persona-adaptive (the prototype's SRC_TITLE), passed
 * down from the server layout.
 */
export function SourceHubTabs({ lpLabel }: { lpLabel: string }) {
  const router = useRouter();
  const pathname = usePathname();

  const tabs = [
    { id: '/source/capital-map', label: lpLabel, icon: Landmark },
    { id: '/source/pipeline', label: 'Deal pipeline', icon: TrendingUp },
    { id: '/source/partners', label: 'Partner Network', icon: Handshake },
    { id: '/source/leads', label: 'Lead Engine', icon: Megaphone }
  ];
  const active = tabs.find((t) => pathname.startsWith(t.id))?.id ?? tabs[0].id;

  return (
    <div className="overflow-x-auto pb-0.5">
      <SegTabs tabs={tabs} active={active} onChange={(id) => router.push(id)} />
    </div>
  );
}
