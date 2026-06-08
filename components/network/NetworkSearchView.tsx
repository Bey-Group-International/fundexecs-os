'use client';

import { useRef, useState, useTransition } from 'react';
import { Search, Users, Building2, CircleDollarSign, Sparkles, Link2, Loader2 } from 'lucide-react';
import { Badge, Button, Card, Input, SectionTitle, SegTabs, type TabItem } from '@/components/ui';
import { EmptyState } from '@/components/shell/EmptyState';
import { cn } from '@/lib/utils';
import { runNetworkSearch } from '@/lib/actions/network-search';
import type { NetworkKind, NetworkSearchResult } from '@/lib/queries/network-search';

/* ---- Helpers ------------------------------------------------------------ */

const KIND_META: Record<
  NetworkKind,
  { label: string; icon: typeof Users; tone: 'azure' | 'gold' | 'neutral' }
> = {
  contact: { label: 'Contact', icon: Users, tone: 'azure' },
  service_provider: { label: 'Service', icon: Building2, tone: 'neutral' },
  capital_provider: { label: 'Capital', icon: CircleDollarSign, tone: 'gold' }
};

const TABS: TabItem[] = [
  { id: 'all', label: 'All' },
  { id: 'capital_provider', label: 'Capital' },
  { id: 'service_provider', label: 'Service' },
  { id: 'contact', label: 'Contacts' }
];

function kindsFor(tab: string): NetworkKind[] | undefined {
  if (tab === 'all') return undefined;
  return [tab as NetworkKind];
}

/* ---- Result card -------------------------------------------------------- */

function ResultCard({ result }: { result: NetworkSearchResult }) {
  const meta = KIND_META[result.kind];
  const Icon = meta.icon;
  const pct = result.similarity != null ? Math.round(result.similarity * 100) : null;

  return (
    <Card className="flex items-start gap-3 p-4">
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-hairline bg-bg-1 text-fg-3">
        <Icon size={16} strokeWidth={1.9} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-[14px] font-semibold text-fg-1">{result.name}</h3>
          <Badge tone={meta.tone} className="text-[10px]">
            {meta.label}
          </Badge>
          {result.alreadyConnected ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--success-line)] bg-[var(--success-soft)] px-2 py-0.5 text-[10px] font-medium text-success">
              <Link2 size={10} strokeWidth={2} aria-hidden />
              In your network
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

/* ---- Main view ---------------------------------------------------------- */

export function NetworkSearchView() {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('all');
  const [results, setResults] = useState<NetworkSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [semantic, setSemantic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const requestIdRef = useRef(0);

  function search(nextTab?: string) {
    const kinds = kindsFor(nextTab ?? tab);
    const requestId = ++requestIdRef.current;
    setError(null);
    startTransition(async () => {
      const res = await runNetworkSearch({ query, kinds });
      // Ignore a stale response if a newer search has since been issued.
      if (requestId !== requestIdRef.current) return;
      setSearched(true);
      if (res.ok) {
        setResults(res.results);
        setSemantic(res.semantic);
      } else {
        setResults([]);
        setSemantic(false);
        setError('Search failed. Please try again.');
      }
    });
  }

  function onTabChange(next: string) {
    setTab(next);
    if (searched) search(next);
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        eyebrow="LP & Partner search"
        title="Search your network"
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
          search();
        }}
        className="flex flex-col gap-3 sm:flex-row"
      >
        <div className="flex-1">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. family offices backing first-time sub-$50M funds"
            icon={Search}
            aria-label="Search your network"
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? (
            <Loader2 size={15} strokeWidth={2} className="animate-spin" aria-hidden />
          ) : (
            <Search size={15} strokeWidth={2} aria-hidden />
          )}
          Search
        </Button>
      </form>

      <SegTabs tabs={TABS} active={tab} onChange={onTabChange} />

      {error ? <p className="text-[12.5px] text-danger">{error}</p> : null}

      {!searched ? (
        <EmptyState
          icon={Search}
          title="Search across LPs, partners, and contacts"
          body="Describe who you're looking for in plain language. Results blend meaning-level matches with keyword and structured filters, and flag anyone already in your network for a warm intro."
        />
      ) : results.length === 0 && !pending ? (
        <EmptyState
          icon={Users}
          title="No matches yet"
          body="Try broadening your query or switching tabs. Semantic matching sharpens as your contacts and partners get embedded."
        />
      ) : (
        <div className={cn('grid gap-3', results.length > 1 && 'lg:grid-cols-2')}>
          {results.map((r) => (
            <ResultCard key={`${r.kind}:${r.id}`} result={r} />
          ))}
        </div>
      )}
    </div>
  );
}
