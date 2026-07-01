"use client";

import { useState, useMemo } from "react";
import type { MarketplaceStatus } from "@/lib/supabase/database.types";
import type { ReputationTier } from "@/lib/compounding";
import { TierBadge } from "@/components/TierBadge";

const STATUS_BADGE: Record<MarketplaceStatus, string> = {
  listed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  draft: "border-line text-fg-muted",
  paused: "border-gold-500/40 bg-gold-500/10 text-gold-300",
  closed: "border-line text-fg-muted/70",
};

const STATUS_LABEL: Record<MarketplaceStatus, string> = {
  listed: "Listed",
  draft: "Draft",
  paused: "Paused",
  closed: "Closed",
};

const TYPE_LABELS: Record<string, string> = {
  deal: "Deal",
  fund: "Fund",
  co_invest: "Co-invest",
  secondary: "Secondary",
  service: "Service",
};

function formatAmount(amount: number | null): string | null {
  if (amount == null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function prettyType(t: string): string {
  return TYPE_LABELS[t] ?? t.split(/[_\s]+/).map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 30) return `${d}d ago`;
  const m = Math.floor(d / 30);
  if (m < 12) return `${m}mo ago`;
  return `${Math.floor(m / 12)}y ago`;
}

const TIER_ORDER: ReputationTier[] = ["principal", "established", "verified", "unranked"];

export type BrowseListing = {
  id: string;
  title: string;
  listing_type: string;
  summary: string | null;
  amount: number | null;
  status: MarketplaceStatus;
  created_at: string;
  organization_id: string;
  organizations: { name: string } | null;
  ownerTier: ReputationTier;
};

const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "amount", label: "Highest amount" },
  { value: "standing", label: "Best standing" },
] as const;

type SortOption = (typeof SORT_OPTIONS)[number]["value"];

const ALL_TYPES = ["all", "deal", "fund", "co_invest", "secondary", "service"] as const;
type TypeFilter = (typeof ALL_TYPES)[number];

export function BrowseListings({
  listings,
  onExpressInterest,
}: {
  listings: BrowseListing[];
  onExpressInterest: (listingId: string, listingTitle: string) => Promise<{ error?: string }>;
}) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sort, setSort] = useState<SortOption>("newest");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [errorIds, setErrorIds] = useState<Map<string, string>>(new Map());

  const filtered = useMemo(() => {
    let items = listings;

    if (typeFilter !== "all") {
      items = items.filter((l) => l.listing_type === typeFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        (l) =>
          l.title.toLowerCase().includes(q) ||
          (l.summary ?? "").toLowerCase().includes(q) ||
          (l.organizations?.name ?? "").toLowerCase().includes(q),
      );
    }

    return [...items].sort((a, b) => {
      if (sort === "amount") return (b.amount ?? 0) - (a.amount ?? 0);
      if (sort === "standing") {
        return TIER_ORDER.indexOf(a.ownerTier) - TIER_ORDER.indexOf(b.ownerTier);
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [listings, typeFilter, search, sort]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: listings.length };
    for (const l of listings) {
      counts[l.listing_type] = (counts[l.listing_type] ?? 0) + 1;
    }
    return counts;
  }, [listings]);

  async function handleExpressInterest(listing: BrowseListing) {
    setPendingId(listing.id);
    try {
      const res = await onExpressInterest(listing.id, listing.title);
      if (res?.error) {
        setErrorIds((m) => new Map(m).set(listing.id, res.error!));
      } else {
        setDoneIds((s) => new Set(s).add(listing.id));
        setErrorIds((m) => { const n = new Map(m); n.delete(listing.id); return n; });
      }
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div>
      {/* Filters row */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          placeholder="Search listings…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-md border border-line bg-surface-0 px-3 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none sm:w-56"
        />
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="rounded-md border border-line bg-surface-0 px-2 py-1.5 text-xs text-fg-primary focus:border-gold-500/60 focus:outline-none"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Type filter chips */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {ALL_TYPES.map((t) => {
          const count = typeCounts[t] ?? 0;
          if (t !== "all" && count === 0) return null;
          const active = typeFilter === t;
          return (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider transition ${
                active
                  ? "border-gold-500/60 bg-gold-500/15 text-gold-300"
                  : "border-line text-fg-muted hover:border-neural-400/40 hover:text-fg-secondary"
              }`}
            >
              {t === "all" ? "All" : prettyType(t)}
              <span className="ml-1 opacity-60">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Result count */}
      <p className="mb-3 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
        {filtered.length} {filtered.length === 1 ? "listing" : "listings"}
        {search || typeFilter !== "all" ? " — filtered" : ""}
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface-1 p-6 text-center">
          <p className="text-sm text-fg-muted">No listings match your filters.</p>
          <button
            onClick={() => { setSearch(""); setTypeFilter("all"); }}
            className="mt-2 text-xs text-gold-400 underline underline-offset-2 hover:text-gold-300"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((l, i) => {
            const amount = formatAmount(l.amount);
            const isDone = doneIds.has(l.id);
            const isPending = pendingId === l.id;
            const errMsg = errorIds.get(l.id);
            return (
              <div
                key={l.id}
                className="fx-card fx-card-hover animate-fade-up p-4"
                style={{ animationDelay: `${Math.min(i * 25, 200)}ms` }}
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-[10px] uppercase tracking-widest text-gold-400">
                        {l.organizations?.name ?? "Unknown firm"}
                      </p>
                      <TierBadge tier={l.ownerTier} />
                      <span className="font-mono text-[10px] text-fg-muted">{timeAgo(l.created_at)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-fg-primary">{l.title}</span>
                      <span
                        className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${STATUS_BADGE[l.status]}`}
                      >
                        {STATUS_LABEL[l.status]}
                      </span>
                    </div>
                    {l.summary ? (
                      <p className="mt-1 line-clamp-2 text-xs leading-snug text-fg-secondary">
                        {l.summary}
                      </p>
                    ) : null}
                    <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                      {prettyType(l.listing_type)}
                      {amount ? ` · ${amount}` : ""}
                    </p>
                    {errMsg ? <p className="mt-1 text-[11px] text-red-400">{errMsg}</p> : null}
                  </div>

                  <div className="shrink-0">
                    {isDone ? (
                      <span className="rounded-md border border-emerald-500/40 px-2.5 py-1 text-xs text-emerald-300">
                        Queued ✓
                      </span>
                    ) : (
                      <button
                        disabled={isPending}
                        onClick={() => handleExpressInterest(l)}
                        className="rounded-md border border-gold-500/40 bg-gold-500/10 px-2.5 py-1 text-xs text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
                      >
                        {isPending ? "Queuing…" : "Express interest"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
