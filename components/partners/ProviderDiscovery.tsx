'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sparkles,
  Search,
  X,
  Loader2,
  Plus,
  Check,
  Building2,
  CircleDollarSign,
  UserCog,
  Info
} from 'lucide-react';
import { Badge, Button, SegTabs, type TabItem } from '@/components/ui';
import { adoptProvider } from '@/lib/actions/partners';
import type { DiscoveredProvider } from '@/lib/ai/partner-discovery';

/* ============================================================================
 * ProviderDiscovery — the AI search experience for the Partner Marketplace.
 * Describe a need in plain English; the LLM returns provider candidates the
 * operator can vet and "add to ops" (directory + intro request + an assigned
 * action-queue task). AI-suggested — clearly labelled "verify". Falls back to
 * a manual-add note when the AI key isn't configured.
 * ========================================================================= */

const KIND_TABS: TabItem[] = [
  { id: 'both', label: 'Both' },
  { id: 'service', label: 'Service' },
  { id: 'capital', label: 'Capital' }
];

const EXAMPLES = [
  'Fund administrators for a sub-$50M emerging manager',
  'Family offices that back first-time funds',
  'Fund formation counsel in Delaware',
  'Fund-of-funds focused on lower-middle-market PE'
];

function money(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

function humanize(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

type AdoptState = 'idle' | 'pending' | 'done' | 'error';

function CandidateCard({ c, index }: { c: DiscoveredProvider; index: number }) {
  const router = useRouter();
  const [state, setState] = useState<AdoptState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const accent = c.kind === 'capital' ? 'var(--gold-1)' : 'var(--azure-1)';

  function adopt() {
    setError(null);
    setState('pending');
    startTransition(async () => {
      try {
        const res = await adoptProvider({
          kind: c.kind,
          name: c.name,
          category: c.category ?? null,
          capitalTypes: c.capitalTypes,
          checkSizeMin: c.checkSizeMin ?? null,
          checkSizeMax: c.checkSizeMax ?? null,
          capabilities: c.capabilities,
          description: c.description,
          fitRationale: c.fitRationale,
          suggestedSpecialist: c.suggestedSpecialist
        });
        if (res.ok) {
          setState('done');
          router.refresh();
        } else {
          setState('error');
          setError(res.error);
        }
      } catch {
        setState('error');
        setError('Could not add provider.');
      }
    });
  }

  const chips = c.kind === 'capital' ? (c.capitalTypes ?? []) : (c.capabilities ?? []).slice(0, 5);
  const hasCheck = c.checkSizeMin != null || c.checkSizeMax != null;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-hairline bg-surface-1 p-4">
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: accent }}
      />
      <div className="pl-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-[14px] font-semibold text-fg-1">{c.name}</h4>
              <Badge tone={c.kind === 'capital' ? 'gold' : 'azure'} className="text-[10px]">
                {c.kind === 'capital' ? 'Capital' : 'Service'}
              </Badge>
            </div>
            <p className="mt-0.5 inline-flex items-center gap-1.5 text-[12px] text-fg-4">
              {c.kind === 'capital' ? (
                <CircleDollarSign size={12} strokeWidth={1.9} className="text-gold-1" aria-hidden />
              ) : (
                <Building2 size={12} strokeWidth={1.9} className="text-azure-1" aria-hidden />
              )}
              {c.kind === 'capital'
                ? (c.capitalTypes ?? []).map(humanize).join(' · ') || 'Capital provider'
                : c.category
                  ? humanize(c.category)
                  : 'Service provider'}
              {hasCheck ? (
                <span className="text-gold-1">
                  {' · '}
                  {c.checkSizeMin != null ? money(c.checkSizeMin) : '—'}–
                  {c.checkSizeMax != null ? money(c.checkSizeMax) : '—'}
                </span>
              ) : null}
            </p>
          </div>
          {state === 'done' ? (
            <span className="inline-flex flex-none items-center gap-1.5 text-[12px] font-medium text-success">
              <Check size={14} strokeWidth={2.4} aria-hidden /> Added
            </span>
          ) : (
            <Button
              size="sm"
              variant="primary"
              icon={state === 'pending' ? Loader2 : Plus}
              disabled={state === 'pending'}
              onClick={adopt}
              className="flex-none"
            >
              {state === 'pending' ? 'Adding…' : 'Add to ops'}
            </Button>
          )}
        </div>

        {c.description ? (
          <p className="mt-2 text-[12px] leading-5 text-fg-3">{c.description}</p>
        ) : null}
        {c.fitRationale ? (
          <p className="mt-1.5 text-[11.5px] leading-5 text-fg-4">
            <span className="font-medium text-fg-3">Why it fits:</span> {c.fitRationale}
          </p>
        ) : null}

        {chips.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {chips.map((t) => (
              <span
                key={t}
                className="rounded-lg border border-hairline bg-bg-1 px-2 py-0.5 text-[11px] text-fg-3"
              >
                {humanize(t)}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-2.5 inline-flex items-center gap-1.5 text-[11px] text-fg-5">
          <UserCog size={12} strokeWidth={1.9} className="text-azure-1" aria-hidden />
          On add, assigned to <span className="font-medium text-fg-3">{c.suggestedSpecialist}</span>
        </div>

        {error ? <p className="mt-1.5 text-[11px] text-danger">{error}</p> : null}
      </div>
      <span className="sr-only">Candidate {index + 1}</span>
    </div>
  );
}

export function ProviderDiscovery({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<string>('both');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    configured: boolean;
    candidates: DiscoveredProvider[];
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/partners/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, kind })
      });
      const data = (await res.json().catch(() => null)) as {
        configured?: boolean;
        candidates?: DiscoveredProvider[];
        error?: string;
      } | null;
      if (!res.ok) {
        setError(data?.error ?? `Search failed (${res.status})`);
        setResult(null);
      } else {
        setResult({
          configured: data?.configured ?? true,
          candidates: Array.isArray(data?.candidates) ? data!.candidates : []
        });
      }
    } catch {
      setError('Search failed. Try again.');
    } finally {
      setLoading(false);
    }
  }, [query, kind]);

  // Esc to close; focus the input on open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Discover providers with AI"
    >
      <button
        type="button"
        className="absolute inset-0 bg-[rgba(3,6,12,0.6)] backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative mt-6 flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-hairline bg-bg-1 shadow-[var(--shadow-lg)] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-150">
        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-hairline px-5 py-3.5">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-xl border border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1">
            <Sparkles size={16} strokeWidth={2} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[14px] font-semibold text-fg-1">Discover providers with AI</h3>
            <p className="truncate text-[11.5px] text-fg-4">
              Describe what you need — bring the best matches into your ops.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-4 transition hover:bg-surface-2 hover:text-fg-1"
          >
            <X size={15} strokeWidth={2} aria-hidden />
          </button>
        </div>

        {/* Search controls */}
        <div className="flex flex-col gap-3 border-b border-hairline px-5 py-3.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-5">
                <Search size={15} strokeWidth={1.9} aria-hidden />
              </span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void run();
                }}
                placeholder="e.g. fund administrators for an emerging manager"
                aria-label="Describe the provider you need"
                className="w-full rounded-xl border border-hairline bg-surface-1 py-2.5 pl-9 pr-3 text-[13px] text-fg-1 outline-none transition placeholder:text-fg-4 focus:border-[var(--accent-line)]"
              />
            </div>
            <Button
              variant="primary"
              icon={loading ? Loader2 : Sparkles}
              disabled={loading || query.trim().length === 0}
              onClick={() => void run()}
            >
              {loading ? 'Searching…' : 'Discover'}
            </Button>
          </div>
          <div className="flex items-center justify-between gap-3">
            <SegTabs tabs={KIND_TABS} active={kind} onChange={setKind} />
            <span className="text-[10.5px] uppercase tracking-[0.08em] text-fg-5">AI · verify</span>
          </div>
        </div>

        {/* Results */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <p className="rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2 text-[12px] text-danger">
              {error}
            </p>
          ) : null}

          {!result && !loading && !error ? (
            <div className="flex flex-col gap-3">
              <p className="text-[12px] text-fg-4">Try one of these:</p>
              <div className="flex flex-col gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => {
                      setQuery(ex);
                      inputRef.current?.focus();
                    }}
                    className="flex items-center gap-2 rounded-xl border border-hairline bg-surface-1 px-3 py-2 text-left text-[12.5px] text-fg-3 transition hover:bg-surface-2 hover:text-fg-1"
                  >
                    <Search
                      size={13}
                      strokeWidth={1.9}
                      className="flex-none text-fg-5"
                      aria-hidden
                    />
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[12.5px] text-fg-4">
              <Loader2 size={16} strokeWidth={2} className="animate-spin" aria-hidden />
              Searching the market…
            </div>
          ) : null}

          {result && !result.configured ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-hairline bg-surface-1 px-4 py-3 text-[12px] text-fg-3">
              <Info
                size={15}
                strokeWidth={1.9}
                className="mt-0.5 flex-none text-azure-1"
                aria-hidden
              />
              <span>
                AI discovery isn&rsquo;t configured on this environment yet. You can still add
                providers manually from the directory — it&rsquo;ll light up automatically once the
                AI key is set.
              </span>
            </div>
          ) : null}

          {result && result.configured && result.candidates.length === 0 && !loading ? (
            <p className="py-10 text-center text-[12.5px] text-fg-4">
              No candidates came back. Try rephrasing the need.
            </p>
          ) : null}

          {result && result.configured && result.candidates.length > 0 ? (
            <div className="flex flex-col gap-3">
              {result.candidates.map((c, i) => (
                <CandidateCard key={`${c.name}-${i}`} c={c} index={i} />
              ))}
              <p className="mt-1 text-center text-[11px] text-fg-5">
                AI-suggested candidates — verify details before outreach.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default ProviderDiscovery;
