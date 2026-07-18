// lib/skills/catalog/returns.ts
// Native skill: a PRELIMINARY RETURNS CASE (first-pass LBO) for a deal. Pure,
// deterministic core — the tested execution path. Like every FundExecs skill it
// NEVER invents financial values: a missing input is FLAGGED (missingData), a
// default is LABELLED as an assumption (kind:"assumption"), a provided figure is
// a fact (kind:"fact"), and every computed number is a calculation
// (kind:"calculation"). LLM enrichment of the narrative is an optional follow-on
// that wraps this core; the MOIC, the IRR, and the sensitivities come from here.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export interface ReturnsDealInput {
  companyName: string;
  /** Entry EBITDA, $M. */
  entryEbitda?: number;
  /** Entry EV / EBITDA multiple (x). */
  entryMultiple?: number;
  /** Net debt at entry, $M. */
  netDebt?: number;
  /** Sponsor equity check, $M. Overrides the EV − net debt derivation when given. */
  equityContribution?: number;
}

export interface ReturnsAssumptions {
  /** Hold period in years. Default 5 (assumption). */
  holdYears?: number;
  /** Exit EV / EBITDA multiple (x). Default = entry multiple (assumption). */
  exitMultiple?: number;
  /** EBITDA CAGR over the hold, as a decimal (0.08 = 8%). Default 0 (assumption). */
  ebitdaCagr?: number;
  /** Annual debt paydown, $M/yr. Default 0 — debt held flat (assumption). */
  annualDebtPaydown?: number;
}

export interface ScreenReturnsInput {
  deal: ReturnsDealInput;
  assumptions?: ReturnsAssumptions;
}

export type SensitivityScenario = "bear" | "base" | "bull";

export interface SensitivityPoint {
  scenario: SensitivityScenario;
  exitMultiple: number;
  moic: number | null;
  irrPct: number | null;
}

export interface ScreenReturnsOutput {
  entryEv: number | null;
  entryEquity: number | null;
  exitEbitda: number | null;
  exitEv: number | null;
  exitEquity: number | null;
  moic: number | null;
  irrPct: number | null;
  remainingDebt: number | null;
  sensitivities: SensitivityPoint[];
  /** Human-readable labels of the assumptions that were applied. */
  assumptionsUsed: string[];
  keyRisks: string[];
  missingFields: string[];
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** MOIC / IRR from an equity in and an equity out over a hold. Null if not derivable. */
function moicIrr(entryEquity: number | null, exitEquity: number | null, holdYears: number): { moic: number | null; irrPct: number | null } {
  if (entryEquity == null || exitEquity == null || entryEquity <= 0 || holdYears <= 0) {
    return { moic: null, irrPct: null };
  }
  const rawMoic = exitEquity / entryEquity;
  const moic = round2(rawMoic);
  // IRR from the (rounded-once) MOIC keeps sensitivities internally consistent.
  const irrPct = rawMoic > 0 ? round1((Math.pow(rawMoic, 1 / holdYears) - 1) * 100) : null;
  return { moic, irrPct };
}

const run: SkillCore<ScreenReturnsInput, ScreenReturnsOutput> = (input): SkillCoreResult<ScreenReturnsOutput> => {
  const deal = input.deal;
  const a = input.assumptions ?? {};
  const sources: SkillSource[] = [];
  const assumptionsUsed: string[] = [];
  const keyRisks: string[] = [];
  const missingFields: string[] = [];

  // --- Provided figures are FACTS. Nothing here is fabricated. ---
  if (deal.entryEbitda != null) sources.push({ label: "Entry EBITDA", kind: "fact", value: deal.entryEbitda });
  if (deal.entryMultiple != null) sources.push({ label: "Entry multiple", kind: "fact", value: `${deal.entryMultiple}x` });
  if (deal.netDebt != null) sources.push({ label: "Net debt at entry", kind: "fact", value: deal.netDebt });
  if (deal.equityContribution != null) sources.push({ label: "Sponsor equity contribution", kind: "fact", value: deal.equityContribution });

  // --- Missing material inputs are FLAGGED, never invented. ---
  if (deal.entryEbitda == null) missingFields.push("Entry EBITDA");
  if (deal.entryMultiple == null) missingFields.push("Entry multiple");
  if (deal.netDebt == null && deal.equityContribution == null) missingFields.push("Net debt");
  if (deal.equityContribution == null && (deal.entryEbitda == null || deal.entryMultiple == null)) {
    missingFields.push("Equity contribution");
  }

  // --- Assumptions: apply defaults, and LABEL each one that is defaulted. ---
  const holdYears = a.holdYears ?? 5;
  if (a.holdYears == null) {
    assumptionsUsed.push("Hold period 5 years (assumed)");
    sources.push({ label: "Assumed hold period", kind: "assumption", value: "5 years" });
  } else {
    sources.push({ label: "Hold period", kind: "fact", value: `${holdYears} years` });
  }

  const exitMultiple = a.exitMultiple ?? deal.entryMultiple ?? null;
  if (a.exitMultiple == null) {
    if (deal.entryMultiple != null) {
      assumptionsUsed.push(`Exit multiple ${deal.entryMultiple}x (assumed = entry multiple)`);
      sources.push({ label: "Assumed exit multiple", kind: "assumption", value: `${deal.entryMultiple}x` });
    }
  } else {
    sources.push({ label: "Exit multiple", kind: "fact", value: `${a.exitMultiple}x` });
  }

  const ebitdaCagr = a.ebitdaCagr ?? 0;
  if (a.ebitdaCagr == null) {
    assumptionsUsed.push("EBITDA CAGR 0% (assumed — flat EBITDA)");
    sources.push({ label: "Assumed EBITDA CAGR", kind: "assumption", value: "0%" });
  } else {
    sources.push({ label: "EBITDA CAGR", kind: "fact", value: `${round1(a.ebitdaCagr * 100)}%` });
  }

  const annualDebtPaydown = a.annualDebtPaydown ?? 0;
  if (a.annualDebtPaydown == null) {
    assumptionsUsed.push("Net debt held flat over hold (no annual paydown provided)");
    sources.push({ label: "Assumed debt paydown", kind: "assumption", value: "0 / yr (debt flat)" });
  } else {
    sources.push({ label: "Annual debt paydown", kind: "fact", value: annualDebtPaydown });
  }

  // --- Entry economics (CALCULATIONS, computed only when inputs exist). ---
  let entryEv: number | null = null;
  if (deal.entryEbitda != null && deal.entryMultiple != null) {
    entryEv = round2(deal.entryEbitda * deal.entryMultiple);
    sources.push({ label: "Entry enterprise value", kind: "calculation", value: entryEv, ref: "entryEbitda × entryMultiple" });
  }

  let entryEquity: number | null = null;
  if (deal.equityContribution != null) {
    entryEquity = round2(deal.equityContribution);
    sources.push({ label: "Entry equity", kind: "calculation", value: entryEquity, ref: "equityContribution (provided)" });
  } else if (entryEv != null) {
    entryEquity = round2(entryEv - (deal.netDebt ?? 0));
    sources.push({ label: "Entry equity", kind: "calculation", value: entryEquity, ref: "entryEv − netDebt" });
  }

  // --- Exit economics (CALCULATIONS). ---
  let exitEbitda: number | null = null;
  if (deal.entryEbitda != null) {
    exitEbitda = round2(deal.entryEbitda * Math.pow(1 + ebitdaCagr, holdYears));
    sources.push({ label: "Exit EBITDA", kind: "calculation", value: exitEbitda, ref: "entryEbitda × (1 + ebitdaCagr)^holdYears" });
  }

  let exitEv: number | null = null;
  if (exitEbitda != null && exitMultiple != null) {
    exitEv = round2(exitEbitda * exitMultiple);
    sources.push({ label: "Exit enterprise value", kind: "calculation", value: exitEv, ref: "exitEbitda × exitMultiple" });
  }

  // Remaining debt is always derivable (defaults floor it at 0); it is a calculation.
  const remainingDebt = round2(Math.max(0, (deal.netDebt ?? 0) - annualDebtPaydown * holdYears));
  sources.push({ label: "Remaining debt at exit", kind: "calculation", value: remainingDebt, ref: "max(0, netDebt − annualDebtPaydown × holdYears)" });

  let exitEquity: number | null = null;
  if (exitEv != null) {
    exitEquity = round2(exitEv - remainingDebt);
    sources.push({ label: "Exit equity", kind: "calculation", value: exitEquity, ref: "exitEv − remainingDebt" });
  }

  // --- MOIC / IRR — computed ONLY when entry EBITDA and entry multiple exist. ---
  const returnsComputable = deal.entryEbitda != null && deal.entryMultiple != null;
  let moic: number | null = null;
  let irrPct: number | null = null;
  if (returnsComputable) {
    const r = moicIrr(entryEquity, exitEquity, holdYears);
    moic = r.moic;
    irrPct = r.irrPct;
    if (moic != null) {
      sources.push({ label: "MOIC", kind: "calculation", value: `${moic}x`, ref: "exitEquity ÷ entryEquity" });
    }
    if (irrPct != null) {
      sources.push({ label: "IRR", kind: "calculation", value: `${irrPct}%`, ref: "MOIC^(1/holdYears) − 1" });
    }
  }

  // --- Sensitivities: bear / base / bull at exitMultiple ∓ 1. ---
  const sensitivities: SensitivityPoint[] = [];
  if (returnsComputable && exitMultiple != null && exitEbitda != null && entryEquity != null) {
    const points: Array<[SensitivityScenario, number]> = [
      ["bear", round2(exitMultiple - 1)],
      ["base", round2(exitMultiple)],
      ["bull", round2(exitMultiple + 1)],
    ];
    for (const [scenario, m] of points) {
      const sExitEv = round2(exitEbitda * m);
      const sExitEquity = round2(sExitEv - remainingDebt);
      const r = moicIrr(entryEquity, sExitEquity, holdYears);
      sensitivities.push({ scenario, exitMultiple: m, moic: r.moic, irrPct: r.irrPct });
    }
  }

  // --- Key risks (deterministic). ---
  if (!returnsComputable) keyRisks.push("Returns not computable — entry EBITDA and/or entry multiple missing.");
  if (entryEquity != null && entryEquity <= 0) keyRisks.push("Non-positive entry equity — net debt at or above enterprise value; returns are not meaningful.");
  if (deal.entryMultiple != null && deal.entryMultiple >= 12) keyRisks.push(`Full entry multiple (${deal.entryMultiple}x) — returns are sensitive to exit-multiple compression.`);
  if (a.exitMultiple != null && deal.entryMultiple != null && a.exitMultiple > deal.entryMultiple) {
    keyRisks.push("Case relies on multiple expansion — exit above entry. Stress a flat/compressed exit.");
  }
  if (a.ebitdaCagr != null && a.ebitdaCagr > 0.15) keyRisks.push(`Aggressive EBITDA CAGR assumed (${round1(a.ebitdaCagr * 100)}%) — validate the growth case.`);
  if (deal.netDebt != null && deal.entryEbitda != null && deal.entryEbitda > 0 && deal.netDebt / deal.entryEbitda >= 6) {
    keyRisks.push(`High entry leverage (~${round1(deal.netDebt / deal.entryEbitda)}x net debt / EBITDA) — confirm debt capacity with lenders.`);
  }
  if (assumptionsUsed.length > 0) keyRisks.push("Result rests on default assumptions (see assumptionsUsed) — replace with deal-specific inputs before relying on it.");

  // --- Completeness / confidence / recommendation. ---
  const MATERIAL = ["entryEbitda", "entryMultiple", "netDebt", "equityContribution"] as const;
  const present = MATERIAL.filter((k) => deal[k] != null).length;
  const completeness = Math.round((present / MATERIAL.length) * 100) / 100;
  const confidence = Math.max(0.2, Math.min(0.9, 0.3 + completeness * 0.5 - assumptionsUsed.length * 0.05));

  const recommendedAction = !returnsComputable
    ? "Provide entry EBITDA and entry multiple to compute a preliminary returns case."
    : moic != null && moic >= 2.5
      ? "Returns clear a typical hurdle on these assumptions — advance to a full LBO model and IC memo, stress-testing exit multiple and leverage."
      : moic != null && moic >= 1.5
        ? "Marginal on current assumptions — refine the operating case and capital structure, then re-run before committing."
        : "Below a typical return hurdle on current assumptions — revisit entry price, leverage, or the value-creation plan.";

  const structured: ScreenReturnsOutput = {
    entryEv,
    entryEquity,
    exitEbitda,
    exitEv,
    exitEquity,
    moic,
    irrPct,
    remainingDebt,
    sensitivities,
    assumptionsUsed,
    keyRisks,
    missingFields,
    recommendedAction,
  };

  const narrative = returnsComputable
    ? `Preliminary returns for ${deal.companyName}: ${moic != null ? `${moic}x MOIC` : "MOIC n/a"}` +
      `${irrPct != null ? ` / ${irrPct}% IRR` : ""} over ${holdYears}y` +
      `${assumptionsUsed.length ? ` on ${assumptionsUsed.length} default assumption(s)` : ""}. ` +
      `${missingFields.length ? `Missing: ${missingFields.join(", ")}. ` : ""}Next: ${recommendedAction}`
    : `Returns for ${deal.companyName} not computable — missing ${missingFields.join(", ")}. Next: ${recommendedAction}`;

  return { structured, narrative, sources, confidence, completeness, missingData: missingFields };
};

// ---------------------------------------------------------------------------
// Schemas + manifest
// ---------------------------------------------------------------------------

const inputSchema: JsonSchema = {
  type: "object",
  required: ["deal"],
  properties: {
    deal: {
      type: "object",
      required: ["companyName"],
      properties: {
        companyName: { type: "string", minLength: 1 },
        entryEbitda: { type: "number" },
        entryMultiple: { type: "number", minimum: 0 },
        netDebt: { type: "number" },
        equityContribution: { type: "number", minimum: 0 },
      },
    },
    assumptions: {
      type: "object",
      properties: {
        holdYears: { type: "number", minimum: 0 },
        exitMultiple: { type: "number", minimum: 0 },
        ebitdaCagr: { type: "number" },
        annualDebtPaydown: { type: "number", minimum: 0 },
      },
    },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["moic", "irrPct", "sensitivities", "recommendedAction"],
  properties: {
    entryEv: { type: "number" },
    entryEquity: { type: "number" },
    exitEbitda: { type: "number" },
    exitEv: { type: "number" },
    exitEquity: { type: "number" },
    moic: { type: "number" },
    irrPct: { type: "number" },
    remainingDebt: { type: "number" },
    sensitivities: {
      type: "array",
      items: {
        type: "object",
        required: ["scenario", "exitMultiple"],
        properties: {
          scenario: { type: "string", enum: ["bear", "base", "bull"] },
          exitMultiple: { type: "number" },
          moic: { type: "number" },
          irrPct: { type: "number" },
        },
      },
    },
    assumptionsUsed: { type: "array", items: { type: "string" } },
    keyRisks: { type: "array", items: { type: "string" } },
    missingFields: { type: "array", items: { type: "string" } },
    recommendedAction: { type: "string" },
  },
};

export const returnsManifest: SkillManifest = {
  id: "returns",
  name: "Preliminary Returns Case",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "run",
  applicableExecutives: ["analyst", "investment_committee"],
  supportedEntityTypes: ["deal", "company", "financial_model"],
  requiredInputs: ["deal.companyName"],
  optionalInputs: [
    "deal.entryEbitda",
    "deal.entryMultiple",
    "deal.netDebt",
    "deal.equityContribution",
    "assumptions.holdYears",
    "assumptions.exitMultiple",
    "assumptions.ebitdaCagr",
    "assumptions.annualDebtPaydown",
  ],
  outputs: ["entryEv", "entryEquity", "exitEbitda", "exitEv", "exitEquity", "moic", "irrPct", "remainingDebt", "sensitivities", "assumptionsUsed", "keyRisks", "missingFields", "recommendedAction"],
  artifactTypes: ["model", "analysis"],
  dataPermissions: ["deal:read", "financial_model:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "no fabricated financial values", "assumptions labelled, not presented as facts"],
  evaluationCriteria: ["correct MOIC/IRR math on golden cases", "missing data flagged not invented", "assumptions labelled", "sensitivities present with bull > base > bear ordering"],
  providerCapabilities: ["financial_reasoning"],
  allowedDownstreamSkills: ["ic-memo"],
  prohibitedActions: ["send_outreach", "distribute_report", "sign_document", "move_capital", "capital_call"],
  inputSchema,
  outputSchema,
};

export const returns: SkillDefinition<ScreenReturnsInput, ScreenReturnsOutput> = {
  manifest: returnsManifest,
  run,
};
