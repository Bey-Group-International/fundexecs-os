// lib/office/listingFormat.ts
// Shared formatting for marketplace listing types and amounts, used by every
// in-world marketplace surface (the browse panel, the listing detail overlay,
// and the deal-room banner) so a listing reads the same everywhere.

export const LISTING_TYPE_LABELS: Record<string, string> = {
  deal: "Deal",
  fund: "Fund",
  co_invest: "Co-invest",
  secondary: "Secondary",
  service: "Service",
  lp_seeking: "LP Seeking",
};

/** Human label for a listing_type, title-casing an unknown value as a fallback. */
export function prettyListingType(t: string): string {
  return (
    LISTING_TYPE_LABELS[t] ??
    t
      .split(/[_\s-]+/)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ")
  );
}

/** Compact USD amount (e.g. "$4M"), or null when there's no amount to show. */
export function formatListingAmount(a: number | null | undefined): string | null {
  if (a == null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    notation: "compact",
  }).format(a);
}
