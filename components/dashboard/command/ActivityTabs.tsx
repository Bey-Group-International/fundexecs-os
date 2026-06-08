'use client';

import { useMemo, useState } from 'react';
import { ShieldCheck, Brain, Sparkles, type LucideIcon } from 'lucide-react';
import { Badge, Card, SectionTitle } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { ActivityItem } from '@/lib/queries/dashboard';

/* ============================================================================
 * ActivityTabs — the on-the-record activity feed with category filters. Each
 * item is tagged into the operator's working categories (approved, logged,
 * exported, generated, inbox action/signal, added LPs/partners) by content, so
 * the same real feed can be sliced without new data plumbing.
 * ========================================================================= */

const KIND_META: Record<ActivityItem['kind'], { icon: LucideIcon; color: string }> = {
  trust: { icon: ShieldCheck, color: 'var(--proof-truth)' },
  diligence: { icon: Brain, color: 'var(--proof-concept)' },
  system: { icon: Sparkles, color: 'var(--gold-1)' }
};

type Cat =
  | 'all'
  | 'approved'
  | 'logged'
  | 'exported'
  | 'generated'
  | 'inbox_action'
  | 'inbox_signal'
  | 'added_lps'
  | 'added_partners';

const TABS: { key: Cat; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'approved', label: 'Approved' },
  { key: 'logged', label: 'Logged' },
  { key: 'exported', label: 'Exported' },
  { key: 'generated', label: 'Generated' },
  { key: 'inbox_action', label: 'Inbox action' },
  { key: 'inbox_signal', label: 'Inbox signal' },
  { key: 'added_lps', label: 'Added LPs' },
  { key: 'added_partners', label: 'Added partners' }
];

function catsOf(item: ActivityItem): Set<Cat> {
  const t = item.title.toLowerCase();
  const cats = new Set<Cat>(['all']);
  if (/approv|accepted|signed off/.test(t)) cats.add('approved');
  if (item.kind === 'trust' || /logged|recorded|on the record|chain of trust/.test(t))
    cats.add('logged');
  if (/export/.test(t)) cats.add('exported');
  if (/generat|drafted|created|produced|memo|deck|wrote/.test(t)) cats.add('generated');
  if (/inbox.*(action|repl|sent|cleared)|replied|triaged|cleared/.test(t)) cats.add('inbox_action');
  if (/signal|match|warm|intro|inbound|detected/.test(t)) cats.add('inbox_signal');
  if (/\blp\b|limited partner|added lp/.test(t)) cats.add('added_lps');
  if (/partner|provider/.test(t)) cats.add('added_partners');
  return cats;
}

function formatRelative(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  const d = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (d < 60) return 'Just now';
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  if (d < 7 * 86400) return `${Math.round(d / 86400)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ActivityTabs({ items }: { items: ActivityItem[] }) {
  const [tab, setTab] = useState<Cat>('all');

  const tagged = useMemo(() => items.map((it) => ({ it, cats: catsOf(it) })), [items]);
  const counts = useMemo(() => {
    const c = new Map<Cat, number>(TABS.map((t) => [t.key, 0]));
    for (const { cats } of tagged) for (const cat of cats) c.set(cat, (c.get(cat) ?? 0) + 1);
    return c;
  }, [tagged]);

  const visible = tagged.filter(({ cats }) => cats.has(tab)).map(({ it }) => it);

  return (
    <Card className="p-5" data-testid="activity-tabs">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionTitle eyebrow="Activity · on the record" title="Activity feed" />
        <Badge tone="success" dot pulse className="text-[10px]">
          Live
        </Badge>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition',
                active
                  ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-fg-1'
                  : 'border-hairline bg-surface-1 text-fg-4 hover:bg-surface-2 hover:text-fg-2'
              )}
            >
              {t.label}
              <span className={cn('tabular-nums', active ? 'text-fg-3' : 'text-fg-5')}>
                {counts.get(t.key) ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline bg-surface-1 px-4 py-6 text-center">
          <p className="text-[12.5px] font-medium text-fg-2">Nothing in this view yet.</p>
          <p className="mt-0.5 text-[11px] text-fg-4">
            As Earn and the AI committee execute, every action lands here — documented as it forms.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {visible.map((item) => {
            const meta = KIND_META[item.kind];
            const Icon = meta.icon;
            const ai = item.actor === 'Earn' || item.actor === 'AI committee';
            return (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-xl border border-hairline bg-bg-1 px-3 py-2.5"
              >
                <span
                  className="flex h-7 w-7 flex-none items-center justify-center rounded-lg border"
                  style={{
                    color: meta.color,
                    background: `color-mix(in srgb, ${meta.color} 12%, transparent)`,
                    borderColor: `color-mix(in srgb, ${meta.color} 28%, transparent)`
                  }}
                >
                  <Icon size={14} strokeWidth={2} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-fg-1">
                    {item.title}
                  </span>
                  <span className="block truncate text-[11px] text-fg-4">
                    <span className={cn(ai && 'text-azure-1')}>{item.actor}</span> ·{' '}
                    {formatRelative(item.at)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export default ActivityTabs;
