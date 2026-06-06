import { Paperclip, Sparkles } from 'lucide-react';
import { Badge, Card, SectionTitle } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { LpUpdate, LpUpdateLifecycle } from './types';

const LIFECYCLE_LABEL: Record<LpUpdateLifecycle, string> = {
  mandate: 'Set the mandate',
  'source-raise': 'Source & raise',
  'analyze-package': 'Analyze & package',
  'communicate-close': 'Communicate & close',
  reporting: 'Reporting'
};

const LIFECYCLE_COLOR: Record<LpUpdateLifecycle, string> = {
  mandate: 'var(--gold-1)',
  'source-raise': 'var(--accent)',
  'analyze-package': 'var(--proof-concept)',
  'communicate-close': 'var(--success)',
  reporting: 'var(--info)'
};

export interface UpdateFeedProps {
  updates: LpUpdate[];
  className?: string;
}

/**
 * UpdateFeed — the LP-facing change log. Each entry carries a lifecycle tag
 * tinted to the canonical four-step model (plus a "Reporting" tone), shows
 * Eleanor (or the explicit author) as the byline, and lists attached
 * artifacts as compact chips that mirror the Vault.
 */
export function UpdateFeed({ updates, className }: UpdateFeedProps) {
  return (
    <Card className={cn('p-5', className)} data-testid="lp-update-feed">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionTitle eyebrow="Updates · recorded as they happen" title="What changed, and why" />
        <Badge tone="success" dot pulse className="text-[10px]">
          Live
        </Badge>
      </div>
      {updates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline bg-surface-1 p-6 text-center">
          <p className="text-[12.5px] font-medium text-fg-2">No updates yet</p>
          <p className="mt-1 text-[11.5px] text-fg-4">
            Eleanor will post here as the fund moves through each lifecycle stage.
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-3">
          {updates.map((update) => {
            const author = update.author ?? 'Eleanor';
            const authorRole = update.authorRole ?? 'Head of Investor Relations';
            const lifecycleColor = LIFECYCLE_COLOR[update.lifecycle];
            return (
              <li
                key={update.id}
                data-testid={`lp-update-${update.id}`}
                className="relative rounded-xl border border-hairline bg-bg-1 px-4 py-3 shadow-[var(--shadow-sm)] transition-[background,transform] hover:bg-surface-1"
              >
                {/* Left lifecycle accent rail */}
                <span
                  aria-hidden
                  className="absolute inset-y-3 left-0 w-[3px] rounded-full"
                  style={{ backgroundColor: lifecycleColor }}
                />
                <div className="pl-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full border bg-bg-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
                      style={{
                        color: lifecycleColor,
                        borderColor: lifecycleColor
                      }}
                    >
                      <span
                        aria-hidden
                        className="h-1 w-1 rounded-full"
                        style={{ backgroundColor: lifecycleColor }}
                      />
                      {LIFECYCLE_LABEL[update.lifecycle]}
                    </span>
                    <span className="text-[10.5px] tabular-nums text-fg-4">{update.postedAt}</span>
                  </div>
                  <h3 className="mt-1.5 text-[14px] font-semibold tracking-[-0.005em] text-fg-1">
                    {update.title}
                  </h3>
                  <p className="mt-1 max-w-[68ch] text-[12.5px] leading-relaxed text-fg-3">
                    {update.body}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px] text-fg-4">
                    <Sparkles size={11} strokeWidth={2} className="text-gold-1" aria-hidden />
                    <span className="font-medium text-fg-3">{author}</span>
                    <span aria-hidden>·</span>
                    <span>{authorRole}</span>
                  </div>

                  {update.attachments && update.attachments.length > 0 ? (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {update.attachments.map((att) => (
                        <li
                          key={att.id}
                          className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface-1 px-2 py-0.5 text-[10.5px] font-medium text-fg-3"
                          data-testid={`lp-update-attachment-${att.id}`}
                        >
                          <Paperclip size={10} strokeWidth={2} aria-hidden />
                          {att.name}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
