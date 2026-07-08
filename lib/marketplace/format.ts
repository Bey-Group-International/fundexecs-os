// Shared formatting for marketplace listing cards — used by both the owner
// console and the public Browse board so numbers, types, and "to be advised"
// placeholders read identically everywhere.

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  CHF: "CHF ",
  AUD: "A$",
  CAD: "C$",
  SGD: "S$",
  HKD: "HK$",
  JPY: "¥",
  AED: "AED ",
};

export const LISTING_CURRENCIES = ["USD", "EUR", "GBP", "CHF", "AUD", "CAD", "SGD"] as const;

const TYPE_LABELS: Record<string, string> = {
  deal: "Deal",
  fund: "Fund",
  co_invest: "Co-invest",
  secondary: "Secondary",
  lp_seeking: "LP seeking",
  service: "Service",
};

export function prettyType(t: string): string {
  return (
    TYPE_LABELS[t] ??
    t
      .split(/[_\s]+/)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ")
  );
}

/** Full currency amount, e.g. "$25,000,000" / "€18,500,000". */
export function formatMoney(amount: number | null | undefined, currency = "USD"): string | null {
  if (amount == null || Number.isNaN(amount)) return null;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // Unknown ISO currency — fall back to a symbol prefix.
    const sym = CURRENCY_SYMBOL[currency] ?? "";
    return `${sym}${Math.round(amount).toLocaleString("en-US")}`;
  }
}

/** Compact currency amount, e.g. "$25M" / "€1.1B" — for dense stat rows. */
export function formatCompact(amount: number | null | undefined, currency = "USD"): string | null {
  if (amount == null || Number.isNaN(amount)) return null;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount);
  } catch {
    const sym = CURRENCY_SYMBOL[currency] ?? "";
    return `${sym}${Math.round(amount).toLocaleString("en-US")}`;
  }
}

/**
 * Headline price for a card. Undisclosed figures render as "TBD" (to be
 * discussed) so an empty amount never looks like a broken card — mirroring how
 * off-market deals are quoted.
 */
export function priceDisplay(
  amount: number | null | undefined,
  currency = "USD",
  placeholder = "TBD",
): string {
  return formatMoney(amount, currency) ?? placeholder;
}

export function formatPct(n: number | null | undefined): string | null {
  if (n == null || Number.isNaN(n)) return null;
  return `${n.toFixed(1).replace(/\.0$/, "")}%`;
}

export type SubMetric = { label: string; value: string };

/**
 * The secondary figure shown under the price. Prefers EBITDA, then gross
 * revenue, then target IRR — the first disclosed one wins. Returns a "TBD"
 * EBITDA row when nothing is set so cards stay visually aligned.
 */
export function subMetricFor(listing: {
  ebitda?: number | null;
  gross_revenue?: number | null;
  target_irr?: number | null;
  currency?: string | null;
}): SubMetric {
  const currency = listing.currency ?? "USD";
  if (listing.ebitda != null) {
    return { label: "EBITDA", value: formatMoney(listing.ebitda, currency)! };
  }
  if (listing.gross_revenue != null) {
    return { label: "Gross", value: formatMoney(listing.gross_revenue, currency)! };
  }
  const irr = formatPct(listing.target_irr);
  if (irr) return { label: "Target IRR", value: irr };
  return { label: "EBITDA", value: "TBD" };
}

export function timeAgo(iso: string, now = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const d = Math.floor(diff / 86_400_000);
  if (d <= 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 30) return `${d}d ago`;
  const m = Math.floor(d / 30);
  if (m < 12) return `${m}mo ago`;
  return `${Math.floor(m / 12)}y ago`;
}

/** Listings created within the window get a "New" label. */
export function isNew(iso: string, now = Date.now(), days = 14): boolean {
  return now - new Date(iso).getTime() < days * 86_400_000;
}
