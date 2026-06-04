'use client';

import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Mail,
  Clock,
  GitMerge,
  Flame,
  Users,
  Activity,
  GitBranch,
  type LucideIcon
} from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ProgressBar,
  SectionTitle,
  SegTabs,
  type BadgeTone,
  type TabItem
} from '@/components/ui';
import type { ConnectionRow, WarmIntroRow } from '@/lib/queries/connections';

/* ---- Display helpers -------------------------------------------------- */

type RelationshipStatus = 'cold' | 'warm' | 'hot';

function normalizeStatus(status: string): RelationshipStatus {
  if (status === 'hot') return 'hot';
  if (status === 'warm') return 'warm';
  return 'cold';
}

// Warmth scale runs neutral -> azure -> gold (the design system reserves gold
// for Earn/gamification, but the relationship-warmth scale is the documented
// exception where gold reads as "hot").
const STATUS_META: Record<RelationshipStatus, { tone: BadgeTone; label: string }> = {
  cold: { tone: 'neutral', label: 'Cold' },
  warm: { tone: 'azure', label: 'Warm' },
  hot: { tone: 'gold', label: 'Hot' }
};

const STATUS_COLOR: Record<RelationshipStatus, string> = {
  cold: 'var(--fg-4)',
  warm: 'var(--azure-1)',
  hot: 'var(--gold-1)'
};

const INTRO_STATUS_META: Record<string, { tone: BadgeTone; label: string }> = {
  suggested: { tone: 'neutral', label: 'Suggested' },
  requested: { tone: 'info', label: 'Requested' },
  introduced: { tone: 'success', label: 'Introduced' }
};

function introMeta(status: string): { tone: BadgeTone; label: string } {
  return INTRO_STATUS_META[status] ?? { tone: 'neutral', label: status || 'Suggested' };
}

const AVATAR_TONE: Record<RelationshipStatus, 'neutral' | 'azure' | 'gold'> = {
  cold: 'neutral',
  warm: 'azure',
  hot: 'gold'
};

function recencyLabel(iso: string | null): string {
  if (!iso) return 'no activity';
  const then = new Date(iso).getTime();
  const d = Math.max(0, Math.round((Date.now() - then) / 86_400_000));
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.round(d / 7)}w ago`;
  return `${Math.round(d / 30)}mo ago`;
}

type SortKey = 'strength' | 'recency' | 'name';

const SORT_TABS: TabItem[] = [
  { id: 'strength', label: 'Warmth' },
  { id: 'recency', label: 'Recency' },
  { id: 'name', label: 'Name' }
];

const STATUS_TABS: TabItem[] = [
  { id: 'all', label: 'All' },
  { id: 'hot', label: 'Hot' },
  { id: 'warm', label: 'Warm' },
  { id: 'cold', label: 'Cold' }
];

const TONE_HEX: Record<BadgeTone, string> = {
  neutral: 'var(--fg-4)',
  gold: 'var(--gold-1)',
  azure: 'var(--azure-1)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)'
};

interface Kpi {
  label: string;
  value: string;
  delta: string;
  sub: string;
  icon: LucideIcon;
  tone: BadgeTone;
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  const Icon = kpi.icon;
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-medium text-fg-3">{kpi.label}</span>
        <span style={{ color: TONE_HEX[kpi.tone] }}>
          <Icon size={16} strokeWidth={1.9} aria-hidden />
        </span>
      </div>
      <div className="mt-3 text-[27px] font-semibold tabular-nums tracking-[-0.02em] text-fg-1">
        {kpi.value}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <Badge tone={kpi.tone} className="px-2 py-0.5 text-[10.5px]">
          {kpi.delta}
        </Badge>
        <span className="truncate text-[11.5px] text-fg-5">{kpi.sub}</span>
      </div>
    </Card>
  );
}

function ContactCard({ row }: { row: ConnectionRow }) {
  const status = normalizeStatus(row.status);
  const meta = STATUS_META[status];
  return (
    <Card clickable className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <Avatar name={row.full_name} size={38} tone={AVATAR_TONE[status]} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold text-fg-1">{row.full_name}</div>
          <div className="truncate text-[11.5px] text-fg-4">
            {[row.title, row.company].filter(Boolean).join(' · ') || 'No company'}
          </div>
        </div>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-fg-4">
          <span>Warmth score</span>
          <span className="font-semibold tabular-nums text-fg-2">{row.strength}</span>
        </div>
        <ProgressBar value={row.strength} color={STATUS_COLOR[status]} height={5} />
      </div>

      <div className="flex items-center justify-between text-[11px] text-fg-5">
        <span className="inline-flex items-center gap-1.5">
          <Clock size={12} strokeWidth={1.9} aria-hidden />
          {recencyLabel(row.last_interaction_at)}
        </span>
        <span className="tabular-nums">{row.interaction_count} touchpoints</span>
        <span className="inline-flex items-center gap-1.5 truncate">
          <Mail size={12} strokeWidth={1.9} aria-hidden />
          <span className="truncate">{row.primary_email ?? 'no email'}</span>
        </span>
      </div>
    </Card>
  );
}

function WarmIntroRowCard({ intro }: { intro: WarmIntroRow }) {
  const meta = introMeta(intro.status);
  return (
    <div className="flex items-start gap-3 rounded-xl border border-hairline bg-surface-1 p-3.5">
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1">
        <GitMerge size={16} strokeWidth={1.9} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] text-fg-1">
          <span className="font-semibold">{intro.connector}</span>
          <span className="text-fg-4"> can intro you to </span>
          <span className="font-semibold">{intro.target}</span>
        </div>
        {intro.rationale ? (
          <div className="mt-1 text-[11.5px] leading-snug text-fg-4">{intro.rationale}</div>
        ) : null}
        <div className="mt-2 flex items-center gap-2">
          <Badge tone={meta.tone} className="px-2 py-0.5 text-[10.5px]">
            {meta.label}
          </Badge>
          <span className="text-[11px] tabular-nums text-fg-5">
            Connector strength {intro.strength}
          </span>
        </div>
      </div>
      <Button
        variant="secondary"
        size="sm"
        iconRight={ArrowRight as LucideIcon}
        className="flex-none"
      >
        Request
      </Button>
    </div>
  );
}

export interface ConnectionsViewProps {
  rows: ConnectionRow[];
  intros: WarmIntroRow[];
}

export function ConnectionsView({ rows, intros }: ConnectionsViewProps) {
  const [sort, setSort] = useState<SortKey>('strength');
  const [filter, setFilter] = useState<string>('all');

  const kpis = useMemo<Kpi[]>(() => {
    const hot = rows.filter((r) => normalizeStatus(r.status) === 'hot').length;
    const warm = rows.filter((r) => normalizeStatus(r.status) === 'warm').length;
    const touchpoints = rows.reduce((sum, r) => sum + (r.interaction_count ?? 0), 0);
    return [
      {
        label: 'Connections',
        value: String(rows.length),
        delta: 'total',
        sub: 'tracked relationships',
        icon: Users,
        tone: 'info'
      },
      {
        label: 'Hot relationships',
        value: String(hot),
        delta: 'hot',
        sub: `${warm} warm`,
        icon: Flame,
        tone: 'gold'
      },
      {
        label: 'Touchpoints',
        value: touchpoints.toLocaleString(),
        delta: 'logged',
        sub: 'across your network',
        icon: Activity,
        tone: 'azure'
      },
      {
        label: 'Intros available',
        value: String(intros.length),
        delta: 'suggested',
        sub: 'warm introductions',
        icon: GitBranch,
        tone: 'success'
      }
    ];
  }, [rows, intros]);

  const visibleRows = useMemo<ConnectionRow[]>(() => {
    const base = rows.filter((r) => filter === 'all' || normalizeStatus(r.status) === filter);
    const sorted = [...base];
    sorted.sort((a, b) => {
      if (sort === 'strength') return b.strength - a.strength;
      if (sort === 'recency')
        return (
          new Date(b.last_interaction_at ?? 0).getTime() -
          new Date(a.last_interaction_at ?? 0).getTime()
        );
      return a.full_name.localeCompare(b.full_name);
    });
    return sorted;
  }, [rows, sort, filter]);

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {kpis.map((k) => (
          <KpiCard key={k.label} kpi={k} />
        ))}
      </div>

      <div className="grid gap-[18px] lg:grid-cols-[1.6fr_1fr]">
        <div>
          <SectionTitle
            eyebrow="Relationship intelligence"
            title="Warm connections"
            action={
              <SegTabs tabs={SORT_TABS} active={sort} onChange={(id) => setSort(id as SortKey)} />
            }
          />
          <div className="mb-4">
            <SegTabs tabs={STATUS_TABS} active={filter} onChange={setFilter} />
          </div>
          {visibleRows.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-[12.5px] text-fg-4">
                {rows.length === 0 ? 'No connections yet.' : 'No connections match this filter.'}
              </p>
            </Card>
          ) : (
            <div className="grid gap-3.5 sm:grid-cols-2">
              {visibleRows.map((r) => (
                <ContactCard key={r.id} row={r} />
              ))}
            </div>
          )}
        </div>

        <div>
          <SectionTitle
            eyebrow="Suggested by Earn"
            title="Warm introductions"
            action={
              <Badge tone="gold" dot pulse>
                Live
              </Badge>
            }
          />
          {intros.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-[12.5px] text-fg-4">No introductions suggested yet.</p>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {intros.map((intro) => (
                <WarmIntroRowCard key={intro.id} intro={intro} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ConnectionsView;
