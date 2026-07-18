// lib/skills/catalog/dcf.ts
// Native skill: a DISCOUNTED CASH FLOW (DCF) valuation for a company. Pure,
// deterministic core — the tested execution path. Like every FundExecs skill it
// NEVER invents financial values: a missing input is FLAGGED (missingFields), a
// default is LABELLED as an assumption (kind:"assumption"), a provided figure is
// a fact (kind:"fact"), and every computed number is a calculation
// (kind:"calculation"). LLM enrichment of the narrative is an optional follow-on
// that wraps this core; the enterprise value, the per-share value, and the
// sensitivities come from here.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export interface DcfInput {
  companyName: string;
  /** Base (year-0) unlevered free cash flow, $M. */
  baseFcf?: number;
  /** Explicit projection horizon in years. Default 5 (assumption). */
  projectionYears?: number;
  /** Annual FCF growth over the horizon, as a decimal (0.08 = 8%). Default 0 (assumption). */
  fcfGrowth?: number;
  /** Discount rate / WACC, as a decimal (0.10 = 10%). */
  discountRate?: number;
  /** Perpetuity (terminal) growth rate, as a decimal (0.02 = 2%). Default 0.02 (assumption). */
  terminalGrowth?: number;
  /** Net debt, $M. Default 0 (assumption) when deriving equity value. */
  netDebt?: number;
  /** Fully diluted shares outstanding (M). Required for a per-share value. */
  sharesOutstanding?: number;
}

export interface DcfCashFlow {
  year: number;
  fcf: number;
  pv: number;
}

export interface DcfSensitivityPoint {
  param: string;
  value: number;
  enterpriseValue: number | null;
}

export interface DcfOutput {
  enterpriseValue: number | null;
  equityValue: number | null;
  perShare: number | null;
  pvExplicit: number | null;
  pvTerminal: number | null;
  terminalValue: number | null;
  cashFlows: DcfCashFlow[];
  sensitivities: DcfSensitivityPoint[];
  /** Human-readable labels of the assumptions that were applied. */
  assumptionsUsed: string[];
  missingFields: string[];
  keyRisks: string[];
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (d: number) => `${round1(d * 100)}%`;

const GUARD_RISK = "Discount rate must exceed terminal growth";

interface ExplicitFlows {
  cashFlows: DcfCashFlow[];
  pvExplicitRaw: number;
  fcfFinalRaw: number;
}

/** Explicit-period cash flows and their PVs. Needs only baseFcf, growth, years, discountRate. */
function explicitFlows(baseFcf: number, fcfGrowth: number, years: number, discountRate: number): ExplicitFlows {
  const cashFlows: DcfCashFlow[] = [];
  let pvExplicitRaw = 0;
  let fcfFinalRaw = baseFcf;
  for (let t = 1; t <= years; t++) {
    const fcfRaw = baseFcf * Math.pow(1 + fcfGrowth, t);
    const pvRaw = fcfRaw / Math.pow(1 + discountRate, t);
    pvExplicitRaw += pvRaw;
    fcfFinalRaw = fcfRaw;
    cashFlows.push({ year: t, fcf: round1(fcfRaw), pv: round1(pvRaw) });
  }
  return { cashFlows, pvExplicitRaw, fcfFinalRaw };
}

/** Enterprise value at a given discount rate / terminal growth. Null when the perpetuity guard fails. */
function evAt(baseFcf: number, fcfGrowth: number, years: number, discountRate: number, terminalGrowth: number): number | null {
  if (discountRate <= terminalGrowth) return null;
  const { pvExplicitRaw, fcfFinalRaw } = explicitFlows(baseFcf, fcfGrowth, years, discountRate);
  const terminalValueRaw = (fcfFinalRaw * (1 + terminalGrowth)) / (discountRate - terminalGrowth);
  const pvTerminalRaw = terminalValueRaw / Math.pow(1 + discountRate, years);
  return round1(pvExplicitRaw + pvTerminalRaw);
}

const run: SkillCore<DcfInput, DcfOutput> = (input): SkillCoreResult<DcfOutput> => {
  const sources: SkillSource[] = [];
  const assumptionsUsed: string[] = [];
  const missingFields: string[] = [];
  const keyRisks: string[] = [];

  // --- Provided figures are FACTS. Nothing here is fabricated. ---
  if (input.baseFcf != null) sources.push({ label: "Base free cash flow", kind: "fact", value: input.baseFcf });
  if (input.projectionYears != null) sources.push({ label: "Projection horizon", kind: "fact", value: `${input.projectionYears} years` });
  if (input.fcfGrowth != null) sources.push({ label: "FCF growth", kind: "fact", value: pct(input.fcfGrowth) });
  if (input.discountRate != null) sources.push({ label: "Discount rate (WACC)", kind: "fact", value: pct(input.discountRate) });
  if (input.terminalGrowth != null) sources.push({ label: "Terminal growth", kind: "fact", value: pct(input.terminalGrowth) });
  if (input.netDebt != null) sources.push({ label: "Net debt", kind: "fact", value: input.netDebt });
  if (input.sharesOutstanding != null) sources.push({ label: "Shares outstanding", kind: "fact", value: input.sharesOutstanding });

  // --- Assumptions: apply defaults, and LABEL each one that is defaulted. ---
  const projectionYears = input.projectionYears ?? 5;
  if (input.projectionYears == null) {
    assumptionsUsed.push("Projection horizon 5 years (assumed)");
    sources.push({ label: "Assumed projection horizon", kind: "assumption", value: "5 years" });
  }

  const fcfGrowth = input.fcfGrowth ?? 0;
  if (input.fcfGrowth == null) {
    assumptionsUsed.push("FCF growth 0% (assumed — flat FCF)");
    sources.push({ label: "Assumed FCF growth", kind: "assumption", value: "0%" });
  }

  const terminalGrowth = input.terminalGrowth ?? 0.02;
  if (input.terminalGrowth == null) {
    assumptionsUsed.push("Terminal growth 2.0% (assumed)");
    sources.push({ label: "Assumed terminal growth", kind: "assumption", value: "2.0%" });
  }

  // --- Missing material inputs are FLAGGED, never invented. ---
  if (input.baseFcf == null) missingFields.push("Base FCF");
  if (input.discountRate == null) missingFields.push("Discount rate (WACC)");
  if (input.sharesOutstanding == null) missingFields.push("Shares outstanding");

  const computable = input.baseFcf != null && input.discountRate != null;

  let enterpriseValue: number | null = null;
  let equityValue: number | null = null;
  let perShare: number | null = null;
  let pvExplicit: number | null = null;
  let pvTerminal: number | null = null;
  let terminalValue: number | null = null;
  let cashFlows: DcfCashFlow[] = [];
  let sensitivities: DcfSensitivityPoint[] = [];

  if (!computable) {
    keyRisks.push("Enterprise value not computable — base FCF and/or discount rate missing.");
  } else {
    const baseFcf = input.baseFcf as number;
    const discountRate = input.discountRate as number;

    // Explicit-period cash flows — CALCULATIONS (need only the discount rate).
    const flows = explicitFlows(baseFcf, fcfGrowth, projectionYears, discountRate);
    cashFlows = flows.cashFlows;
    pvExplicit = round1(flows.pvExplicitRaw);
    for (const cf of cashFlows) {
      sources.push({ label: `Year ${cf.year} PV`, kind: "calculation", value: cf.pv, ref: "fcf_t / (1 + discountRate)^t" });
    }
    sources.push({ label: "PV of explicit FCF", kind: "calculation", value: pvExplicit, ref: "Σ fcf_t / (1 + discountRate)^t" });

    // HARD GUARD: the Gordon terminal value is only defined when discountRate > terminalGrowth.
    if (discountRate <= terminalGrowth) {
      keyRisks.push(GUARD_RISK);
    } else {
      const terminalValueRaw = (flows.fcfFinalRaw * (1 + terminalGrowth)) / (discountRate - terminalGrowth);
      const pvTerminalRaw = terminalValueRaw / Math.pow(1 + discountRate, projectionYears);
      terminalValue = round1(terminalValueRaw);
      pvTerminal = round1(pvTerminalRaw);
      enterpriseValue = round1(flows.pvExplicitRaw + pvTerminalRaw);
      sources.push({ label: "Terminal value", kind: "calculation", value: terminalValue, ref: "fcf_N × (1 + terminalGrowth) / (discountRate − terminalGrowth)" });
      sources.push({ label: "PV of terminal value", kind: "calculation", value: pvTerminal, ref: "terminalValue / (1 + discountRate)^N" });
      sources.push({ label: "Enterprise value", kind: "calculation", value: enterpriseValue, ref: "pvExplicit + pvTerminal" });

      // Equity value — net debt defaults to 0 (assumption) when absent.
      const netDebt = input.netDebt ?? 0;
      if (input.netDebt == null) {
        assumptionsUsed.push("Net debt 0 (assumed)");
        sources.push({ label: "Assumed net debt", kind: "assumption", value: 0 });
      }
      equityValue = round1(enterpriseValue - netDebt);
      sources.push({ label: "Equity value", kind: "calculation", value: equityValue, ref: "enterpriseValue − netDebt" });

      if (input.sharesOutstanding != null && input.sharesOutstanding !== 0) {
        perShare = round2(equityValue / input.sharesOutstanding);
        sources.push({ label: "Value per share", kind: "calculation", value: perShare, ref: "equityValue / sharesOutstanding" });
      }

      // Sensitivities — recompute EV at discountRate ±0.01 and terminalGrowth ±0.005.
      const round3 = (n: number) => Math.round(n * 1000) / 1000;
      sensitivities = [
        { param: "discountRate", value: round2(discountRate - 0.01), enterpriseValue: evAt(baseFcf, fcfGrowth, projectionYears, discountRate - 0.01, terminalGrowth) },
        { param: "discountRate", value: round2(discountRate + 0.01), enterpriseValue: evAt(baseFcf, fcfGrowth, projectionYears, discountRate + 0.01, terminalGrowth) },
        { param: "terminalGrowth", value: round3(terminalGrowth - 0.005), enterpriseValue: evAt(baseFcf, fcfGrowth, projectionYears, discountRate, terminalGrowth - 0.005) },
        { param: "terminalGrowth", value: round3(terminalGrowth + 0.005), enterpriseValue: evAt(baseFcf, fcfGrowth, projectionYears, discountRate, terminalGrowth + 0.005) },
      ];
    }
  }

  // --- Key risks (deterministic). ---
  if (input.baseFcf != null && input.baseFcf <= 0) keyRisks.push("Base FCF is non-positive — a DCF may not be meaningful; confirm the cash-flow basis.");
  if (enterpriseValue != null && pvTerminal != null && enterpriseValue > 0 && pvTerminal / enterpriseValue >= 0.75) {
    keyRisks.push(`Terminal value is ~${Math.round((pvTerminal / enterpriseValue) * 100)}% of enterprise value — the result is highly sensitive to the terminal assumptions.`);
  }
  if (input.fcfGrowth != null && input.fcfGrowth > 0.15) keyRisks.push(`Aggressive FCF growth assumed (${pct(input.fcfGrowth)}) — validate the growth case.`);
  if (assumptionsUsed.length > 0) keyRisks.push("Result rests on default assumptions (see assumptionsUsed) — replace with company-specific inputs before relying on it.");

  // --- Completeness / confidence / recommendation. ---
  const MATERIAL = ["baseFcf", "discountRate", "fcfGrowth", "projectionYears", "terminalGrowth", "netDebt", "sharesOutstanding"] as const;
  const present = MATERIAL.filter((k) => input[k] != null).length;
  const completeness = Math.round((present / MATERIAL.length) * 100) / 100;
  const confidence = Math.max(0.2, Math.min(0.9, 0.3 + completeness * 0.5 - assumptionsUsed.length * 0.05));

  const recommendedAction = !computable
    ? "Provide base FCF and a discount rate (WACC) to compute a DCF valuation."
    : enterpriseValue == null
      ? "Set a discount rate above the terminal growth rate, then re-run the DCF."
      : `DCF complete — enterprise value ~$${enterpriseValue}M${perShare != null ? ` (~$${perShare}/share)` : ""}. Stress the discount rate and terminal growth (sensitivities provided), then advance to an IC memo.`;

  const structured: DcfOutput = {
    enterpriseValue,
    equityValue,
    perShare,
    pvExplicit,
    pvTerminal,
    terminalValue,
    cashFlows,
    sensitivities,
    assumptionsUsed,
    missingFields,
    keyRisks,
    recommendedAction,
  };

  const narrative = !computable
    ? `DCF for ${input.companyName} not computable — missing ${missingFields.filter((f) => f !== "Shares outstanding").join(", ") || "required inputs"}. Next: ${recommendedAction}`
    : enterpriseValue == null
      ? `DCF for ${input.companyName} halted — ${GUARD_RISK.toLowerCase()}. Next: ${recommendedAction}`
      : `DCF for ${input.companyName}: enterprise value ~$${enterpriseValue}M` +
        `${equityValue != null ? ` / equity ~$${equityValue}M` : ""}` +
        `${perShare != null ? ` (~$${perShare}/share)` : ""} over ${projectionYears}y` +
        `${assumptionsUsed.length ? ` on ${assumptionsUsed.length} default assumption(s)` : ""}. Next: ${recommendedAction}`;

  return { structured, narrative, sources, confidence, completeness, missingData: missingFields };
};

// ---------------------------------------------------------------------------
// Schemas + manifest
// ---------------------------------------------------------------------------

const inputSchema: JsonSchema = {
  type: "object",
  required: ["companyName"],
  properties: {
    companyName: { type: "string", minLength: 1 },
    baseFcf: { type: "number" },
    projectionYears: { type: "integer", minimum: 1 },
    fcfGrowth: { type: "number" },
    discountRate: { type: "number" },
    terminalGrowth: { type: "number" },
    netDebt: { type: "number" },
    sharesOutstanding: { type: "number", minimum: 0 },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["enterpriseValue", "cashFlows", "sensitivities", "recommendedAction"],
  properties: {
    enterpriseValue: { type: "number" },
    equityValue: { type: "number" },
    perShare: { type: "number" },
    pvExplicit: { type: "number" },
    pvTerminal: { type: "number" },
    terminalValue: { type: "number" },
    cashFlows: {
      type: "array",
      items: {
        type: "object",
        required: ["year", "fcf", "pv"],
        properties: {
          year: { type: "integer" },
          fcf: { type: "number" },
          pv: { type: "number" },
        },
      },
    },
    sensitivities: {
      type: "array",
      items: {
        type: "object",
        required: ["param", "value"],
        properties: {
          param: { type: "string" },
          value: { type: "number" },
          enterpriseValue: { type: "number" },
        },
      },
    },
    assumptionsUsed: { type: "array", items: { type: "string" } },
    missingFields: { type: "array", items: { type: "string" } },
    keyRisks: { type: "array", items: { type: "string" } },
    recommendedAction: { type: "string" },
  },
};

export const dcfManifest: SkillManifest = {
  id: "dcf",
  name: "Discounted Cash Flow",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "run",
  applicableExecutives: ["analyst"],
  supportedEntityTypes: ["deal", "company", "financial_model"],
  requiredInputs: ["companyName"],
  optionalInputs: ["baseFcf", "projectionYears", "fcfGrowth", "discountRate", "terminalGrowth", "netDebt", "sharesOutstanding"],
  outputs: ["enterpriseValue", "equityValue", "perShare", "pvExplicit", "pvTerminal", "terminalValue", "cashFlows", "sensitivities", "assumptionsUsed", "missingFields", "keyRisks", "recommendedAction"],
  artifactTypes: ["model", "analysis"],
  dataPermissions: ["deal:read", "financial_model:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "no fabricated financial values", "assumptions labelled, not presented as facts"],
  evaluationCriteria: ["correct DCF math on golden cases", "missing data flagged not invented", "assumptions labelled", "terminal-growth guard enforced", "sensitivities present"],
  providerCapabilities: ["financial_reasoning"],
  allowedDownstreamSkills: ["ic-memo"],
  prohibitedActions: ["send_outreach", "distribute_report", "sign_document", "move_capital"],
  inputSchema,
  outputSchema,
};

export const dcf: SkillDefinition<DcfInput, DcfOutput> = {
  manifest: dcfManifest,
  run,
};
