// lib/entity-ownership.ts
// Build-hub entity ownership roll-up — the cap table for the firm's OWN vehicles
// (GP, management company, funds, SPVs): who holds what and at what percentage.
// Ownership % is taken explicitly when set, else derived from each holder's
// share of total units within the entity. Pure — unit-tested, reused by the UI.
import type { EquityHolding } from "@/lib/supabase/database.types";

// Minimal shapes the roll-up needs — both full DB rows and lightweight client
// projections satisfy these structurally.
type StakeholderLike = { id: string; name: string; kind: string };
type ShareClassLike = { id: string; name: string };

const n = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;
const round2 = (v: number): number => Math.round(v * 100) / 100;

export interface OwnershipRow {
  holdingId: string;
  stakeholderId: string;
  name: string;
  kind: string;
  className: string | null;
  units: number | null;
  ownershipPct: number; // resolved %
  investedAmount: number | null;
}

export interface ClassBreakdown {
  className: string;
  pct: number;
}

export interface OwnershipRollup {
  rows: OwnershipRow[];
  totalPct: number; // sum of resolved % (≈100 when complete)
  totalUnits: number;
  totalInvested: number;
  balanced: boolean; // within 0.5 of 100
  topHolderPct: number;
  byClass: ClassBreakdown[];
}

/**
 * Roll up an entity's holdings into an ownership table. Explicit ownership_pct
 * wins; otherwise a holder's % is its share of the entity's total units. When
 * neither is present, holders split evenly so the table still sums sensibly.
 */
export function rollupOwnership(
  holdings: EquityHolding[],
  stakeholders: StakeholderLike[],
  shareClasses: ShareClassLike[],
): OwnershipRollup {
  const stakeholderById = new Map(stakeholders.map((s) => [s.id, s]));
  const classById = new Map(shareClasses.map((c) => [c.id, c]));

  const totalUnits = holdings.reduce((s, h) => s + n(h.units), 0);
  const explicitPct = holdings.reduce((s, h) => s + n(h.ownership_pct), 0);
  const withoutAny = holdings.filter((h) => h.ownership_pct == null && !n(h.units));
  const evenShare = holdings.length ? (Math.max(0, 100 - explicitPct) / holdings.length) : 0;

  const rows: OwnershipRow[] = holdings.map((h) => {
    let pct: number;
    if (h.ownership_pct != null) pct = round2(n(h.ownership_pct));
    else if (totalUnits > 0 && n(h.units) > 0) pct = round2((n(h.units) / totalUnits) * 100);
    else pct = round2(evenShare);
    const s = stakeholderById.get(h.stakeholder_id);
    return {
      holdingId: h.id,
      stakeholderId: h.stakeholder_id,
      name: s?.name ?? "Unknown",
      kind: s?.kind ?? "other",
      className: h.share_class_id ? classById.get(h.share_class_id)?.name ?? null : null,
      units: h.units,
      ownershipPct: pct,
      investedAmount: h.invested_amount,
    };
  });
  rows.sort((a, b) => b.ownershipPct - a.ownershipPct);
  void withoutAny;

  const totalPct = round2(rows.reduce((s, r) => s + r.ownershipPct, 0));
  const totalInvested = holdings.reduce((s, h) => s + n(h.invested_amount), 0);

  const classMap = new Map<string, number>();
  for (const r of rows) {
    const k = r.className ?? "Unclassified";
    classMap.set(k, round2((classMap.get(k) ?? 0) + r.ownershipPct));
  }
  const byClass: ClassBreakdown[] = [...classMap.entries()]
    .map(([className, pct]) => ({ className, pct }))
    .sort((a, b) => b.pct - a.pct);

  return {
    rows,
    totalPct,
    totalUnits,
    totalInvested,
    balanced: Math.abs(totalPct - 100) <= 0.5,
    topHolderPct: rows.length ? rows[0].ownershipPct : 0,
    byClass,
  };
}
