// Execute-hub 409A fair-value engine — the layer above the valuation *policy*.
// Where the policy enforces re-mark cadence, this computes a defensible mark:
// the income, market, and cost approaches a 409A analysis weighs, concluded into
// a single fair value with an optional discount for lack of marketability
// (DLOM). Pure and dependency-free; the UI feeds it each holding's inputs and
// surfaces the concluded value next to the carried mark.

export type Approach = "income" | "market" | "cost";

export interface ApproachResult {
  approach: Approach;
  value: number;
  weight: number; // relative weight before normalization
  rationale: string;
}

export interface Fair409A {
  approaches: ApproachResult[];
  grossValue: number; // weighted conclusion before DLOM
  dlom: number; // discount for lack of marketability, 0–1
  concludedValue: number; // grossValue × (1 − dlom)
  primary: Approach | null; // highest-weighted approach
}

function round0(v: number): number {
  return Math.round(v);
}

/**
 * Income approach — capitalize stabilized income. `capRatePct` is a percentage
 * (e.g. 6.5 → 0.065); a cap rate at or below zero has no defined value.
 */
export function incomeValue(noi: number, capRatePct: number): number | null {
  if (!Number.isFinite(noi) || !Number.isFinite(capRatePct) || capRatePct <= 0 || noi <= 0) return null;
  return round0(noi / (capRatePct / 100));
}

/**
 * Market approach — a comparable metric (revenue, EBITDA, NOI) times its
 * observed multiple, less net debt to bridge enterprise to equity value.
 */
export function marketValue(metric: number, multiple: number, netDebt = 0): number | null {
  if (!Number.isFinite(metric) || !Number.isFinite(multiple) || metric <= 0 || multiple <= 0) return null;
  return round0(metric * multiple - (Number.isFinite(netDebt) ? netDebt : 0));
}

/**
 * Conclude a fair value from the available approaches: a weight-normalized
 * blend, then a discount for lack of marketability. Approaches with a
 * non-positive value or weight are dropped. Returns a zeroed conclusion when no
 * approach is available. No I/O — unit-testable.
 */
export function conclude(approaches: ApproachResult[], dlom = 0): Fair409A {
  const usable = approaches.filter((a) => a.value > 0 && a.weight > 0);
  const totalWeight = usable.reduce((s, a) => s + a.weight, 0);
  const grossValue =
    totalWeight > 0 ? round0(usable.reduce((s, a) => s + a.value * a.weight, 0) / totalWeight) : 0;
  const clampedDlom = Math.min(Math.max(dlom, 0), 0.9);
  const primary = usable.length
    ? usable.reduce((best, a) => (a.weight > best.weight ? a : best)).approach
    : null;
  return {
    approaches,
    grossValue,
    dlom: clampedDlom,
    concludedValue: round0(grossValue * (1 - clampedDlom)),
    primary,
  };
}

export interface Mark409AInput {
  noi?: number | null;
  capRatePct?: number | null;
  marketMetric?: number | null;
  marketMultiple?: number | null;
  netDebt?: number | null;
  cost?: number | null;
  dlom?: number;
}

/**
 * Build a concluded 409A mark from a holding's available inputs. The income and
 * market approaches carry the weight when present; the cost approach is the
 * backstop (half weight) so a holding with only a cost basis still gets a value.
 * Returns null when no approach can be computed.
 */
export function markAsset(input: Mark409AInput): Fair409A | null {
  const approaches: ApproachResult[] = [];

  const inc = incomeValue(num(input.noi), num(input.capRatePct));
  if (inc != null) {
    approaches.push({
      approach: "income",
      value: inc,
      weight: 1,
      rationale: `NOI ${fmt(num(input.noi))} ÷ ${num(input.capRatePct)}% cap rate`,
    });
  }

  const mkt = marketValue(num(input.marketMetric), num(input.marketMultiple), num(input.netDebt));
  if (mkt != null) {
    approaches.push({
      approach: "market",
      value: mkt,
      weight: 1,
      rationale: `${fmt(num(input.marketMetric))} × ${num(input.marketMultiple)}× comp${
        num(input.netDebt) ? `, less ${fmt(num(input.netDebt))} net debt` : ""
      }`,
    });
  }

  const cost = num(input.cost);
  if (cost > 0) {
    approaches.push({
      approach: "cost",
      value: cost,
      weight: approaches.length > 0 ? 0.5 : 1,
      rationale: "Acquisition cost basis",
    });
  }

  if (approaches.length === 0) return null;
  return conclude(approaches, input.dlom ?? 0);
}

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}
