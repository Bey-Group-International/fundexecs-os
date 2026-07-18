// lib/skills/catalog/three-statement.ts
// Native skill: project a simplified, INTERNALLY-CONSISTENT three-statement model
// (income statement, cash flow, balance sheet) for N years from caller-SUPPLIED
// drivers, and TIE OUT the balance sheet (assets = liabilities + equity) every
// year. Pure, deterministic core — the tested execution path. Like every FundExecs
// skill it NEVER invents a driver: a missing required driver is FLAGGED
// (missingInputs) and the projection is NOT produced. A supplied figure is a
// `fact`, every projected line item is a `calculation`, and the equity plug /
// held-constant debt are `assumption`s. The load-bearing output is the
// balance-sheet tie-out: the model BALANCES BY CONSTRUCTION, and `balanceCheck` is
// ~0 every year — asserted in the golden tests. LLM enrichment of the narrative is
// an optional follow-on that wraps this core; the projection and the tie-out come
// from here.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export interface ThreeStatementInput {
  /** Projection horizon in years. Default 5 (assumption), capped at 10. */
  years?: number;
  /** Base (year-0) revenue. */
  baseRevenue?: number;
  /** Annual revenue growth, as a decimal (0.10 = 10%). */
  revenueGrowth?: number;
  /** EBITDA margin, as a decimal (0.20 = 20%). */
  ebitdaMargin?: number;
  /** Depreciation & amortization as a decimal of revenue (0.05 = 5%). */
  daPctOfRevenue?: number;
  /** Cash tax rate, as a decimal (0.25 = 25%). */
  taxRate?: number;
  /** Capex as a decimal of revenue (0.06 = 6%). */
  capexPctOfRevenue?: number;
  /** Net working capital as a decimal of revenue (0.10 = 10%). */
  nwcPctOfRevenue?: number;
  /** Opening balance sheet — cash. Default 0 (assumption). */
  beginningCash?: number;
  /** Opening balance sheet — PP&E. Default 0 (assumption). */
  beginningPPE?: number;
  /** Opening balance sheet — debt (held constant). Default 0 (assumption). */
  beginningDebt?: number;
  /** Opening balance sheet — equity. Omit to DERIVE it as a balancing plug. */
  beginningEquity?: number;
}

export interface ThreeStatementYear {
  year: number;
  revenue: number;
  ebitda: number;
  ebit: number;
  netIncome: number;
  fcf: number;
  cash: number;
  ppe: number;
  nwc: number;
  debt: number;
  equity: number;
  /** round(assets − (liabilities + equity), 2). ~0 by construction. */
  balanceCheck: number;
}

export interface ThreeStatementOutput {
  years: number;
  projection: ThreeStatementYear[];
  /** True when every projected year ties out (|balanceCheck| ≤ epsilon). */
  balances: boolean;
  missingInputs: string[];
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;

// Below this the year is considered tied out. balanceCheck is rounded to cents, so
// a balanced-by-construction model reports exactly 0.
const BALANCE_EPSILON = 0.01;

const MAX_YEARS = 10;

// Required drivers — a missing one is FLAGGED, never fabricated, and halts the
// projection. Order is the display order in missingInputs.
const REQUIRED_DRIVERS: Array<{ key: keyof ThreeStatementInput; label: string }> = [
  { key: "baseRevenue", label: "Base revenue" },
  { key: "revenueGrowth", label: "Revenue growth" },
  { key: "ebitdaMargin", label: "EBITDA margin" },
  { key: "daPctOfRevenue", label: "D&A % of revenue" },
  { key: "taxRate", label: "Tax rate" },
  { key: "capexPctOfRevenue", label: "Capex % of revenue" },
  { key: "nwcPctOfRevenue", label: "NWC % of revenue" },
];

const run: SkillCore<ThreeStatementInput, ThreeStatementOutput> = (input): SkillCoreResult<ThreeStatementOutput> => {
  const sources: SkillSource[] = [];
  const missingInputs: string[] = [];

  // Horizon: default 5 (assumption), capped at MAX_YEARS.
  const requestedYears = input.years == null ? 5 : Math.max(1, Math.trunc(input.years));
  const years = Math.min(requestedYears, MAX_YEARS);
  if (input.years == null) {
    sources.push({ label: "Assumed projection horizon", kind: "assumption", value: `${years} years` });
  } else {
    sources.push({ label: "Projection horizon", kind: "fact", value: `${input.years} years` });
    if (input.years > MAX_YEARS) {
      sources.push({ label: "Capped projection horizon", kind: "assumption", value: `${MAX_YEARS} years` });
    }
  }

  // --- Supplied drivers are FACTS. Missing required drivers are FLAGGED. ---
  for (const d of REQUIRED_DRIVERS) {
    const v = input[d.key];
    if (v != null) sources.push({ label: d.label, kind: "fact", value: v as number });
    else missingInputs.push(d.label);
  }

  // GUARDRAIL: a missing required driver is NEVER invented. Return an empty
  // projection plus the flag — the model is not produced without every driver.
  if (missingInputs.length > 0) {
    const recommendedAction =
      `Provide the missing driver(s) — ${missingInputs.join(", ")} — then re-run; ` +
      "the projection is not produced without every required driver.";
    const structured: ThreeStatementOutput = {
      years,
      projection: [],
      balances: false,
      missingInputs,
      recommendedAction,
    };
    const narrative =
      `Three-statement projection not produced — missing ${missingInputs.join(", ")}. ` +
      "No driver is invented; supply the missing input(s) to model. " +
      `Next: ${recommendedAction}`;
    const completeness = round2((REQUIRED_DRIVERS.length - missingInputs.length) / REQUIRED_DRIVERS.length);
    return { structured, narrative, sources, confidence: 0.2, completeness, missingData: [...missingInputs] };
  }

  // Every required driver present — safe to read.
  const baseRevenue = input.baseRevenue as number;
  const revenueGrowth = input.revenueGrowth as number;
  const ebitdaMargin = input.ebitdaMargin as number;
  const daPct = input.daPctOfRevenue as number;
  const taxRate = input.taxRate as number;
  const capexPct = input.capexPctOfRevenue as number;
  const nwcPct = input.nwcPctOfRevenue as number;

  // --- Opening balance sheet. Supplied figures are FACTS; a defaulted opening
  //     figure of 0 is an ASSUMPTION. ---
  const beginningCash = input.beginningCash ?? 0;
  if (input.beginningCash != null) sources.push({ label: "Opening cash", kind: "fact", value: input.beginningCash });
  else sources.push({ label: "Assumed opening cash", kind: "assumption", value: 0 });

  const beginningPPE = input.beginningPPE ?? 0;
  if (input.beginningPPE != null) sources.push({ label: "Opening PP&E", kind: "fact", value: input.beginningPPE });
  else sources.push({ label: "Assumed opening PP&E", kind: "assumption", value: 0 });

  const beginningDebt = input.beginningDebt ?? 0;
  if (input.beginningDebt != null) sources.push({ label: "Opening debt", kind: "fact", value: input.beginningDebt });
  else sources.push({ label: "Assumed opening debt", kind: "assumption", value: 0 });

  // Opening NWC is a function of the supplied driver, not an independent input.
  const beginningNWC = nwcPct * baseRevenue;
  sources.push({ label: "Opening net working capital", kind: "calculation", value: round2(beginningNWC), ref: "nwcPctOfRevenue × baseRevenue" });

  // Opening equity: DERIVE it as a balancing plug when omitted (assumption). When
  // supplied it is a FACT — and if the opening BS does not tie out, FLAG it; never
  // silently adjust.
  const derivedEquity = beginningCash + beginningNWC + beginningPPE - beginningDebt;
  let beginningEquity: number;
  if (input.beginningEquity == null) {
    beginningEquity = derivedEquity;
    sources.push({
      label: "Derived opening equity (plug)",
      kind: "assumption",
      value: round2(beginningEquity),
      ref: "beginningCash + beginningNWC + beginningPPE − beginningDebt",
    });
  } else {
    beginningEquity = input.beginningEquity;
    sources.push({ label: "Opening equity", kind: "fact", value: input.beginningEquity });
    const openingDiff = round2(beginningCash + beginningNWC + beginningPPE - (beginningDebt + beginningEquity));
    if (Math.abs(openingDiff) > BALANCE_EPSILON) {
      missingInputs.push(
        `Opening balance sheet does not tie out: assets − (liabilities + equity) = ${openingDiff}. ` +
          "Correct the opening figures, or omit beginningEquity to derive it as a plug.",
      );
    }
  }

  // Debt is held constant across the horizon — an ASSUMPTION, labelled as such.
  sources.push({ label: "Debt held constant", kind: "assumption", value: round2(beginningDebt) });

  // --- Roll the model forward. It BALANCES BY CONSTRUCTION: with debt held
  //     constant and equity rolling by net income, the balance difference is
  //     invariant across years and equals the opening difference (0 under the
  //     plug). ---
  const projection: ThreeStatementYear[] = [];
  let prevRevenue = baseRevenue;
  let prevNWC = beginningNWC;
  let prevCash = beginningCash;
  let prevPPE = beginningPPE;
  let prevEquity = beginningEquity;
  const debt = beginningDebt;

  for (let t = 1; t <= years; t++) {
    const revenue = prevRevenue * (1 + revenueGrowth);
    const ebitda = ebitdaMargin * revenue;
    const da = daPct * revenue;
    const ebit = ebitda - da;
    const tax = Math.max(0, ebit) * taxRate;
    const netIncome = ebit - tax;
    const capex = capexPct * revenue;
    const nwc = nwcPct * revenue;
    const deltaNwc = nwc - prevNWC;
    const fcf = netIncome + da - capex - deltaNwc;
    const endingCash = prevCash + fcf;
    const ppe = prevPPE + capex - da;
    const equity = prevEquity + netIncome;

    const assets = endingCash + nwc + ppe;
    const liabEquity = debt + equity;
    const balanceCheck = round2(assets - liabEquity);

    projection.push({
      year: t,
      revenue: round2(revenue),
      ebitda: round2(ebitda),
      ebit: round2(ebit),
      netIncome: round2(netIncome),
      fcf: round2(fcf),
      cash: round2(endingCash),
      ppe: round2(ppe),
      nwc: round2(nwc),
      debt: round2(debt),
      equity: round2(equity),
      balanceCheck,
    });

    // Projected line items are CALCULATIONS, never facts.
    sources.push({ label: `Year ${t} revenue`, kind: "calculation", value: round2(revenue), ref: "prevRevenue × (1 + revenueGrowth)" });
    sources.push({ label: `Year ${t} net income`, kind: "calculation", value: round2(netIncome), ref: "ebit − tax" });
    sources.push({ label: `Year ${t} free cash flow`, kind: "calculation", value: round2(fcf), ref: "netIncome + D&A − capex − ΔNWC" });
    sources.push({ label: `Year ${t} balance check`, kind: "calculation", value: balanceCheck, ref: "assets − (liabilities + equity)" });

    prevRevenue = revenue;
    prevNWC = nwc;
    prevCash = endingCash;
    prevPPE = ppe;
    prevEquity = equity;
  }

  const balances = projection.length > 0 && projection.every((y) => Math.abs(y.balanceCheck) <= BALANCE_EPSILON);

  const completeness = round2((REQUIRED_DRIVERS.length - REQUIRED_DRIVERS.filter((d) => input[d.key] == null).length) / REQUIRED_DRIVERS.length);
  const confidence = balances ? 0.85 : 0.5;

  const recommendedAction = balances
    ? `Three-statement projection complete and tied out across ${years} year(s) (assets = liabilities + equity each year). ` +
      "Advance to a DCF or an IC memo on the projected cash flows."
    : missingInputs.length > 0
      ? "Opening balance sheet does not tie out — correct the opening figures (or omit beginningEquity to derive it as a plug), then re-run."
      : "Balance sheet did not tie out — review the drivers before relying on the projection.";

  const structured: ThreeStatementOutput = {
    years,
    projection,
    balances,
    missingInputs,
    recommendedAction,
  };

  const narrative = balances
    ? `Three-statement projection: ${years}-year model from revenue $${round2(baseRevenue)} growing ${round2(revenueGrowth * 100)}%/yr, ` +
      `ending revenue $${projection[projection.length - 1].revenue}. Balance sheet ties out every year (assets = liabilities + equity). ` +
      `Next: ${recommendedAction}`
    : `Three-statement projection produced but the balance sheet does not tie out` +
      `${missingInputs.length > 0 ? ` — ${missingInputs[0]}` : ""}. Next: ${recommendedAction}`;

  return { structured, narrative, sources, confidence, completeness, missingData: [...missingInputs] };
};

// ---------------------------------------------------------------------------
// Schemas + manifest
// ---------------------------------------------------------------------------

const inputSchema: JsonSchema = {
  type: "object",
  required: [],
  properties: {
    years: { type: "integer", minimum: 1, maximum: 10 },
    baseRevenue: { type: "number" },
    revenueGrowth: { type: "number" },
    ebitdaMargin: { type: "number" },
    daPctOfRevenue: { type: "number" },
    taxRate: { type: "number" },
    capexPctOfRevenue: { type: "number" },
    nwcPctOfRevenue: { type: "number" },
    beginningCash: { type: "number" },
    beginningPPE: { type: "number" },
    beginningDebt: { type: "number" },
    beginningEquity: { type: "number" },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["years", "projection", "balances", "missingInputs", "recommendedAction"],
  properties: {
    years: { type: "integer" },
    projection: {
      type: "array",
      items: {
        type: "object",
        required: ["year", "revenue", "ebitda", "ebit", "netIncome", "fcf", "cash", "ppe", "nwc", "debt", "equity", "balanceCheck"],
        properties: {
          year: { type: "integer" },
          revenue: { type: "number" },
          ebitda: { type: "number" },
          ebit: { type: "number" },
          netIncome: { type: "number" },
          fcf: { type: "number" },
          cash: { type: "number" },
          ppe: { type: "number" },
          nwc: { type: "number" },
          debt: { type: "number" },
          equity: { type: "number" },
          balanceCheck: { type: "number" },
        },
      },
    },
    balances: { type: "boolean" },
    missingInputs: { type: "array", items: { type: "string" } },
    recommendedAction: { type: "string" },
  },
};

export const threeStatementManifest: SkillManifest = {
  id: "three-statement",
  name: "Three-Statement Projection",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "run",
  applicableExecutives: ["analyst"],
  supportedEntityTypes: ["deal", "company", "financial_model"],
  requiredInputs: [],
  optionalInputs: [
    "years",
    "baseRevenue",
    "revenueGrowth",
    "ebitdaMargin",
    "daPctOfRevenue",
    "taxRate",
    "capexPctOfRevenue",
    "nwcPctOfRevenue",
    "beginningCash",
    "beginningPPE",
    "beginningDebt",
    "beginningEquity",
  ],
  outputs: ["years", "projection", "balances", "missingInputs", "recommendedAction"],
  artifactTypes: ["analysis"],
  dataPermissions: ["deal:read", "financial_model:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: [
    "input matches input.schema.json",
    "output matches output.schema.json",
    "no fabricated drivers — a missing required driver halts the projection",
    "balance sheet ties out (assets = liabilities + equity) every year",
    "equity plug and held-constant debt labelled as assumptions, not facts",
  ],
  evaluationCriteria: [
    "full model ties out: balanceCheck ≈ 0 and balances === true every year",
    "missing required driver returns an empty projection and is flagged, not invented",
    "supplied driver is a fact",
    "derived opening equity is labelled an assumption (plug)",
    "supplied-but-unbalanced opening balance sheet is flagged, never silently adjusted",
  ],
  providerCapabilities: ["financial_reasoning"],
  allowedDownstreamSkills: ["dcf", "ic-memo"],
  prohibitedActions: ["send_outreach", "distribute_report", "sign_document"],
  inputSchema,
  outputSchema,
};

export const threeStatement: SkillDefinition<ThreeStatementInput, ThreeStatementOutput> = {
  manifest: threeStatementManifest,
  run,
};
