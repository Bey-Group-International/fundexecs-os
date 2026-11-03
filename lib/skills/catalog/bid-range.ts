// lib/skills/catalog/bid-range.ts
// Bid Price Range (PE department · Valuation 07). Solves the maximum entry price
// that still clears the firm's return hurdle in the base and downside cases, using
// the same LBO core as the `lbo` skill (no second model to drift), then adjusts for
// supported red-flag price items and sets it against the comps range.
//   * walk-away = min(max price clearing base, max price clearing downside) − adjustments;
//   * opening and target are the deal team's negotiating call — computed ONLY from
//     discounts they supply, never invented;
//   * the note says so plainly if the walk-away does not clear the downside.
// Pure core. Price is enterprise value.

import type { JsonSchema, SkillContext, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";
import { lbo } from "./lbo";
import { DEFAULT_RETURNS, testHurdle, type HurdleVerdict, type ReturnsHurdles } from "@/lib/pe/returns-hurdles";

export interface DownsideCase {
  ebitdaGrowthRate?: number;
  exitMultiple?: number;
}

export interface BidRangeInput {
  /** Diligence-adjusted LTM EBITDA (from the QoE bridge, once signed). */
  ebitda: number;
  leverageMultiple?: number;
  debtAmount?: number;
  holdYears?: number;
  /** Fixed exit multiple. Absent = exit at entry multiple (labelled convention). */
  exitMultiple?: number;
  ebitdaGrowthRate?: number;
  annualDebtPaydown?: number;
  transactionFeesPct?: number;
  /** Org hurdles; the standing default applies when absent and is labelled. */
  hurdles?: ReturnsHurdles;
  downsideCase?: DownsideCase;
  compsMultipleRange?: { low: number; high: number };
  /** Supported price reduction from the red flag register (enterprise value, positive). */
  redFlagPriceAdjustment?: number;
  /** Deal-team stance, as % below walk-away. opening >= target. */
  openingDiscountPct?: number;
  targetDiscountPct?: number;
  gateOwner?: string;
}

export interface CaseSolve {
  case: "base" | "downside";
  maxEntryMultiple: number | null;
  maxEntryEV: number | null;
  capped: boolean;
}

export interface BidRangeOutput {
  base: CaseSolve;
  downside: CaseSolve | null;
  adjustmentApplied: number;
  walkAway: { ev: number | null; multiple: number | null; basis: string };
  target: { ev: number | null; basis: string };
  opening: { ev: number | null; basis: string };
  walkAwayClearsBase: HurdleVerdict;
  walkAwayClearsDownside: HurdleVerdict;
  versusComps: "below" | "within" | "above" | "not-supplied";
  hurdlesAreDefault: boolean;
  limitation: string;
  note: string;
  gate: string;
}

const MAX_MULT = 60;
const MIN_MULT = 0.5;
const r1 = (n: number) => Math.round(n * 10) / 10;

function lboAt(input: BidRangeInput, hold: number, multiple: number, dn?: DownsideCase, ctx?: SkillContext) {
  const c = ctx ?? { workspaceId: "", principalId: "", executive: "analyst" as const };
  const out = lbo.run(
    {
      entryEbitda: input.ebitda,
      entryMultiple: multiple,
      leverageMultiple: input.leverageMultiple,
      debtAmount: input.debtAmount,
      holdYears: hold,
      exitMultiple: dn?.exitMultiple ?? input.exitMultiple,
      ebitdaGrowthRate: dn?.ebitdaGrowthRate ?? input.ebitdaGrowthRate,
      annualDebtPaydown: input.annualDebtPaydown,
      transactionFeesPct: input.transactionFeesPct,
    },
    c,
  ).structured;
  return { irr: out.irr, moic: out.moic };
}

/** Highest entry multiple that still clears the hurdle (returns fall as price rises, so bisect). */
function solveMax(clears: (m: number) => boolean, minMult: number): { multiple: number | null; capped: boolean } {
  if (!clears(minMult)) return { multiple: null, capped: false };
  if (clears(MAX_MULT)) return { multiple: MAX_MULT, capped: true };
  let lo = minMult;
  let hi = MAX_MULT;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (clears(mid)) lo = mid;
    else hi = mid;
  }
  return { multiple: Math.round(lo * 100) / 100, capped: false };
}

const run: SkillCore<BidRangeInput, BidRangeOutput> = (input, ctx): SkillCoreResult<BidRangeOutput> => {
  const sources: SkillSource[] = [];
  const missingData: string[] = [];
  const hurdlesAreDefault = !input.hurdles;
  const hurdles = input.hurdles ?? DEFAULT_RETURNS;
  const hold = input.holdYears ?? hurdles.holdYears;

  if (hurdlesAreDefault) sources.push({ label: "Return hurdles", kind: "assumption", value: "standing default: gross IRR 20%, MOIC 2.5x", ref: "run on default settings — set root-returns" });
  if (input.holdYears === undefined) sources.push({ label: "Hold period", kind: "assumption", value: `${hold} years`, ref: hurdlesAreDefault ? "standing default" : "root-returns" });
  if (input.exitMultiple === undefined) sources.push({ label: "Exit multiple", kind: "assumption", value: "exit at entry multiple (no expansion)" });
  sources.push({ label: "Diligence-adjusted EBITDA", kind: "fact", value: input.ebitda });
  if (input.leverageMultiple === undefined && input.debtAmount === undefined) missingData.push("Leverage / debt — modelled all-equity, which understates the price that clears the hurdle");

  const baseClears = (m: number) => {
    const r = lboAt(input, hold, m, undefined, ctx);
    return testHurdle(hurdles.base, r.irr, r.moic) === "clears";
  };
  // Below debt + fees the equity cheque is not positive and IRR is undefined, so start the search just above that.
  const debt = input.debtAmount ?? (input.leverageMultiple ?? 0) * input.ebitda;
  const minMult = Math.max(MIN_MULT, input.ebitda > 0 ? debt / (input.ebitda * (1 + (input.transactionFeesPct ?? 0))) + 0.05 : MIN_MULT);
  const b = solveMax(baseClears, minMult);
  const base: CaseSolve = { case: "base", maxEntryMultiple: b.multiple, maxEntryEV: b.multiple === null ? null : r1(b.multiple * input.ebitda), capped: b.capped };
  sources.push({ label: "Max price clearing base hurdle", kind: "calculation", value: base.maxEntryEV ?? "none", ref: "bisection on entry multiple over the lbo core" });

  let downside: CaseSolve | null = null;
  const downsideHurdle = hurdles.downside;
  if (downsideHurdle && input.downsideCase) {
    const dc = input.downsideCase;
    const clears = (m: number) => {
      const r = lboAt(input, hold, m, dc, ctx);
      return testHurdle(downsideHurdle, r.irr, r.moic) === "clears";
    };
    const d = solveMax(clears, minMult);
    downside = { case: "downside", maxEntryMultiple: d.multiple, maxEntryEV: d.multiple === null ? null : r1(d.multiple * input.ebitda), capped: d.capped };
    sources.push({ label: "Max price clearing downside hurdle", kind: "calculation", value: downside.maxEntryEV ?? "none" });
  } else if (downsideHurdle && !input.downsideCase) {
    missingData.push("A downside hurdle is set but no downside case was supplied — downside not tested");
  }

  const adjustment = input.redFlagPriceAdjustment ?? 0;
  const ceilings = [base.maxEntryEV, downside?.maxEntryEV].filter((v): v is number => typeof v === "number");
  const anyNone = base.maxEntryEV === null || (downside !== null && downside.maxEntryEV === null);
  const ceiling = anyNone || ceilings.length === 0 ? null : Math.min(...ceilings);
  const walkAwayEv = ceiling === null ? null : r1(Math.max(0, ceiling - adjustment));
  const walkMult = walkAwayEv === null ? null : Math.round((walkAwayEv / input.ebitda) * 100) / 100;
  const walkBasis =
    ceiling === null
      ? "No price clears the hurdle on these assumptions."
      : `Lower of the max price clearing the ${downside ? "base and downside" : "base"} hurdle (${ceiling}) less supported red-flag adjustments (${adjustment}).`;

  // Does the walk-away actually clear? (Re-test at the adjusted price.)
  let clearsBase: HurdleVerdict = "not-tested";
  let clearsDown: HurdleVerdict = "not-tested";
  if (walkMult !== null) {
    const rb = lboAt(input, hold, walkMult, undefined, ctx);
    clearsBase = testHurdle(hurdles.base, rb.irr, rb.moic);
    if (downsideHurdle && input.downsideCase) {
      const rd = lboAt(input, hold, walkMult, input.downsideCase, ctx);
      clearsDown = testHurdle(downsideHurdle, rd.irr, rd.moic);
    }
  }

  const stance = (disc: number | undefined, label: string) =>
    walkAwayEv === null
      ? { ev: null, basis: "No walk-away price." }
      : disc === undefined
        ? { ev: null, basis: `${label} not set — a negotiating call for the deal team; supply a discount to the walk-away to compute it.` }
        : { ev: r1(walkAwayEv * (1 - disc / 100)), basis: `${disc}% below walk-away (deal-team input).` };
  const target = stance(input.targetDiscountPct, "Target");
  const opening = stance(input.openingDiscountPct, "Opening bid");
  if (opening.ev !== null && target.ev !== null && opening.ev > target.ev) {
    opening.basis += " WARNING: opening is above target — check the discounts.";
  }

  let versusComps: BidRangeOutput["versusComps"] = "not-supplied";
  if (input.compsMultipleRange && walkMult !== null) {
    versusComps = walkMult < input.compsMultipleRange.low ? "below" : walkMult > input.compsMultipleRange.high ? "above" : "within";
  }

  const gateOwner = input.gateOwner?.trim() || "The IC";
  const gate = `${gateOwner} sets the price. This note informs it.`;
  const limitation = "The range ignores process dynamics you have not told it about — competing bidders, seller timing. Price is enterprise value; equity price needs net debt and debt-like items.";
  const note =
    walkAwayEv === null
      ? "No entry price clears the hurdle on these assumptions: revisit leverage, growth or the hurdle before bidding."
      : `Walk-away ${walkAwayEv} (${walkMult}x): ${clearsBase === "clears" ? "clears" : clearsBase === "misses" ? "MISSES" : "not tested on"} the base hurdle${downside ? `, ${clearsDown === "clears" ? "clears" : clearsDown === "misses" ? "MISSES" : "not tested on"} the downside hurdle` : "; downside not tested"}.${versusComps === "above" ? " Above the comps range." : ""}${hurdlesAreDefault ? " Run on default hurdles." : ""}`;

  const structured: BidRangeOutput = {
    base,
    downside,
    adjustmentApplied: adjustment,
    walkAway: { ev: walkAwayEv, multiple: walkMult, basis: walkBasis },
    target,
    opening,
    walkAwayClearsBase: clearsBase,
    walkAwayClearsDownside: clearsDown,
    versusComps,
    hurdlesAreDefault,
    limitation,
    note,
    gate,
  };

  const completeness = Math.round(((input.leverageMultiple !== undefined || input.debtAmount !== undefined ? 1 : 0) + (input.holdYears !== undefined ? 1 : 0) + (input.downsideCase ? 1 : 0) + (hurdlesAreDefault ? 0 : 1)) / 4 * 100) / 100;
  return { structured, narrative: `${note} ${gate}`, sources, confidence: Math.max(0.2, Math.min(0.85, 0.3 + completeness * 0.5)), completeness, missingData };
};

const caseSchema: JsonSchema = { type: "object", properties: { ebitdaGrowthRate: { type: "number" }, exitMultiple: { type: "number", minimum: 0 } } };
const hurdle: JsonSchema = { type: "object", properties: { irr: { type: "number", minimum: 0 }, moic: { type: "number", minimum: 0 } } };

const inputSchema: JsonSchema = {
  type: "object",
  required: ["ebitda"],
  properties: {
    ebitda: { type: "number", minimum: 0 },
    leverageMultiple: { type: "number", minimum: 0 },
    debtAmount: { type: "number", minimum: 0 },
    holdYears: { type: "number", minimum: 0 },
    exitMultiple: { type: "number", minimum: 0 },
    ebitdaGrowthRate: { type: "number" },
    annualDebtPaydown: { type: "number", minimum: 0 },
    transactionFeesPct: { type: "number", minimum: 0, maximum: 1 },
    hurdles: { type: "object", required: ["base", "holdYears"], properties: { base: hurdle, downside: hurdle, holdYears: { type: "number", minimum: 0 } } },
    downsideCase: caseSchema,
    compsMultipleRange: { type: "object", required: ["low", "high"], properties: { low: { type: "number" }, high: { type: "number" } } },
    redFlagPriceAdjustment: { type: "number", minimum: 0 },
    openingDiscountPct: { type: "number", minimum: 0, maximum: 100 },
    targetDiscountPct: { type: "number", minimum: 0, maximum: 100 },
    gateOwner: { type: "string" },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["base", "walkAway", "target", "opening", "walkAwayClearsBase", "walkAwayClearsDownside", "versusComps", "hurdlesAreDefault", "limitation", "note", "gate"],
  properties: {
    base: { type: "object" },
    downside: { type: "object" },
    adjustmentApplied: { type: "number" },
    walkAway: { type: "object", required: ["basis"] },
    target: { type: "object", required: ["basis"] },
    opening: { type: "object", required: ["basis"] },
    walkAwayClearsBase: { type: "string", enum: ["clears", "misses", "not-tested"] },
    walkAwayClearsDownside: { type: "string", enum: ["clears", "misses", "not-tested"] },
    versusComps: { type: "string", enum: ["below", "within", "above", "not-supplied"] },
    hurdlesAreDefault: { type: "boolean" },
    limitation: { type: "string" },
    note: { type: "string" },
    gate: { type: "string" },
  },
};

export const bidRangeManifest: SkillManifest = {
  id: "bid-range",
  name: "Bid Price Range",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "run",
  applicableExecutives: ["analyst", "investment_committee"],
  supportedEntityTypes: ["deal"],
  requiredInputs: ["ebitda"],
  optionalInputs: ["leverageMultiple", "debtAmount", "holdYears", "exitMultiple", "ebitdaGrowthRate", "hurdles", "downsideCase", "compsMultipleRange", "redFlagPriceAdjustment", "openingDiscountPct", "targetDiscountPct", "gateOwner"],
  outputs: ["base", "downside", "walkAway", "target", "opening", "versusComps", "note", "gate"],
  artifactTypes: ["analysis"],
  dataPermissions: ["deal:read", "valuation:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "moderate",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "walk-away re-tested against the hurdles", "opening/target never invented"],
  evaluationCriteria: ["walk-away clears or note says it does not", "uses the lbo core", "default hurdles labelled", "price adjustments tie to red flag register"],
  providerCapabilities: ["financial_reasoning"],
  allowedDownstreamSkills: ["ic-memo", "returns"],
  prohibitedActions: ["send_outreach", "distribute_report", "sign_document", "move_capital", "capital_call", "submit_term_sheet"],
  inputSchema,
  outputSchema,
};

export const bidRange: SkillDefinition<BidRangeInput, BidRangeOutput> = { manifest: bidRangeManifest, run };
