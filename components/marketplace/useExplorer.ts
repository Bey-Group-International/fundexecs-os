"use client";

import { useMemo, useState } from "react";
import {
  DEFAULT_FILTERS,
  runExplorer,
  typeFacets as computeTypeFacets,
  countryFacets as computeCountryFacets,
  assetClassFacets as computeAssetClassFacets,
  type ListingFilters,
  type ListingLike,
  type SortKey,
} from "@/lib/marketplace/filter";
import type { ListingView } from "./ListingCard";

// Shared client state machine for the listing surfaces: holds filters, sort,
// view, and page; derives facets from the full set and the paginated slice from
// the active query. Changing filters or sort resets to page 1 automatically.
export function useMarketplaceExplorer<T extends ListingLike>(
  listings: T[],
  opts: { perPage?: number; defaultSort?: SortKey; defaultView?: ListingView } = {},
) {
  const perPage = opts.perPage ?? 9;
  const [filters, setFiltersRaw] = useState<ListingFilters>({ ...DEFAULT_FILTERS });
  const [sort, setSortRaw] = useState<SortKey>(opts.defaultSort ?? "featured");
  const [view, setView] = useState<ListingView>(opts.defaultView ?? "list");
  const [page, setPage] = useState(1);

  const setFilters = (next: ListingFilters) => {
    setFiltersRaw(next);
    setPage(1);
  };
  const setSort = (s: SortKey) => {
    setSortRaw(s);
    setPage(1);
  };
  const resetFilters = () => {
    setFiltersRaw({ ...DEFAULT_FILTERS });
    setPage(1);
  };

  const facets = useMemo(
    () => ({
      type: computeTypeFacets(listings),
      country: computeCountryFacets(listings),
      assetClass: computeAssetClassFacets(listings),
    }),
    [listings],
  );

  const result = useMemo(
    () => runExplorer(listings, filters, sort, page, perPage),
    [listings, filters, sort, page, perPage],
  );

  // Full filtered+sorted set (all pages) — used for export.
  const filteredAll = useMemo(
    () => runExplorer(listings, filters, sort, 1, Number.MAX_SAFE_INTEGER).items,
    [listings, filters, sort],
  );

  return {
    filters,
    setFilters,
    resetFilters,
    sort,
    setSort,
    view,
    setView,
    page,
    setPage,
    facets,
    pageItems: result.items,
    filteredAll,
    total: listings.length,
    filteredTotal: result.filteredTotal,
    pageCount: result.pageCount,
  };
}
