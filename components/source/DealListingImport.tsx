"use client";

import { useState, useTransition } from "react";
import {
  parseDealListingsAction,
  addDealListingsAction,
} from "@/app/(app)/[hub]/[module]/deal-listing-actions";
import type { DealListing } from "@/lib/ingestion/deal-listings";

// Compact money for the review chips — mirrors formatMoney in deal-listings.ts
// but stays client-side so the panel needs no server round-trip to render.
function money(n: number | null): string | null {
  if (n == null || !isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000) return `$${(Math.round((n / 1_000_000) * 100) / 100).toString()}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

const NETWORKS = "LoopNet · Crexi · BizBuySell · BusinessesForSale · Transworld";

// Import for-sale listings from the top deal networks into the pipeline. Paste a
// listing / search page, or drop a URL (fetched compliantly, robots-respecting);
// review the parsed listings and add the ones you want. Deterministic parse with
// a Claude-assisted fallback server-side — no key needed for the common case.
export function DealListingImport({ hub, module }: { hub: string; module: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [html, setHtml] = useState("");
  const [pending, start] = useTransition();
  const [listings, setListings] = useState<DealListing[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState<string | null>(null);

  const runParse = () => {
    setMessage(null);
    setListings(null);
    start(async () => {
      const res = await parseDealListingsAction({ url: url.trim() || undefined, html: html.trim() || undefined });
      if (!res.ok || !res.listings) return setMessage(res.error ?? "Could not parse listings.");
      setListings(res.listings);
      setSelected(new Set(res.listings.map((_, i) => i)));
      setMessage(`Found ${res.listings.length} listing${res.listings.length === 1 ? "" : "s"} on ${res.marketplace}.`);
    });
  };

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const addSelected = () => {
    if (!listings) return;
    const picks = listings.filter((_, i) => selected.has(i));
    if (picks.length === 0) return setMessage("Select at least one listing to add.");
    start(async () => {
      const res = await addDealListingsAction(hub, module, picks);
      if (!res.ok) return setMessage(res.error ?? "Could not add to pipeline.");
      setMessage(`Added ${res.added} listing${res.added === 1 ? "" : "s"} to the pipeline.`);
      setListings(null);
      setUrl("");
      setHtml("");
    });
  };

  return (
    <div className="mb-5 rounded-2xl border border-status-info/25 bg-gradient-to-b from-status-info/[0.06] to-transparent p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-status-info">⇥ Import Listings</span>
        <span className="hidden text-xs text-fg-muted sm:inline">· {NETWORKS}</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto rounded-md border border-status-info/40 bg-status-info/10 px-3 py-1.5 text-xs font-medium text-status-info transition hover:bg-status-info/20"
        >
          {open ? "Close" : "Import from a deal network"}
        </button>
      </div>

      {open ? (
        <div className="mt-3 space-y-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Listing or search URL (e.g. https://www.bizbuysell.com/…)"
            className="w-full rounded-md border border-line bg-surface-0 px-3 py-1.5 text-xs text-fg-primary outline-none focus:border-status-info"
          />
          <div className="flex items-center gap-2">
            <span className="h-px flex-1 bg-line" />
            <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">or paste the page</span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <textarea
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            placeholder="Paste the listing or search-results page here (blocked by the site's robots.txt? this always works)"
            rows={4}
            className="w-full resize-y rounded-md border border-line bg-surface-0 px-3 py-2 text-xs text-fg-primary outline-none focus:border-status-info"
          />
          <button
            type="button"
            onClick={runParse}
            disabled={pending || (!url.trim() && !html.trim())}
            className="rounded-md border border-status-info/40 bg-status-info/10 px-3 py-1.5 text-xs font-medium text-status-info transition hover:bg-status-info/20 disabled:opacity-50"
          >
            Parse listings
          </button>
        </div>
      ) : null}

      {pending ? <p className="mt-3 animate-pulse text-xs text-status-info">Working…</p> : null}
      {message ? (
        <p className="mt-3 rounded-md border border-line bg-surface-1 px-3 py-2 text-xs text-fg-primary">{message}</p>
      ) : null}

      {listings && listings.length > 0 ? (
        <div className="mt-3 space-y-2">
          {listings.map((l, i) => {
            const chips = [money(l.askingPrice) && `Ask ${money(l.askingPrice)}`, money(l.cashFlow) && `CF ${money(l.cashFlow)}`, money(l.revenue) && `Rev ${money(l.revenue)}`, l.capRate != null && `${l.capRate}% cap`].filter(Boolean) as string[];
            return (
              <label
                key={`${l.name}-${i}`}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface-1 p-3 transition hover:border-status-info/40"
              >
                <input
                  type="checkbox"
                  checked={selected.has(i)}
                  onChange={() => toggle(i)}
                  className="mt-0.5 h-4 w-4 accent-status-info"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-fg-primary">{l.name}</span>
                    <span className="shrink-0 rounded-full border border-line px-1.5 py-0 font-mono text-[8px] uppercase tracking-wider text-fg-muted">
                      {l.sourceLabel}
                    </span>
                  </div>
                  {(l.category || l.location) && (
                    <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                      {[l.category?.replace(/_/g, " "), l.location].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  {chips.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                      {chips.map((c) => (
                        <span key={c} className="font-mono text-[10px] text-status-info">{c}</span>
                      ))}
                    </div>
                  )}
                  {l.description && <p className="mt-1 line-clamp-2 text-xs text-fg-secondary">{l.description}</p>}
                  {(l.contactName || l.contactEmail) && (
                    <div className="mt-0.5 font-mono text-[9px] text-fg-muted">
                      {l.contactName}
                      {l.contactEmail && <span className="opacity-70"> · {l.contactEmail}</span>}
                    </div>
                  )}
                  {l.url && (
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5 inline-block font-mono text-[9px] text-fg-muted hover:text-status-info hover:underline"
                    >
                      ↗ view listing
                    </a>
                  )}
                </div>
              </label>
            );
          })}
          <button
            type="button"
            onClick={addSelected}
            disabled={pending}
            className="mt-1 rounded-md bg-status-info px-4 py-2 text-sm font-medium text-surface-0 transition hover:opacity-90 disabled:opacity-50"
          >
            Add {selected.size} to pipeline
          </button>
        </div>
      ) : null}
    </div>
  );
}
