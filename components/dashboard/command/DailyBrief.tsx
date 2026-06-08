'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Sparkles } from 'lucide-react';
import { Card, SectionTitle } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { DashboardAction, MajorAlert, EarnBriefing } from '@/lib/queries/dashboard';

/* ============================================================================
 * DailyBrief — Earn's categorized morning read. A lead summary, then tabs that
 * bucket today's real action items + alerts into the operator's working
 * categories (follow-ups, hot inbox signals, new deals, dormant warm intros,
 * prospects, high-priority). Empty categories stay calm.
 * ========================================================================= */

type BucketKey =
  | 'follow_ups'
  | 'hot_inbox'
  | 'new_deals'
  | 'dormant_intros'
  | 'prospects'
  | 'high_priority';

const BUCKETS: { key: BucketKey; label: string }[] = [
  { key: 'follow_ups', label: 'Follow-ups' },
  { key: 'hot_inbox', label: 'Hot inbox signals' },
  { key: 'new_deals', label: 'New deals' },
  { key: 'dormant_intros', label: 'Dormant warm intros' },
  { key: 'prospects', label: 'Prospects' },
  { key: 'high_priority', label: 'High priority' }
];

interface BriefItem {
  id: string;
  title: string;
  detail: string;
  href: string;
  tone: DashboardAction['tone'];
  high: boolean;
}

function bucketOf(text: string, high: boolean): BucketKey {
  const t = text.toLowerCase();
  if (/follow|reply|respond|reach out|nudge|check in|circle back/.test(t)) return 'follow_ups';
  if (/inbox|signal|email|message|thread|intelligence/.test(t)) return 'hot_inbox';
  if (/deal|pipeline|diligence|ic memo|sourc|term sheet/.test(t)) return 'new_deals';
  if (/dormant|warm intro|reconnect|re-engage|cold|re-warm/.test(t)) return 'dormant_intros';
  if (/prospect|\blp\b|lead|investor|allocator|family office/.test(t)) return 'prospects';
  return high ? 'high_priority' : 'follow_ups';
}

export function DailyBrief({
  briefing,
  actions,
  alerts
}: {
  briefing: EarnBriefing;
  actions: DashboardAction[];
  alerts: MajorAlert[];
}) {
  const [tab, setTab] = useState<BucketKey>('follow_ups');

  const byBucket = useMemo(() => {
    const map = new Map<BucketKey, BriefItem[]>(BUCKETS.map((b) => [b.key, []]));
    for (const a of actions) {
      const item: BriefItem = {
        id: a.id,
        title: a.title,
        detail: a.context,
        href: a.href,
        tone: a.tone,
        high: a.tone === 'warning'
      };
      map.get(bucketOf(`${a.title} ${a.context} ${a.cta} ${a.href}`, item.high))!.push(item);
    }
    for (const al of alerts) {
      const high = al.severity === 'critical' || al.severity === 'warning';
      const tone: DashboardAction['tone'] = al.severity === 'critical' ? 'warning' : 'azure';
      const key =
        al.severity === 'critical'
          ? 'high_priority'
          : bucketOf(`${al.title} ${al.detail} ${al.href}`, high);
      map
        .get(key)!
        .push({ id: al.id, title: al.title, detail: al.detail, href: al.href, tone, high });
    }
    return map;
  }, [actions, alerts]);

  const items = byBucket.get(tab) ?? [];

  return (
    <Card className="p-5" data-testid="daily-brief">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionTitle eyebrow="The morning call · Earn's read" title="Daily Brief" />
        <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-gold-1">
          <Sparkles size={12} strokeWidth={2} aria-hidden /> Earn
        </span>
      </div>

      {briefing.lines.length > 0 ? (
        <ul className="mb-3.5 flex flex-col gap-1.5">
          {briefing.lines.slice(0, 4).map((line, i) => (
            <li key={i} className="flex gap-2 text-[12.5px] leading-5 text-fg-3">
              <span className="mt-1.5 h-1 w-1 flex-none rounded-full bg-gold-1" aria-hidden />
              {line}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Category tabs */}
      <div className="flex flex-wrap gap-1.5">
        {BUCKETS.map((b) => {
          const n = byBucket.get(b.key)?.length ?? 0;
          const active = tab === b.key;
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => setTab(b.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition',
                active
                  ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-fg-1'
                  : 'border-hairline bg-surface-1 text-fg-4 hover:bg-surface-2 hover:text-fg-2'
              )}
            >
              {b.label}
              <span className={cn('tabular-nums', active ? 'text-fg-3' : 'text-fg-5')}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* Items */}
      <div className="mt-3 flex flex-col gap-1.5">
        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-hairline bg-surface-1 px-4 py-5 text-center text-[12px] text-fg-4">
            Nothing in this bucket today.
          </p>
        ) : (
          items.map((it) => (
            <Link
              key={it.id}
              href={it.href}
              className="group flex items-center gap-3 rounded-xl border border-hairline bg-bg-1 px-3 py-2.5 transition hover:bg-surface-1"
            >
              <span
                className="h-2 w-2 flex-none rounded-full"
                style={{
                  background: `var(--${it.tone === 'gold' ? 'gold-1' : it.tone === 'warning' ? 'warning' : it.tone === 'success' ? 'success' : 'azure-1'})`
                }}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium text-fg-1">
                  {it.title}
                </span>
                {it.detail ? (
                  <span className="block truncate text-[11px] text-fg-4">{it.detail}</span>
                ) : null}
              </span>
              <ArrowUpRight
                size={14}
                strokeWidth={2}
                className="flex-none text-fg-5 transition group-hover:text-azure-1"
                aria-hidden
              />
            </Link>
          ))
        )}
      </div>
    </Card>
  );
}

export default DailyBrief;
