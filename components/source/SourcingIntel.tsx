"use client";

import { useEffect, useRef, useState } from "react";
import {
  discoverEntities,
  findSimilarEntities,
  indexPipeline,
  addEntityToPipeline,
} from "@/app/(app)/[hub]/[module]/sourcing-intel-actions";
import type { DiscoveryHit, EntityKind } from "@/lib/sourcing-intel";

type Phase = "idle" | "searching" | "done";
type KindFilter = EntityKind | "all";

// Kind chips defined locally so this client bundle never value-imports the
// intelligence engine (which pulls server-only deps).
const KINDS: { key: KindFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "company", label: "Companies" },
  { key: "investor", label: "Investors" },
  { key: "fund", label: "Funds" },
  { key: "advisor", label: "Advisors" },
  { key: "lender", label: "Lenders" },
  { key: "provider", label: "Providers" },
];

const EXAMPLES = [
  "Founder-owned industrial services firms in the Southeast, $5–20M EBITDA",
  "Family offices that back first-time managers",
  "Private credit lenders for value-add real estate",
];

function scoreTone(score: number): string {
  if (score >= 70) return "text-status-success";
  if (score >= 45) return "text-gold-300";
  return "text-fg-muted";
}
function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Sourcing Intelligence — the dedicated discovery workspace. Natural-language
// search over the firm's first-party, embedded entity catalog (semantic, with a
// deterministic fallback), plus one-click lookalike ("find similar") and accept-
// to-pipeline. The catalog grows from AI/web discovery and the live pipeline.
export function SourcingIntel({
  live,
  initialPrompt,
}: {
  live: boolean;
  initialPrompt?: string;
}) {
  const [query, setQuery] = useState(initialPrompt ?? "");
  const [kind, setKind] = useState<KindFilter>("all");
  const [phase, setPhase] = useState<Phase>("idle");
  const [hits, setHits] = useState<DiscoveryHit[]>([]);
  const [discovered, setDiscovered] = useState(0);
  const [similar, setSimilar] = useState<{ anchor: string; hits: DiscoveryHit[] } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [indexing, setIndexing] = useState(false);
  const [indexNote, setIndexNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ranInitial = useRef(false);

  const busy = phase === "searching";

  async function run(q: string) {
    const clean = q.trim();
    if (!clean || busy) return;
    setError(null);
    setSimilar(null);
    setPhase("searching");
    try {
      const res = await discoverEntities(clean, kind === "all" ? null : kind);
      if (!res.ok) {
        setError(res.error ?? "Could not run discovery.");
        setPhase("idle");
        return;
      }
      setHits(res.hits ?? []);
      setDiscovered(res.discovered ?? 0);
      setPhase("done");
    } catch {
      setError("Could not run discovery.");
      setPhase("idle");
    }
  }

  useEffect(() => {
    if (initialPrompt && !ranInitial.current) {
      ranInitial.current = true;
      run(initialPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  async function showSimilar(h: DiscoveryHit) {
    if (!h.id || busyId) return;
    setBusyId(h.id);
    setError(null);
    try {
      const res = await findSimilarEntities(h.id);
      if (res.ok) setSimilar({ anchor: res.anchor ?? h.name, hits: res.hits ?? [] });
      else setError(res.error ?? "Could not find similar entities.");
    } catch {
      setError("Could not find similar entities.");
    } finally {
      setBusyId(null);
    }
  }

  async function addToPipeline(h: DiscoveryHit) {
    if (!h.id || busyId || added.has(h.id)) return;
    setBusyId(h.id);
    try {
      const res = await addEntityToPipeline(h.id);
      if (res.ok) setAdded((prev) => new Set(prev).add(h.id!));
      else setError(res.error ?? "Could not add to pipeline.");
    } catch {
      setError("Could not add to pipeline.");
    } finally {
      setBusyId(null);
    }
  }

  async function reindex() {
    if (indexing) return;
    setIndexing(true);
    setIndexNote(null);
    try {
      const res = await indexPipeline();
      setIndexNote(res.ok ? `Indexed ${res.indexed ?? 0} pipeline records.` : res.error ?? "Could not index.");
    } catch {
      setIndexNote("Could not index the pipeline.");
    } finally {
      setIndexing(false);
    }
  }

  function card(h: DiscoveryHit, idx: number) {
    const isAdded = h.id ? added.has(h.id) : false;
    return (
      <div
        key={h.id ?? `${h.name}:${idx}`}
        className="rounded-2xl border border-line bg-surface-1 p-4 transition hover:border-gold-500/40"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="truncate text-sm font-medium text-fg-primary">{h.name}</span>
              <span className={`shrink-0 font-mono text-xs ${scoreTone(h.score)}`}>{h.score}%</span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
              <span className="rounded-full border border-line px-1.5 py-0.5">{humanize(h.kind)}</span>
              {h.geography ? <span>{h.geography}</span> : null}
              {h.categories.slice(0, 3).map((c) => (
                <span key={c} className="text-gold-400">
                  {humanize(c)}
                </span>
              ))}
              {h.provenance === "pipeline" ? (
                <span className="text-status-info">in pipeline</span>
              ) : null}
            </div>
            {h.description ? <p className="mt-1.5 text-xs text-fg-secondary">{h.description}</p> : null}
            {h.sourceUrl ? (
              <a
                href={h.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block max-w-full truncate font-mono text-[10px] text-status-info hover:underline"
              >
                ↗ source
              </a>
            ) : null}
          </div>
        </div>
        {h.id ? (
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => showSimilar(h)}
              disabled={busyId === h.id}
              className="rounded-md border border-line px-2.5 py-1 text-[11px] text-fg-secondary transition hover:bg-surface-2 disabled:opacity-50"
            >
              ⌕ Find similar
            </button>
            <button
              type="button"
              onClick={() => addToPipeline(h)}
              disabled={busyId === h.id || isAdded}
              className="rounded-md border border-gold-500/40 bg-gold-500/10 px-2.5 py-1 text-[11px] font-medium text-gold-200 transition hover:bg-gold-500/20 disabled:opacity-50"
            >
              {isAdded ? "Added ✓" : busyId === h.id ? "Working…" : "Add to pipeline"}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            ✶ Sourcing Intelligence
          </span>
          {!live ? (
            <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
              local mode
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-fg-secondary">
          Search the firm&apos;s intelligence catalog in plain language, or find lookalikes of any
          entity. New AI/web discoveries fold into the catalog as you go.
        </p>
      </header>

      {/* Search */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(query);
        }}
        className="rounded-2xl border border-gold-500/25 bg-gradient-to-b from-gold-500/[0.06] to-transparent p-4"
      >
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={2}
          placeholder="e.g. Founder-owned industrial services firms in the Southeast, $5–20M EBITDA"
          className="w-full resize-none rounded-lg border border-line bg-surface-0 px-3 py-2.5 text-sm text-fg-primary outline-none focus:border-gold-500"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={() => setKind(k.key)}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                kind === k.key
                  ? "border-gold-500/50 bg-gold-500/10 text-fg-primary"
                  : "border-line text-fg-muted hover:bg-surface-2"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                disabled={busy}
                onClick={() => setQuery(ex)}
                className="rounded-full border border-line px-2.5 py-1 text-[11px] text-fg-muted transition hover:bg-surface-2 hover:text-fg-secondary disabled:opacity-50"
              >
                {ex.length > 42 ? `${ex.slice(0, 42)}…` : ex}
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={busy || !query.trim()}
            className="shrink-0 rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300 disabled:opacity-50"
          >
            {busy ? "Searching…" : "Discover"}
          </button>
        </div>
      </form>

      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={reindex}
          disabled={indexing}
          className="rounded-md border border-line px-2.5 py-1 text-[11px] text-fg-muted transition hover:bg-surface-2 disabled:opacity-50"
        >
          {indexing ? "Indexing…" : "Index my pipeline"}
        </button>
        {indexNote ? <span className="text-[11px] text-gold-300">{indexNote}</span> : null}
      </div>

      {error ? (
        <p className="mt-3 rounded-md border border-status-danger/40 bg-status-danger/5 px-3 py-2 text-xs text-status-danger">
          {error}
        </p>
      ) : null}

      {/* Lookalike drawer */}
      {similar ? (
        <div className="mt-5 rounded-2xl border border-gold-500/30 bg-gold-500/[0.04] p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
              Similar to {similar.anchor}
            </span>
            <button
              type="button"
              onClick={() => setSimilar(null)}
              className="font-mono text-[10px] uppercase tracking-wider text-fg-muted hover:text-fg-secondary"
            >
              ✕ close
            </button>
          </div>
          {similar.hits.length ? (
            <div className="space-y-3">{similar.hits.map((h, i) => card(h, i))}</div>
          ) : (
            <p className="text-sm text-fg-secondary">No lookalikes in the catalog yet.</p>
          )}
        </div>
      ) : null}

      {/* Results */}
      {phase === "done" ? (
        hits.length ? (
          <div className="mt-5 space-y-3">
            {discovered > 0 ? (
              <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                +{discovered} newly discovered · {hits.length} ranked
              </p>
            ) : null}
            {hits.map((h, i) => card(h, i))}
            <p className="text-[11px] text-fg-muted">
              Ranked by semantic relevance to your query. Added records land as AI-sourced and
              unverified — confirm them in the module.
            </p>
          </div>
        ) : (
          <p className="mt-6 rounded-xl border border-line bg-surface-1 px-4 py-3 text-sm text-fg-secondary">
            Nothing in the catalog matched yet. Try “Index my pipeline” to seed it, or refine the
            query.
          </p>
        )
      ) : null}
    </div>
  );
}
