"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { officeInviteUrl } from "@/lib/office/floor-link";

const GOLD = "#c9a84c";

type DealListing = {
  id: string;
  title: string;
  listing_type: string;
  amount: number | null;
};

const TYPE_LABELS: Record<string, string> = {
  deal: "Deal",
  fund: "Fund",
  co_invest: "Co-invest",
  secondary: "Secondary",
  service: "Service",
  lp_seeking: "LP Seeking",
};

function prettyType(t: string): string {
  return TYPE_LABELS[t] ?? t.split(/[_\s-]+/).map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

function formatAmount(a: number | null): string | null {
  if (a == null) return null;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, notation: "compact" }).format(a);
}

/**
 * Deal-room context banner. Shown at the top of the Deal Room while a specific
 * marketplace listing is convened there (opened from the listing detail, or
 * arrived at via a `?deal=` invite link). It names the deal and offers a
 * shareable invite that carries the deal + auto-joins video, so a counterparty
 * lands in the same room with the same context. Dismiss to clear the convening.
 */
export function DealRoomBanner({ listingId, onClose }: { listingId: string; onClose: () => void }) {
  const [listing, setListing] = useState<DealListing | null | "error">(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setListing(null);
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("marketplace_listings")
        .select("id, title, listing_type, amount")
        .eq("id", listingId)
        .eq("is_public", true)
        .maybeSingle();
      if (cancelled) return;
      setListing(error || !data ? "error" : (data as DealListing));
    })();
    return () => {
      cancelled = true;
    };
  }, [listingId]);

  const copyInvite = async () => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = officeInviteUrl(origin, { room: "trading", deal: listingId, meet: true });
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard may be unavailable; no-op */
    }
  };

  const amount = listing && listing !== "error" ? formatAmount(listing.amount) : null;

  return (
    <div
      className="pointer-events-auto flex items-center gap-3 rounded-lg border px-3 py-2 backdrop-blur-sm"
      style={{ borderColor: `${GOLD}59`, background: "rgba(10,8,6,0.92)" }}
    >
      <span
        className="shrink-0 rounded-sm px-1.5 py-0.5 text-[8px] uppercase tracking-[0.18em]"
        style={{ background: `${GOLD}1f`, color: GOLD, fontFamily: "Georgia, serif" }}
      >
        Deal room
      </span>

      <div className="min-w-0 flex-1">
        {listing === null ? (
          <p className="truncate text-[11px] text-slate-500">Convening deal room…</p>
        ) : listing === "error" ? (
          <p className="truncate text-[11px] text-slate-400">This deal isn&apos;t available.</p>
        ) : (
          <div className="flex items-center gap-2">
            <span className="truncate text-[12px] font-medium text-slate-100" style={{ fontFamily: "Georgia, serif" }}>
              {listing.title}
            </span>
            <span className="shrink-0 text-[9px] uppercase tracking-wider" style={{ color: GOLD }}>
              {prettyType(listing.listing_type)}
              {amount ? ` · ${amount}` : ""}
            </span>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={copyInvite}
        className="shrink-0 rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-opacity"
        style={{ background: GOLD, color: "#0a0806", fontFamily: "Georgia, serif" }}
      >
        {copied ? "Copied ✓" : "Copy invite"}
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close deal room"
        className="grid h-6 w-6 shrink-0 place-items-center rounded text-[13px] leading-none text-slate-400 transition-colors hover:text-slate-100"
        style={{ border: `1px solid ${GOLD}40` }}
      >
        ✕
      </button>
    </div>
  );
}
