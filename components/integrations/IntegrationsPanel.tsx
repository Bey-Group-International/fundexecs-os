'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, PlugZap, Search, X, type LucideIcon } from 'lucide-react';
import { Card, type BadgeTone } from '@/components/ui';
import { IntegrationCard } from '@/components/integrations/IntegrationCard';
import { cn } from '@/lib/utils';
import {
  GROUP_ORDER,
  PROVIDER_META,
  type IntegrationGroup,
  type IntegrationView
} from '@/lib/integrations/catalog';

/* ============================================================================
 * IntegrationsPanel — the provider catalog: status summary, search, category
 * tabs, and a "Connected" / "Available" split with grouped sections. Shared by
 * the standalone /integrations page and the Settings → Integrations section.
 * Callers fetch + merge connections and pass them in; `variant` tunes density.
 * ========================================================================= */

const TONE_HEX: Record<BadgeTone, string> = {
  neutral: 'var(--fg-4)',
  gold: 'var(--gold-1)',
  azure: 'var(--azure-1)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)'
};

interface SummaryStat {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: BadgeTone;
}

function SummaryCard({ stat }: { stat: SummaryStat }) {
  const Icon = stat.icon;
  return (
    <Card className="flex items-center gap-3 p-3.5">
      <span
        className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border"
        style={{
          color: TONE_HEX[stat.tone],
          background: `var(--${stat.tone}-soft, var(--surface-2))`,
          borderColor: `var(--${stat.tone}-line, var(--border))`
        }}
      >
        <Icon size={16} strokeWidth={1.9} aria-hidden />
      </span>
      <div>
        <div className="text-[19px] font-semibold tabular-nums leading-none tracking-[-0.02em] text-fg-1">
          {stat.value}
        </div>
        <div className="mt-1 text-[11px] text-fg-4">{stat.label}</div>
      </div>
    </Card>
  );
}

type TabId = 'all' | 'connected' | IntegrationGroup;

function FilterTab({
  active,
  label,
  count,
  onClick
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-none items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition',
        active
          ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-fg-1'
          : 'border-hairline bg-surface-1 text-fg-4 hover:bg-surface-2 hover:text-fg-2'
      )}
    >
      {label}
      <span className={cn('tabular-nums text-[10.5px]', active ? 'text-fg-3' : 'text-fg-5')}>
        {count}
      </span>
    </button>
  );
}

function GroupSection({
  title,
  blurb,
  items,
  gridCols
}: {
  title: string;
  blurb?: string;
  items: IntegrationView[];
  gridCols: string;
}) {
  if (items.length === 0) return null;
  return (
    <section className="mb-7 last:mb-0">
      <div className="mb-3">
        <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-fg-1">{title}</h3>
        {blurb ? <p className="mt-0.5 text-[11.5px] text-fg-4">{blurb}</p> : null}
      </div>
      <div className={`grid gap-3.5 ${gridCols}`}>
        {items.map((c) => (
          <IntegrationCard key={c.provider} conn={c} />
        ))}
      </div>
    </section>
  );
}

export function IntegrationsPanel({
  connections,
  variant = 'page'
}: {
  connections: IntegrationView[];
  /** 'page' = wide standalone page (up to 3 cols); 'settings' = narrow pane (2 cols). */
  variant?: 'page' | 'settings';
}) {
  const [tab, setTab] = useState<TabId>('all');
  const [query, setQuery] = useState('');

  const connectedCount = connections.filter((c) => c.status === 'connected').length;
  const attentionCount = connections.filter((c) => c.status === 'error').length;
  const availableCount = connections.filter(
    (c) => c.available && c.status !== 'connected' && c.status !== 'error'
  ).length;

  const summary: SummaryStat[] = [
    { label: 'Connected', value: connectedCount, icon: CheckCircle2, tone: 'success' },
    { label: 'Needs attention', value: attentionCount, icon: AlertTriangle, tone: 'danger' },
    { label: 'Available to add', value: availableCount, icon: PlugZap, tone: 'neutral' }
  ];

  // Text filter across name, description and category.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return connections;
    return connections.filter((c) => {
      const meta = PROVIDER_META[c.provider];
      return (
        meta.name.toLowerCase().includes(q) ||
        meta.description.toLowerCase().includes(q) ||
        meta.category.toLowerCase().includes(q)
      );
    });
  }, [connections, query]);

  // Counts for the group tabs (respecting the active text query).
  const groupCounts = useMemo(() => {
    const counts = new Map<IntegrationGroup, number>();
    for (const c of filtered) {
      const g = PROVIDER_META[c.provider].group;
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    return counts;
  }, [filtered]);

  const filteredConnected = filtered.filter((c) => c.status === 'connected');

  const gridCols =
    variant === 'settings'
      ? 'grid-cols-1 sm:grid-cols-2'
      : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

  // Which groups to render, given the active tab.
  const visibleGroups = GROUP_ORDER.filter((g) => tab === 'all' || tab === g.id);

  // Build the rendered body for the active tab.
  let body: React.ReactNode;
  if (tab === 'connected') {
    body =
      filteredConnected.length > 0 ? (
        <GroupSection title="Connected" items={filteredConnected} gridCols={gridCols} />
      ) : (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing connected yet"
          body="Connect a tool below to start syncing relationship signals into Earn."
        />
      );
  } else {
    const sections = visibleGroups
      .map((g) => ({
        group: g,
        items: filtered.filter((c) => PROVIDER_META[c.provider].group === g.id)
      }))
      .filter((s) => s.items.length > 0);

    body =
      sections.length > 0 ? (
        sections.map((s) => (
          <GroupSection
            key={s.group.id}
            title={s.group.label}
            blurb={s.group.blurb}
            items={s.items}
            gridCols={gridCols}
          />
        ))
      ) : (
        <EmptyState
          icon={Search}
          title="No integrations match"
          body={`Nothing matches “${query}”. Try a different name or category.`}
        />
      );
  }

  return (
    <div>
      {/* Summary */}
      <div className="mb-[18px] grid grid-cols-3 gap-3">
        {summary.map((s) => (
          <SummaryCard key={s.label} stat={s} />
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-5">
          <Search size={15} strokeWidth={1.9} aria-hidden />
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search integrations…"
          aria-label="Search integrations"
          className="w-full rounded-xl border border-hairline bg-surface-1 py-2.5 pl-9 pr-9 text-[13px] text-fg-1 outline-none transition placeholder:text-fg-4 focus:border-[var(--accent-line)]"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-lg text-fg-5 transition hover:bg-surface-2 hover:text-fg-2"
          >
            <X size={14} strokeWidth={2} aria-hidden />
          </button>
        ) : null}
      </div>

      {/* Category tabs */}
      <div className="mb-5 flex flex-wrap gap-2">
        <FilterTab
          active={tab === 'all'}
          label="All"
          count={filtered.length}
          onClick={() => setTab('all')}
        />
        <FilterTab
          active={tab === 'connected'}
          label="Connected"
          count={filteredConnected.length}
          onClick={() => setTab('connected')}
        />
        {GROUP_ORDER.map((g) => (
          <FilterTab
            key={g.id}
            active={tab === g.id}
            label={g.label}
            count={groupCounts.get(g.id) ?? 0}
            onClick={() => setTab(g.id)}
          />
        ))}
      </div>

      {body}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body
}: {
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <Card className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-hairline bg-surface-2 text-fg-4">
        <Icon size={20} strokeWidth={1.8} aria-hidden />
      </span>
      <h3 className="text-[14px] font-semibold text-fg-1">{title}</h3>
      <p className="max-w-sm text-[12px] text-fg-4">{body}</p>
    </Card>
  );
}

export default IntegrationsPanel;
