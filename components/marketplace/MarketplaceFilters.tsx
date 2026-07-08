"use client";

import { prettyType } from "@/lib/marketplace/format";
import {
  filtersActive,
  DEFAULT_FILTERS,
  type Facet,
  type ListingFilters,
} from "@/lib/marketplace/filter";
import type { MarketplaceStatus } from "@/lib/supabase/database.types";

// Faceted advanced search. Fully controlled — the parent explorer owns filter
// state (and resets page to 1 on change). Facet counts are computed from the
// *unfiltered* set so users always see where results live.

const STATUS_OPTIONS: { value: MarketplaceStatus; label: string }[] = [
  { value: "listed", label: "Listed" },
  { value: "draft", label: "Draft" },
  { value: "paused", label: "Paused" },
  { value: "closed", label: "Closed" },
];

function numOrNull(v: string): number | null {
  const s = v.replace(/[^0-9.]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

export function MarketplaceFilters({
  filters,
  onChange,
  typeFacets,
  countryFacets,
  assetClassFacets,
  currency = "USD",
  showStatus = false,
}: {
  filters: ListingFilters;
  onChange: (next: ListingFilters) => void;
  typeFacets: Facet[];
  countryFacets: Facet[];
  assetClassFacets: Facet[];
  currency?: string;
  showStatus?: boolean;
}) {
  const set = (patch: Partial<ListingFilters>) => onChange({ ...filters, ...patch });
  const active = filtersActive(filters);

  return (
    <aside className="fx-card animate-fade-up p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-gold-400">Refine</p>
        {active ? (
          <button
            type="button"
            onClick={() => onChange({ ...DEFAULT_FILTERS })}
            className="font-mono text-[10px] uppercase tracking-wider text-fg-muted underline underline-offset-2 transition hover:text-gold-300"
          >
            Clear all
          </button>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            Keyword
          </label>
          <input
            type="search"
            value={filters.keyword}
            onChange={(e) => set({ keyword: e.target.value })}
            placeholder="Title, country, ref #…"
            className="w-full rounded-md border border-line bg-surface-0 px-3 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
          />
        </div>

        {/* Type chips */}
        <div>
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">Type</p>
          <div className="flex flex-wrap gap-1.5">
            <FacetChip
              label="All"
              active={filters.type === "all"}
              onClick={() => set({ type: "all" })}
            />
            {typeFacets.map((f) => (
              <FacetChip
                key={f.key}
                label={prettyType(f.key)}
                count={f.count}
                active={filters.type === f.key}
                onClick={() => set({ type: filters.type === f.key ? "all" : f.key })}
              />
            ))}
          </div>
        </div>

        {showStatus ? (
          <div>
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
              Status
            </p>
            <div className="flex flex-wrap gap-1.5">
              <FacetChip
                label="All"
                active={filters.status === "all"}
                onClick={() => set({ status: "all" })}
              />
              {STATUS_OPTIONS.map((s) => (
                <FacetChip
                  key={s.value}
                  label={s.label}
                  active={filters.status === s.value}
                  onClick={() =>
                    set({ status: filters.status === s.value ? "all" : s.value })
                  }
                />
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FacetSelect
            label="Country"
            value={filters.country}
            onChange={(v) => set({ country: v })}
            facets={countryFacets}
          />
          <FacetSelect
            label="Asset class"
            value={filters.assetClass}
            onChange={(v) => set({ assetClass: v })}
            facets={assetClassFacets}
          />
        </div>

        {/* Advanced ranges + features */}
        <details className="group" open={filters.amountMin != null || filters.amountMax != null || filters.irrMin != null}>
          <summary className="cursor-pointer list-none select-none font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:text-fg-secondary">
            <span className="group-open:hidden">▸ Price, IRR &amp; features</span>
            <span className="hidden group-open:inline">▾ Price, IRR &amp; features</span>
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                Price ({currency})
              </p>
              <div className="flex items-center gap-2">
                <RangeInput
                  placeholder="Min"
                  value={filters.amountMin}
                  onChange={(n) => set({ amountMin: n })}
                />
                <span className="text-fg-muted">–</span>
                <RangeInput
                  placeholder="Max"
                  value={filters.amountMax}
                  onChange={(n) => set({ amountMax: n })}
                />
              </div>
            </div>
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                Min target IRR %
              </p>
              <RangeInput
                placeholder="e.g. 15"
                value={filters.irrMin}
                onChange={(n) => set({ irrMin: n })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <CheckRow
                label="Featured only"
                checked={filters.featuredOnly}
                onChange={(v) => set({ featuredOnly: v })}
              />
              <CheckRow
                label="Has teaser / data room"
                checked={filters.hasTeaser}
                onChange={(v) => set({ hasTeaser: v })}
              />
            </div>
          </div>
        </details>
      </div>
    </aside>
  );
}

function FacetChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider transition ${
        active
          ? "border-gold-500/60 bg-gold-500/15 text-gold-300"
          : "border-line text-fg-muted hover:border-neural-400/40 hover:text-fg-secondary"
      }`}
    >
      {label}
      {count != null ? <span className="ml-1 opacity-60">{count}</span> : null}
    </button>
  );
}

function FacetSelect({
  label,
  value,
  onChange,
  facets,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  facets: Facet[];
}) {
  return (
    <div>
      <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-fg-muted">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={facets.length === 0}
        className="w-full rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary focus:border-gold-500/60 focus:outline-none disabled:opacity-50"
      >
        <option value="all">All</option>
        {facets.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label} ({f.count})
          </option>
        ))}
      </select>
    </div>
  );
}

function RangeInput({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string;
  value: number | null;
  onChange: (n: number | null) => void;
}) {
  return (
    <input
      inputMode="decimal"
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) => onChange(numOrNull(e.target.value))}
      className="w-full rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
    />
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-fg-secondary">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-gold-500"
      />
      {label}
    </label>
  );
}
