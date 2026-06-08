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
  CircleDollarSign,
  UserCog,
  Info,
  Copy,
  MessageSquareQuote
} from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { adoptLp } from '@/lib/actions/lp-pipeline';
import type { DiscoveredLp } from '@/lib/ai/lp-discovery';

/* ============================================================================
 * LpFinder — the AI LP search for the LP Pipeline. Describe a raise thesis;
 * the LLM returns enriched LP candidates (capital type, check size, fit, a
 * tailored first-touch note). "Add to pipeline" brings the LP into Prospect
 * with an assigned outreach task. AI-suggested — verify before outreach.
 * ========================================================================= */

const EXAMPLES = [
  'Family offices backing first-time sub-$50M funds',
  'Fund-of-funds active in lower-middle-market PE',
  'Endowments and foundations with emerging-manager programs',
  'RIA/wealth platforms allocating to private markets'
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

function LpCandidateCard({ c }: { c: DiscoveredLp }) {
  const router = useRouter();
  const [state, setState] = useState<AdoptState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [showNote, setShowNote] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, startTransition] = useTransition();
  const hasCheck = c.checkSizeMin != null || c.checkSizeMax != null;

  function add() {
    setError(null);
    setState('pending');
    startTransition(async () => {
      try {
        const res = await adoptLp({
          name: c.name,
          capitalTypes: c.capitalTypes,
          checkSizeMin: c.checkSizeMin,
          checkSizeMax: c.checkSizeMax,
          description: c.description,
          fitRationale: c.fitRationale,
          suggestedSpecialist: c.suggestedSpecialist,
          firstTouchNote: c.firstTouchNote
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
        setError('Could not add LP.');
      }
    });
  }

  function copyNote() {
    navigator.clipboard?.writeText(c.firstTouchNote).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => undefined
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-hairline bg-surface-1 p-4">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-gold-1" />
      <div className="pl-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="text-[14px] font-semibold text-fg-1">{c.name}</h4>
            <p className="mt-0.5 inline-flex flex-wrap items-center gap-1.5 text-[12px] text-fg-4">
              <CircleDollarSign size={12} strokeWidth={1.9} className="text-gold-1" aria-hidden />
              {c.capitalTypes.map(humanize).join(' · ') || 'Limited partner'}
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
              onClick={add}
              className="flex-none"
            >
              {state === 'pending' ? 'Adding…' : 'Add to pipeline'}
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

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-5">
            <UserCog size={12} strokeWidth={1.9} className="text-azure-1" aria-hidden />
            Owner: <span className="font-medium text-fg-3">{c.suggestedSpecialist}</span>
          </span>
          {c.firstTouchNote ? (
            <button
              type="button"
              onClick={() => setShowNote((v) => !v)}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-azure-1 transition hover:brightness-110"
            >
              <MessageSquareQuote size={12} strokeWidth={2} aria-hidden />
              {showNote ? 'Hide first-touch note' : 'First-touch note'}
            </button>
          ) : null}
        </div>

        {showNote && c.firstTouchNote ? (
          <div className="mt-2 rounded-xl border border-hairline bg-bg-1 p-3">
            <p className="text-[11.5px] leading-5 text-fg-3">{c.firstTouchNote}</p>
            <button
              type="button"
              onClick={copyNote}
              className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-azure-1 transition hover:brightness-110"
            >
              {copied ? (
                <Check size={12} strokeWidth={2.4} aria-hidden />
              ) : (
                <Copy size={12} strokeWidth={2} aria-hidden />
              )}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        ) : null}

        {error ? <p className="mt-1.5 text-[11px] text-danger">{error}</p> : null}
      </div>
    </div>
  );
}

export function LpFinder({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ configured: boolean; candidates: DiscoveredLp[] } | null>(
    null
  );
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/lp-pipeline/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q })
      });
      const data = (await res.json().catch(() => null)) as {
        configured?: boolean;
        candidates?: DiscoveredLp[];
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
  }, [query]);

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
      aria-label="Find LPs with AI"
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
            <h3 className="text-[14px] font-semibold text-fg-1">Find LPs with AI</h3>
            <p className="truncate text-[11.5px] text-fg-4">
              Describe your raise — bring matched LPs into your pipeline.
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

        {/* Search */}
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
                placeholder="e.g. family offices backing first-time funds"
                aria-label="Describe your raise thesis"
                className="w-full rounded-xl border border-hairline bg-surface-1 py-2.5 pl-9 pr-3 text-[13px] text-fg-1 outline-none transition placeholder:text-fg-4 focus:border-[var(--accent-line)]"
              />
            </div>
            <Button
              variant="primary"
              icon={loading ? Loader2 : Sparkles}
              disabled={loading || query.trim().length === 0}
              onClick={() => void run()}
            >
              {loading ? 'Searching…' : 'Find LPs'}
            </Button>
          </div>
          <span className="text-[10.5px] uppercase tracking-[0.08em] text-fg-5">AI · verify</span>
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
              Searching the LP universe…
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
                AI LP discovery isn&rsquo;t configured on this environment yet. You can still add
                LPs manually — it&rsquo;ll light up once the AI key is set.
              </span>
            </div>
          ) : null}

          {result && result.configured && result.candidates.length === 0 && !loading ? (
            <p className="py-10 text-center text-[12.5px] text-fg-4">
              No LPs came back. Try rephrasing your thesis.
            </p>
          ) : null}

          {result && result.configured && result.candidates.length > 0 ? (
            <div className="flex flex-col gap-3">
              {result.candidates.map((c, i) => (
                <LpCandidateCard key={`${c.name}-${i}`} c={c} />
              ))}
              <p className="mt-1 text-center text-[11px] text-fg-5">
                AI-suggested LPs — verify details before outreach.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default LpFinder;
