// Pure underwriting math for the Run › Underwriting module. No I/O — every
// function here takes plain data and returns plain data so it is trivially
// unit-testable. The server actions and the React module compose these.
//
// IRR/MOIC values on an Underwriting may be stored as a fraction (0.18) or a
// whole percent (18); for cross-case comparison we normalize IRR to a
// percentage so everything is on the same scale. MOIC is a multiple, used
// as-is. `toPercent` is defined locally (mirroring lib/run-conviction) so this
// module stays leaf-pure and safe to import from client components.
import type { Underwriting } from "@/lib/supabase/database.types";

// Normalize an IRR/MOIC value to a percentage number (fraction → ×100; an
// already-whole percent is left as-is). Kept in sync with run-conviction.
export function toPercent(v: number | null): number | null {
  if (v == null) return null;
  return v <= 2 ? Math.round(v * 1000) / 10 : Math.round(v * 10) / 10;
}

// The canonical scenario ordering for side-by-side comparison.
export const SCENARIO_ORDER = ["base", "upside", "downside", "stress"] as const;
export type ScenarioKey = (typeof SCENARIO_ORDER)[number];

// --- model JSON helpers -----------------------------------------------------
// The `model` JSONB column holds free-form assumptions plus the operator-set
// probability weight. These readers are defensive: the column may be null, a
// scalar, or an object from older rows.

export interface UnderwritingAssumptions {
  equity?: number | null;
  exitValue?: number | null;
  exitMultiple?: number | null;
  holdYears?: number | null;
  leverage?: number | null;
}

function asRecord(model: unknown): Record<string, unknown> {
  return model && typeof model === "object" && !Array.isArray(model)
    ? (model as Record<string, unknown>)
    : {};
}

/** Read the probability weight (0..1) stored in `model.probability`, if any. */
export function readProbability(model: unknown): number | null {
  const v = asRecord(model)["probability"];
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return clamp01(v);
}

/** Read the saved calculator assumptions from `model.assumptions`. */
export function readAssumptions(model: unknown): UnderwritingAssumptions {
  const a = asRecord(asRecord(model)["assumptions"]);
  const numOrNull = (k: string): number | null => {
    const v = a[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  return {
    equity: numOrNull("equity"),
    exitValue: numOrNull("exitValue"),
    exitMultiple: numOrNull("exitMultiple"),
    holdYears: numOrNull("holdYears"),
    leverage: numOrNull("leverage"),
  };
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// --- 3. Inputs-driven returns calculator -----------------------------------
export interface ReturnInputs {
  /** Entry equity invested. */
  equity: number;
  /** Total exit value (gross proceeds attributable to equity). */
  exitValue: number;
  /** Hold period in years. */
  holdYears: number;
}

export interface ComputedReturns {
  /** Multiple on invested capital = exitValue / equity. */
  moic: number | null;
  /** Annualized IRR as a FRACTION (e.g. 0.18 for 18%). */
  irr: number | null;
}

/**
 * Core return math. MOIC = exitValue / equity; IRR = MOIC^(1/holdYears) - 1,
 * the constant annual growth that turns `equity` into `exitValue` over the
 * hold. Returns nulls (rather than throwing) when inputs are degenerate so the
 * UI can render an em-dash instead of NaN/Infinity.
 */
export function computeReturns({ equity, exitValue, holdYears }: ReturnInputs): ComputedReturns {
  if (!Number.isFinite(equity) || !Number.isFinite(exitValue) || equity <= 0 || exitValue < 0) {
    return { moic: null, irr: null };
  }
  const moic = exitValue / equity;
  let irr: number | null = null;
  if (Number.isFinite(holdYears) && holdYears > 0 && moic > 0) {
    irr = Math.pow(moic, 1 / holdYears) - 1;
  }
  return { moic, irr };
}

/**
 * Convenience: resolve an exit value from either an explicit exit value or an
 * exit multiple (exitMultiple × equity), then compute returns. `leverage` is
 * accepted for parity with the inputs form but does not change the
 * equity-level MOIC/IRR here (proceeds are already equity-attributable).
 */
export function computeReturnsFromInputs(input: {
  equity: number;
  exitValue?: number | null;
  exitMultiple?: number | null;
  holdYears: number;
}): ComputedReturns {
  const exitValue =
    input.exitValue != null && Number.isFinite(input.exitValue)
      ? input.exitValue
      : input.exitMultiple != null && Number.isFinite(input.exitMultiple)
        ? input.exitMultiple * input.equity
        : NaN;
  return computeReturns({ equity: input.equity, exitValue, holdYears: input.holdYears });
}

// --- 1. Scenario comparison + deltas ---------------------------------------
export interface ScenarioRow {
  scenario: string;
  /** The underlying case, if one exists for this scenario. */
  uw: Underwriting | null;
  /** IRR normalized to a percentage number (e.g. 18.0), or null. */
  irrPct: number | null;
  /** MOIC multiple, or null. */
  moic: number | null;
  /** IRR delta (in percentage points) vs the base case, or null. */
  irrDeltaPct: number | null;
  /** MOIC delta (in multiples) vs the base case, or null. */
  moicDelta: number | null;
}

export interface DealComparison {
  dealId: string;
  rows: ScenarioRow[];
  baseCase: Underwriting | null;
}

function pickBase(cases: Underwriting[]): Underwriting | null {
  return (
    cases.find((u) => u.scenario === "base") ??
    cases.find((u) => /base/i.test(u.name)) ??
    cases[0] ??
    null
  );
}

/**
 * Build a base/upside/downside/stress comparison for a single deal's cases,
 * with each non-base row's IRR/MOIC delta measured against the base case.
 * Always returns the four canonical scenario rows (missing ones carry nulls)
 * so the table renders a stable shape. Extra/unknown scenarios are appended.
 */
export function compareScenarios(dealId: string, cases: Underwriting[]): DealComparison {
  const forDeal = cases.filter((u) => u.deal_id === dealId);
  const base = pickBase(forDeal);
  const baseIrr = base ? toPercent(base.projected_irr) : null;
  const baseMoic = base?.projected_moic ?? null;

  const byScenario = new Map<string, Underwriting>();
  for (const u of forDeal) if (!byScenario.has(u.scenario)) byScenario.set(u.scenario, u);

  const extras = [...byScenario.keys()].filter(
    (s) => !SCENARIO_ORDER.includes(s as ScenarioKey),
  );
  const order = [...SCENARIO_ORDER, ...extras];

  const rows: ScenarioRow[] = order.map((scenario) => {
    const uw = byScenario.get(scenario) ?? null;
    const irrPct = uw ? toPercent(uw.projected_irr) : null;
    const moic = uw?.projected_moic ?? null;
    const isBase = !!base && uw?.id === base.id;
    return {
      scenario,
      uw,
      irrPct,
      moic,
      irrDeltaPct: !isBase && irrPct != null && baseIrr != null ? round1(irrPct - baseIrr) : null,
      moicDelta: !isBase && moic != null && baseMoic != null ? round2(moic - baseMoic) : null,
    };
  });

  return { dealId, rows, baseCase: base };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// --- 2. Probability-weighted expected return -------------------------------
export interface WeightedCase {
  /** Probability weight, expected 0..1 (will be normalized across cases). */
  weight: number;
  /** IRR as stored on the case (fraction or percent — normalized internally). */
  projected_irr: number | null;
  projected_moic: number | null;
}

export interface WeightedReturn {
  /** Probability-weighted expected IRR, normalized to a percentage. */
  irrPct: number | null;
  /** Probability-weighted expected MOIC multiple. */
  moic: number | null;
  /** Sum of raw weights supplied (before normalization). */
  totalWeight: number;
  /** Number of cases that contributed (had a usable value + positive weight). */
  contributing: number;
}

/**
 * Probability-weighted expected IRR/MOIC across a deal's cases. Weights need
 * not sum to 1 — they are normalized over the cases that actually carry a value
 * for the given metric (IRR and MOIC are normalized independently, so a case
 * missing one metric doesn't distort the other). Returns nulls when no case has
 * a usable value or all weights are zero.
 */
export function weightedReturn(cases: WeightedCase[]): WeightedReturn {
  const totalWeight = cases.reduce((s, c) => s + (c.weight > 0 ? c.weight : 0), 0);

  const irrPct = weightedMetric(cases, (c) => toPercent(c.projected_irr));
  const moic = weightedMetric(cases, (c) => c.projected_moic);
  const contributing = cases.filter(
    (c) => c.weight > 0 && (c.projected_irr != null || c.projected_moic != null),
  ).length;

  return { irrPct, moic, totalWeight, contributing };
}

function weightedMetric(
  cases: WeightedCase[],
  value: (c: WeightedCase) => number | null,
): number | null {
  let weightSum = 0;
  let acc = 0;
  for (const c of cases) {
    const v = value(c);
    const w = c.weight > 0 ? c.weight : 0;
    if (v == null || w === 0) continue;
    weightSum += w;
    acc += w * v;
  }
  if (weightSum === 0) return null;
  return round2(acc / weightSum);
}

// --- 4. Sources & uses / equity roll-up ------------------------------------
export interface EquityRollup {
  /** Sum of equity_required across each deal's base case. */
  totalEquityRequired: number;
  /** How many deals contributed a base-case equity figure. */
  dealsWithEquity: number;
  /** Per-deal base-case equity, for the breakdown table. */
  byDeal: { dealId: string; equityRequired: number }[];
}

/**
 * Pipeline-wide equity roll-up: for each deal, take its base case's
 * `equity_required` and sum across deals. Cases without a base case or without
 * an equity figure are skipped. Pure — feed it the full org-wide case list.
 */
export function rollupEquityRequired(cases: Underwriting[]): EquityRollup {
  const byDealId = new Map<string, Underwriting[]>();
  for (const u of cases) {
    const arr = byDealId.get(u.deal_id) ?? [];
    arr.push(u);
    byDealId.set(u.deal_id, arr);
  }

  const byDeal: { dealId: string; equityRequired: number }[] = [];
  for (const [dealId, group] of byDealId) {
    const base = pickBase(group);
    const eq = base?.equity_required;
    if (eq != null && Number.isFinite(eq)) {
      byDeal.push({ dealId, equityRequired: eq });
    }
  }

  return {
    totalEquityRequired: byDeal.reduce((s, d) => s + d.equityRequired, 0),
    dealsWithEquity: byDeal.length,
    byDeal,
  };
}

/** Group a flat list of cases by deal id, preserving input order. */
export function groupByDeal(cases: Underwriting[]): Map<string, Underwriting[]> {
  const map = new Map<string, Underwriting[]>();
  for (const u of cases) {
    const arr = map.get(u.deal_id) ?? [];
    arr.push(u);
    map.set(u.deal_id, arr);
  }
  return map;
}
