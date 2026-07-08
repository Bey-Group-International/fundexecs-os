"use client";

import { useState } from "react";
import type { MarketplaceStatus } from "@/lib/supabase/database.types";
import type { ReputationTier } from "@/lib/compounding";
import { TierBadge } from "@/components/TierBadge";
import { ListingCard, type ListingCardData } from "@/components/marketplace/ListingCard";
import { MarketplaceFilters } from "@/components/marketplace/MarketplaceFilters";
import {
  MarketplaceToolbar,
  DEFAULT_SORT_OPTIONS,
  type SortOption,
} from "@/components/marketplace/MarketplaceToolbar";
import { Pagination } from "@/components/marketplace/Pagination";
import { TrustBar } from "@/components/marketplace/TrustBar";
import { BookMeetingCTA } from "@/components/marketplace/BookMeetingCTA";
import { useMarketplaceExplorer } from "@/components/marketplace/useExplorer";
import { downloadCsv, printListings } from "@/components/marketplace/export";
import { formatCompact } from "@/lib/marketplace/format";
import { resolveCountry } from "@/lib/marketplace/flags";

// Public cross-org discovery board. The full listing shape carries the rich
// card fields plus the owner's org name + reputation tier (for standing sort).
export type BrowseListing = ListingCardData & {
  organization_id: string;
  organizations: { name: string } | null;
  ownerTier: ReputationTier;
};

const TIER_ORDER: ReputationTier[] = ["principal", "established", "verified", "unranked"];

const BROWSE_SORT_OPTIONS: SortOption[] = [
  ...DEFAULT_SORT_OPTIONS,
  { value: "standing", label: "Best standing" },
];

type ExplorerItem = BrowseListing & { orgName: string | null; tierRank: number };

export function BrowseListings({
  listings,
  onExpressInterest,
}: {
  listings: BrowseListing[];
  onExpressInterest: (listingId: string, listingTitle: string) => Promise<{ error?: string }>;
}) {
  const items: ExplorerItem[] = listings.map((l) => ({
    ...l,
    orgName: l.organizations?.name ?? null,
    tierRank: TIER_ORDER.indexOf(l.ownerTier),
  }));

  const ex = useMarketplaceExplorer(items, { perPage: 9, defaultSort: "featured" });

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [errorIds, setErrorIds] = useState<Map<string, string>>(new Map());

  async function handleExpressInterest(l: ExplorerItem) {
    setPendingId(l.id);
    try {
      const res = await onExpressInterest(l.id, l.title);
      if (res?.error) {
        setErrorIds((m) => new Map(m).set(l.id, res.error!));
      } else {
        setDoneIds((s) => new Set(s).add(l.id));
        setErrorIds((m) => {
          const n = new Map(m);
          n.delete(l.id);
          return n;
        });
      }
    } finally {
      setPendingId(null);
    }
  }

  // Trust bar — live snapshot of what's on the board.
  const countries = new Set(
    listings.map((l) => resolveCountry(l.country)?.code ?? l.country).filter(Boolean),
  ).size;
  const orgs = new Set(listings.map((l) => l.organization_id)).size;
  const aggregate = listings.reduce((sum, l) => sum + (l.amount ?? 0), 0);
  const stats = [
    { label: "Live listings", value: String(listings.length), accent: "text-emerald-300" },
    { label: "Countries", value: countries ? String(countries) : "—" },
    { label: "Firms", value: String(orgs), accent: "text-gold-400" },
    { label: "Aggregate value", value: aggregate > 0 ? formatCompact(aggregate)! : "—" },
  ];

  const view = ex.view;

  return (
    <div>
      <TrustBar stats={stats} />
      <BookMeetingCTA />

      <div className="lg:grid lg:grid-cols-[260px_1fr] lg:gap-6">
        <div className="no-print mb-4 lg:mb-0">
          <MarketplaceFilters
            filters={ex.filters}
            onChange={ex.setFilters}
            typeFacets={ex.facets.type}
            countryFacets={ex.facets.country}
            assetClassFacets={ex.facets.assetClass}
          />
        </div>

        <div>
          <div className="no-print">
            <MarketplaceToolbar
              total={ex.total}
              filteredTotal={ex.filteredTotal}
              sort={ex.sort}
              onSort={ex.setSort}
              view={view}
              onView={ex.setView}
              sortOptions={BROWSE_SORT_OPTIONS}
              onExportCsv={() => downloadCsv(ex.filteredAll, "marketplace-browse.csv")}
              onPrint={printListings}
            />
          </div>

          {ex.filteredTotal === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-surface-1 p-6 text-center">
              <p className="text-sm text-fg-muted">No listings match your filters.</p>
              <button
                onClick={ex.resetFilters}
                className="mt-2 text-xs text-gold-400 underline underline-offset-2 hover:text-gold-300"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div
              className={
                view === "grid"
                  ? "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
                  : "flex flex-col gap-2"
              }
            >
              {ex.pageItems.map((l, i) => {
                const isDone = doneIds.has(l.id);
                const isPending = pendingId === l.id;
                const errMsg = errorIds.get(l.id);
                return (
                  <ListingCard
                    key={l.id}
                    listing={l}
                    href={`/marketplace/${l.id}`}
                    view={view}
                    index={i}
                    eyebrow={
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] uppercase tracking-widest text-gold-400">
                          {l.orgName ?? "Unknown firm"}
                        </span>
                        <TierBadge tier={l.ownerTier} />
                      </div>
                    }
                    actions={
                      isDone ? (
                        <span className="rounded-md border border-emerald-500/40 px-2.5 py-1 text-xs text-emerald-300">
                          Queued ✓
                        </span>
                      ) : (
                        <div className="flex flex-col items-end gap-1">
                          <button
                            disabled={isPending}
                            onClick={() => handleExpressInterest(l)}
                            className="no-print rounded-md border border-gold-500/40 bg-gold-500/10 px-2.5 py-1 text-xs text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
                          >
                            {isPending ? "Queuing…" : "Express interest"}
                          </button>
                          {errMsg ? <span className="text-[11px] text-red-400">{errMsg}</span> : null}
                        </div>
                      )
                    }
                  />
                );
              })}
            </div>
          )}

          <div className="no-print">
            <Pagination page={ex.page} pageCount={ex.pageCount} onPage={ex.setPage} />
          </div>
        </div>
      </div>
    </div>
  );
}
