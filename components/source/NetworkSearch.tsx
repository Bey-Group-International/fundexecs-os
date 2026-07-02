"use client";

import { useState, useTransition } from "react";
import type { NetworkSearchResult } from "@/lib/network-search";

const STRENGTH_COLORS: Record<string, string> = {
  strong: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  active: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  warm: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  cold: "bg-fg-muted/10 text-fg-muted border-line",
};

interface Props {
  onSelectContact?: (contact: NetworkSearchResult) => void;
}

export function NetworkSearch({ onSelectContact }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NetworkSearchResult[]>([]);
  const [isPending, startTransition] = useTransition();
  const [hasSearched, setHasSearched] = useState(false);

  async function runSearch(q: string) {
    if (!q.trim()) return;
    setHasSearched(true);
    startTransition(async () => {
      const res = await fetch(`/api/network/search?q=${encodeURIComponent(q)}&limit=20`);
      if (res.ok) {
        const data = await res.json();
        setResults(data.results ?? []);
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Search bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch(query)}
            placeholder='Try "VPs of Sales in fintech" or "family offices in Austin"'
            className="w-full rounded-lg border border-line bg-surface pl-9 pr-4 py-2.5 text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <button
          onClick={() => runSearch(query)}
          disabled={isPending || !query.trim()}
          className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-40 transition-colors"
        >
          {isPending ? "Searching…" : "Search"}
        </button>
      </div>

      {/* Example queries */}
      {!hasSearched && (
        <div className="flex flex-wrap gap-2">
          {[
            "Who do I know raising a Series A?",
            "Family offices focused on real estate",
            "CFOs in my network",
            "Investors in climate tech",
          ].map((example) => (
            <button
              key={example}
              onClick={() => { setQuery(example); runSearch(example); }}
              className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-fg-muted hover:text-fg hover:border-fg-muted transition-colors"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      {isPending && (
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          Searching your network…
        </div>
      )}

      {!isPending && hasSearched && results.length === 0 && (
        <p className="text-sm text-fg-muted">No contacts found. Try importing your LinkedIn network.</p>
      )}

      {!isPending && results.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
            {results.length} result{results.length !== 1 ? "s" : ""}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {results.map((c) => (
              <ContactCard
                key={c.id}
                contact={c}
                onClick={() => onSelectContact?.(c)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ContactCard({
  contact,
  onClick,
}: {
  contact: NetworkSearchResult;
  onClick: () => void;
}) {
  const label = contact.strengthLabel ?? "cold";
  const colorCls = STRENGTH_COLORS[label] ?? STRENGTH_COLORS.cold;

  return (
    <button
      onClick={onClick}
      className="rounded-xl border border-line bg-surface p-4 text-left hover:border-fg-muted/40 hover:bg-surface/80 transition-all group"
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent font-semibold text-sm">
          {contact.avatarUrl ? (
            <img src={contact.avatarUrl} alt={contact.fullName} className="h-10 w-10 rounded-full object-cover" />
          ) : (
            contact.fullName.split(" ").map((n) => n[0]).slice(0, 2).join("")
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-fg truncate">{contact.fullName}</span>
            <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${colorCls}`}>
              {label}
            </span>
          </div>
          {(contact.title || contact.company) && (
            <p className="text-xs text-fg-muted mt-0.5 truncate">
              {[contact.title, contact.company].filter(Boolean).join(" · ")}
            </p>
          )}
          {contact.location && (
            <p className="text-xs text-fg-muted/70 mt-0.5 truncate">{contact.location}</p>
          )}

          {/* Relevance reason */}
          <p className="mt-2 text-xs text-fg-muted line-clamp-2">{contact.relevanceReason}</p>

          {/* Intro path */}
          {contact.introPath && contact.introPath.length > 0 && (
            <div className="mt-2 flex items-center gap-1 flex-wrap">
              {contact.introPath.map((name, i) => (
                <span key={i} className="flex items-center gap-1">
                  <span className="text-[11px] font-medium text-fg-muted">{name}</span>
                  {i < contact.introPath!.length - 1 && (
                    <svg className="h-3 w-3 text-fg-muted/40 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
