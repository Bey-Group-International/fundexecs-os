// lib/skills/catalog/lbo.ts
// Native skill: a LEVERAGED-BUYOUT (LBO) returns model. Pure, deterministic core —
// the tested execution path. Like every FundExecs skill it NEVER invents a
// financial assumption: a missing required input is FLAGGED (missingInputs) and the
// affected output is `null`, never guessed; a conservative default (no multiple
// expansion, no growth, no paydown, no fees) is LABELLED as an assumption
// (kind:"assumption"); every supplied figure is a fact (kind:"fact"); and every
// derived figure — sources & uses, exit equity, MOIC, IRR — is a calculation
// (kind:"calculation"). LLM enrichment of the narrative is an optional follow-on
// that wraps this core; every number comes from here.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export interface LboInput {
  /** LTM EBITDA at entry. */
  entryEbitda?: number;
  /** EV / EBITDA entry multiple. */
  entryMultiple?: number;
  /** Net debt / EBITDA at entry — used to size debt. Ignored when debtAmount is given. */
  leverageMultiple?: number;
  /** Debt raised at entry, given directly. Takes precedence over leverageMultiple. */
  debtAmount?: number;
  /** Hold period in years. */
  holdYears?: number;
  /** Exit EV / EBITDA multiple. Defaults to entryMultiple (no expansion) as an assumption. */
  exitMultiple?: number;
  /** Annual EBITDA growth, as a decimal (0.08 = 8%). Default 0 (assumption). */
  ebitdaGrowthRate?: number;
  /** Total debt repaid over the hold. Default 0 (assumption — no amortization). */
  annualDebtPaydown?: number;
  /** Transaction fees as a % of entry EV, as a decimal (0.02 = 2%). Default 0 (assumption). */
  transactionFeesPct?: number;
}

export interface LboOutput {
  entryEV: number | null;
  entryEquity: number | null;
  debt: number | null;
  exitEbitda: number | null;
  exitEV: number | null;
  exitEquity: number | null;
  moic: number | null;
  irr: number | null;
  /** Human-readable labels of the assumptions that were applied. */
  assumptions: string[];
  /** Human-readable labels of the required inputs that were missing. */
  missingInputs: string[];
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const round1 = (n: number) => Math.round(n * 10) / 10;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const pct = (d: number) => `${round1(d * 100)}%`;

const run: SkillCore<LboInput, LboOutput> = (input): SkillCoreResult<LboOutput> => {
  const sources: SkillSource[] = [];
  const assumptions: string[] = [];
  const missingInputs: string[] = [];

  // --- Provided figures are FACTS. Nothing here is fabricated. ---
  if (input.entryEbitda != null) sources.push({ label: "Entry LTM EBITDA", kind: "fact", value: input.entryEbitda });
  if (input.entryMultiple != null) sources.push({ label: "Entry multiple (EV/EBITDA)", kind: "fact", value: input.entryMultiple });
  if (input.leverageMultiple != null) sources.push({ label: "Leverage (net debt/EBITDA)", kind: "fact", value: input.leverageMultiple });
  if (input.debtAmount != null) sources.push({ label: "Debt amount", kind: "fact", value: input.debtAmount });
  if (input.holdYears != null) sources.push({ label: "Hold period", kind: "fact", value: `${input.holdYears} years` });
  if (input.exitMultiple != null) sources.push({ label: "Exit multiple (EV/EBITDA)", kind: "fact", value: input.exitMultiple });
  if (input.ebitdaGrowthRate != null) sources.push({ label: "EBITDA growth rate", kind: "fact", value: pct(input.ebitdaGrowthRate) });
  if (input.annualDebtPaydown != null) sources.push({ label: "Debt paydown over hold", kind: "fact", value: input.annualDebtPaydown });
  if (input.transactionFeesPct != null) sources.push({ label: "Transaction fees %", kind: "fact", value: pct(input.transactionFeesPct) });

  // --- Missing REQUIRED inputs are FLAGGED, never invented. ---
  if (input.entryEbitda == null) missingInputs.push("Entry EBITDA");
  if (input.entryMultiple == null) missingInputs.push("Entry multiple");
  if (input.holdYears == null) missingInputs.push("Hold years");

  const computable = input.entryEbitda != null && input.entryMultiple != null && input.holdYears != null;

  let entryEV: number | null = null;
  let entryEquity: number | null = null;
  let debt: number | null = null;
  let exitEbitda: number | null = null;
  let exitEV: number | null = null;
  let exitEquity: number | null = null;
  let moic: number | null = null;
  let irr: number | null = null;

  if (!computable) {
    const structured: LboOutput = {
      entryEV,
      entryEquity,
      debt,
      exitEbitda,
      exitEV,
      exitEquity,
      moic,
      irr,
      assumptions,
      missingInputs,
      recommendedAction:
        "Provide entry EBITDA, entry multiple, and hold years to compute an LBO returns model.",
    };
    const narrative =
      `LBO returns not computable — missing ${missingInputs.join(", ")}. ` +
      "This skill never fabricates a financial assumption; supply the required inputs to run the model. " +
      `Next: ${structured.recommendedAction}`;
    return {
      structured,
      narrative,
      sources,
      confidence: 0.2,
      completeness: 0,
      missingData: [...missingInputs],
    };
  }

  const entryEbitda = input.entryEbitda as number;
  const entryMultiple = input.entryMultiple as number;
  const holdYears = input.holdYears as number;

  // --- Assumptions: apply conservative defaults, and LABEL each one. ---
  const exitMultiple = input.exitMultiple ?? entryMultiple;
  if (input.exitMultiple == null) {
    assumptions.push(`Exit multiple ${entryMultiple}x (assumed — no multiple expansion)`);
    sources.push({ label: "Assumed exit multiple", kind: "assumption", value: `${entryMultiple}x (no expansion)` });
  }

  const ebitdaGrowthRate = input.ebitdaGrowthRate ?? 0;
  if (input.ebitdaGrowthRate == null) {
    assumptions.push("EBITDA growth 0% (assumed — flat EBITDA)");
    sources.push({ label: "Assumed EBITDA growth", kind: "assumption", value: "0%" });
  }

  const annualDebtPaydown = input.annualDebtPaydown ?? 0;
  if (input.annualDebtPaydown == null) {
    assumptions.push("Debt paydown 0 (assumed — no amortization over hold)");
    sources.push({ label: "Assumed debt paydown", kind: "assumption", value: 0 });
  }

  const transactionFeesPct = input.transactionFeesPct ?? 0;
  if (input.transactionFeesPct == null) {
    assumptions.push("Transaction fees 0% (assumed)");
    sources.push({ label: "Assumed transaction fees", kind: "assumption", value: "0%" });
  }

  // --- Sources & uses (CALCULATIONS). ---
  entryEV = round1(entryEbitda * entryMultiple);
  sources.push({ label: "Entry enterprise value", kind: "calculation", value: entryEV, ref: "entryEbitda × entryMultiple" });

  // Debt: given directly (debtAmount) takes precedence over sizing from leverage.
  // Neither supplied → an all-equity deal (debt 0), surfaced as an assumption.
  if (input.debtAmount != null) {
    debt = round1(input.debtAmount);
  } else if (input.leverageMultiple != null) {
    debt = round1(input.leverageMultiple * entryEbitda);
  } else {
    debt = 0;
    assumptions.push("No debt supplied — modelled as an all-equity purchase (debt 0)");
    sources.push({ label: "Assumed capital structure", kind: "assumption", value: "all-equity (debt 0)" });
  }
  sources.push({ label: "Entry debt", kind: "calculation", value: debt, ref: "debtAmount ?? leverageMultiple × entryEbitda" });

  const fees = round1(transactionFeesPct * entryEV);
  entryEquity = round1(entryEV + fees - debt);
  sources.push({ label: "Entry equity", kind: "calculation", value: entryEquity, ref: "entryEV + fees − debt" });

  // --- Exit (CALCULATIONS). ---
  exitEbitda = round1(entryEbitda * Math.pow(1 + ebitdaGrowthRate, holdYears));
  sources.push({ label: "Exit EBITDA", kind: "calculation", value: exitEbitda, ref: "entryEbitda × (1 + growth)^holdYears" });

  exitEV = round1(exitEbitda * exitMultiple);
  sources.push({ label: "Exit enterprise value", kind: "calculation", value: exitEV, ref: "exitEbitda × exitMultiple" });

  const exitNetDebt = round1(Math.max(0, debt - annualDebtPaydown));
  exitEquity = round1(exitEV - exitNetDebt);
  sources.push({ label: "Exit equity", kind: "calculation", value: exitEquity, ref: "exitEV − max(0, debt − paydown)" });

  // --- Returns (CALCULATIONS). Null-safe: entry equity must be positive. ---
  if (entryEquity > 0) {
    moic = round4(exitEquity / entryEquity);
    sources.push({ label: "MOIC", kind: "calculation", value: moic, ref: "exitEquity / entryEquity" });
    if (moic > 0) {
      irr = round4(Math.pow(moic, 1 / holdYears) - 1);
      sources.push({ label: "IRR", kind: "calculation", value: irr, ref: "MOIC^(1/holdYears) − 1" });
    }
  }

  // --- Completeness / confidence / recommendation. ---
  const MATERIAL = [
    "entryEbitda",
    "entryMultiple",
    "holdYears",
    "exitMultiple",
    "ebitdaGrowthRate",
    "annualDebtPaydown",
    "transactionFeesPct",
  ] as const;
  const present = MATERIAL.filter((k) => input[k] != null).length + (input.debtAmount != null || input.leverageMultiple != null ? 1 : 0);
  const completeness = Math.round((present / (MATERIAL.length + 1)) * 100) / 100;
  const confidence = Math.max(0.2, Math.min(0.9, 0.3 + completeness * 0.5 - assumptions.length * 0.05));

  const recommendedAction =
    moic == null
      ? "Entry equity is non-positive (debt ≥ entry EV + fees) — reduce leverage or confirm the capital structure, then re-run the LBO."
      : `LBO complete — MOIC ~${moic}x, IRR ~${irr != null ? pct(irr) : "n/a"} over ${holdYears}y` +
        `${assumptions.length ? ` on ${assumptions.length} default assumption(s)` : ""}. ` +
        "Stress the exit multiple and leverage, then advance to returns / an IC memo.";

  const structured: LboOutput = {
    entryEV,
    entryEquity,
    debt,
    exitEbitda,
    exitEV,
    exitEquity,
    moic,
    irr,
    assumptions,
    missingInputs,
    recommendedAction,
  };

  const narrative =
    moic == null
      ? `LBO for entry EV ~$${entryEV} halted — entry equity is non-positive (~$${entryEquity}). Next: ${recommendedAction}`
      : `LBO: entry equity ~$${entryEquity} on ~$${entryEV} EV / ~$${debt} debt → exit equity ~$${exitEquity} ` +
        `(MOIC ~${moic}x, IRR ~${irr != null ? pct(irr) : "n/a"}) over ${holdYears}y` +
        `${assumptions.length ? ` on ${assumptions.length} default assumption(s)` : ""}. Next: ${recommendedAction}`;

  return { structured, narrative, sources, confidence, completeness, missingData: [...missingInputs] };
};

// ---------------------------------------------------------------------------
// Schemas + manifest
// ---------------------------------------------------------------------------

const inputSchema: JsonSchema = {
  type: "object",
  required: [],
  properties: {
    entryEbitda: { type: "number" },
    entryMultiple: { type: "number", minimum: 0 },
    leverageMultiple: { type: "number", minimum: 0 },
    debtAmount: { type: "number", minimum: 0 },
    holdYears: { type: "number", minimum: 0 },
    exitMultiple: { type: "number", minimum: 0 },
    ebitdaGrowthRate: { type: "number" },
    annualDebtPaydown: { type: "number" },
    transactionFeesPct: { type: "number" },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["assumptions", "missingInputs", "recommendedAction"],
  properties: {
    entryEV: { type: "number" },
    entryEquity: { type: "number" },
    debt: { type: "number" },
    exitEbitda: { type: "number" },
    exitEV: { type: "number" },
    exitEquity: { type: "number" },
    moic: { type: "number" },
    irr: { type: "number" },
    assumptions: { type: "array", items: { type: "string" } },
    missingInputs: { type: "array", items: { type: "string" } },
    recommendedAction: { type: "string" },
  },
};

export const lboManifest: SkillManifest = {
  id: "lbo",
  name: "LBO Returns Model",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "run",
  applicableExecutives: ["analyst"],
  supportedEntityTypes: ["deal", "company", "financial_model"],
  requiredInputs: [],
  optionalInputs: [
    "entryEbitda",
    "entryMultiple",
    "leverageMultiple",
    "debtAmount",
    "holdYears",
    "exitMultiple",
    "ebitdaGrowthRate",
    "annualDebtPaydown",
    "transactionFeesPct",
  ],
  outputs: ["entryEV", "entryEquity", "debt", "exitEbitda", "exitEV", "exitEquity", "moic", "irr", "assumptions", "missingInputs", "recommendedAction"],
  artifactTypes: ["analysis"],
  dataPermissions: ["deal:read", "financial_model:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "no fabricated financial assumptions", "defaults labelled as assumptions, not facts"],
  evaluationCriteria: [
    "correct LBO math on golden cases",
    "missing required inputs flagged, MOIC/IRR null not invented",
    "conservative defaults labelled as assumptions",
    "supplied inputs labelled facts, derived figures labelled calculations",
    "non-positive entry equity yields null MOIC/IRR",
  ],
  providerCapabilities: ["financial_reasoning"],
  allowedDownstreamSkills: ["returns", "ic-memo"],
  prohibitedActions: ["send_outreach", "distribute_report", "sign_document", "move_capital"],
  inputSchema,
  outputSchema,
};

export const lbo: SkillDefinition<LboInput, LboOutput> = {
  manifest: lboManifest,
  run,
};
