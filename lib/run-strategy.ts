// Run-hub strategy: the allocation + prioritization layer on top of conviction.
// Where conviction asks "is this one deal ready?", strategy asks "where should
// the firm point its attention *next*, and is the live pipeline actually
// covering the mandate it set for itself?". All logic here is pure over the
// already-scored `DealConviction[]` and the `Mandate`, so it is unit-testable
// without touching the database.
import type { DealConviction } from "@/lib/run-conviction";
import type { Mandate } from "@/lib/build-readiness";

// --- Normalization ----------------------------------------------------------

/** Clamp a 0..1 thesis-fit value into range; null passes through. */
export function clampUnit(v: number | null): number | null {
  if (v == null || Number.isNaN(v)) return null;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * Free-text mandate matching: a deal's asset_class / geography "covers" a
 * mandate bucket when either string contains the other (case-insensitive).
 * Mirrors the `inMandate` heuristic the module already used so the allocation
 * view and the per-row fit chips agree.
 */
export function matchesBucket(value: string | null, bucket: string): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  const b = bucket.trim().toLowerCase();
  if (!v || !b) return false;
  return v.includes(b) || b.includes(v);
}

// --- Allocation / mandate coverage ------------------------------------------

export interface AllocationSlice {
  /** The bucket label (asset class or geography), as captured on deals. */
  label: string;
  count: number;
  /** Share of the working set, 0..1. */
  share: number;
  /** True when this label is the single largest slice (concentration flag). */
  concentrated: boolean;
}

export interface MandateGap {
  /** A mandate bucket with zero covering deals in the live pipeline. */
  label: string;
}

export interface AllocationDimension {
  slices: AllocationSlice[];
  /** Mandate buckets with no covering deal in the working set. */
  gaps: MandateGap[];
  /** Count of deals with no value recorded on this dimension. */
  unspecified: number;
}

export interface Allocation {
  total: number;
  byAssetClass: AllocationDimension;
  byGeography: AllocationDimension;
}

const CONCENTRATION_THRESHOLD = 0.5; // a single slice >50% of pipeline

function dimension(
  deals: DealConviction[],
  pick: (d: DealConviction) => string | null,
  mandateBuckets: string[],
): AllocationDimension {
  const total = deals.length;
  const counts = new Map<string, number>();
  let unspecified = 0;
  for (const d of deals) {
    const raw = pick(d);
    const label = raw?.trim();
    if (!label) {
      unspecified += 1;
      continue;
    }
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const max = Math.max(0, ...counts.values());
  const slices: AllocationSlice[] = [...counts.entries()]
    .map(([label, count]) => ({
      label,
      count,
      share: total ? count / total : 0,
      // Largest slice, and only meaningful as "concentration" once it's a
      // genuine majority of the (>1 deal) pipeline.
      concentrated: count === max && total > 1 && count / total > CONCENTRATION_THRESHOLD,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  // A mandate bucket is a gap when no deal in the working set covers it.
  const gaps: MandateGap[] = mandateBuckets
    .filter((bucket) => bucket.trim().length > 0)
    .filter((bucket) => !deals.some((d) => matchesBucket(pick(d), bucket)))
    .map((label) => ({ label }));

  return { slices, gaps, unspecified };
}

/**
 * Roll the working set up into an allocation view across asset class and
 * geography, flagging concentration and which mandate buckets the live pipeline
 * does not yet cover.
 */
export function computeAllocation(deals: DealConviction[], mandate: Mandate | null): Allocation {
  return {
    total: deals.length,
    byAssetClass: dimension(deals, (d) => d.deal.asset_class, mandate?.assetClasses ?? []),
    byGeography: dimension(deals, (d) => d.deal.geography, mandate?.geographies ?? []),
  };
}

// --- Prioritization queue ---------------------------------------------------

export interface PriorityDeal {
  conviction: DealConviction;
  /** Blended priority score, 0..100. */
  priority: number;
  /** The drivers behind the score, for explaining the ranking. */
  factors: {
    conviction: number; // 0..1 (score / 100)
    fit: number; // 0..1 (thesis_fit, default 0.5 when unscored)
    size: number; // 0..1 (relative to the largest target_amount in the set)
  };
}

const DEFAULT_FIT = 0.5; // an unscored deal is treated as neutral, not zero

/**
 * Rank the working set by a blended priority: conviction carries the most
 * weight (it reflects real evaluation progress), thesis fit and relative check
 * size tilt attention toward the deals most worth the firm's time. Returns a
 * new array sorted highest-priority first; ties break on conviction then name
 * so the order is stable.
 */
export function prioritize(deals: DealConviction[]): PriorityDeal[] {
  const maxSize = Math.max(
    0,
    ...deals.map((d) => (d.deal.target_amount != null && d.deal.target_amount > 0 ? d.deal.target_amount : 0)),
  );

  return deals
    .map((d) => {
      const conviction = Math.min(Math.max(d.score, 0), 100) / 100;
      const fit = clampUnit(d.deal.thesis_fit) ?? DEFAULT_FIT;
      const size =
        maxSize > 0 && d.deal.target_amount != null && d.deal.target_amount > 0
          ? d.deal.target_amount / maxSize
          : 0;

      // Weighted blend. Size is a softer signal than conviction/fit — and many
      // deals carry no target_amount — so it contributes a smaller, additive
      // tilt rather than multiplying the score to zero when size is unknown.
      const blended = conviction * 0.55 + fit * 0.3 + size * 0.15;
      const priority = Math.round(blended * 1000) / 10; // 0..100, one decimal

      return { conviction: d, priority, factors: { conviction, fit, size } };
    })
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        b.conviction.score - a.conviction.score ||
        a.conviction.deal.name.localeCompare(b.conviction.deal.name),
    );
}

/** The single deal the operator should focus on next, or null when empty. */
export function focusNext(deals: DealConviction[]): PriorityDeal | null {
  return prioritize(deals)[0] ?? null;
}
