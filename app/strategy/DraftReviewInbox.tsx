'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, Check, CheckCheck, Sparkles, Users, X } from 'lucide-react';
import { Badge, Button, Card, SectionTitle, type BadgeTone } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { StrategyObjective } from '@/lib/queries/strategy';
import { approveDraftObjectives, deleteObjective } from '@/lib/actions/strategy';

type Tier = '100' | '30' | '10';

const TIER_COLOR: Record<Tier, string> = {
  '100': 'var(--gold-1)',
  '30': 'var(--azure-1)',
  '10': 'var(--success)'
};

const CATEGORY_TONE: Record<string, BadgeTone> = {
  capital: 'gold',
  governance: 'azure',
  compliance: 'success',
  execution: 'neutral'
};

/**
 * Batched team-review inbox for `/strategy`. The "your executive team drafted N
 * moves — review" queue: pending specialist drafts the operator approves into
 * the live plan in one pass, or dismisses. This is the control half of the
 * dynamism loop (decision #1) — Earn drafts, you approve. Renders nothing when
 * there are no drafts.
 */
export function DraftReviewInbox({ drafts }: { drafts: StrategyObjective[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Default every draft selected — the common case is "accept the team's plan".
  const [selected, setSelected] = useState<Set<string>>(() => new Set(drafts.map((d) => d.id)));
  const [error, setError] = useState<string | null>(null);

  const allIds = useMemo(() => drafts.map((d) => d.id), [drafts]);
  const allSelected = selected.size === drafts.length && drafts.length > 0;

  if (drafts.length === 0) return null;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === allIds.length ? new Set() : new Set(allIds)));
  }

  function approve(ids: string[]) {
    if (ids.length === 0) return;
    setError(null);
    startTransition(async () => {
      const res = await approveDraftObjectives(ids);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function dismiss(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await deleteObjective(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card className="p-[18px]">
      <SectionTitle
        eyebrow="Team review"
        title={`Your executive team drafted ${drafts.length} ${drafts.length === 1 ? 'move' : 'moves'}`}
        className="mb-3"
        action={
          <Badge tone="azure" dot>
            <Users size={11} strokeWidth={2} className="mr-1 inline" aria-hidden />
            {selected.size} selected
          </Badge>
        }
      />

      <p className="mb-3.5 max-w-2xl text-[11.5px] leading-relaxed text-fg-4">
        Proposed from where you are in the lifecycle — the moves a seasoned firm would run next.
        Approve them into your 100 / 30 / 10 plan, or dismiss what doesn&rsquo;t fit.
      </p>

      <div className="flex flex-col gap-2">
        {drafts.map((d) => {
          const color = TIER_COLOR[d.tier];
          const isSel = selected.has(d.id);
          return (
            <div
              key={d.id}
              className={cn(
                'flex items-start gap-3 rounded-[12px] border bg-surface-1 p-3 transition',
                isSel ? 'border-[var(--azure-line)] bg-[var(--azure-soft)]' : 'border-hairline'
              )}
            >
              <button
                type="button"
                role="checkbox"
                aria-checked={isSel}
                aria-label={isSel ? `Deselect ${d.title}` : `Select ${d.title}`}
                onClick={() => toggle(d.id)}
                className={cn(
                  'mt-0.5 flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px] border transition',
                  isSel
                    ? 'border-azure-1 bg-azure-1 text-white'
                    : 'border-hairline bg-surface-2 text-transparent hover:border-azure-1'
                )}
              >
                <Check size={12} strokeWidth={3} aria-hidden />
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="rounded-md border bg-white/[0.05] px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums"
                    style={{ color, borderColor: color }}
                  >
                    {d.tier}
                  </span>
                  {d.category && (
                    <Badge tone={CATEGORY_TONE[d.category] ?? 'neutral'} className="text-[10px]">
                      {d.category}
                    </Badge>
                  )}
                  <Badge tone="neutral" className="text-[10px]">
                    {d.priority} priority
                  </Badge>
                </div>

                <div className="mt-1.5 text-[14px] font-semibold text-fg-1">{d.title}</div>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-fg-4">
                  <span className="flex items-center gap-1.5">
                    <Calendar size={12} strokeWidth={1.9} aria-hidden />
                    {d.timeline ?? '—'}
                  </span>
                  {d.ai && (
                    <span className="flex items-center gap-1.5 text-azure-1">
                      <Sparkles size={12} strokeWidth={1.9} aria-hidden />
                      {d.ai}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-none items-center gap-1">
                <button
                  type="button"
                  title="Approve into plan"
                  aria-label={`Approve ${d.title}`}
                  disabled={pending}
                  onClick={() => approve([d.id])}
                  className="flex h-[28px] w-[28px] items-center justify-center rounded-md border border-[var(--success-line)] bg-[var(--success-soft)] text-success transition hover:brightness-110 disabled:opacity-50"
                >
                  <Check size={13} strokeWidth={2.2} aria-hidden />
                </button>
                <button
                  type="button"
                  title="Dismiss"
                  aria-label={`Dismiss ${d.title}`}
                  disabled={pending}
                  onClick={() => dismiss(d.id)}
                  className="flex h-[28px] w-[28px] items-center justify-center rounded-md border border-hairline bg-surface-2 text-fg-4 transition hover:text-fg-1 disabled:opacity-50"
                >
                  <X size={13} strokeWidth={2.2} aria-hidden />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {error && <p className="mt-3 text-[11.5px] text-danger">{error}</p>}

      <div className="mt-3.5 flex flex-wrap items-center gap-2.5 border-t border-hairline pt-3.5">
        <Button
          variant="primary"
          size="sm"
          icon={CheckCheck}
          disabled={pending || selected.size === 0}
          onClick={() => approve([...selected])}
        >
          Approve {selected.size} into plan
        </Button>
        <Button variant="secondary" size="sm" onClick={toggleAll} disabled={pending}>
          {allSelected ? 'Clear selection' : 'Select all'}
        </Button>
      </div>
    </Card>
  );
}
