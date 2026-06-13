'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowUpRight, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { OUTCOME_ICONS } from '@/lib/earn/outcome-icons';
import {
  OUTCOME_KINDS,
  OUTCOME_KIND_ORDER,
  type EarnOutcome,
  type OutcomeKind
} from '@/lib/earn/outcomes';
import { getMember } from '@/lib/team';
import { cn } from '@/lib/utils';

/**
 * The Earn ledger — the `/earn` surface. Every approved Earn action lands here
 * as a durable, searchable row: what the team produced, which desk produced it,
 * where it fanned out to, and whether the Chain of Trust backs it. This is the
 * firm's memory — the compounding made visible — instead of a chat scroll that
 * evaporates when the dock closes.
 */

type Filter = 'all' | OutcomeKind;

/** Compact relative time (e.g. "4m", "3h", "2d") from an ISO timestamp. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.floor(Math.max(0, Date.now() - then) / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function SpecialistMark({ slug }: { slug: string }) {
  const member = getMember(slug);
  if (member?.chief) return <EarnCoin size={30} />;
  const Icon = member?.icon ?? Sparkles;
  return (
    <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full border border-[var(--azure-line)] bg-[var(--azure-soft)] text-azure-1">
      <Icon size={14} strokeWidth={1.9} aria-hidden />
    </span>
  );
}

export function EarnLedger({
  outcomes,
  countsByKind
}: {
  outcomes: EarnOutcome[];
  countsByKind: Partial<Record<OutcomeKind, number>>;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  // Only show chips for kinds that actually have outcomes — the ledger never
  // advertises an empty filter.
  const activeKinds = useMemo(
    () => OUTCOME_KIND_ORDER.filter((k) => (countsByKind[k] ?? 0) > 0),
    [countsByKind]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return outcomes.filter((o) => {
      if (filter !== 'all' && o.kind !== filter) return false;
      if (!q) return true;
      const member = getMember(o.specialistSlug);
      const hay = [o.title, o.summary ?? '', member?.name ?? '', OUTCOME_KINDS[o.kind].label]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [outcomes, filter, query]);

  return (
    <div className="fx-rise mx-auto max-w-[760px]">
      {/* header */}
      <div className="mb-5 flex items-start gap-3">
        <EarnCoin size={40} online className="flex-none" />
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold tracking-[-0.01em] text-fg-1">Earn Ledger</h1>
          <p className="mt-0.5 text-[12.5px] text-fg-4">
            Every move your executive team made, on the record — searchable, reusable, and proven.
          </p>
        </div>
      </div>

      {outcomes.length === 0 ? (
        <div className="rounded-[16px] border border-hairline bg-surface-1 px-6 py-12 text-center">
          <div className="mx-auto mb-3 flex w-fit">
            <EarnCoin size={44} />
          </div>
          <div className="text-[14px] font-semibold text-fg-1">Your ledger is ready</div>
          <p className="mx-auto mt-1.5 max-w-[420px] text-[12.5px] leading-relaxed text-fg-4">
            Approve an action with Earn — source a deal, run the committee, draft an LP letter — and
            it lands here. Nothing evaporates: every outcome stays searchable and links back to
            where it lives.
          </p>
        </div>
      ) : (
        <>
          {/* search + filter chips */}
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-hairline bg-surface-1 px-3 py-2">
            <Search size={15} className="flex-none text-fg-5" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search outcomes, desks, deals…"
              className="flex-1 bg-transparent text-[13px] text-fg-1 placeholder:text-fg-5 focus:outline-none"
              aria-label="Search the ledger"
            />
          </div>
          <div className="mb-4 flex flex-wrap gap-1.5">
            <FilterChip
              label="All"
              count={outcomes.length}
              active={filter === 'all'}
              onClick={() => setFilter('all')}
            />
            {activeKinds.map((k) => (
              <FilterChip
                key={k}
                label={OUTCOME_KINDS[k].label}
                count={countsByKind[k] ?? 0}
                active={filter === k}
                onClick={() => setFilter(k)}
              />
            ))}
          </div>

          {/* rows */}
          {visible.length === 0 ? (
            <div className="rounded-[14px] border border-hairline bg-surface-1 px-5 py-8 text-center text-[12.5px] text-fg-4">
              Nothing matches that filter yet.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {visible.map((o) => {
                const member = getMember(o.specialistSlug);
                const meta = OUTCOME_KINDS[o.kind];
                const KindIcon = OUTCOME_ICONS[o.kind];
                return (
                  <div
                    key={o.id}
                    className="flex items-start gap-3 rounded-[14px] border border-hairline bg-surface-1 px-4 py-3.5"
                  >
                    <SpecialistMark slug={o.specialistSlug} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-faint)] bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-fg-4">
                          <KindIcon size={11} strokeWidth={2} aria-hidden />
                          {meta.label}
                        </span>
                        <span className="text-[11px] text-fg-5">{relativeTime(o.createdAt)}</span>
                      </div>
                      <div className="mt-1.5 truncate text-[13.5px] font-semibold text-fg-1">
                        {o.title}
                      </div>
                      {o.summary && (
                        <div className="mt-0.5 text-[12px] leading-relaxed text-fg-3">
                          {o.summary}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-5">
                        {member && <span>{member.name}</span>}
                        {o.hasTrustProof && (
                          <Link
                            href="/execute/chain-of-trust"
                            className="inline-flex items-center gap-1 text-success hover:underline"
                          >
                            <ShieldCheck size={12} aria-hidden />
                            On the Chain of Trust
                          </Link>
                        )}
                      </div>
                    </div>
                    {o.homeHref && (
                      <Link
                        href={o.homeHref}
                        className="inline-flex flex-none items-center gap-1 self-center rounded-lg border border-hairline px-2.5 py-1.5 text-[11.5px] font-semibold text-azure-1 transition hover:border-[var(--azure-line)] hover:bg-[var(--azure-soft)]"
                      >
                        {o.homeSurface ?? 'Open'}
                        <ArrowUpRight size={13} strokeWidth={2} aria-hidden />
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition',
        active
          ? 'border-[var(--gold-line)] bg-[var(--gold-soft)] text-fg-1'
          : 'border-hairline bg-surface-1 text-fg-3 hover:bg-surface-2'
      )}
    >
      {label}
      <span className="text-[10.5px] text-fg-5 [font-feature-settings:'tnum']">{count}</span>
    </button>
  );
}
