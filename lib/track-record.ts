// lib/track-record.ts
// Blends a firm's individual deals into the pooled performance an LP expects on
// a one-pager: capital deployed, value created, DPI/RVPI/MOIC, and a
// capital-weighted gross IRR. Pure computation over in-memory rows — no DB —
// so it is unit-tested directly and reused by the investor one-pager.
import type { TrackRecord } from "@/lib/supabase/database.types";

export interface BlendedTrackRecord {
  dealCount: number;
  realizedCount: number;
  totalInvested: number;
  totalRealized: number;
  totalUnrealized: number;
  totalValue: number; // realized + unrealized
  /** Pooled gross MOIC = total value / total invested. null when no capital. */
  pooledMoic: number | null;
  /** DPI = realized / invested. null when no capital. */
  dpi: number | null;
  /** RVPI = unrealized / invested. null when no capital. */
  rvpi: number | null;
  /** Capital-weighted gross IRR across deals that report both IRR and size. */
  weightedGrossIrr: number | null;
  vintageRange: { from: number; to: number } | null;
}

const num = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

export function blendTrackRecord(records: TrackRecord[]): BlendedTrackRecord {
  const totalInvested = records.reduce((s, r) => s + num(r.invested_amount), 0);
  const totalRealized = records.reduce((s, r) => s + num(r.realized_value), 0);
  const totalUnrealized = records.reduce((s, r) => s + num(r.unrealized_value), 0);
  const totalValue = totalRealized + totalUnrealized;

  // Capital-weighted IRR: only deals that report both an IRR and a size count.
  let irrWeight = 0;
  let irrAccum = 0;
  for (const r of records) {
    if (r.gross_irr != null && num(r.invested_amount) > 0) {
      irrWeight += num(r.invested_amount);
      irrAccum += r.gross_irr * num(r.invested_amount);
    }
  }

  const vintages = records
    .map((r) => r.vintage_year)
    .filter((y): y is number => typeof y === "number" && y > 0);

  return {
    dealCount: records.length,
    realizedCount: records.filter((r) => r.is_realized).length,
    totalInvested,
    totalRealized,
    totalUnrealized,
    totalValue,
    pooledMoic: totalInvested > 0 ? totalValue / totalInvested : null,
    dpi: totalInvested > 0 ? totalRealized / totalInvested : null,
    rvpi: totalInvested > 0 ? totalUnrealized / totalInvested : null,
    weightedGrossIrr: irrWeight > 0 ? irrAccum / irrWeight : null,
    vintageRange: vintages.length
      ? { from: Math.min(...vintages), to: Math.max(...vintages) }
      : null,
  };
}
