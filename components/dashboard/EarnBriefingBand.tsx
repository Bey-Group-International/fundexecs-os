import Link from 'next/link';
import { ArrowUpRight, Sparkles, type LucideIcon } from 'lucide-react';
import { Badge, Card } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { cn } from '@/lib/utils';

export type EarnPriorityTone = 'azure' | 'gold' | 'success' | 'warning' | 'danger';

export interface EarnBriefingPriority {
  id: string;
  /** Headline (one line, ~50 chars) — what Earn wants you to do. */
  title: string;
  /** One-line rationale (the "why"). */
  context: string;
  /** Optional impact label (e.g. "High impact · ~$2.4M at stake"). */
  impact?: string;
  /** Which Earn brain is surfacing this priority (e.g. "Capital Formation"). */
  brain?: string;
  /** Optional icon — defaults to Sparkles. */
  icon?: LucideIcon;
  /** Tone of the leading dot + action chip. */
  tone?: EarnPriorityTone;
  /** Where the action lands. */
  href?: string;
  /** CTA label (defaults to "Open"). */
  cta?: string;
}

export interface EarnBriefingBandProps {
  /** First-name greeting target. */
  displayName: string;
  /** Optional one-liner shown under the greeting. */
  subtitle?: string;
  /** "Status dot" label rendered next to the coin (e.g. "Live"). */
  status?: string;
  /** 1–3 ranked priorities. The first one renders with stronger emphasis. */
  priorities: EarnBriefingPriority[];
  /** Optional override of the gold eyebrow above the headline. Defaults to
   *  "Earnest Fundmaker · Chief Operating Officer · your live AI guide" — the
   *  exact framing used on www.fundexecs.com. */
  eyebrow?: string;
  /** Optional audit-trail caption beneath the priorities. Defaults to the
   *  brand's signature "on the record" line; pass empty string to hide. */
  audit?: string;
}

const TONE_DOT: Record<EarnPriorityTone, string> = {
  azure: 'bg-azure-1',
  gold: 'bg-gold-1',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger'
};

/**
 * EarnBriefingBand — flagship dashboard banner that introduces "Earnest
 * Fundmaker, your Private Market Assistant" and surfaces 1–3 ranked
 * priorities for the day. Glow-ringed coin · live status dot · ranked rows
 * (impact / brain / action CTA). Color discipline: gold is *only* used on
 * the coin + a single highlight; row tones use semantic chips.
 */
export function EarnBriefingBand({
  displayName,
  subtitle = 'Today’s ranked priorities — surfaced from across the desk, recorded as they happen.',
  status = 'Live',
  priorities,
  eyebrow = 'Earnest Fundmaker · Chief Operating Officer · your live AI guide',
  audit = 'On the record · every decision and approval logged to your Chain of Trust.'
}: EarnBriefingBandProps) {
  const firstName = displayName.split(' ')[0] || displayName;

  return (
    <Card data-testid="earn-briefing-band" className="relative overflow-hidden p-[18px]">
      {/* Soft radial gold wash for the briefing — strictly via tokens. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(80% 110% at 0% 0%, rgba(247,201,72,0.10), transparent 55%), radial-gradient(60% 100% at 100% 0%, rgba(37,99,235,0.08), transparent 60%)'
        }}
      />

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
        <div className="relative flex-none">
          <span
            aria-hidden
            className="absolute -inset-1.5 rounded-full"
            style={{ boxShadow: 'var(--shadow-glow-gold)' }}
          />
          <EarnCoin size={56} className="relative" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-gold-1">
              {eyebrow}
            </p>
            <Badge tone="success" dot pulse className="text-[10px]">
              {status}
            </Badge>
          </div>
          <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.018em] text-fg-1 sm:text-[24px]">
            Today’s plan, {firstName}.
          </h2>
          <p className="mt-0.5 max-w-[60ch] text-[12.5px] text-fg-3">{subtitle}</p>
        </div>
      </div>

      {/* Priorities */}
      {priorities.length > 0 && (
        <ol className="mt-5 flex flex-col gap-2" data-testid="earn-briefing-priorities">
          {priorities.map((p, idx) => {
            const Icon = p.icon ?? Sparkles;
            const tone = p.tone ?? 'azure';
            const rowClass = cn(
              'group relative flex items-start gap-3 rounded-xl border border-hairline bg-surface-1 px-3.5 py-2.5 transition-[background,transform,box-shadow]',
              p.href && 'hover:-translate-y-0.5 hover:bg-surface-2 hover:shadow-[var(--shadow-md)]'
            );
            const inner = (
              <>
                <span
                  aria-hidden
                  className={cn('mt-1.5 h-1.5 w-1.5 flex-none rounded-full', TONE_DOT[tone])}
                />
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-hairline bg-bg-1 text-fg-3 group-hover:text-fg-1">
                  <Icon size={15} strokeWidth={1.9} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-[10px] font-semibold tabular-nums text-fg-5">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <p className="text-[13.5px] font-semibold tracking-[-0.005em] text-fg-1">
                      {p.title}
                    </p>
                  </div>
                  <p className="mt-0.5 truncate text-[11.5px] text-fg-3">{p.context}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10.5px] text-fg-4">
                    {p.impact && (
                      <span className="rounded-full border border-hairline bg-surface-2 px-2 py-0.5 font-medium text-fg-3">
                        {p.impact}
                      </span>
                    )}
                    {p.brain && (
                      <span className="rounded-full border border-hairline bg-surface-2 px-2 py-0.5 font-medium text-fg-3">
                        Brain · {p.brain}
                      </span>
                    )}
                  </div>
                </div>
                {p.href && (
                  <span className="flex items-center gap-1 self-center text-[11.5px] font-semibold text-azure-1">
                    {p.cta ?? 'Open'}
                    <ArrowUpRight
                      size={13}
                      strokeWidth={2}
                      className="transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </span>
                )}
              </>
            );
            return p.href ? (
              <Link
                key={p.id}
                href={p.href}
                data-testid={`earn-priority-${p.id}`}
                className={rowClass}
              >
                {inner}
              </Link>
            ) : (
              <li key={p.id} data-testid={`earn-priority-${p.id}`} className={rowClass}>
                {inner}
              </li>
            );
          })}
        </ol>
      )}

      {audit ? (
        <p
          className="mt-4 flex items-center gap-2 text-[10.5px] font-medium text-fg-4"
          data-testid="earn-briefing-audit"
        >
          <span aria-hidden className="inline-flex h-1 w-1 rounded-full bg-success" />
          {audit}
        </p>
      ) : null}
    </Card>
  );
}
