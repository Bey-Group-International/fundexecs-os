import Link from 'next/link';
import { Zap, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { Badge, Card, SectionTitle } from '@/components/ui';
import { cn } from '@/lib/utils';

export type SynergyTone = 'azure' | 'gold' | 'success' | 'warning' | 'info';

export interface SynergyAlert {
  id: string;
  /** Headline ("New match: Mosaic LP × Sequoia Pre-seed", etc.). */
  title: string;
  /** One-line context. */
  context: string;
  /** Relative timestamp string ("3m ago", "Just now"). */
  when: string;
  /** Source brain / route that fired the alert. */
  source?: string;
  /** Optional icon override (defaults to Zap). */
  icon?: LucideIcon;
  /** Visual tone of the leading dot + chip. */
  tone?: SynergyTone;
  /** Where the alert lands when clicked. */
  href?: string;
}

const TONE_DOT: Record<SynergyTone, string> = {
  azure: 'bg-azure-1',
  gold: 'bg-gold-1',
  success: 'bg-success',
  warning: 'bg-warning',
  info: 'bg-info'
};

export interface SynergyAlertsFeedProps {
  alerts: SynergyAlert[];
  /** Section heading; defaults to "Synergy alerts". */
  title?: string;
  /** Eyebrow above the title. */
  eyebrow?: string;
  /** "Live" indicator on the right side of the heading. */
  live?: boolean;
  /** Empty-state copy when `alerts` is empty. */
  emptyLabel?: string;
  className?: string;
}

/**
 * SynergyAlertsFeed — vertical feed of ambient synergy notifications.
 * Live pulse dot on the heading; each row has a tone dot + icon chip +
 * source meta + optional CTA arrow. Mirrors the prototype's flagship feed.
 */
export function SynergyAlertsFeed({
  alerts,
  title = 'Synergy alerts',
  eyebrow = 'Live · ambient feed',
  live = true,
  emptyLabel = 'No new synergy signals yet.',
  className
}: SynergyAlertsFeedProps) {
  return (
    <Card className={cn('p-5', className)} data-testid="synergy-alerts-feed">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionTitle eyebrow={eyebrow} title={title} />
        {live && (
          <Badge tone="success" dot pulse className="text-[10px]">
            Live
          </Badge>
        )}
      </div>
      {alerts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline bg-surface-1 px-4 py-6 text-center">
          <p className="text-[11.5px] text-fg-4">{emptyLabel}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {alerts.map((a) => {
            const Icon = a.icon ?? Zap;
            const tone = a.tone ?? 'azure';
            const Row = a.href ? Link : 'div';
            const rowProps = a.href
              ? { href: a.href, 'data-testid': `synergy-alert-${a.id}` }
              : { 'data-testid': `synergy-alert-${a.id}` };
            return (
              <Row
                key={a.id}
                {...(rowProps as Record<string, string>)}
                className={cn(
                  'group flex items-start gap-3 rounded-xl border border-hairline bg-surface-1 px-3 py-2.5 transition-[background,transform]',
                  a.href && 'hover:-translate-y-0.5 hover:bg-surface-2'
                )}
              >
                <span
                  aria-hidden
                  className={cn('mt-1.5 h-1.5 w-1.5 flex-none rounded-full', TONE_DOT[tone])}
                />
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-hairline bg-bg-1 text-fg-3 group-hover:text-fg-1">
                  <Icon size={14} strokeWidth={1.9} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-semibold text-fg-1">{a.title}</p>
                  <p className="truncate text-[11px] text-fg-3">{a.context}</p>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-fg-4">
                    <span className="tabular-nums">{a.when}</span>
                    {a.source && (
                      <>
                        <span aria-hidden>·</span>
                        <span>{a.source}</span>
                      </>
                    )}
                  </div>
                </div>
                {a.href && (
                  <ArrowUpRight
                    size={13}
                    strokeWidth={2}
                    className="mt-1 flex-none text-fg-4 transition-transform group-hover:translate-x-0.5 group-hover:text-azure-1"
                    aria-hidden
                  />
                )}
              </Row>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
