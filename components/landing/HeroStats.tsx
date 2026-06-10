'use client';

import { AnimatedNumber } from '@/components/ui';

interface Stat {
  /** Animated count-up when the headline figure is numeric; null renders `text` statically. */
  value: number | null;
  format?: (n: number) => string;
  /** Static headline for qualitative entries. */
  text?: string;
  label: string;
}

// Qualitative proof points only — every figure here is verifiable from the
// product itself (the four proof layers, the fifteen-member team, the
// always-on desk, the cohort gate).
//
// TODO(team): restore quantitative traction metrics ("Capital tracked",
// "Relationships mapped") once real, verified values exist — the previous
// hardcoded $612M+/500+ were unconfirmed placeholders and must not ship as
// real claims.
//
// Defined in this client component so the `format` functions aren't passed
// across the server→client boundary (which Next.js forbids).
const STATS: Stat[] = [
  { value: 4, format: (n) => `${n}-layer`, label: 'Chain of Trust' },
  { value: 15, format: (n) => `${n}`, label: 'AI specialists' },
  { value: null, text: '24/7', label: 'Always-on desk' },
  { value: null, text: 'Invite-only', label: 'Cohort onboarding' }
];

/** Hero proof points — animated count-ups in an elevated strip. */
export function HeroStats() {
  return (
    <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline sm:grid-cols-4">
      {STATS.map((s) => (
        <div key={s.label} className="bg-bg-1 px-5 py-4">
          <dd className="text-[26px] font-semibold leading-none tracking-[-0.02em] text-fg-1">
            {s.value !== null && s.format ? (
              <AnimatedNumber value={s.value} durationMs={1100} format={s.format} />
            ) : (
              s.text
            )}
          </dd>
          <dt className="mt-2 text-[11.5px] leading-tight text-fg-4">{s.label}</dt>
        </div>
      ))}
    </dl>
  );
}

export default HeroStats;
