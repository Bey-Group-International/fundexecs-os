"use client";

import type { SortKey } from "@/lib/marketplace/filter";
import type { ListingView } from "./ListingCard";

// Result count + sort + list/grid toggle + export. Sort options can be trimmed
// per surface (e.g. Browse adds "Best standing").
export type SortOption = { value: SortKey; label: string };

export const DEFAULT_SORT_OPTIONS: SortOption[] = [
  { value: "featured", label: "Featured first" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "amount_desc", label: "Price: high → low" },
  { value: "amount_asc", label: "Price: low → high" },
  { value: "irr_desc", label: "Target IRR" },
];

export function MarketplaceToolbar({
  total,
  filteredTotal,
  sort,
  onSort,
  view,
  onView,
  sortOptions = DEFAULT_SORT_OPTIONS,
  onExportCsv,
  onPrint,
}: {
  total: number;
  filteredTotal: number;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  view: ListingView;
  onView: (v: ListingView) => void;
  sortOptions?: SortOption[];
  onExportCsv?: () => void;
  onPrint?: () => void;
}) {
  const filtered = filteredTotal !== total;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
        <span className="text-fg-secondary">{filteredTotal}</span>{" "}
        {filteredTotal === 1 ? "listing" : "listings"}
        {filtered ? <span className="opacity-60"> of {total}</span> : null}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {(onExportCsv || onPrint) && (
          <div className="flex items-center gap-1">
            {onExportCsv ? (
              <button
                type="button"
                onClick={onExportCsv}
                title="Export current view to CSV"
                className="rounded-md border border-line px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:border-gold-500/40 hover:text-fg-secondary"
              >
                CSV
              </button>
            ) : null}
            {onPrint ? (
              <button
                type="button"
                onClick={onPrint}
                title="Print / save as PDF"
                className="rounded-md border border-line px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:border-gold-500/40 hover:text-fg-secondary"
              >
                PDF
              </button>
            ) : null}
          </div>
        )}

        <label className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Sort</span>
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value as SortKey)}
            className="rounded-md border border-line bg-surface-0 px-2 py-1.5 text-xs text-fg-primary focus:border-gold-500/60 focus:outline-none"
          >
            {sortOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <div className="fx-segment inline-flex" role="group" aria-label="View">
          <button
            type="button"
            aria-pressed={view === "list"}
            onClick={() => onView("list")}
            className={`rounded-md px-2 py-1 text-xs transition ${
              view === "list" ? "bg-surface-2 text-fg-primary" : "text-fg-muted hover:text-fg-secondary"
            }`}
            title="List view"
          >
            ▤
          </button>
          <button
            type="button"
            aria-pressed={view === "grid"}
            onClick={() => onView("grid")}
            className={`rounded-md px-2 py-1 text-xs transition ${
              view === "grid" ? "bg-surface-2 text-fg-primary" : "text-fg-muted hover:text-fg-secondary"
            }`}
            title="Grid view"
          >
            ▦
          </button>
        </div>
      </div>
    </div>
  );
}
