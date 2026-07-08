import type { ListingCardData } from "./ListingCard";
import { priceDisplay, subMetricFor, prettyType } from "@/lib/marketplace/format";
import { resolveCountry } from "@/lib/marketplace/flags";

// Client-side export helpers. The marketplace has no server export endpoint, so
// we build the file in the browser from whatever set of listings is currently
// in view (respecting the active filters).

function csvCell(value: string): string {
  // Escape per RFC 4180 — wrap in quotes and double any embedded quotes.
  return `"${value.replace(/"/g, '""')}"`;
}

export function listingsToCsv(listings: ListingCardData[]): string {
  const header = [
    "Reference",
    "Title",
    "Type",
    "Country",
    "Asset class",
    "Status",
    "Price",
    "Sub-metric",
    "Sub-metric value",
    "Created",
  ];
  const rows = listings.map((l) => {
    const sub = subMetricFor(l);
    return [
      l.reference_code ?? "",
      l.title,
      prettyType(l.listing_type),
      resolveCountry(l.country)?.label ?? "",
      l.asset_class ?? "",
      l.status,
      priceDisplay(l.amount, l.currency),
      sub.label,
      sub.value,
      new Date(l.created_at).toISOString().slice(0, 10),
    ].map((c) => csvCell(String(c)));
  });
  return [header.map(csvCell), ...rows].map((r) => r.join(",")).join("\r\n");
}

export function downloadCsv(listings: ListingCardData[], filename = "marketplace-listings.csv") {
  const blob = new Blob([listingsToCsv(listings)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// PDF export without a dependency: hand the current view to the browser's print
// dialog ("Save as PDF"). The print stylesheet in globals.css keeps only the
// listing grid.
export function printListings() {
  if (typeof window !== "undefined") window.print();
}
