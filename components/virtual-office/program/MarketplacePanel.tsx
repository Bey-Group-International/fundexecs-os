"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { prettyListingType, formatListingAmount } from "@/lib/office/listingFormat";

const TEAL = "#2dd4bf";

export type PublicListing = {
  id: string;
  title: string;
  listing_type: string;
  summary: string | null;
  amount: number | null;
  status: string;
};

/**
 * In-world Marketplace browser. Shown while the operator stands in the
 * Marketplace hall: it pulls live public listings from `marketplace_listings`
 * (readable cross-org via the public-read RLS policy) and deep-links each one
 * into the full /marketplace pages. The office stays the spatial entry point;
 * the transaction surfaces already live under /marketplace do the rest.
 */
export function MarketplacePanel({
  listings: provided,
  onOpenListing,
  onCreate,
}: {
  listings?: PublicListing[] | null;
  /** Open a listing's in-world detail overlay instead of navigating away. */
  onOpenListing?: (id: string) => void;
  /** Open the in-world "list something" overlay instead of navigating away. */
  onCreate?: () => void;
}) {
  const [fetched, setFetched] = useState<PublicListing[] | null>(null);
  // The parent (VirtualOfficeGame) usually supplies listings so the same data
  // feeds the in-world stall signboards; fall back to a self-fetch if not.
  const listings = provided !== undefined ? provided : fetched;

  useEffect(() => {
    if (provided !== undefined) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("marketplace_listings")
        .select("id, title, listing_type, summary, amount, status")
        .eq("is_public", true)
        .order("created_at", { ascending: false })
        .limit(12);
      if (!cancelled) setFetched((data as PublicListing[] | null) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [provided]);

  return (
    <div
      className="flex max-h-[440px] w-full flex-col overflow-hidden rounded-lg border backdrop-blur-sm"
      style={{ borderColor: "rgba(45,212,191,0.28)", background: "rgba(10,8,6,0.92)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: "rgba(45,212,191,0.2)" }}>
        <span className="text-[10px] uppercase tracking-[0.22em]" style={{ color: TEAL, fontFamily: "Georgia, serif" }}>
          Marketplace
        </span>
        <span className="flex items-center gap-1 text-[9px]" style={{ color: "rgba(45,212,191,0.85)" }}>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: TEAL }} />
          {listings == null ? "Loading" : `${listings.length} public`}
        </span>
      </div>

      {/* Listings feed */}
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-2">
        {listings == null ? (
          <p className="text-[10px] text-slate-500">Fetching public listings…</p>
        ) : listings.length === 0 ? (
          <p className="text-[10px] leading-relaxed text-slate-500">
            No public listings yet. Publish one from your marketplace to make it discoverable across the network.
          </p>
        ) : (
          listings.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => {
                if (onOpenListing) onOpenListing(l.id);
                else window.location.href = `/marketplace/${l.id}`;
              }}
              className="block w-full rounded-md border px-2.5 py-2 text-left transition-colors hover:border-teal-400/50"
              style={{ borderColor: "rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-medium text-slate-100" style={{ fontFamily: "Georgia, serif" }}>
                  {l.title}
                </span>
                {formatListingAmount(l.amount) && (
                  <span className="shrink-0 text-[10px]" style={{ color: TEAL }}>
                    {formatListingAmount(l.amount)}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span
                  className="shrink-0 rounded-sm px-1 text-[8px] uppercase tracking-wider"
                  style={{ background: "rgba(45,212,191,0.12)", color: TEAL }}
                >
                  {prettyListingType(l.listing_type)}
                </span>
                {l.summary && <span className="truncate text-[9px] text-slate-500">{l.summary}</span>}
              </div>
            </button>
          ))
        )}
      </div>

      {/* Footer actions */}
      <div className="flex gap-1.5 border-t px-3 py-2" style={{ borderColor: "rgba(45,212,191,0.2)" }}>
        <a
          href="/marketplace/browse"
          className="flex-1 rounded px-2 py-1 text-center text-[10px] font-semibold uppercase tracking-wider"
          style={{ background: TEAL, color: "#0a0806", fontFamily: "Georgia, serif" }}
        >
          Browse all
        </a>
        {onCreate ? (
          <button
            type="button"
            onClick={onCreate}
            className="rounded border px-2 py-1 text-[10px] uppercase tracking-wider text-slate-400 transition-colors hover:text-slate-200"
            style={{ borderColor: "rgba(255,255,255,0.15)" }}
          >
            + New
          </button>
        ) : (
          <a
            href="/marketplace"
            className="rounded border px-2 py-1 text-[10px] uppercase tracking-wider text-slate-400 transition-colors hover:text-slate-200"
            style={{ borderColor: "rgba(255,255,255,0.15)" }}
          >
            + New
          </a>
        )}
      </div>
    </div>
  );
}
