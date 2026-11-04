// lib/skills/catalog/debt-structure.ts
// Debt Structure (PE department · Valuation 05). Sizes and shapes the debt package
// from the tranches the user proposes and tests whether the business can carry it
// in the supplied operating and downside cases:
//   * leverage, interest cover and fixed-charge cover per test period;
//   * the covenants the user lists, tested in both cases, with headroom reported at
//     the TIGHTEST period (never a year average);
//   * the structure against the firm's financing limits.
// It structures from supplied numbers and invents none. The balance rolls with
// mandatory amortisation only (no cash sweep or optional prepayment — labelled), and
// every ratio is on the MODEL's definition: the lender's credit-agreement definition
// decides headroom, so a covenant not tied to a term-sheet source is flagged. Pure core.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";
import { DEFAULT_FINANCING, type FinancingPolicy } from "@/lib/pe/financing-policy";

export type Seniority = "senior" | "junior";

export interface TrancheIn {
  name: string;
  seniority: Seniority;
  /** Principal. Give exactly one of amount / multiple. */
  amount?: number;
  /** Principal as a multiple of entry EBITDA. */
  multiple?: number;
  /** Floating tranche: margin over the shared base rate, in basis points. */
  marginBps?: number;
  /** Fixed-rate tranche: all-in rate, percent. */
  fixedRatePct?: number;
  /** Mandatory amortisation, percent of the ORIGINAL principal per year. */
  amortPctPerYear: number;
  tenorYears?: number;
}

export interface PeriodIn {
  label: string;
  /** Covenant-measured (LTM) EBITDA at this test date. */
  ebitdaLtm: number;
  /** Length of the period in years, for interest and amortisation. Default 1. */
  periodYears?: number;
  capex?: number;
  cashTaxes?: number;
}

export interface CaseIn {
  periods: PeriodIn[];
}

export type CovenantKind = "maxLeverage" | "minInterestCover" | "minFixedChargeCover";

export interface CovenantIn {
  name: string;
  kind: CovenantKind;
  threshold: number;
  /** Term-sheet / credit-agreement source of the definition. Absent = flagged. */
  definitionSource?: string;
}

export interface DebtStructureInput {
  dealName: string;
  entryEbitda: number;
  tranches: TrancheIn[];
  /** Shared base rate for floating tranches, percent. */
  baseRatePct?: number;
  /** Total uses (price + fees), to test the equity contribution against policy. */
  totalUses?: number;
  base: CaseIn;
  downside?: CaseIn;
  covenants?: CovenantIn[];
  financing?: FinancingPolicy;
  gateOwner?: string;
}

export interface ResolvedTranche {
  name: string;
  seniority: Seniority;
  amount: number | null;
  multiple: number | null;
  ratePct: number | null;
  annualInterest: number | null;
  annualAmort: number;
  issue: string | null;
}

export interface PeriodRow {
  period: string;
  ebitdaLtm: number;
  openingDebt: number;
  interest: number | null;
  mandatoryAmort: number;
  closingDebt: number;
  leverage: number | null;
  interestCover: number | null;
  fixedChargeCover: number | null;
}

export type CovenantStatus = "ok" | "warning" | "breach" | "not-tested";

export interface CovenantResult {
  name: string;
  kind: CovenantKind;
  threshold: number;
  definitionSource: string | null;
  base: { tightestPeriod: string | null; metric: number | null; headroomPct: number | null; status: CovenantStatus };
  downside: { tightestPeriod: string | null; metric: number | null; headroomPct: number | null; status: CovenantStatus } | null;
}

export interface PolicyCheck {
  check: string;
  result: "pass" | "fail" | "not-tested";
  detail: string;
}

export interface DebtStructureOutput {
  tranches: ResolvedTranche[];
  closing: { totalDebt: number | null; totalLeverage: number | null; seniorLeverage: number | null; equityPctOfSources: number | null };
  base: PeriodRow[];
  downside: PeriodRow[] | null;
  covenants: CovenantResult[];
  policyChecks: PolicyCheck[];
  financingPolicyIsDefault: boolean;
  assumptions: string[];
  limitation: string;
  gate: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function resolveTranche(t: TrancheIn, entryEbitda: number, baseRatePct: number | undefined): ResolvedTranche {
  let issue: string | null = null;
  let amount: number | null = null;
  // Ambiguous size (both given) leaves the amount unset rather than picking one.
  if (t.amount !== undefined && t.multiple !== undefined) issue = "Give either an amount or a multiple, not both.";
  else if (t.amount !== undefined) amount = t.amount;
  else if (t.multiple !== undefined) amount = t.multiple * entryEbitda;
  else issue = "No size: give an amount or a multiple of EBITDA.";

  let ratePct: number | null = null;
  if (t.fixedRatePct !== undefined && t.marginBps !== undefined) issue = issue ?? "Give either a fixed rate or a margin, not both.";
  else if (t.fixedRatePct !== undefined) ratePct = t.fixedRatePct;
  else if (t.marginBps !== undefined) {
    if (baseRatePct === undefined) issue = issue ?? "Floating tranche needs the base rate.";
    else ratePct = baseRatePct + t.marginBps / 100;
  } else issue = issue ?? "No pricing: give a margin (with the base rate) or a fixed rate.";

  const usable = amount !== null && ratePct !== null && !issue;
  return {
    name: t.name,
    seniority: t.seniority,
    amount: amount === null ? null : r2(amount),
    multiple: amount === null || entryEbitda <= 0 ? null : r2(amount / entryEbitda),
    ratePct: ratePct === null ? null : r2(ratePct),
    annualInterest: usable ? r2((amount as number) * (ratePct as number) / 100) : null,
    annualAmort: amount === null ? 0 : r2((amount * t.amortPctPerYear) / 100),
    issue,
  };
}

/** Roll the balance with mandatory amortisation only; interest is annualised on the opening balance. */
function runCase(c: CaseIn, tranches: ResolvedTranche[], inputTranches: TrancheIn[]): PeriodRow[] {
  const usable = tranches.every((t) => t.annualInterest !== null && t.amount !== null);
  const balances = tranches.map((t) => t.amount ?? 0);
  const rows: PeriodRow[] = [];
  for (const p of c.periods) {
    const years = p.periodYears ?? 1;
    const opening = balances.reduce((s, b) => s + b, 0);
    // Annualised interest on the opening balances, at each tranche's rate.
    const interest = usable ? balances.reduce((s, b, i) => s + (b * (tranches[i].ratePct as number)) / 100, 0) : null;
    let amortAnnualised = 0;
    let amortInPeriod = 0;
    balances.forEach((b, i) => {
      const annual = Math.min(b, (inputTranches[i].amortPctPerYear / 100) * (tranches[i].amount ?? 0));
      amortAnnualised += annual;
      const inPeriod = Math.min(b, annual * years);
      amortInPeriod += inPeriod;
      balances[i] = b - inPeriod;
    });
    const closing = balances.reduce((s, b) => s + b, 0);
    const lev = p.ebitdaLtm > 0 ? closing / p.ebitdaLtm : null;
    const ic = interest !== null && interest > 0 ? p.ebitdaLtm / interest : null;
    const fixedCharges = interest !== null ? interest + amortAnnualised : null;
    const fccr =
      fixedCharges !== null && fixedCharges > 0 && p.capex !== undefined && p.cashTaxes !== undefined ? (p.ebitdaLtm - p.capex - p.cashTaxes) / fixedCharges : null;
    rows.push({
      period: p.label,
      ebitdaLtm: p.ebitdaLtm,
      openingDebt: r2(opening),
      interest: interest === null ? null : r2(interest),
      mandatoryAmort: r2(amortInPeriod),
      closingDebt: r2(closing),
      leverage: lev === null ? null : r2(lev),
      interestCover: ic === null ? null : r2(ic),
      fixedChargeCover: fccr === null ? null : r2(fccr),
    });
  }
  return rows;
}

function metricFor(kind: CovenantKind, row: PeriodRow): number | null {
  return kind === "maxLeverage" ? row.leverage : kind === "minInterestCover" ? row.interestCover : row.fixedChargeCover;
}

function testCovenant(cov: CovenantIn, rows: PeriodRow[], warnPct: number): CovenantResult["base"] {
  let tight: { period: string; metric: number; headroom: number } | null = null;
  for (const row of rows) {
    const m = metricFor(cov.kind, row);
    if (m === null || cov.threshold <= 0) continue;
    const headroom = cov.kind === "maxLeverage" ? ((cov.threshold - m) / cov.threshold) * 100 : ((m - cov.threshold) / cov.threshold) * 100;
    if (!tight || headroom < tight.headroom) tight = { period: row.period, metric: m, headroom };
  }
  if (!tight) return { tightestPeriod: null, metric: null, headroomPct: null, status: "not-tested" };
  const status: CovenantStatus = tight.headroom < 0 ? "breach" : tight.headroom < warnPct ? "warning" : "ok";
  return { tightestPeriod: tight.period, metric: tight.metric, headroomPct: r2(tight.headroom), status };
}

const run: SkillCore<DebtStructureInput, DebtStructureOutput> = (input): SkillCoreResult<DebtStructureOutput> => {
  const sources: SkillSource[] = [{ label: "Entry EBITDA", kind: "fact", value: input.entryEbitda }];
  const missingData: string[] = [];
  const assumptions = ["No cash sweep or optional prepayment: the balance falls by mandatory amortisation only.", "Interest is annualised on each period's opening balance."];
  const policy = input.financing ?? DEFAULT_FINANCING;
  const policyIsDefault = !input.financing;
  if (policyIsDefault) sources.push({ label: "Financing policy", kind: "assumption", value: "standing default: max senior leverage 4.0x, covenant warning at 20% headroom", ref: "run on default settings — set root-financing" });
  for (const a of assumptions) sources.push({ label: "Modelling assumption", kind: "assumption", value: a });

  const tranches = input.tranches.map((t) => resolveTranche(t, input.entryEbitda, input.baseRatePct));
  for (const t of tranches) if (t.issue) missingData.push(`${t.name}: ${t.issue}`);

  const allSized = tranches.length > 0 && tranches.every((t) => t.amount !== null);
  const totalDebt = allSized ? r2(tranches.reduce((s, t) => s + (t.amount as number), 0)) : null;
  const seniorDebt = allSized ? tranches.filter((t) => t.seniority === "senior").reduce((s, t) => s + (t.amount as number), 0) : null;
  const totalLeverage = totalDebt !== null && input.entryEbitda > 0 ? r2(totalDebt / input.entryEbitda) : null;
  const seniorLeverage = seniorDebt !== null && input.entryEbitda > 0 ? r2(seniorDebt / input.entryEbitda) : null;
  const equityPct = totalDebt !== null && input.totalUses !== undefined && input.totalUses > 0 ? r2(((input.totalUses - totalDebt) / input.totalUses) * 100) : null;
  if (totalDebt !== null) sources.push({ label: "Total debt at close", kind: "calculation", value: totalDebt, ref: "sum of tranche principal" });

  const baseRows = runCase(input.base, tranches, input.tranches);
  const downsideRows = input.downside ? runCase(input.downside, tranches, input.tranches) : null;
  if (!input.downside) missingData.push("No downside case — the structure is not stress-tested");

  // Covenants, both cases, tightest period.
  const covenants: CovenantResult[] = (input.covenants ?? []).map((c) => {
    const defined = !!c.definitionSource?.trim();
    if (!defined) missingData.push(`Covenant "${c.name}" cites no term-sheet source — headroom is on the model's definition, not the lender's`);
    return {
      name: c.name,
      kind: c.kind,
      threshold: c.threshold,
      definitionSource: defined ? (c.definitionSource as string).trim() : null,
      base: testCovenant(c, baseRows, policy.covenantWarnHeadroomPct),
      downside: downsideRows ? testCovenant(c, downsideRows, policy.covenantWarnHeadroomPct) : null,
    };
  });

  // Firm financing limits.
  const policyChecks: PolicyCheck[] = [];
  const limit = (check: string, value: number | null, max: number | undefined, unit: string) => {
    if (max === undefined) policyChecks.push({ check, result: "not-tested", detail: "The firm sets no limit." });
    else if (value === null) policyChecks.push({ check, result: "not-tested", detail: "Cannot be computed from the inputs." });
    else policyChecks.push({ check, result: value <= max ? "pass" : "fail", detail: `${value}${unit} against a limit of ${max}${unit}.` });
  };
  limit("Senior leverage at close", seniorLeverage, policy.maxSeniorLeverage, "x");
  limit("Total leverage at close", totalLeverage, policy.maxTotalLeverage, "x");
  if (policy.minInterestCoverDownside === undefined) policyChecks.push({ check: "Interest cover in the downside", result: "not-tested", detail: "The firm sets no minimum." });
  else if (!downsideRows) policyChecks.push({ check: "Interest cover in the downside", result: "not-tested", detail: "No downside case supplied." });
  else {
    const covers = downsideRows.map((r) => r.interestCover).filter((x): x is number => x !== null);
    if (!covers.length) policyChecks.push({ check: "Interest cover in the downside", result: "not-tested", detail: "Cannot be computed from the inputs." });
    else {
      const lowest = Math.min(...covers);
      policyChecks.push({ check: "Interest cover in the downside", result: lowest >= policy.minInterestCoverDownside ? "pass" : "fail", detail: `Lowest ${lowest}x against a minimum of ${policy.minInterestCoverDownside}x.` });
    }
  }
  if (policy.minEquityPct === undefined) policyChecks.push({ check: "Equity contribution", result: "not-tested", detail: "The firm sets no minimum." });
  else if (equityPct === null) policyChecks.push({ check: "Equity contribution", result: "not-tested", detail: "Give total uses to test the equity share of sources." });
  else policyChecks.push({ check: "Equity contribution", result: equityPct >= policy.minEquityPct ? "pass" : "fail", detail: `${equityPct}% of sources against a minimum of ${policy.minEquityPct}%.` });

  const gateOwner = input.gateOwner?.trim() || "The financing lead";
  const gate = `${gateOwner} approves the structure before lenders see it.`;
  const limitation = "Covenant definitions in the final documents decide headroom. A metric on this model's definition may differ from the lender's: check every figure against the credit agreement.";

  const breaches = covenants.flatMap((c) => [c.base.status === "breach" ? `${c.name} (operating case)` : "", c.downside?.status === "breach" ? `${c.name} (downside)` : ""]).filter(Boolean);
  const failed = policyChecks.filter((p) => p.result === "fail").map((p) => p.check);
  const narrative =
    `Debt structure, ${input.dealName}: ${totalDebt ?? "n/a"} total (${totalLeverage ?? "n/a"}x, senior ${seniorLeverage ?? "n/a"}x). ` +
    `${breaches.length ? `Covenant BREACH: ${breaches.join(", ")}. ` : covenants.length ? "No covenant breach in the cases tested. " : ""}` +
    `${failed.length ? `Outside firm limits: ${failed.join(", ")}. ` : ""}${gate}`;

  const completeness = Math.round(((allSized ? 1 : 0) + (downsideRows ? 1 : 0) + (covenants.length && covenants.every((c) => c.definitionSource) ? 1 : 0)) / 3 * 100) / 100;
  return {
    structured: {
      tranches,
      closing: { totalDebt, totalLeverage, seniorLeverage, equityPctOfSources: equityPct },
      base: baseRows,
      downside: downsideRows,
      covenants,
      policyChecks,
      financingPolicyIsDefault: policyIsDefault,
      assumptions,
      limitation,
      gate,
    },
    narrative,
    sources,
    confidence: Math.max(0.25, Math.min(0.85, 0.3 + completeness * 0.5)),
    completeness,
    missingData,
  };
};

const period: JsonSchema = {
  type: "object",
  required: ["label", "ebitdaLtm"],
  properties: { label: { type: "string", minLength: 1 }, ebitdaLtm: { type: "number" }, periodYears: { type: "number", minimum: 0 }, capex: { type: "number", minimum: 0 }, cashTaxes: { type: "number", minimum: 0 } },
};
const caseSchema: JsonSchema = { type: "object", required: ["periods"], properties: { periods: { type: "array", items: period } } };

const inputSchema: JsonSchema = {
  type: "object",
  required: ["dealName", "entryEbitda", "tranches", "base"],
  properties: {
    dealName: { type: "string", minLength: 1 },
    entryEbitda: { type: "number", minimum: 0 },
    tranches: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "seniority", "amortPctPerYear"],
        properties: {
          name: { type: "string", minLength: 1 },
          seniority: { type: "string", enum: ["senior", "junior"] },
          amount: { type: "number", minimum: 0 },
          multiple: { type: "number", minimum: 0 },
          marginBps: { type: "number", minimum: 0 },
          fixedRatePct: { type: "number", minimum: 0 },
          amortPctPerYear: { type: "number", minimum: 0, maximum: 100 },
          tenorYears: { type: "number", minimum: 0 },
        },
      },
    },
    baseRatePct: { type: "number", minimum: 0 },
    totalUses: { type: "number", minimum: 0 },
    base: caseSchema,
    downside: caseSchema,
    covenants: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "kind", "threshold"],
        properties: { name: { type: "string", minLength: 1 }, kind: { type: "string", enum: ["maxLeverage", "minInterestCover", "minFixedChargeCover"] }, threshold: { type: "number" }, definitionSource: { type: "string" } },
      },
    },
    financing: {
      type: "object",
      properties: { maxSeniorLeverage: { type: "number" }, maxTotalLeverage: { type: "number" }, minInterestCoverDownside: { type: "number" }, minEquityPct: { type: "number" }, covenantWarnHeadroomPct: { type: "number" } },
    },
    gateOwner: { type: "string" },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["tranches", "closing", "base", "covenants", "policyChecks", "financingPolicyIsDefault", "assumptions", "limitation", "gate"],
  properties: {
    tranches: { type: "array", items: { type: "object", required: ["name", "seniority", "annualAmort"] } },
    closing: { type: "object" },
    base: { type: "array", items: { type: "object", required: ["period", "openingDebt", "closingDebt"] } },
    downside: { type: "array", items: { type: "object", required: ["period", "openingDebt", "closingDebt"] } },
    covenants: { type: "array", items: { type: "object", required: ["name", "kind", "threshold", "base"] } },
    policyChecks: { type: "array", items: { type: "object", required: ["check", "result", "detail"] } },
    financingPolicyIsDefault: { type: "boolean" },
    assumptions: { type: "array", items: { type: "string" } },
    limitation: { type: "string" },
    gate: { type: "string" },
  },
};

export const debtStructureManifest: SkillManifest = {
  id: "debt-structure",
  name: "Debt Structure",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "run",
  applicableExecutives: ["analyst", "legal_closing"],
  supportedEntityTypes: ["deal"],
  requiredInputs: ["dealName", "entryEbitda", "tranches", "base"],
  optionalInputs: ["baseRatePct", "totalUses", "downside", "covenants", "financing", "gateOwner"],
  outputs: ["tranches", "closing", "base", "downside", "covenants", "policyChecks", "gate"],
  artifactTypes: ["model"],
  dataPermissions: ["deal:read", "valuation:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "moderate",
  executionTimeoutMs: 10_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "covenant headroom at the tightest period", "covenant definition tied to a term-sheet source"],
  evaluationCriteria: ["tranche sizing and pricing resolved", "balance rolls with amortisation only", "headroom at tightest period in both cases", "firm limits tested, default policy labelled"],
  providerCapabilities: ["financial_reasoning"],
  allowedDownstreamSkills: ["financing-terms", "bid-range", "covenant-watch", "ic-memo"],
  prohibitedActions: ["send_outreach", "distribute_report", "share_materials", "submit_term_sheet", "sign_document", "move_capital"],
  inputSchema,
  outputSchema,
};

export const debtStructure: SkillDefinition<DebtStructureInput, DebtStructureOutput> = { manifest: debtStructureManifest, run };
