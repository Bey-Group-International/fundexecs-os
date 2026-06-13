'use client';

import { Flame, Handshake, Radar, ThermometerSun } from 'lucide-react';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { MotionItem, MotionStagger } from '@/components/dashboard/command/MotionReveal';
import { compactMoney } from '@/lib/format';

/**
 * The Command Center desk stats — four live KPIs. Client island so the figures
 * count up on first view (tier: meaningful — they read as live numbers) and
 * the cards arrive in a short stagger. All inputs are plain numbers, so the
 * server page stays a server component. Reduced motion lands every figure and
 * card at its final state instantly (see AnimatedNumber / MotionStagger).
 */
export function CommandCenterKpis({
  activeDeals,
  capitalInMotion,
  hotRelationships,
  warmedThisWeek
}: {
  activeDeals: number;
  capitalInMotion: number;
  hotRelationships: number;
  warmedThisWeek: number;
}) {
  const kpis = [
    { icon: Radar, label: 'Active deals', value: activeDeals, format: intFmt },
    { icon: Handshake, label: 'In motion', value: capitalInMotion, format: compactMoney },
    { icon: Flame, label: 'Hot relationships', value: hotRelationships, format: intFmt },
    { icon: ThermometerSun, label: 'Warmed this week', value: warmedThisWeek, format: intFmt }
  ];

  return (
    <MotionStagger className="grid grid-cols-2 gap-2.5 lg:grid-cols-4" immediate>
      {kpis.map(({ icon: Icon, label, value, format }) => (
        <MotionItem
          key={label}
          className="flex items-center gap-3 rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-3"
        >
          <Icon size={16} strokeWidth={1.9} className="flex-none text-azure-1" aria-hidden />
          <div className="min-w-0">
            <div className="text-[17px] font-semibold tracking-[-0.01em]">
              <AnimatedNumber value={value} format={format} />
            </div>
            <div className="truncate text-[10.5px] uppercase tracking-[0.08em] text-fg-5">
              {label}
            </div>
          </div>
        </MotionItem>
      ))}
    </MotionStagger>
  );
}

function intFmt(n: number): string {
  return String(Math.round(n));
}
