"use client";

// Global search UI: a submit-driven search box that writes the query into the
// ?q= param (the RSC page re-runs the query) plus the grouped results. Dark/gold
// theme, war-room links per hit. Client component so the input can own its
// value and navigate on submit.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SearchResults, SearchHit, SearchKind } from "@/lib/search";
import { RecordLifecycleActions } from "@/components/RecordLifecycleActions";

const KIND_LABEL: Record<SearchKind, string> = {
  deal: "Deal",
  investor: "LP",
  asset: "Asset",
};

function KindBadge({ kind }: { kind: SearchKind }) {
  return (
    <span className="shrink-0 rounded-full border border-gold-500/40 bg-gold-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
      {KIND_LABEL[kind]}
    </span>
  );
}

function HitRow({ hit }: { hit: SearchHit }) {
  const lifecycle =
    hit.kind === "deal"
      ? { hub: "deal", table: "deals" }
      : hit.kind === "investor"
        ? { hub: "investor", table: "investors" }
        : { hub: "asset", table: "assets" };

  return (
    <div className="fx-card fx-card-hover flex items-center gap-3 px-3 py-2.5">
      <Link href={hit.href} className="min-w-0 flex-1">
        <span className="block truncate text-sm text-fg-primary transition hover:text-gold-300">{hit.title}</span>
        {hit.subtitle ? (
          <span className="block truncate font-mono text-[10px] uppercase tracking-wide text-fg-muted">
            {hit.subtitle}
          </span>
        ) : null}
      </Link>
      <KindBadge kind={hit.kind} />
      <RecordLifecycleActions
        hub={lifecycle.hub}
        module={hit.id}
        table={lifecycle.table}
        id={hit.id}
        deleteClassName=""
      />
    </div>
  );
}

function ResultGroup({ label, hits }: { label: string; hits: SearchHit[] }) {
  if (hits.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="mb-3 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-fg-muted">
        <span aria-hidden className="h-3 w-0.5 rounded-full bg-gold-500/70" />
        {label}
        <span className="text-fg-muted/70">· {hits.length}</span>
      </h2>
      <div className="flex flex-col gap-2">
        {hits.map((hit) => (
          <HitRow key={hit.id} hit={hit} />
        ))}
      </div>
    </section>
  );
}

export function SearchView({ results }: { results: SearchResults }) {
  const router = useRouter();
  const [value, setValue] = useState(results.query);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = value.trim();
    router.push(next ? `/search?q=${encodeURIComponent(next)}` : "/search");
  }

  const hasQuery = results.query.trim().length > 0;
  const hasHits = results.total > 0;

  return (
    <div>
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          type="search"
          name="q"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          placeholder="Search deals, LPs, and assets…"
          aria-label="Search deals, LPs, and assets"
          className="flex-1 rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-lg bg-gold-500 px-4 py-2 text-xs font-medium text-surface-0 shadow-[0_4px_14px_-6px_rgba(196,151,74,0.6)] transition hover:bg-gold-400"
        >
          Search
        </button>
      </form>

      {!hasQuery ? (
        <p className="mt-8 text-sm text-fg-muted">
          Type at least two characters to search across deals, LPs, and assets.
        </p>
      ) : !hasHits ? (
        <p className="mt-8 text-sm text-fg-muted">
          No matches for{" "}
          <span className="text-fg-secondary">&ldquo;{results.query}&rdquo;</span>. Try a
          different name.
        </p>
      ) : (
        <>
          <ResultGroup label="Deals" hits={results.deals} />
          <ResultGroup label="LPs" hits={results.investors} />
          <ResultGroup label="Assets" hits={results.assets} />
        </>
      )}
    </div>
  );
}
