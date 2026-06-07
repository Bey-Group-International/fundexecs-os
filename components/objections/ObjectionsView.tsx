'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  MessagesSquare,
  Plus,
  CheckCircle2,
  CircleDot,
  Percent,
  Pencil,
  Quote,
  RotateCcw,
  Check,
  type LucideIcon
} from 'lucide-react';
import { Badge, Button, Card, ProgressBar, SectionTitle, type BadgeTone } from '@/components/ui';
import { EmptyState } from '@/components/shell/EmptyState';
import { cn } from '@/lib/utils';
import type { ObjectionsData, ObjectionItem } from '@/lib/queries/objections';
import { resolveObjection, reopenObjection } from '@/lib/actions/objections';
import { ObjectionDrawer } from './ObjectionDrawer';

type StatusFilter = 'open' | 'resolved' | 'all';

/** A stable tone per category so the same category reads the same everywhere. */
function categoryTone(category: string): BadgeTone {
  const s = category.toLowerCase();
  if (s.includes('fee') || s.includes('term')) return 'gold';
  if (s.includes('track')) return 'azure';
  if (s.includes('team')) return 'info';
  if (s.includes('strateg') || s.includes('thesis')) return 'success';
  if (s.includes('timing')) return 'warning';
  if (s.includes('liquid')) return 'danger';
  return 'neutral';
}

function prettyCategory(category: string): string {
  return category.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function relativeDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function KpiTile({
  label,
  value,
  hint,
  icon: Icon,
  tone
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone: BadgeTone;
}) {
  const dot: Record<BadgeTone, string> = {
    neutral: 'text-fg-4',
    gold: 'text-gold-1',
    azure: 'text-azure-1',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
    info: 'text-info'
  };
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] font-medium text-fg-3">{label}</span>
        <span className={dot[tone]}>
          <Icon size={15} strokeWidth={1.9} aria-hidden />
        </span>
      </div>
      <div className="mt-2 text-[23px] font-semibold tabular-nums tracking-[-0.02em] text-fg-1">
        {value}
      </div>
      {hint ? <p className="mt-0.5 text-[11px] text-fg-4">{hint}</p> : null}
    </Card>
  );
}

function ObjectionCard({
  item,
  onEdit,
  onResolve,
  onReopen,
  pending
}: {
  item: ObjectionItem;
  onEdit: (item: ObjectionItem) => void;
  onResolve: (item: ObjectionItem) => void;
  onReopen: (item: ObjectionItem) => void;
  pending: boolean;
}) {
  const tone = categoryTone(item.category);
  const resolved = item.status === 'resolved';
  return (
    <Card className={cn('p-4 transition', pending && 'opacity-50')}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone} className="text-[10.5px]">
          {prettyCategory(item.category)}
        </Badge>
        {item.lpName ? (
          <span className="text-[11.5px] font-medium text-fg-2">{item.lpName}</span>
        ) : (
          <span className="text-[11.5px] text-fg-5">Unlinked LP</span>
        )}
        <Badge
          tone={resolved ? 'success' : 'warning'}
          dot
          pulse={!resolved}
          className="ml-auto text-[10px]"
        >
          {resolved ? 'Resolved' : 'Open'}
        </Badge>
      </div>

      <p className="mt-3 text-[13.5px] font-medium leading-relaxed text-fg-1">{item.objection}</p>

      {item.rebuttal ? (
        <div className="mt-3 flex gap-2.5 rounded-xl border border-hairline bg-bg-2 px-3.5 py-3">
          <Quote size={14} strokeWidth={1.9} className="mt-0.5 flex-none text-fg-4" aria-hidden />
          <p className="text-[12.5px] leading-relaxed text-fg-3">{item.rebuttal}</p>
        </div>
      ) : (
        <p className="mt-3 text-[12px] italic text-fg-5">No rebuttal drafted yet.</p>
      )}

      <div className="mt-3.5 flex items-center gap-2 border-t border-hairline pt-3">
        <span className="text-[11px] text-fg-4">
          {resolved && item.resolvedAt
            ? `Resolved ${relativeDate(item.resolvedAt)}`
            : `Logged ${relativeDate(item.createdAt)}`}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            icon={Pencil}
            onClick={() => onEdit(item)}
            disabled={pending}
            data-testid={`objection-edit-${item.id}`}
          >
            Edit
          </Button>
          {resolved ? (
            <Button
              variant="ghost"
              size="sm"
              icon={RotateCcw}
              onClick={() => onReopen(item)}
              disabled={pending || !item.lpId}
              data-testid={`objection-reopen-${item.id}`}
            >
              Reopen
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              icon={Check}
              onClick={() => onResolve(item)}
              disabled={pending}
              data-testid={`objection-resolve-${item.id}`}
            >
              Resolve
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export interface ObjectionsViewProps {
  data: ObjectionsData;
}

export function ObjectionsView({ data }: ObjectionsViewProps) {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ObjectionItem | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [, startAction] = useTransition();

  function openCreate() {
    setEditing(null);
    setDrawerOpen(true);
  }

  function openEdit(item: ObjectionItem) {
    setEditing(item);
    setDrawerOpen(true);
  }

  function runAction(item: ObjectionItem, fn: () => Promise<{ ok: boolean; error?: string }>) {
    if (pendingId) return;
    setActionError(null);
    setPendingId(item.id);
    startAction(async () => {
      const r = await fn();
      setPendingId(null);
      if (r.ok) router.refresh();
      else setActionError(r.error ?? 'Action failed.');
    });
  }

  // Derived (React Compiler memoizes) — no manual useMemo needed.
  const filtered = data.items.filter((i) => {
    if (statusFilter !== 'all' && i.status !== statusFilter) return false;
    if (categoryFilter && i.category !== categoryFilter) return false;
    return true;
  });

  if (data.empty) {
    return (
      <>
        <Header onAdd={openCreate} canAdd={data.lps.length > 0} />
        <EmptyState
          icon={MessagesSquare}
          title="No objections logged yet"
          body="Capture LP objections — fees, track record, team, strategy, timing — alongside the rebuttals you'll send. Resolved vs. open is tracked so your objection-handling compounds across the raise."
          action={
            data.lps.length > 0 ? (
              <Button variant="primary" icon={Plus} onClick={openCreate}>
                Log first objection
              </Button>
            ) : undefined
          }
        />
        <ObjectionDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          lps={data.lps}
          editing={editing}
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-[18px]">
      <Header onAdd={openCreate} canAdd={data.lps.length > 0} />

      {actionError ? (
        <div
          role="alert"
          className="rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3.5 py-2.5 text-[12.5px] text-danger"
        >
          {actionError}
        </div>
      ) : null}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <KpiTile
          label="Total logged"
          value={String(data.total)}
          icon={MessagesSquare}
          tone="azure"
        />
        <KpiTile label="Open" value={String(data.openCount)} icon={CircleDot} tone="warning" />
        <KpiTile
          label="Resolved"
          value={String(data.resolvedCount)}
          icon={CheckCircle2}
          tone="success"
        />
        <KpiTile
          label="Resolution rate"
          value={`${data.resolutionPct}%`}
          icon={Percent}
          tone="gold"
        />
      </div>

      {/* Resolution progress */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-[12.5px] font-medium text-fg-3">Resolution progress</span>
          <span className="text-[12.5px] tabular-nums text-fg-2">
            {data.resolvedCount} / {data.total} resolved
          </span>
        </div>
        <ProgressBar
          value={data.resolutionPct}
          height={6}
          color="var(--success)"
          ariaLabel="Objection resolution rate"
          className="mt-3"
        />
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {(['open', 'resolved', 'all'] as StatusFilter[]).map((s) => {
          const count =
            s === 'all' ? data.total : s === 'open' ? data.openCount : data.resolvedCount;
          const active = statusFilter === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-[12px] font-medium capitalize transition',
                active
                  ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-fg-1'
                  : 'border-hairline text-fg-3 hover:bg-surface-1 hover:text-fg-1'
              )}
              data-testid={`objection-filter-${s}`}
            >
              {s} <span className="ml-1 tabular-nums text-fg-4">{count}</span>
            </button>
          );
        })}
        <span className="mx-1 h-4 w-px bg-hairline" aria-hidden />
        {data.categories.map((c) => {
          const active = categoryFilter === c.category;
          return (
            <button
              key={c.category}
              type="button"
              onClick={() => setCategoryFilter(active ? null : c.category)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-[12px] font-medium transition',
                active
                  ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-fg-1'
                  : 'border-hairline text-fg-3 hover:bg-surface-1 hover:text-fg-1'
              )}
            >
              {prettyCategory(c.category)}{' '}
              <span className="ml-1 tabular-nums text-fg-4">{c.count}</span>
            </button>
          );
        })}
      </div>

      <SectionTitle
        eyebrow="Capital formation · convert LPs"
        title="Objection triage"
        className="mb-0"
      />

      {/* List */}
      {filtered.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-[13px] text-fg-4">No objections match this filter.</p>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filtered.map((item) => (
            <ObjectionCard
              key={item.id}
              item={item}
              onEdit={openEdit}
              onResolve={(i) => runAction(i, () => resolveObjection(i.id))}
              onReopen={(i) =>
                runAction(i, () =>
                  reopenObjection({
                    id: i.id,
                    lpId: i.lpId ?? '',
                    category: i.category,
                    objection: i.objection,
                    rebuttal: i.rebuttal ?? undefined
                  })
                )
              }
              pending={pendingId === item.id}
            />
          ))}
        </div>
      )}

      <ObjectionDrawer
        key={editing?.id ?? 'new'}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        lps={data.lps}
        editing={editing}
      />
    </div>
  );
}

function Header({ onAdd, canAdd }: { onAdd: () => void; canAdd: boolean }) {
  return (
    <SectionTitle
      eyebrow="Capital formation command center"
      title="Objections"
      className="mb-0"
      action={
        <Button
          variant="primary"
          icon={Plus}
          onClick={onAdd}
          disabled={!canAdd}
          data-testid="objection-add"
        >
          Log objection
        </Button>
      }
    />
  );
}
