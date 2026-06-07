'use client';

import { useState } from 'react';
import {
  Shield,
  ShieldCheck,
  Settings,
  Search,
  Microscope,
  ChevronDown,
  ChevronUp,
  Clock,
  type LucideIcon
} from 'lucide-react';
import { Badge, Card, Input, SectionTitle, type BadgeTone } from '@/components/ui';
import { EmptyState } from '@/components/shell/EmptyState';
import { cn } from '@/lib/utils';
import type { AuditData, AuditEvent, AuditEventKind } from '@/lib/queries/audit';

/* ---- Display helpers ---------------------------------------------------- */

const KIND_META: Record<AuditEventKind, { label: string; tone: BadgeTone; Icon: LucideIcon }> = {
  trust: { label: 'Chain of Trust', tone: 'success', Icon: ShieldCheck },
  admin: { label: 'Admin Action', tone: 'danger', Icon: Settings },
  diligence: { label: 'Diligence', tone: 'azure', Icon: Microscope }
};

/** CSS accent var per tone — drives the filter-card rail + active ring. */
const TONE_ACCENT: Record<BadgeTone, string> = {
  neutral: 'var(--fg-4)',
  info: 'var(--info)',
  azure: 'var(--azure-1)',
  success: 'var(--success)',
  gold: 'var(--gold-1)',
  warning: 'var(--warning)',
  danger: 'var(--danger)'
};

/** The audit filter strip: an "All" overview card + one per event kind. */
const FILTER_CARDS: { id: string; label: string; tone: BadgeTone; Icon: LucideIcon }[] = [
  { id: 'all', label: 'All events', tone: 'neutral', Icon: Shield },
  { id: 'trust', label: 'Chain of Trust', tone: 'success', Icon: ShieldCheck },
  { id: 'admin', label: 'Admin', tone: 'danger', Icon: Settings },
  { id: 'diligence', label: 'Diligence', tone: 'azure', Icon: Microscope }
];

function formatTs(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function humanize(str: string): string {
  return str.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ---- Event row ---------------------------------------------------------- */

function EventRow({ event }: { event: AuditEvent }) {
  const [open, setOpen] = useState(false);
  const { label, tone, Icon } = KIND_META[event.kind];
  const hasDetail = event.summary || (event.meta && Object.keys(event.meta).length > 0);

  return (
    <div className="border-b border-hairline last:border-0">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        className={cn(
          'flex w-full items-start gap-3 px-4 py-3.5 text-left transition',
          hasDetail ? 'cursor-pointer hover:bg-surface-1/60' : 'cursor-default'
        )}
        aria-expanded={hasDetail ? open : undefined}
      >
        {/* Timeline dot + icon */}
        <div className="relative flex flex-none flex-col items-center">
          <span
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-xl border',
              tone === 'success' &&
                'border-[var(--success-line)] bg-[var(--success-soft)] text-success',
              tone === 'danger' &&
                'border-[var(--danger-line)] bg-[var(--danger-soft)] text-danger',
              tone === 'azure' && 'border-[var(--azure-line)] bg-[var(--azure-soft)] text-azure-1'
            )}
          >
            <Icon size={13} strokeWidth={1.9} aria-hidden />
          </span>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={tone} className="text-[10px]">
              {label}
            </Badge>
            {event.score != null && (
              <Badge
                tone={event.score >= 70 ? 'success' : event.score >= 45 ? 'warning' : 'danger'}
                className="text-[10px]"
              >
                {event.score}/100
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-[13px] font-medium text-fg-1">{humanize(event.action)}</p>
          {event.summary ? (
            <p className="mt-0.5 line-clamp-2 text-[12px] text-fg-3">{event.summary}</p>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-fg-5">
            <span className="flex items-center gap-1">
              <Clock size={11} strokeWidth={1.9} aria-hidden />
              {formatTs(event.timestamp)}
            </span>
            {event.entityType ? (
              <span className="rounded-md border border-hairline bg-surface-1 px-1.5 py-0.5">
                {humanize(event.entityType)}
              </span>
            ) : null}
            {event.agent ? (
              <span className="rounded-md border border-hairline bg-surface-1 px-1.5 py-0.5">
                {event.agent}
              </span>
            ) : null}
          </div>
        </div>

        {/* Expand chevron */}
        {hasDetail ? (
          <span className="mt-1 flex-none text-fg-4">
            {open ? (
              <ChevronUp size={14} strokeWidth={1.9} aria-hidden />
            ) : (
              <ChevronDown size={14} strokeWidth={1.9} aria-hidden />
            )}
          </span>
        ) : null}
      </button>

      {/* Expanded detail */}
      {open && hasDetail ? (
        <div className="border-t border-hairline bg-surface-1/40 px-4 pb-4 pt-3">
          {event.summary ? (
            <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-fg-2">
              {event.summary}
            </p>
          ) : null}
          {event.meta && Object.keys(event.meta).length > 0 ? (
            <pre className="mt-3 overflow-x-auto rounded-xl border border-hairline bg-surface-2 p-3 text-[11px] leading-relaxed text-fg-3">
              {JSON.stringify(event.meta, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ---- Filter card (overview + filter in one) ----------------------------- */

function FilterCard({
  label,
  count,
  tone,
  Icon,
  active,
  onClick
}: {
  label: string;
  count: number;
  tone: BadgeTone;
  Icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}) {
  const accent = TONE_ACCENT[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'group relative overflow-hidden rounded-2xl border bg-bg-1 p-3 text-left transition-[transform,box-shadow,background]',
        'hover:-translate-y-0.5 hover:bg-surface-1 hover:shadow-[var(--shadow-sm)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-0',
        active ? 'border-transparent bg-surface-1' : 'border-hairline'
      )}
      style={active ? { boxShadow: `inset 0 0 0 1.5px ${accent}` } : undefined}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: active ? accent : 'transparent' }}
      />
      <div className="flex items-center gap-2">
        <span
          className="flex h-7 w-7 flex-none items-center justify-center rounded-lg border bg-bg-1"
          style={{ color: accent, borderColor: accent }}
        >
          <Icon size={13} strokeWidth={1.9} aria-hidden />
        </span>
        <span className="text-[20px] font-semibold tabular-nums leading-none text-fg-1">
          {count}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] font-medium text-fg-3">{label}</p>
    </button>
  );
}

/* ---- Main view ---------------------------------------------------------- */

export interface AuditViewProps {
  data: AuditData;
}

export function AuditView({ data }: AuditViewProps) {
  const [filter, setFilter] = useState<string>('all');
  const [query, setQuery] = useState('');

  // Per-kind totals for the filter strip (full dataset, independent of the
  // active filter so the overview always reflects everything).
  const counts: Record<string, number> = { all: data.events.length };
  for (const e of data.events) counts[e.kind] = (counts[e.kind] ?? 0) + 1;

  // Derived filtering — React Compiler memoizes; no manual useMemo needed.
  const q = query.trim().toLowerCase();
  const filtered = data.events.filter((e) => {
    if (filter !== 'all' && e.kind !== filter) return false;
    if (!q) return true;
    return (
      e.action.toLowerCase().includes(q) ||
      (e.summary?.toLowerCase().includes(q) ?? false) ||
      (e.entityType?.toLowerCase().includes(q) ?? false) ||
      (e.agent?.toLowerCase().includes(q) ?? false)
    );
  });

  if (data.empty) {
    return (
      <EmptyState
        icon={Shield}
        title="No audit events yet"
        body="Chain-of-Trust mutations, admin actions, and diligence findings will appear here as a chronological timeline once your organization has activity."
      />
    );
  }

  // Group by date
  const grouped = filtered.reduce<Record<string, AuditEvent[]>>((acc, e) => {
    const day = new Date(e.timestamp).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
    (acc[day] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Filter strip — per-kind overview that doubles as the filter. */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {FILTER_CARDS.map((c) => (
          <FilterCard
            key={c.id}
            label={c.label}
            count={counts[c.id] ?? 0}
            tone={c.tone}
            Icon={c.Icon}
            active={filter === c.id}
            onClick={() => setFilter(c.id)}
          />
        ))}
      </div>

      {/* Search */}
      <div className="w-full sm:max-w-xs">
        <Input
          icon={Search}
          placeholder="Search events…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* Timeline */}
      {Object.keys(grouped).length === 0 ? (
        <EmptyState
          icon={Search}
          title="No matching events"
          body="Try adjusting the filter or search query."
        />
      ) : (
        Object.entries(grouped).map(([day, events]) => (
          <section key={day} aria-label={day}>
            <SectionTitle eyebrow="Audit Trail" title={day} />
            <Card className="overflow-hidden p-0">
              {events.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </Card>
          </section>
        ))
      )}

      {/* Count */}
      <p className="text-center text-[11.5px] text-fg-5">
        {filtered.length} event{filtered.length !== 1 ? 's' : ''} shown
        {filter !== 'all' || query ? ' (filtered)' : ''}
      </p>
    </div>
  );
}
