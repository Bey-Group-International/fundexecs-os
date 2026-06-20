// Shared formatting helpers for money and multiples. Centralized so every
// Execute view (command center, modules) renders figures identically.

export const num = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/** Compact currency for summaries and tiles — "$1.5M", "$0". */
export function compactUsd(n: number): string {
  if (!Number.isFinite(n) || Math.abs(n) < 1) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

/** Exact whole-dollar currency for ledgers — "$1,250,000". */
export function usd(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Investment multiple — "1.50×" or an em dash when unknown. */
export function multiple(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(2)}×`;
}

/** A short, human date — "Jun 20, 2026" — from an ISO date/datetime, or "—". */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
