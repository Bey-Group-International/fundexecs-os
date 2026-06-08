import Link from 'next/link';
import { Sparkles, ArrowUpRight } from 'lucide-react';
import { Card, SectionTitle } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { DashboardAction } from '@/lib/queries/dashboard';

const TONE_BG: Record<DashboardAction['tone'], string> = {
  azure: 'var(--accent-soft)',
  gold: 'var(--gold-soft)',
  success: 'var(--success-soft)',
  warning: 'var(--warning-soft)'
};

const TONE_LINE: Record<DashboardAction['tone'], string> = {
  azure: 'var(--accent-line)',
  gold: 'var(--gold-line)',
  success: 'var(--success-line)',
  warning: 'var(--warning-line)'
};

const TONE_COLOR: Record<DashboardAction['tone'], string> = {
  azure: 'var(--accent)',
  gold: 'var(--gold-1)',
  success: 'var(--success)',
  warning: 'var(--warning)'
};

export interface NextBestActionCardProps {
  /** The single highest-leverage move (top of `topActions`). */
  action: DashboardAction | null;
  className?: string;
}

/**
 * NextBestActionCard — Earn's single highest-leverage move, given prominent
 * spotlight in the dashboard hero. Tone-tinted card, gold-glow coin avatar,
 * and a primary CTA wired to the recommended href. Empty state stays calm
 * when there's nothing pressing.
 */
export function NextBestActionCard({ action, className }: NextBestActionCardProps) {
  return (
    <Card
      data-testid="next-best-action-card"
      className={cn('relative overflow-hidden p-5', className)}
      style={
        action
          ? {
              backgroundImage: `radial-gradient(60% 130% at 0% 0%, ${TONE_BG[action.tone]}, transparent 70%)`
            }
          : undefined
      }
    >
      <SectionTitle
        eyebrow="The one move that compounds · Earn"
        title="Your highest-leverage move"
        className="mb-3"
      />

      {!action ? (
        <p className="text-[12.5px] text-fg-3">
          Your desk is in order — Earn will surface the next move as soon as one&rsquo;s ready.
        </p>
      ) : (
        <div
          className="flex flex-col gap-3 rounded-xl border bg-bg-1 p-4"
          style={{ borderColor: TONE_LINE[action.tone] }}
          data-testid={`next-best-action-${action.id}`}
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="relative flex h-10 w-10 flex-none items-center justify-center rounded-2xl border bg-bg-1"
              style={{ borderColor: TONE_LINE[action.tone], color: TONE_COLOR[action.tone] }}
            >
              <span
                aria-hidden
                className="absolute -inset-1 rounded-2xl"
                style={{ boxShadow: action.tone === 'gold' ? 'var(--shadow-glow-gold)' : 'none' }}
              />
              <Sparkles size={17} strokeWidth={1.9} className="relative" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p
                className="text-[10px] font-semibold uppercase tracking-[0.12em]"
                style={{ color: TONE_COLOR[action.tone] }}
              >
                Recommended now
              </p>
              <h3 className="mt-0.5 text-[16px] font-semibold tracking-[-0.012em] text-fg-1">
                {action.title}
              </h3>
              <p className="mt-1 max-w-[60ch] text-[12.5px] leading-relaxed text-fg-3">
                {action.context}
              </p>
            </div>
          </div>
          <Link
            href={action.href}
            data-testid="next-best-action-cta"
            className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-transparent bg-[var(--cta-gradient)] px-3.5 py-2 text-[12.5px] font-semibold text-white shadow-[var(--shadow-cta)] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {action.cta}
            <ArrowUpRight size={13} strokeWidth={2} aria-hidden />
          </Link>
        </div>
      )}
    </Card>
  );
}
