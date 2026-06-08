'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import {
  Search,
  CircleDollarSign,
  Sparkles,
  Link2,
  Loader2,
  Layers,
  TrendingUp
} from 'lucide-react';
import {
  Badge,
  Card,
  Input,
  SectionTitle,
  SegTabs,
  type BadgeTone,
  type TabItem
} from '@/components/ui';
import { EmptyState } from '@/components/shell/EmptyState';
import { cn } from '@/lib/utils';
import { runNetworkSearch } from '@/lib/actions/network-search';
import type { NetworkSearchResult } from '@/lib/queries/network-search';
import type { CapitalCommitment } from '@/lib/queries/capital-stack';
import {
  deriveInstrument,
  matchesInstrument,
  INSTRUMENT_LABELS,
  type Instrument,
  type InstrumentFilter
} from '@/lib/capital/instrument';

/* ============================================================================
 * CapitalSearch — one searchable surface for capital.
 *
 * Replaces the old Equity / Debt / Hybrid rail split with a single box that
 * searches *both* sides of the raise at once:
 *   • your own stack (commitments already loaded on the page — filtered live)
 *   • capital sources in your network (capital_provider rows, via the hybrid
 *     `search_network` retrieval already powering LP & Partner search)
 *
 * Instrument (equity/debt/hybrid) is a derived facet — chips, not destinations.
 * No migration: see lib/capital/instrument.ts.
 * ========================================================================= */

function money(n: number, currency = 'USD'): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0
  }).format(n);
}

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const INSTRUMENT_TONE: Record<Instrument, BadgeTone> = {
  equity: 'azure',
  debt: 'gold',
  hybrid: 'success'
};

const CHIPS: TabItem[] = [
  { id: 'all', label: 'All capital' },
  { id: 'equity', label: 'Equity' },
  { id: 'debt', label: 'Debt' },
  { id: 'hybrid', label: 'Hybrid' }
];

/** A commitment paired with its derived instrument, so we classify once. */
interface ClassifiedCommitment {
  commitment: CapitalCommitment;
  instrument: Instrument;
}

function InstrumentBadge({ instrument }: { instrument: Instrument }) {
  return (
    <Badge tone={INSTRUMENT_TONE[instrument]} className="text-[10px]">
      {INSTRUMENT_LABELS[instrument]}
    </Badge>
  );
}

/* ---- Result rows -------------------------------------------------------- */

function StackRow({ item }: { item: ClassifiedCommitment }) {
  const c = item.commitment;
  return (
    <Card className="flex items-center gap-3 p-3.5">
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-hairline bg-bg-1 text-fg-3">
        <Layers size={16} strokeWidth={1.9} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[13.5px] font-semibold text-fg-1">
            {c.lpType ? titleCase(c.lpType) : 'Commitment'}
          </span>
          <InstrumentBadge instrument={item.instrument} />
          <Badge tone="neutral" className="text-[10px]">
            {titleCase(c.stage)}
          </Badge>
        </div>
        {c.tranche || c.notes ? (
          <p className="mt-0.5 truncate text-[12px] text-fg-4">
            {[c.tranche, c.notes].filter(Boolean).join(' · ')}
          </p>
        ) : null}
      </div>
      <span className="flex-none text-right text-[13px] font-semibold tabular-nums text-fg-1">
        {money(c.amount, c.currency)}
      </span>
    </Card>
  );
}

function SourceRow({
  result,
  instrument
}: {
  result: NetworkSearchResult;
  instrument: Instrument;
}) {
  const pct = result.similarity != null ? Math.round(result.similarity * 100) : null;
  return (
    <Card className="flex items-center gap-3 p-3.5">
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-hairline bg-bg-1 text-gold-1">
        <CircleDollarSign size={16} strokeWidth={1.9} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[13.5px] font-semibold text-fg-1">{result.name}</span>
          <InstrumentBadge instrument={instrument} />
          {result.alreadyConnected ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--success-line)] bg-[var(--success-soft)] px-2 py-0.5 text-[10px] font-medium text-success">
              <Link2 size={10} strokeWidth={2} aria-hidden />
              Warm intro
            </span>
          ) : null}
        </div>
        {result.subtitle ? (
          <p className="mt-0.5 truncate text-[12px] text-fg-4">{result.subtitle}</p>
        ) : null}
      </div>
      {pct != null ? (
        <span className="inline-flex flex-none items-center gap-1 rounded-lg border border-hairline bg-surface-1 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-azure-1">
          <Sparkles size={11} strokeWidth={2} aria-hidden />
          {pct}%
        </span>
      ) : null}
    </Card>
  );
}

/* ---- Main --------------------------------------------------------------- */

export interface CapitalSearchProps {
  commitments: CapitalCommitment[];
}

export function CapitalSearch({ commitments }: CapitalSearchProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<InstrumentFilter>('all');
  const [sources, setSources] = useState<NetworkSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [semantic, setSemantic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const requestIdRef = useRef(0);

  // Classify each commitment once; re-derives only when the list changes.
  const classified = useMemo<ClassifiedCommitment[]>(
    () =>
      commitments.map((c) => ({
        commitment: c,
        instrument: deriveInstrument(c.tranche, c.notes, c.lpType, c.stage)
      })),
    [commitments]
  );

  // Live, client-side filter of the user's own stack — text + instrument chip.
  const stackMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return classified.filter(({ commitment: c, instrument }) => {
      if (!matchesInstrument(instrument, filter)) return false;
      if (!q) return true;
      const hay = [c.lpType, c.stage, c.tranche, c.notes, INSTRUMENT_LABELS[instrument]]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [classified, query, filter]);

  // Capital sources from the network, classified + filtered by the same chip.
  const sourceMatches = useMemo(() => {
    return sources
      .map((r) => ({
        result: r,
        instrument: deriveInstrument(
          r.subtitle,
          r.name,
          // capital_types often arrives on metadata; fold it into the haystack.
          Array.isArray(r.metadata?.capital_types)
            ? (r.metadata.capital_types as unknown[]).join(' ')
            : typeof r.metadata?.capital_type === 'string'
              ? (r.metadata.capital_type as string)
              : null
        )
      }))
      .filter(({ instrument }) => matchesInstrument(instrument, filter));
  }, [sources, filter]);

  function searchSources() {
    const q = query.trim();
    // Always advance the request id — even on clear — so any in-flight response
    // from a prior search loses the stale-check and can't repopulate results.
    const requestId = ++requestIdRef.current;
    if (!q) {
      setSources([]);
      setSearched(false);
      setSemantic(false);
      setError(null);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await runNetworkSearch({ query: q, kinds: ['capital_provider'] });
        if (requestId !== requestIdRef.current) return; // drop stale response
        setSearched(true);
        if (res.ok) {
          setSources(res.results);
          setSemantic(res.semantic);
        } else {
          setSources([]);
          setSemantic(false);
          setError('Capital-source search failed. Your stack results are still shown.');
        }
      } catch {
        // The action returns {ok:false} rather than throwing, but guard anyway
        // so an unexpected throw still degrades to the fallback error UX.
        if (requestId !== requestIdRef.current) return;
        setSearched(true);
        setSources([]);
        setSemantic(false);
        setError('Capital-source search failed. Your stack results are still shown.');
      }
    });
  }

  const totalStack = stackMatches.reduce((sum, m) => sum + m.commitment.amount, 0);
  const stackCurrency = commitments[0]?.currency ?? 'USD';

  return (
    <section aria-label="Find capital" className="space-y-4">
      <SectionTitle
        eyebrow="Aggregate & allocate"
        title="Find capital"
        action={
          semantic ? (
            <Badge tone="azure" className="text-[10.5px]">
              <Sparkles size={11} strokeWidth={2} className="mr-1 inline" aria-hidden />
              Semantic
            </Badge>
          ) : null
        }
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          searchSources();
        }}
        className="space-y-3"
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search capital — e.g. family offices for venture debt, or filter your stack"
          icon={Search}
          aria-label="Search capital"
        />
        <div className="flex items-center justify-between gap-3">
          <SegTabs
            tabs={CHIPS}
            active={filter}
            onChange={(id) => setFilter(id as InstrumentFilter)}
          />
          <button
            type="submit"
            disabled={pending}
            className="inline-flex flex-none items-center gap-1.5 rounded-[10px] border border-hairline bg-surface-1 px-3 py-1.5 text-[12px] font-medium text-fg-2 transition hover:border-[var(--azure-line)] hover:bg-[var(--azure-soft)] hover:text-azure-1 disabled:opacity-50"
          >
            {pending ? (
              <Loader2 size={13} strokeWidth={2} className="animate-spin" aria-hidden />
            ) : (
              <Search size={13} strokeWidth={2} aria-hidden />
            )}
            Search sources
          </button>
        </div>
      </form>

      {error ? <p className="text-[12px] text-warning">{error}</p> : null}

      {/* In your stack — always live, filters as you type. */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-0.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-4">
            In your stack
          </span>
          <span className="text-[11px] tabular-nums text-fg-4">
            {stackMatches.length} · {money(totalStack, stackCurrency)}
          </span>
        </div>
        {stackMatches.length > 0 ? (
          <div className="grid gap-2">
            {stackMatches.map((m) => (
              <StackRow key={m.commitment.id} item={m} />
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-hairline bg-surface-1/40 px-3.5 py-3 text-[12px] text-fg-4">
            {commitments.length === 0
              ? 'No commitments in your stack yet.'
              : 'No commitments match this search or filter.'}
          </p>
        )}
      </div>

      {/* Capital sources — from your network, on demand. */}
      {searched ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-4">
              Capital sources
            </span>
            <span className="text-[11px] tabular-nums text-fg-4">{sourceMatches.length}</span>
          </div>
          {sourceMatches.length > 0 ? (
            <div className="grid gap-2">
              {sourceMatches.map(({ result, instrument }) => (
                <SourceRow
                  key={`${result.kind}:${result.id}`}
                  result={result}
                  instrument={instrument}
                />
              ))}
            </div>
          ) : !pending ? (
            <EmptyState
              icon={TrendingUp}
              title="No capital sources match"
              body="Broaden the query or switch the instrument filter. Semantic matching sharpens as your capital providers get embedded."
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
