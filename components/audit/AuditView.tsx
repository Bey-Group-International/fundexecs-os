'use client';

import { useState, useMemo } from 'react';
import {
  Shield,
  ShieldCheck,
  Settings,
  Search,
  Microscope,
  ChevronDown,
  ChevronUp,
  Clock
} from 'lucide-react';
import {
  Badge,
  Card,
  Input,
  SegTabs,
  SectionTitle,
  type BadgeTone,
  type TabItem
} from '@/components/ui';
import { EmptyState } from '@/components/shell/EmptyState';
import { cn } from '@/lib/utils';
import type { AuditData, AuditEvent, AuditEventKind } from '@/lib/queries/audit';

/* ---- Display helpers ---------------------------------------------------- */

const KIND_META: Record<
  AuditEventKind,
  { label: string; tone: BadgeTone; Icon: React.ElementType }
> = {
  trust: { label: 'Chain of Trust', tone: 'success', Icon: ShieldCheck },
  admin: { label: 'Admin Action', tone: 'danger', Icon: Settings },
  diligence: { label: 'Diligence', tone: 'azure', Icon: Microscope }
};

const FILTER_TABS: TabItem[] = [
  { id: 'all', label: 'All' },
  { id: 'trust', label: 'Chain of Trust' },
  { id: 'admin', label: 'Admin' },
  { id: 'diligence', label: 'Diligence' }
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

/* ---- Main view ---------------------------------------------------------- */

export interface AuditViewProps {
  data: AuditData;
}

export function AuditView({ data }: AuditViewProps) {
  const [filter, setFilter] = useState<string>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    let list = data.events;
    if (filter !== 'all') list = list.filter((e) => e.kind === filter);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (e) =>
          e.action.toLowerCase().includes(q) ||
          (e.summary?.toLowerCase().includes(q) ?? false) ||
          (e.entityType?.toLowerCase().includes(q) ?? false) ||
          (e.agent?.toLowerCase().includes(q) ?? false)
      );
    }
    return list;
  }, [data.events, filter, query]);

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
      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SegTabs tabs={FILTER_TABS} active={filter} onChange={setFilter} />
        <div className="w-full sm:w-64">
          <Input
            icon={Search}
            placeholder="Search events…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
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
