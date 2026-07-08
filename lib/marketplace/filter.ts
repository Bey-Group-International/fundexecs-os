// Pure filter / sort / paginate / facet logic for marketplace listings. Kept
// framework-free and side-effect-free so it can be unit-tested and reused by
// both the owner console and the public Browse board.

import type { MarketplaceStatus } from "@/lib/supabase/database.types";
import { resolveCountry } from "./flags";

/** Minimal shape the explorer needs; both surfaces map their rows onto this. */
export type ListingLike = {
  id: string;
  title: string;
  summary: string | null;
  listing_type: string;
  status: MarketplaceStatus;
  amount: number | null;
  target_irr: number | null;
  country: string | null;
  asset_class: string | null;
  reference_code: string | null;
  currency: string;
  featured: boolean;
  teaser_url: string | null;
  created_at: string;
  orgName?: string | null;
  /** Lower = better standing; injected by Browse from reputation tier. */
  tierRank?: number;
};

export type SortKey =
  | "featured"
  | "newest"
  | "oldest"
  | "amount_desc"
  | "amount_asc"
  | "irr_desc"
  | "standing";

export type ListingFilters = {
  keyword: string;
  type: string; // "all" or a listing_type
  status: MarketplaceStatus | "all";
  country: string; // "all" or a resolved code/label key
  assetClass: string; // "all" or exact asset_class
  amountMin: number | null;
  amountMax: number | null;
  irrMin: number | null;
  featuredOnly: boolean;
  hasTeaser: boolean;
};

export const DEFAULT_FILTERS: ListingFilters = {
  keyword: "",
  type: "all",
  status: "all",
  country: "all",
  assetClass: "all",
  amountMin: null,
  amountMax: null,
  irrMin: null,
  featuredOnly: false,
  hasTeaser: false,
};

export function filtersActive(f: ListingFilters): boolean {
  return (
    f.keyword.trim() !== "" ||
    f.type !== "all" ||
    f.status !== "all" ||
    f.country !== "all" ||
    f.assetClass !== "all" ||
    f.amountMin != null ||
    f.amountMax != null ||
    f.irrMin != null ||
    f.featuredOnly ||
    f.hasTeaser
  );
}

/** Canonical facet key for a country (ISO-2 when known, else a slug of label). */
export function countryKey(country: string | null): string | null {
  const r = resolveCountry(country);
  if (!r) return null;
  return r.code ?? r.label.toLowerCase();
}

export function matchesFilters(l: ListingLike, f: ListingFilters): boolean {
  if (f.type !== "all" && l.listing_type !== f.type) return false;
  if (f.status !== "all" && l.status !== f.status) return false;
  if (f.assetClass !== "all" && (l.asset_class ?? "") !== f.assetClass) return false;
  if (f.country !== "all" && countryKey(l.country) !== f.country) return false;
  if (f.featuredOnly && !l.featured) return false;
  if (f.hasTeaser && !l.teaser_url) return false;
  if (f.amountMin != null && (l.amount ?? -Infinity) < f.amountMin) return false;
  if (f.amountMax != null && (l.amount ?? Infinity) > f.amountMax) return false;
  if (f.irrMin != null && (l.target_irr ?? -Infinity) < f.irrMin) return false;

  const q = f.keyword.trim().toLowerCase();
  if (q) {
    const hay = [
      l.title,
      l.summary ?? "",
      l.orgName ?? "",
      l.reference_code ?? "",
      l.country ?? "",
      l.asset_class ?? "",
      l.listing_type,
    ]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

const TIER_FALLBACK = 99;

export function sortListings<T extends ListingLike>(items: T[], sort: SortKey): T[] {
  const byNewest = (a: T, b: T) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  const arr = [...items];
  switch (sort) {
    case "newest":
      return arr.sort(byNewest);
    case "oldest":
      return arr.sort((a, b) => -byNewest(a, b));
    case "amount_desc":
      return arr.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0) || byNewest(a, b));
    case "amount_asc":
      return arr.sort((a, b) => (a.amount ?? Infinity) - (b.amount ?? Infinity) || byNewest(a, b));
    case "irr_desc":
      return arr.sort((a, b) => (b.target_irr ?? 0) - (a.target_irr ?? 0) || byNewest(a, b));
    case "standing":
      return arr.sort(
        (a, b) => (a.tierRank ?? TIER_FALLBACK) - (b.tierRank ?? TIER_FALLBACK) || byNewest(a, b),
      );
    case "featured":
    default:
      // Featured first, then newest.
      return arr.sort((a, b) => Number(b.featured) - Number(a.featured) || byNewest(a, b));
  }
}

export type Facet = { key: string; label: string; count: number };

/** Count listings by a keyed dimension, sorted by frequency then label. */
function facetBy<T extends ListingLike>(
  items: T[],
  keyOf: (l: T) => string | null,
  labelOf: (key: string) => string,
): Facet[] {
  const counts = new Map<string, number>();
  for (const l of items) {
    const k = keyOf(l);
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: labelOf(key), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function typeFacets<T extends ListingLike>(items: T[]): Facet[] {
  return facetBy(
    items,
    (l) => l.listing_type,
    (k) => k,
  );
}

export function countryFacets<T extends ListingLike>(items: T[]): Facet[] {
  return facetBy(
    items,
    (l) => countryKey(l.country),
    (k) => resolveCountry(k)?.label ?? k,
  );
}

export function assetClassFacets<T extends ListingLike>(items: T[]): Facet[] {
  return facetBy(
    items,
    (l) => l.asset_class || null,
    (k) => k,
  );
}

export type PageResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageCount: number;
};

export function paginate<T>(items: T[], page: number, perPage: number): PageResult<T> {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const safe = Math.min(Math.max(1, page), pageCount);
  const start = (safe - 1) * perPage;
  return { items: items.slice(start, start + perPage), total, page: safe, pageCount };
}

/** One-shot: filter → sort → paginate. */
export function runExplorer<T extends ListingLike>(
  items: T[],
  filters: ListingFilters,
  sort: SortKey,
  page: number,
  perPage: number,
): PageResult<T> & { filteredTotal: number } {
  const filtered = sortListings(
    items.filter((l) => matchesFilters(l, filters)),
    sort,
  );
  return { ...paginate(filtered, page, perPage), filteredTotal: filtered.length };
}
