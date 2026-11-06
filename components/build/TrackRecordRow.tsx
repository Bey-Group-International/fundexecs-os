import type { TrackRecord } from "@/lib/supabase/database.types";

function compactUsd(n: number | null): string | null {
  if (!n || n <= 0) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

/**
 * The read-only cells of one Track Record table row. The deal name is pinned to
 * the left edge on a phone so it stays in view while the figures scroll sideways.
 */
export function TrackRecordCells({ r }: { r: TrackRecord }) {
  return (
    <>
      <td className="max-w-[10rem] truncate bg-surface-1 px-3 py-2 text-fg-primary max-sm:sticky max-sm:left-0 max-sm:z-10">
        {r.deal_name}
      </td>
      <td className="whitespace-nowrap px-3 py-2">{r.asset_class ?? "—"}</td>
      <td className="px-3 py-2">{r.vintage_year ?? "—"}</td>
      <td className="whitespace-nowrap px-3 py-2">{compactUsd(r.invested_amount) ?? "—"}</td>
      <td className="px-3 py-2">{r.gross_irr != null ? `${r.gross_irr}%` : "—"}</td>
      <td className="px-3 py-2">{r.gross_moic != null ? `${r.gross_moic}x` : "—"}</td>
    </>
  );
}
