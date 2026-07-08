"use client";

import type { MarketplaceListing, MarketplaceStatus } from "@/lib/supabase/database.types";
import type { InvestorMatch } from "@/lib/matching";
import { ListingCard, type ListingCardData } from "@/components/marketplace/ListingCard";
import { MarketplaceFilters } from "@/components/marketplace/MarketplaceFilters";
import { MarketplaceToolbar } from "@/components/marketplace/MarketplaceToolbar";
import { Pagination } from "@/components/marketplace/Pagination";
import { useMarketplaceExplorer } from "@/components/marketplace/useExplorer";
import { downloadCsv, printListings } from "@/components/marketplace/export";
import { formatCompact } from "@/lib/marketplace/format";
import { EditListingForm } from "./EditListingForm";
import { updateListingStatus, toggleListingPublic, deleteListing, queueListingOutreach } from "./actions";

const STATUS_BADGE: Record<MarketplaceStatus, string> = {
  listed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  draft: "border-line text-fg-muted",
  paused: "border-gold-500/40 bg-gold-500/10 text-gold-300",
  closed: "border-line text-fg-muted/70",
};
const STATUS_LABEL: Record<MarketplaceStatus, string> = {
  draft: "Draft",
  listed: "Listed",
  paused: "Paused",
  closed: "Closed",
};
const NEXT_LABEL: Record<MarketplaceStatus, string> = {
  draft: "List",
  listed: "Pause",
  paused: "Close",
  closed: "Reopen",
};

function toCardData(l: MarketplaceListing): ListingCardData {
  return {
    id: l.id,
    title: l.title,
    summary: l.summary,
    listing_type: l.listing_type,
    status: l.status,
    amount: l.amount,
    currency: l.currency ?? "USD",
    country: l.country,
    asset_class: l.asset_class,
    reference_code: l.reference_code,
    ebitda: l.ebitda,
    gross_revenue: l.gross_revenue,
    target_irr: l.target_irr,
    featured: l.featured,
    teaser_url: l.teaser_url,
    created_at: l.created_at,
  };
}

export function OwnerListings({
  listings,
  matchesByListing,
}: {
  listings: MarketplaceListing[];
  matchesByListing: Record<string, InvestorMatch[]>;
}) {
  const items = listings.map(toCardData);
  const byId = new Map(listings.map((l) => [l.id, l]));
  const ex = useMarketplaceExplorer(items, { perPage: 8, defaultSort: "newest" });
  const view = ex.view;

  if (listings.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-surface-1 p-6 text-center text-sm text-fg-muted">
        No listings yet. Create one above — try{" "}
        <span className="text-fg-secondary">&ldquo;Series B secondary, $4M allocation&rdquo;</span>.
      </p>
    );
  }

  return (
    <div className="lg:grid lg:grid-cols-[260px_1fr] lg:gap-6">
      <div className="no-print mb-4 lg:mb-0">
        <MarketplaceFilters
          filters={ex.filters}
          onChange={ex.setFilters}
          typeFacets={ex.facets.type}
          countryFacets={ex.facets.country}
          assetClassFacets={ex.facets.assetClass}
          showStatus
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
            onExportCsv={() => downloadCsv(ex.filteredAll, "my-marketplace-listings.csv")}
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
                ? "grid grid-cols-1 gap-3 sm:grid-cols-2"
                : "flex flex-col gap-2"
            }
          >
            {ex.pageItems.map((card, i) => {
              const l = byId.get(card.id)!;
              const matches = matchesByListing[l.id];
              return (
                <ListingCard
                  key={l.id}
                  listing={card}
                  href={`/marketplace/${l.id}`}
                  view={view}
                  index={i}
                  badges={
                    <>
                      <span
                        className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${STATUS_BADGE[l.status]}`}
                      >
                        {STATUS_LABEL[l.status]}
                      </span>
                      {l.is_public ? (
                        <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
                          Public
                        </span>
                      ) : (
                        <span className="rounded-full border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                          Private
                        </span>
                      )}
                    </>
                  }
                  footer={
                    <>
                      <div className="no-print mt-3 flex flex-wrap items-center gap-1.5 border-t border-line/60 pt-3">
                        <form action={updateListingStatus}>
                          <input type="hidden" name="id" value={l.id} />
                          <input type="hidden" name="current" value={l.status} />
                          <button className="rounded-md bg-gold-500 px-2.5 py-1 text-xs font-medium text-surface-0 transition hover:bg-gold-400">
                            {NEXT_LABEL[l.status]}
                          </button>
                        </form>
                        <EditListingForm listing={l} />
                        <form action={toggleListingPublic}>
                          <input type="hidden" name="id" value={l.id} />
                          <input type="hidden" name="is_public" value={String(l.is_public)} />
                          <button className="rounded-md border border-line px-2.5 py-1 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary">
                            {l.is_public ? "Make private" : "Make public"}
                          </button>
                        </form>
                        <form action={deleteListing}>
                          <input type="hidden" name="id" value={l.id} />
                          <button className="rounded-md border border-status-danger/40 px-2.5 py-1 text-xs text-status-danger transition hover:bg-status-danger/10">
                            Delete
                          </button>
                        </form>
                      </div>

                      {l.status === "draft" && !l.summary ? (
                        <p className="mt-2 text-[11px] text-fg-muted">
                          <span className="text-gold-400">Tip:</span> Add a summary so buyers know
                          what this is before you list it.
                        </p>
                      ) : null}

                      {matches?.length ? (
                        <div className="mt-3 rounded-lg border border-gold-500/25 bg-gold-500/[0.05] p-3">
                          <p className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
                            Best-fit investors
                          </p>
                          <div className="mt-1.5 flex flex-col gap-2">
                            {matches.map((m) => {
                              const inv = m.investor;
                              const checkRange =
                                inv.typical_check_min != null || inv.typical_check_max != null
                                  ? `${inv.typical_check_min != null ? formatCompact(inv.typical_check_min) : "—"}–${inv.typical_check_max != null ? formatCompact(inv.typical_check_max) : "—"} check`
                                  : null;
                              const aum = inv.aum != null ? `${formatCompact(inv.aum)} AUM` : null;
                              return (
                                <div key={inv.id} className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="text-sm font-medium text-fg-primary">
                                        {inv.name}
                                      </span>
                                      <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
                                        {m.score} fit
                                      </span>
                                      {inv.investor_type ? (
                                        <span className="rounded-full border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                                          {inv.investor_type.replace(/_/g, " ")}
                                        </span>
                                      ) : null}
                                    </div>
                                    {checkRange || aum ? (
                                      <p className="mt-0.5 font-mono text-[10px] text-fg-muted">
                                        {[aum, checkRange].filter(Boolean).join(" · ")}
                                      </p>
                                    ) : null}
                                  </div>
                                  <form action={queueListingOutreach} className="no-print shrink-0 self-center">
                                    <input type="hidden" name="investor_id" value={inv.id} />
                                    <input type="hidden" name="listing_title" value={l.title} />
                                    <button className="rounded-md border border-line px-2.5 py-1 text-xs text-fg-secondary transition hover:border-gold-500/50 hover:text-fg-primary">
                                      Queue outreach
                                    </button>
                                  </form>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </>
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
  );
}
