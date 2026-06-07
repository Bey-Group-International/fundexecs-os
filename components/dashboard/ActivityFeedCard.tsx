import { ShieldCheck, Brain, Sparkles, type LucideIcon } from 'lucide-react';
import { Badge, Card, SectionTitle } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { ActivityItem } from '@/lib/queries/dashboard';

const KIND_META: Record<ActivityItem['kind'], { icon: LucideIcon; color: string; label: string }> =
  {
    trust: { icon: ShieldCheck, color: 'var(--proof-truth)', label: 'Chain of Trust' },
    diligence: { icon: Brain, color: 'var(--proof-concept)', label: 'AI committee' },
    system: { icon: Sparkles, color: 'var(--gold-1)', label: 'System' }
  };

/** Relative-time string. Falls back to the ISO date for older items. */
function formatRelative(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  const deltaSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (deltaSec < 60) return 'Just now';
  if (deltaSec < 3600) return `${Math.round(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `${Math.round(deltaSec / 3600)}h ago`;
  if (deltaSec < 7 * 86400) return `${Math.round(deltaSec / 86400)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export interface ActivityFeedCardProps {
  /** Recent activity merged from Chain of Trust + diligence + system. */
  items: ActivityItem[];
  className?: string;
}

/**
 * ActivityFeedCard — the recent-activity feed surfaced on the dashboard. Each
 * item carries actor attribution (Earn · AI committee · teammate · You) so
 * autonomous work the agent team did overnight is legible. Live pulse dot on
 * the heading; rows render solid `bg-bg-1` per the legibility rule.
 */
export function ActivityFeedCard({ items, className }: ActivityFeedCardProps) {
  return (
    <Card className={cn('p-5', className)} data-testid="activity-feed-card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionTitle eyebrow="Activity · on the record" title="What happened on your desk" />
        <Badge tone="success" dot pulse className="text-[10px]">
          Live
        </Badge>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline bg-surface-1 px-4 py-6 text-center">
          <p className="text-[12.5px] font-medium text-fg-2">No activity yet.</p>
          <p className="mt-0.5 text-[11px] text-fg-4">
            As Earn and the AI committee execute, every action lands here — documented as it forms.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5" data-testid="activity-feed-items">
          {items.map((item) => {
            const meta = KIND_META[item.kind];
            const Icon = meta.icon;
            const ai = item.actor === 'Earn' || item.actor === 'AI committee';
            return (
              <li
                key={item.id}
                data-testid={`activity-item-${item.id}`}
                className="flex items-start gap-3 rounded-xl border border-hairline bg-bg-1 px-3 py-2"
              >
                <span
                  aria-hidden
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border bg-bg-1"
                  style={{ color: meta.color, borderColor: meta.color }}
                >
                  <Icon size={14} strokeWidth={2} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-semibold text-fg-1">{item.title}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-fg-4">
                    <span>{meta.label}</span>
                    <span aria-hidden>·</span>
                    <span className={ai ? 'text-gold-1' : 'text-fg-3'}>{item.actor}</span>
                    <span aria-hidden>·</span>
                    <span className="tabular-nums">{formatRelative(item.at)}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
