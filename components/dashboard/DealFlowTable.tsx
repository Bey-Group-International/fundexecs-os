import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Badge, Card, SectionTitle, type BadgeTone } from '@/components/ui';
import { cn } from '@/lib/utils';

export type DealFlowStage =
  | 'sourcing'
  | 'screening'
  | 'diligence'
  | 'ic'
  | 'closing'
  | 'closed';

export interface DealFlowRow {
  id: string;
  /** Company / deal name. */
  name: string;
  /** Stage of the deal (drives the chip tone). */
  stage: DealFlowStage;
  /** Pre-formatted size label (e.g. "$2.4M", "—"). */
  size?: string;
  /** Optional sector / vertical tag. */
  sector?: string;
  /** "3d ago", "Today", … */
  lastTouch?: string;
  /** Stand-in for a logo: 1-2 letters that appear in a tinted disc. */
  initials?: string;
  /** Link to deal detail (Pipeline). */
  href?: string;
}

export const STAGE_TONE: Record<DealFlowStage, BadgeTone> = {
  sourcing: 'neutral',
  screening: 'neutral',
  diligence: 'azure',
  ic: 'warning',
  closing: 'gold',
  closed: 'success'
};

export interface DealFlowTableProps {
  rows: DealFlowRow[];
  title?: string;
  eyebrow?: string;
  /** Empty-state body copy when `rows` is empty. */
  emptyBody?: string;
  /** Empty-state CTA href / label. */
  emptyHref?: string;
  emptyCta?: string;
  className?: string;
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * DealFlowTable — the flagship dashboard's denser deal list. Each row is a
 * logo disc + name/sector + stage chip + size + last-touch + arrow CTA. The
 * underlying primitive is still a `<ul>` for accessibility; the visual grid
 * is achieved with token-driven utility classes.
 */
export function DealFlowTable({
  rows,
  title = 'Deal flow',
  eyebrow = 'Active pipeline',
  emptyBody = 'Add your first opportunity to start tracking deal flow.',
  emptyHref = '/pipeline',
  emptyCta = 'Open Pipeline',
  className
}: DealFlowTableProps) {
  return (
    <Card className={cn('p-5', className)} data-testid="deal-flow-table">
      <SectionTitle eyebrow={eyebrow} title={title} className="mb-3" />
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline bg-surface-1 p-5 text-center">
          <p className="text-[12.5px] font-medium text-fg-2">No deals yet</p>
          <p className="mt-1 text-[11.5px] text-fg-4">{emptyBody}</p>
          <Link
            href={emptyHref}
            className="mt-3 inline-flex text-[11.5px] font-semibold text-azure-1 hover:underline"
            data-testid="deal-flow-empty-cta"
          >
            {emptyCta} →
          </Link>
        </div>
      ) : (
        <>
          <div
            className="mb-1 hidden grid-cols-[2fr_1fr_1fr_0.6fr_24px] gap-3 px-1 sm:grid"
            aria-hidden
          >
            {['Deal', 'Stage', 'Size', 'Touch', ''].map((h) => (
              <span
                key={h}
                className="text-[10px] font-semibold uppercase tracking-[0.11em] text-fg-5"
              >
                {h}
              </span>
            ))}
          </div>
          <ul className="flex flex-col">
            {rows.map((row) => {
              const tone = STAGE_TONE[row.stage] ?? 'neutral';
              const Row = row.href ? Link : 'div';
              const rowProps = row.href
                ? { href: row.href, 'data-testid': `deal-row-${row.id}` }
                : { 'data-testid': `deal-row-${row.id}` };
              return (
                <li key={row.id}>
                  <Row
                    {...(rowProps as Record<string, string>)}
                    className={cn(
                      'group grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl px-1 py-2.5 transition-[background,transform]',
                      'sm:grid-cols-[2fr_1fr_1fr_0.6fr_24px]',
                      row.href && 'hover:bg-surface-1'
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-hairline bg-surface-2 text-[11px] font-semibold text-fg-2">
                        {row.initials ?? initialsFor(row.name)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold text-fg-1">
                          {row.name}
                        </p>
                        {row.sector && (
                          <p className="truncate text-[10.5px] text-fg-4">{row.sector}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-3 sm:contents">
                      <Badge tone={tone} className="text-[10px] uppercase">
                        {row.stage}
                      </Badge>
                      <span className="hidden text-[12px] font-medium tabular-nums text-fg-2 sm:block">
                        {row.size ?? '—'}
                      </span>
                      <span className="hidden text-[11px] text-fg-4 sm:block">
                        {row.lastTouch ?? '—'}
                      </span>
                      {row.href ? (
                        <ArrowUpRight
                          size={14}
                          strokeWidth={2}
                          className="hidden text-fg-4 transition-transform group-hover:translate-x-0.5 group-hover:text-azure-1 sm:block"
                          aria-hidden
                        />
                      ) : (
                        <span aria-hidden className="hidden sm:block" />
                      )}
                    </div>
                  </Row>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}
