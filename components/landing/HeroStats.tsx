'use client';

import { AnimatedNumber } from '@/components/ui';

interface Stat {
  value: number;
  format: (n: number) => string;
  label: string;
}

// Defined in this client component so the `format` functions aren't passed
// across the server→client boundary (which Next.js forbids).
const STATS: Stat[] = [
  { value: 612, format: (n) => `$${n.toLocaleString()}M+`, label: 'Capital tracked' },
  { value: 500, format: (n) => `${n.toLocaleString()}+`, label: 'Relationships mapped' },
  { value: 4, format: (n) => `${n}-layer`, label: 'Chain of Trust' },
  { value: 15, format: (n) => `${n}`, label: 'AI specialists' }
];

/** Hero proof points — animated count-ups in an elevated strip. */
export function HeroStats() {
  return (
    <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline sm:grid-cols-4">
      {STATS.map((s) => (
        <div key={s.label} className="bg-bg-1 px-5 py-4">
          <dd className="text-[26px] font-semibold leading-none tracking-[-0.02em] text-fg-1">
            <AnimatedNumber value={s.value} durationMs={1100} format={s.format} />
          </dd>
          <dt className="mt-2 text-[11.5px] leading-tight text-fg-4">{s.label}</dt>
        </div>
      ))}
    </dl>
  );
}

export default HeroStats;
